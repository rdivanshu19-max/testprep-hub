// Server functions powering the admin PDF→CBT pipeline.
// Every handler is admin-only (verified via has_role check on the authed supabase client).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PDF_BUCKET = "pdf-uploads";

// ---------- admin guard ----------
async function assertAdmin(ctx: {
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>;
  userId: string;
}) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

// =========================================================================
// LIST + GET
// =========================================================================

export const listExtractionJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
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
    const [{ data: job }, { data: questions }, { data: report }, { data: batches }] = await Promise.all([
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
    ]);
    if (!job) throw new Error("Job not found");
    return { job, questions: questions ?? [], report: report ?? null, batches: batches ?? [] };
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

    await context.supabase.from("extraction_audit_log").insert({
      job_id: row.id,
      actor: context.userId,
      action: "job.created",
      payload: { filename: data.originalFilename },
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
    const { splitPdfIntoBatches } = await import("./extraction.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Mark splitting
    await context.supabase
      .from("extraction_jobs")
      .update({ status: "splitting", last_error: null })
      .eq("id", data.jobId);

    const { data: job } = await context.supabase
      .from("extraction_jobs")
      .select("pdf_storage_path")
      .eq("id", data.jobId)
      .single();
    if (!job) throw new Error("Job not found");

    const pdfDl = await supabaseAdmin.storage.from(PDF_BUCKET).download(job.pdf_storage_path);
    if (pdfDl.error || !pdfDl.data) throw new Error(`PDF download: ${pdfDl.error?.message}`);
    const pdfBytes = new Uint8Array(await pdfDl.data.arrayBuffer());

    const { pageCount, batches } = await splitPdfIntoBatches(pdfBytes);

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
    await context.supabase.from("extraction_audit_log").insert({
      job_id: data.jobId,
      actor: context.userId,
      action: "job.split",
      payload: { pageCount, batches: batches.length },
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
    const { extractQuestionsWithGemini } = await import("./extraction.server");
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
      // Nothing left → flip status if still extracting
      const { data: remaining } = await context.supabase
        .from("extraction_batches")
        .select("id", { count: "exact", head: true })
        .eq("job_id", data.jobId)
        .eq("status", "pending");
      const pendingCount = (remaining as unknown as { count?: number } | null)?.count ?? 0;
      return { done: true, processedBatchId: null, pendingCount };
    }

    await context.supabase
      .from("extraction_batches")
      .update({ status: "running", attempts: (batch.attempts ?? 0) + 1, last_error: null })
      .eq("id", batch.id);

    try {
      const path = `jobs/${data.jobId}/batches/batch-${(Math.floor((batch.page_from - 1) / 2))
        .toString()
        .padStart(3, "0")}.pdf`;
      const dl = await supabaseAdmin.storage.from("question-images").download(path);
      if (dl.error || !dl.data) throw new Error(`Batch download: ${dl.error?.message}`);
      const pdfBytes = new Uint8Array(await dl.data.arrayBuffer());

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

      return {
        done: false,
        processedBatchId: batch.id,
        pagesProcessed: `${batch.page_from}-${batch.page_to}`,
        extractedCount: questions.length,
        pendingCount: pendingCount ?? 0,
      };
    } catch (err) {
      const msg = (err as Error).message;
      await context.supabase
        .from("extraction_batches")
        .update({ status: "failed", last_error: msg })
        .eq("id", batch.id);
      await context.supabase
        .from("extraction_jobs")
        .update({ last_error: msg })
        .eq("id", data.jobId);
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
    const { report, raw } = await validateWithGroq(
      apiKey,
      mapped,
      job?.expected_question_count ?? null,
    );

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
      raw: raw as Record<string, unknown>,
    });

    await context.supabase
      .from("extraction_jobs")
      .update({ status: "needs_review", extraction_score: report.score })
      .eq("id", data.jobId);

    await context.supabase.from("extraction_audit_log").insert({
      job_id: data.jobId,
      actor: context.userId,
      action: "job.validated",
      payload: { score: report.score, missing: report.missingNumbers.length },
    });
    return report;
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
      .update(patch)
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
    if (testErr || !test) throw new Error(testErr?.message ?? "Test insert failed");

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
    if (qsErr || !insertedQs) throw new Error(qsErr?.message ?? "Question insert failed");

    const testQRows = insertedQs.map((row, idx) => ({
      test_id: test.id,
      question_id: row.id,
      order_index: idx,
      section: extracted[idx].subject,
    }));
    const { error: tqErr } = await context.supabase.from("test_questions").insert(testQRows);
    if (tqErr) throw new Error(tqErr.message);

    await context.supabase
      .from("extraction_jobs")
      .update({ status: "published" })
      .eq("id", data.jobId);
    await context.supabase.from("extraction_audit_log").insert({
      job_id: data.jobId,
      actor: context.userId,
      action: "job.published",
      payload: { testId: test.id, questionCount: insertedQs.length },
    });
    return { testId: test.id, questionCount: insertedQs.length };
  });
