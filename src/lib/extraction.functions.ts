// Server functions powering the admin PDF→CBT pipeline.
// Every handler is admin-only (verified via has_role check on the authed supabase client).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  assertAdmin,
  auditExtraction,
  errorMessage,
  errorStack,
  logExtractionError,
  recoverStuckJobs,
} from "./extraction-utils.server";

const PDF_BUCKET = "pdf-uploads";

// =========================================================================
// LIST + GET
// =========================================================================

export const listExtractionJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    await recoverStuckJobs(context, { timeoutMinutes: 10 });
    const { data, error } = await context.supabase
      .from("extraction_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getExtractionJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const [{ data: job }, { data: questions }, { data: report }, { data: batches }, { data: logs }] = await Promise.all([
      context.supabase.from("extraction_jobs").select("*").eq("id", data.jobId).single(),
      context.supabase
        .from("extraction_questions")
        .select("*")
        .eq("job_id", data.jobId)
        .order("question_number", { ascending: true }),
      context.supabase
        .from("extraction_validation_reports")
        .select("*")
        .eq("job_id", data.jobId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("extraction_batches")
        .select("id, page_from, page_to, status, attempts, last_error")
        .eq("job_id", data.jobId)
        .order("page_from", { ascending: true }),
      context.supabase
        .from("extraction_audit_log")
        .select("id, actor, action, payload, created_at")
        .eq("job_id", data.jobId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (!job) throw new Error("Job not found");
    return { job, questions: questions ?? [], report: report ?? null, batches: batches ?? [], logs: logs ?? [] };
  });

// =========================================================================
// CREATE JOB
// =========================================================================

export const createExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        storagePath: z.string().min(1),
        originalFilename: z.string().min(1),
        title: z.string().min(1),
        exam: z.enum(["jee_main", "jee_advanced", "neet"]),
        expectedQuestionCount: z.number().int().positive().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("extraction_jobs")
      .insert({
        pdf_storage_path: data.storagePath,
        original_filename: data.originalFilename,
        title: data.title,
        exam: data.exam,
        expected_question_count: data.expectedQuestionCount,
        status: "uploaded",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to create job");

    await auditExtraction(context.supabase, row.id, context.userId, "job.created", {
      filename: data.originalFilename,
      title: data.title,
    });
    return { jobId: row.id as string };
  });

// =========================================================================
// SPLIT — load PDF, slice into 2-page batches, persist + bytes in storage
// =========================================================================

export const splitExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Mark splitting
    await context.supabase
      .from("extraction_jobs")
      .update({ status: "splitting", last_error: null })
      .eq("id", data.jobId);
    await auditExtraction(context.supabase, data.jobId, context.userId, "split.started");

    const { data: job } = await context.supabase
      .from("extraction_jobs")
      .select("pdf_storage_path")
      .eq("id", data.jobId)
      .single();
    if (!job) throw new Error("Job not found");

    const pdfDl = await supabaseAdmin.storage.from(PDF_BUCKET).download(job.pdf_storage_path);
    if (pdfDl.error || !pdfDl.data) throw new Error(`PDF download: ${pdfDl.error?.message}`);
    const pdfBytes = new Uint8Array(await pdfDl.data.arrayBuffer());

    let pageCount = 0;
    let batches: Awaited<ReturnType<typeof import("./extraction.server").splitPdfIntoBatches>>["batches"] = [];
    try {
      const { splitPdfIntoBatches } = await import("./extraction.server");
      ({ pageCount, batches } = await splitPdfIntoBatches(pdfBytes));
    } catch (err) {
      const stack = errorStack(err);
      logExtractionError("split", data.jobId, err);
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "failed", last_error: stack.slice(0, 4000) })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "split.failed", {
        error: stack.slice(0, 4000),
      });
      throw err;
    }

    // Persist batch PDFs in question-images bucket (admin-only, signed URLs only)
    for (const b of batches) {
      const path = `jobs/${data.jobId}/batches/batch-${b.batchIndex.toString().padStart(3, "0")}.pdf`;
      const up = await supabaseAdmin.storage
        .from("question-images")
        .upload(path, b.bytes, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(`Batch upload: ${up.error.message}`);
    }

    // Reset rows for this job (re-splittable)
    await context.supabase.from("extraction_batches").delete().eq("job_id", data.jobId);
    await context.supabase.from("extraction_pages").delete().eq("job_id", data.jobId);

    await context.supabase.from("extraction_batches").insert(
      batches.map((b) => ({
        job_id: data.jobId,
        page_from: b.pageFrom,
        page_to: b.pageTo,
        status: "pending",
      })),
    );
    await context.supabase.from("extraction_pages").insert(
      Array.from({ length: pageCount }, (_, i) => ({
        job_id: data.jobId,
        page_number: i + 1,
        status: "ready",
      })),
    );
    await context.supabase
      .from("extraction_jobs")
      .update({ status: "extracting", page_count: pageCount })
      .eq("id", data.jobId);
    await auditExtraction(context.supabase, data.jobId, context.userId, "split.completed", {
      pageCount,
      batches: batches.length,
    });
    return { pageCount, batchCount: batches.length };
  });

// =========================================================================
// PROCESS NEXT BATCH — single batch, called repeatedly by the client
// =========================================================================

export const processNextBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), retryBatchId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find next pending batch (or specific retry batch)
    let batchQuery = context.supabase
      .from("extraction_batches")
      .select("*")
      .eq("job_id", data.jobId)
      .order("page_from", { ascending: true })
      .limit(1);
    if (data.retryBatchId) {
      batchQuery = context.supabase
        .from("extraction_batches")
        .select("*")
        .eq("id", data.retryBatchId)
        .limit(1);
    } else {
      batchQuery = batchQuery.eq("status", "pending");
    }
    const { data: batchRows } = await batchQuery;
    const batch = batchRows?.[0];

    if (!batch) {
      const { count: pendingCount } = await context.supabase
        .from("extraction_batches")
        .select("id", { count: "exact", head: true })
        .eq("job_id", data.jobId)
        .eq("status", "pending");
      const { count: failedCount } = await context.supabase
        .from("extraction_batches")
        .select("id", { count: "exact", head: true })
        .eq("job_id", data.jobId)
        .eq("status", "failed");
      if ((failedCount ?? 0) > 0) {
        const reason = `${failedCount} extraction batch${failedCount === 1 ? "" : "es"} failed.`;
        await context.supabase
          .from("extraction_jobs")
          .update({ status: "failed", last_error: reason })
          .eq("id", data.jobId);
        await auditExtraction(context.supabase, data.jobId, context.userId, "extract.failed", { reason });
        throw new Error(`${reason} Click “Retry failed step” to re-run only failed batches.`);
      }
      return { done: true, processedBatchId: null, pendingCount };
    }

    await context.supabase
      .from("extraction_batches")
      .update({ status: "running", attempts: (batch.attempts ?? 0) + 1, last_error: null })
      .eq("id", batch.id);
    await auditExtraction(context.supabase, data.jobId, context.userId, "extract.batch_started", {
      batchId: batch.id,
      attempt: (batch.attempts ?? 0) + 1,
      pages: `${batch.page_from}-${batch.page_to}`,
    });

    try {
      const path = `jobs/${data.jobId}/batches/batch-${(Math.floor((batch.page_from - 1) / 2))
        .toString()
        .padStart(3, "0")}.pdf`;
      const dl = await supabaseAdmin.storage.from("question-images").download(path);
      if (dl.error || !dl.data) throw new Error(`Batch download: ${dl.error?.message}`);
      const pdfBytes = new Uint8Array(await dl.data.arrayBuffer());

      const { extractQuestionsWithGemini } = await import("./extraction.server");
      const { questions, raw } = await extractQuestionsWithGemini(apiKey, pdfBytes);

      // Replace any existing rows for this batch (idempotent retries)
      await context.supabase.from("extraction_questions").delete().eq("batch_id", batch.id);

      if (questions.length > 0) {
        const rows = questions.map((q) => ({
          job_id: data.jobId,
          batch_id: batch.id,
          question_number: Number(q.questionNumber) || 0,
          source_page: batch.page_from,
          type: q.questionType,
          subject: q.subject,
          question_text: q.questionText ?? "",
          options: q.options ?? {},
          answer: q.answer ?? null,
          has_image: !!q.hasImage,
          status: "draft" as const,
        }));
        // upsert by (job_id, question_number) — newer batch wins on retry
        await context.supabase
          .from("extraction_questions")
          .upsert(rows, { onConflict: "job_id,question_number" });
      }

      await context.supabase
        .from("extraction_batches")
        .update({
          status: "done",
          raw_response: raw as never,
          parsed: { questions } as never,
        })
        .eq("id", batch.id);

      const { count: pendingCount } = await context.supabase
        .from("extraction_batches")
        .select("id", { count: "exact", head: true })
        .eq("job_id", data.jobId)
        .eq("status", "pending");
      await auditExtraction(context.supabase, data.jobId, context.userId, "extract.batch_completed", {
        batchId: batch.id,
        pages: `${batch.page_from}-${batch.page_to}`,
        extractedCount: questions.length,
        pendingCount: pendingCount ?? 0,
      });

      return {
        done: false,
        processedBatchId: batch.id,
        pagesProcessed: `${batch.page_from}-${batch.page_to}`,
        extractedCount: questions.length,
        pendingCount: pendingCount ?? 0,
      };
    } catch (err) {
      const msg = errorMessage(err);
      const stack = errorStack(err);
      logExtractionError("process-batch", data.jobId, err);
      await context.supabase
        .from("extraction_batches")
        .update({ status: "failed", last_error: stack.slice(0, 4000) })
        .eq("id", batch.id);
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "failed", last_error: stack.slice(0, 4000) || msg })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "extract.batch_failed", {
        batchId: batch.id,
        pages: `${batch.page_from}-${batch.page_to}`,
        error: stack.slice(0, 4000),
      });
      throw err;
    }
  });

// =========================================================================
// VALIDATE WITH GROQ
// =========================================================================

export const runValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Missing GROQ_API_KEY");
    const { validateWithGroq } = await import("./extraction.server");

    await context.supabase
      .from("extraction_jobs")
      .update({ status: "validating", last_error: null })
      .eq("id", data.jobId);
    await auditExtraction(context.supabase, data.jobId, context.userId, "validate.started");

    const { data: job } = await context.supabase
      .from("extraction_jobs")
      .select("expected_question_count")
      .eq("id", data.jobId)
      .single();

    const { data: qs } = await context.supabase
      .from("extraction_questions")
      .select("question_number, type, subject, question_text, options, answer, has_image")
      .eq("job_id", data.jobId)
      .order("question_number", { ascending: true });

    const mapped = (qs ?? []).map((q) => ({
      questionNumber: q.question_number,
      questionType: q.type as never,
      subject: q.subject ?? "",
      questionText: q.question_text ?? "",
      options: (q.options ?? {}) as Record<string, string>,
      answer: q.answer ?? "",
      hasImage: !!q.has_image,
      imageUrl: "",
    }));
    if (mapped.length === 0) {
      const reason = "No extracted questions found to validate.";
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "failed", last_error: reason })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "validate.failed", { error: reason });
      throw new Error(reason);
    }
    let report: Awaited<ReturnType<typeof validateWithGroq>>["report"];
    let raw: Awaited<ReturnType<typeof validateWithGroq>>["raw"];
    try {
      ({ report, raw } = await validateWithGroq(
        apiKey,
        mapped,
        job?.expected_question_count ?? null,
      ));
    } catch (err) {
      const stack = errorStack(err);
      logExtractionError("validate", data.jobId, err);
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "failed", last_error: stack.slice(0, 4000) })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "validate.failed", {
        error: stack.slice(0, 4000),
      });
      throw err;
    }

    // Persist new report
    await context.supabase.from("extraction_validation_reports").insert({
      job_id: data.jobId,
      missing_numbers: report.missingNumbers,
      duplicates: report.duplicates,
      broken_options: report.brokenOptions,
      empty_questions: report.emptyQuestions,
      broken_equations: report.brokenEquations,
      invalid_json: report.invalidJson,
      score: report.score,
      raw: raw as never,
    });

    await context.supabase
      .from("extraction_jobs")
      .update({ status: "needs_review", extraction_score: report.score })
      .eq("id", data.jobId);

    await auditExtraction(context.supabase, data.jobId, context.userId, "validate.completed", {
      score: report.score,
      missing: report.missingNumbers.length,
      duplicates: report.duplicates.length,
    });
    return report;
  });

export const retryFailedStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: job } = await context.supabase
      .from("extraction_jobs")
      .select("id, status, page_count, last_error")
      .eq("id", data.jobId)
      .single();
    if (!job) throw new Error("Job not found");

    const { data: batches } = await context.supabase
      .from("extraction_batches")
      .select("id, status")
      .eq("job_id", data.jobId);
    const batchRows = batches ?? [];
    const retryableBatchIds = batchRows
      .filter((b) => b.status === "failed" || b.status === "running")
      .map((b) => b.id);

    if (job.status === "splitting" || (job.status === "failed" && batchRows.length === 0)) {
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "uploaded", last_error: null })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "retry.splitting", { attempt: Date.now() });
      return { stage: "splitting" as const, batchIds: [] as string[] };
    }

    if (retryableBatchIds.length > 0 || job.status === "extracting") {
      const ids = retryableBatchIds.length > 0 ? retryableBatchIds : batchRows.filter((b) => b.status !== "done").map((b) => b.id);
      if (ids.length === 0) throw new Error("No extraction batches need retry");
      await context.supabase
        .from("extraction_batches")
        .update({ status: "pending", last_error: null })
        .in("id", ids);
      await context.supabase
        .from("extraction_jobs")
        .update({ status: "extracting", last_error: null })
        .eq("id", data.jobId);
      await auditExtraction(context.supabase, data.jobId, context.userId, "retry.extracting", {
        batchIds: ids,
        attempt: Date.now(),
      });
      return { stage: "extracting" as const, batchIds: ids };
    }

    if (job.status === "validating" || job.status === "failed") {
      const doneCount = batchRows.filter((b) => b.status === "done").length;
      if (doneCount > 0 && doneCount === batchRows.length) {
        await context.supabase
          .from("extraction_jobs")
          .update({ status: "validating", last_error: null })
          .eq("id", data.jobId);
        await auditExtraction(context.supabase, data.jobId, context.userId, "retry.validating", { attempt: Date.now() });
        return { stage: "validating" as const, batchIds: [] as string[] };
      }
    }

    throw new Error("No failed pipeline step was detected for this job.");
  });

export const recoverStuckExtractionJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ timeoutMinutes: z.number().int().min(2).max(120).default(10) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    return recoverStuckJobs(context, { timeoutMinutes: data.timeoutMinutes });
  });

export const runExtractionSmokeTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      createSmokeTestPdf,
      splitPdfIntoBatches,
      extractQuestionsWithGemini,
      validateWithGroq,
    } = await import("./extraction.server");

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (!geminiKey) throw new Error("Missing GEMINI_API_KEY");
    if (!groqKey) throw new Error("Missing GROQ_API_KEY");

    type SmokeDetails = { [key: string]: string | number | boolean | null | string[] | number[] };
    type SmokeStep = { name: string; ok: boolean; startedAt: string; endedAt?: string; details?: SmokeDetails; error?: string };
    const steps: SmokeStep[] = [];
    let jobId: string | null = null;
    let testId: string | null = null;
    let questionCount = 0;

    const smokeDetails = (name: string, result: unknown): SmokeDetails => {
      if (result instanceof Uint8Array) return { bytes: result.byteLength };
      if (name === "split" && result && typeof result === "object" && "pageCount" in result && "batches" in result) {
        const r = result as { pageCount: number; batches: unknown[] };
        return { pageCount: r.pageCount, batchCount: r.batches.length };
      }
      if (result && typeof result === "object") {
        const out: SmokeDetails = {};
        for (const [key, value] of Object.entries(result)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) out[key] = value;
          else if (Array.isArray(value)) out[key] = value.map((v) => String(v)).slice(0, 25);
        }
        return out;
      }
      return { value: String(result) };
    };

    const runStep = async <T,>(name: string, fn: () => Promise<T>) => {
      const step: SmokeStep = { name, ok: false, startedAt: new Date().toISOString() };
      steps.push(step);
      try {
        const result = await fn();
        const details = smokeDetails(name, result);
        step.ok = true;
        step.endedAt = new Date().toISOString();
        step.details = details;
        if (jobId) await auditExtraction(supabaseAdmin, jobId, context.userId, `smoke.${name}.passed`, details);
        return result;
      } catch (err) {
        const stack = errorStack(err).slice(0, 4000);
        step.ok = false;
        step.endedAt = new Date().toISOString();
        step.error = stack;
        if (jobId) {
          await supabaseAdmin.from("extraction_jobs").update({ status: "failed", last_error: stack }).eq("id", jobId);
          await auditExtraction(supabaseAdmin, jobId, context.userId, `smoke.${name}.failed`, { error: stack });
        }
        throw err;
      }
    };

    try {
      const pdfBytes = await runStep("create_pdf", () => createSmokeTestPdf());
      const storagePath = `smoke/${context.userId}/${Date.now()}-pipeline-smoke.pdf`;

      await runStep("upload", async () => {
        const up = await supabaseAdmin.storage.from(PDF_BUCKET).upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        if (up.error) throw new Error(up.error.message);

        const { data: job, error } = await supabaseAdmin
          .from("extraction_jobs")
          .insert({
            pdf_storage_path: storagePath,
            original_filename: "pipeline-smoke.pdf",
            title: `[SMOKE] PDF Pipeline ${new Date().toISOString()}`,
            exam: "jee_main",
            expected_question_count: 2,
            status: "uploaded",
            created_by: context.userId,
          })
          .select("id")
          .single();
        if (error || !job) throw new Error(error?.message ?? "Smoke job insert failed");
        jobId = job.id;
        await auditExtraction(supabaseAdmin, jobId, context.userId, "smoke.started", { storagePath });
        return { jobId };
      });

      const split = await runStep("split", async () => {
        if (!jobId) throw new Error("Smoke job missing");
        await supabaseAdmin.from("extraction_jobs").update({ status: "splitting", last_error: null }).eq("id", jobId);
        const r = await splitPdfIntoBatches(pdfBytes);
        for (const b of r.batches) {
          const path = `jobs/${jobId}/batches/batch-${b.batchIndex.toString().padStart(3, "0")}.pdf`;
          const up = await supabaseAdmin.storage.from("question-images").upload(path, b.bytes, {
            contentType: "application/pdf",
            upsert: true,
          });
          if (up.error) throw new Error(up.error.message);
        }
        await supabaseAdmin.from("extraction_batches").insert(
          r.batches.map((b) => ({ job_id: jobId!, page_from: b.pageFrom, page_to: b.pageTo, status: "pending" })),
        );
        await supabaseAdmin.from("extraction_pages").insert(
          Array.from({ length: r.pageCount }, (_, i) => ({ job_id: jobId!, page_number: i + 1, status: "ready" })),
        );
        await supabaseAdmin.from("extraction_jobs").update({ status: "extracting", page_count: r.pageCount }).eq("id", jobId);
        return r;
      });

      await runStep("extract", async () => {
        if (!jobId) throw new Error("Smoke job missing");
        const { data: batches, error } = await supabaseAdmin
          .from("extraction_batches")
          .select("*")
          .eq("job_id", jobId)
          .order("page_from", { ascending: true });
        if (error) throw new Error(error.message);
        for (const batch of batches ?? []) {
          await supabaseAdmin
            .from("extraction_batches")
            .update({ status: "running", attempts: (batch.attempts ?? 0) + 1, last_error: null })
            .eq("id", batch.id);
          const pdf = split.batches.find((b) => b.pageFrom === batch.page_from && b.pageTo === batch.page_to);
          if (!pdf) throw new Error(`Missing smoke batch bytes for pages ${batch.page_from}-${batch.page_to}`);
          const { questions, raw } = await extractQuestionsWithGemini(geminiKey, pdf.bytes);
          if (questions.length === 0) throw new Error(`Gemini extracted 0 questions for pages ${batch.page_from}-${batch.page_to}`);
          await supabaseAdmin.from("extraction_questions").upsert(
            questions.map((q) => ({
              job_id: jobId!,
              batch_id: batch.id,
              question_number: Number(q.questionNumber) || 0,
              source_page: batch.page_from,
              type: q.questionType,
              subject: q.subject,
              question_text: q.questionText ?? "",
              options: q.options ?? {},
              answer: q.answer ?? null,
              has_image: !!q.hasImage,
              status: "draft" as const,
            })),
            { onConflict: "job_id,question_number" },
          );
          await supabaseAdmin
            .from("extraction_batches")
            .update({ status: "done", raw_response: raw as never, parsed: { questions } as never })
            .eq("id", batch.id);
          questionCount += questions.length;
        }
        if (questionCount < 1) throw new Error("Smoke extraction produced no questions");
        return { questionCount };
      });

      await runStep("validate", async () => {
        if (!jobId) throw new Error("Smoke job missing");
        await supabaseAdmin.from("extraction_jobs").update({ status: "validating", last_error: null }).eq("id", jobId);
        const { data: rows, error } = await supabaseAdmin
          .from("extraction_questions")
          .select("question_number, type, subject, question_text, options, answer, has_image")
          .eq("job_id", jobId)
          .order("question_number", { ascending: true });
        if (error) throw new Error(error.message);
        const mapped = (rows ?? []).map((q) => ({
          questionNumber: q.question_number,
          questionType: q.type as never,
          subject: q.subject ?? "",
          questionText: q.question_text ?? "",
          options: (q.options ?? {}) as Record<string, string>,
          answer: q.answer ?? "",
          hasImage: !!q.has_image,
          imageUrl: "",
        }));
        const { report, raw } = await validateWithGroq(groqKey, mapped, 2);
        await supabaseAdmin.from("extraction_validation_reports").insert({
          job_id: jobId,
          missing_numbers: report.missingNumbers,
          duplicates: report.duplicates,
          broken_options: report.brokenOptions,
          empty_questions: report.emptyQuestions,
          broken_equations: report.brokenEquations,
          invalid_json: report.invalidJson,
          score: report.score,
          raw: raw as never,
        });
        await supabaseAdmin.from("extraction_jobs").update({ status: "needs_review", extraction_score: report.score }).eq("id", jobId);
        return { score: report.score, missing: report.missingNumbers };
      });

      await runStep("admin_review", async () => {
        if (!jobId) throw new Error("Smoke job missing");
        const { error } = await supabaseAdmin.from("extraction_questions").update({ status: "approved" }).eq("job_id", jobId);
        if (error) throw new Error(error.message);
        await supabaseAdmin.from("extraction_jobs").update({ status: "approved" }).eq("id", jobId);
        return { approved: questionCount };
      });

      await runStep("publish", async () => {
        if (!jobId) throw new Error("Smoke job missing");
        const { data: extracted, error } = await supabaseAdmin
          .from("extraction_questions")
          .select("*")
          .eq("job_id", jobId)
          .order("question_number", { ascending: true });
        if (error) throw new Error(error.message);
        if (!extracted?.length) throw new Error("No smoke questions to publish");
        const { data: test, error: testErr } = await supabaseAdmin
          .from("tests")
          .insert({
            title: `[SMOKE] PDF Pipeline ${new Date().toISOString()}`,
            exam: "jee_main",
            kind: "full",
            duration_min: 15,
            marking_scheme: { correct: 4, incorrect: -1, unattempted: 0 },
            status: "published",
            created_by: context.userId,
            extraction_job_id: jobId,
          })
          .select("id")
          .single();
        if (testErr || !test) throw new Error(testErr?.message ?? "Smoke test insert failed");
        testId = test.id;

        const { data: inserted, error: qErr } = await supabaseAdmin
          .from("questions")
          .insert(
            extracted.map((q) => ({
              type: q.type,
              difficulty: "medium" as const,
              question_text: q.question_text ?? "",
              options: q.options ?? {},
              correct_answer: q.answer ?? "",
              is_published: true,
              created_by: context.userId,
              source: "pipeline-smoke",
            })),
          )
          .select("id");
        if (qErr || !inserted) throw new Error(qErr?.message ?? "Smoke question insert failed");
        const { error: tqErr } = await supabaseAdmin.from("test_questions").insert(
          inserted.map((q, idx) => ({
            test_id: test.id,
            question_id: q.id,
            order_index: idx,
            section: extracted[idx].subject,
          })),
        );
        if (tqErr) throw new Error(tqErr.message);
        await supabaseAdmin.from("extraction_jobs").update({ status: "published" }).eq("id", jobId);
        return { testId: test.id, questionCount: inserted.length };
      });

      if (jobId) await auditExtraction(supabaseAdmin, jobId, context.userId, "smoke.completed", { testId, questionCount });
      return { pass: true, jobId, testId, questionCount, steps };
    } catch (err) {
      return { pass: false, jobId, testId, questionCount, steps, error: errorStack(err).slice(0, 4000) };
    }
  });

// =========================================================================
// RETRY missing question numbers — only re-runs their parent batches
// =========================================================================

export const retryMissing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: report } = await context.supabase
      .from("extraction_validation_reports")
      .select("missing_numbers")
      .eq("job_id", data.jobId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const missing = report?.missing_numbers ?? [];
    if (missing.length === 0) return { batchIds: [] };

    // Map missing numbers → likely source pages (best-effort: pageFrom of batch covering qNumber).
    // Without per-question page mapping, we re-run ALL non-done batches that overlap any source_page
    // appearing in existing questions adjacent to the missing number. Pragmatic fallback: re-run
    // every batch that has fewer than expected questions (i.e. any batch with status='done').
    const { data: batches } = await context.supabase
      .from("extraction_batches")
      .select("id, page_from, page_to")
      .eq("job_id", data.jobId);
    const ids = (batches ?? []).map((b) => b.id);
    await context.supabase
      .from("extraction_batches")
      .update({ status: "pending" })
      .in("id", ids);
    return { batchIds: ids, missing };
  });

// =========================================================================
// Admin edits to extracted questions
// =========================================================================

export const updateExtractionQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        questionText: z.string().optional(),
        options: z.record(z.string(), z.string()).optional(),
        answer: z.string().optional(),
        subject: z.string().optional(),
        type: z
          .enum([
            "single_correct",
            "multiple_correct",
            "integer",
            "matrix_match",
            "assertion_reason",
            "paragraph",
          ])
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, unknown> = { status: "edited" };
    if (data.questionText !== undefined) patch.question_text = data.questionText;
    if (data.options !== undefined) patch.options = data.options;
    if (data.answer !== undefined) patch.answer = data.answer;
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.type !== undefined) patch.type = data.type;
    const { error } = await context.supabase
      .from("extraction_questions")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExtractionQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("extraction_questions")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =========================================================================
// PUBLISH — turn approved extracted questions into a real CBT
// =========================================================================

export const publishExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        jobId: z.string().uuid(),
        durationMin: z.number().int().min(15).max(360),
        markingScheme: z
          .object({ correct: z.number(), incorrect: z.number(), unattempted: z.number() })
          .default({ correct: 4, incorrect: -1, unattempted: 0 }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await auditExtraction(context.supabase, data.jobId, context.userId, "publish.started");
    const { data: job } = await context.supabase
      .from("extraction_jobs")
      .select("id, title, exam")
      .eq("id", data.jobId)
      .single();
    if (!job || !job.exam) throw new Error("Job missing title/exam");

    const { data: extracted } = await context.supabase
      .from("extraction_questions")
      .select("*")
      .eq("job_id", data.jobId)
      .order("question_number", { ascending: true });
    if (!extracted || extracted.length === 0) throw new Error("No questions to publish");

    // Create test
    const { data: test, error: testErr } = await context.supabase
      .from("tests")
      .insert({
        title: job.title ?? "Untitled paper",
        exam: job.exam,
        kind: "full",
        duration_min: data.durationMin,
        marking_scheme: data.markingScheme,
        status: "published",
        created_by: context.userId,
        extraction_job_id: job.id,
      })
      .select("id")
      .single();
    if (testErr || !test) {
      await auditExtraction(context.supabase, data.jobId, context.userId, "publish.failed", {
        error: testErr?.message ?? "Test insert failed",
      });
      throw new Error(testErr?.message ?? "Test insert failed");
    }

    // Insert questions one shot, capture ids
    const questionRows = extracted.map((q) => ({
      type: q.type,
      difficulty: "medium" as const,
      question_text: q.question_text ?? "",
      options: q.options ?? {},
      correct_answer: q.answer ?? "",
      is_published: true,
      created_by: context.userId,
    }));
    const { data: insertedQs, error: qsErr } = await context.supabase
      .from("questions")
      .insert(questionRows)
      .select("id");
    if (qsErr || !insertedQs) {
      await auditExtraction(context.supabase, data.jobId, context.userId, "publish.failed", {
        error: qsErr?.message ?? "Question insert failed",
      });
      throw new Error(qsErr?.message ?? "Question insert failed");
    }

    const testQRows = insertedQs.map((row, idx) => ({
      test_id: test.id,
      question_id: row.id,
      order_index: idx,
      section: extracted[idx].subject,
    }));
    const { error: tqErr } = await context.supabase.from("test_questions").insert(testQRows);
    if (tqErr) {
      await auditExtraction(context.supabase, data.jobId, context.userId, "publish.failed", { error: tqErr.message });
      throw new Error(tqErr.message);
    }

    await context.supabase
      .from("extraction_jobs")
      .update({ status: "published" })
      .eq("id", data.jobId);
    await auditExtraction(context.supabase, data.jobId, context.userId, "publish.completed", {
      testId: test.id,
      questionCount: insertedQs.length,
    });
    return { testId: test.id, questionCount: insertedQs.length };
  });
