// Server functions for the Manual/Text-import CBT builder.
// All handlers are admin-only. RLS policies on tests/questions/test_questions
// already enforce admin-only writes, but we double-check via assertAdmin.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "./extraction-utils.server";

const ExamEnum = z.enum(["jee_main", "jee_advanced", "neet"]);
const KindEnum = z.enum(["full", "subject", "chapter", "pyq", "custom"]);
const StatusEnum = z.enum(["draft", "published", "archived"]);
const QuestionTypeEnum = z.enum([
  "single_correct",
  "multiple_correct",
  "integer",
  "matrix_match",
  "assertion_reason",
  "paragraph",
]);
const DifficultyEnum = z.enum(["easy", "medium", "hard"]);

const QuestionSchema = z.object({
  id: z.string().uuid().optional(),
  question_text: z.string().min(1),
  options: z.record(z.string(), z.string()).default({}),
  correct_answer: z.string().default(""),
  type: QuestionTypeEnum.default("single_correct"),
  difficulty: DifficultyEnum.default("medium"),
  subject_id: z.string().uuid().nullable().optional(),
  chapter_id: z.string().uuid().nullable().optional(),
  topic_id: z.string().uuid().nullable().optional(),
  solution_text: z.string().nullable().optional(),
  question_image_url: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// LIST + GET
// ---------------------------------------------------------------------------

export const getTestForEdit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ testId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: test, error: te } = await context.supabase
      .from("tests")
      .select("*")
      .eq("id", data.testId)
      .single();
    if (te || !test) throw new Error(te?.message ?? "Test not found");

    const { data: rows, error: qe } = await context.supabase
      .from("test_questions")
      .select("id, order_index, section, question_id, questions(*)")
      .eq("test_id", data.testId)
      .order("order_index", { ascending: true });
    if (qe) throw new Error(qe.message);

    return {
      test,
      questions: (rows ?? []).map((r) => ({
        link_id: r.id,
        order_index: r.order_index,
        section: r.section,
        ...(r.questions as Record<string, unknown>),
      })),
    };
  });

// ---------------------------------------------------------------------------
// CREATE DRAFT
// ---------------------------------------------------------------------------

export const createTestDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().optional().nullable(),
        exam: ExamEnum,
        kind: KindEnum.default("custom"),
        duration_min: z.number().int().positive().max(600).default(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("tests")
      .insert({
        title: data.title,
        description: data.description ?? null,
        exam: data.exam,
        kind: data.kind,
        duration_min: data.duration_min,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to create test");
    return { testId: row.id };
  });

// ---------------------------------------------------------------------------
// UPDATE METADATA
// ---------------------------------------------------------------------------

export const updateTestMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        testId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
        exam: ExamEnum.optional(),
        kind: KindEnum.optional(),
        duration_min: z.number().int().positive().max(600).optional(),
        status: StatusEnum.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { testId, ...patch } = data;
    const { error } = await context.supabase.from("tests").update(patch).eq("id", testId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// UPSERT QUESTION (creates or updates, and attaches to test)
// ---------------------------------------------------------------------------

export const upsertQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ testId: z.string().uuid(), question: QuestionSchema, order_index: z.number().int().min(0) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { testId, question, order_index } = data;

    let questionId = question.id;
    if (questionId) {
      const { error } = await context.supabase
        .from("questions")
        .update({
          question_text: question.question_text,
          options: question.options,
          correct_answer: question.correct_answer,
          type: question.type,
          difficulty: question.difficulty,
          subject_id: question.subject_id ?? null,
          chapter_id: question.chapter_id ?? null,
          topic_id: question.topic_id ?? null,
          solution_text: question.solution_text ?? null,
          question_image_url: question.question_image_url ?? null,
          is_published: true,
        })
        .eq("id", questionId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await context.supabase
        .from("questions")
        .insert({
          question_text: question.question_text,
          options: question.options,
          correct_answer: question.correct_answer,
          type: question.type,
          difficulty: question.difficulty,
          subject_id: question.subject_id ?? null,
          chapter_id: question.chapter_id ?? null,
          topic_id: question.topic_id ?? null,
          solution_text: question.solution_text ?? null,
          question_image_url: question.question_image_url ?? null,
          is_published: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !row) throw new Error(error?.message ?? "Failed to save question");
      questionId = row.id;

      const { error: linkErr } = await context.supabase.from("test_questions").insert({
        test_id: testId,
        question_id: questionId,
        order_index,
      });
      if (linkErr) throw new Error(linkErr.message);
    }
    return { questionId };
  });

// ---------------------------------------------------------------------------
// DELETE QUESTION LINK (and question row)
// ---------------------------------------------------------------------------

export const removeTestQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ testId: z.string().uuid(), questionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await context.supabase
      .from("test_questions")
      .delete()
      .eq("test_id", data.testId)
      .eq("question_id", data.questionId);
    await context.supabase.from("questions").delete().eq("id", data.questionId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// REORDER
// ---------------------------------------------------------------------------

export const reorderTestQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        testId: z.string().uuid(),
        orderedQuestionIds: z.array(z.string().uuid()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    for (let i = 0; i < data.orderedQuestionIds.length; i += 1) {
      await context.supabase
        .from("test_questions")
        .update({ order_index: i })
        .eq("test_id", data.testId)
        .eq("question_id", data.orderedQuestionIds[i]);
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// IMPORT FROM PASTED TEXT
// ---------------------------------------------------------------------------

export const importQuestionsFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ testId: z.string().uuid(), text: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { parseQuestionsFromText } = await import("./extraction.server");
    const parsed = parseQuestionsFromText(data.text);
    if (!parsed.length) return { inserted: 0, note: "No questions parsed. Check the format." };

    const { count: existing } = await context.supabase
      .from("test_questions")
      .select("*", { count: "exact", head: true })
      .eq("test_id", data.testId);
    let orderStart = existing ?? 0;
    let inserted = 0;

    for (const q of parsed) {
      const type: "single_correct" | "integer" =
        Object.keys(q.options ?? {}).length >= 2 ? "single_correct" : "integer";
      const { data: qrow, error } = await context.supabase
        .from("questions")
        .insert({
          question_text: q.questionText,
          options: q.options ?? {},
          correct_answer: q.answer ?? "",
          type,
          difficulty: "medium",
          is_published: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !qrow) continue;
      await context.supabase.from("test_questions").insert({
        test_id: data.testId,
        question_id: qrow.id,
        order_index: orderStart++,
      });
      inserted += 1;
    }
    return { inserted, parsed: parsed.length };
  });

// ---------------------------------------------------------------------------
// IMPORT FROM UPLOADED PDF (text-only, no vision AI)
// ---------------------------------------------------------------------------

export const importQuestionsFromPdfTextOnly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ testId: z.string().uuid(), storagePath: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: file, error } = await context.supabase.storage
      .from("pdf-uploads")
      .download(data.storagePath);
    if (error || !file) throw new Error(error?.message ?? "Failed to download PDF");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { extractPdfText, parseQuestionsFromText } = await import("./extraction.server");
    const text = await extractPdfText(bytes);
    const parsed = parseQuestionsFromText(text);
    if (!parsed.length) {
      return {
        inserted: 0,
        parsed: 0,
        note: "PDF did not contain parseable text questions. Try the manual builder or paste the text.",
        textPreview: text.slice(0, 500),
      };
    }

    const { count: existing } = await context.supabase
      .from("test_questions")
      .select("*", { count: "exact", head: true })
      .eq("test_id", data.testId);
    let orderStart = existing ?? 0;
    let inserted = 0;
    for (const q of parsed) {
      const type: "single_correct" | "integer" =
        Object.keys(q.options ?? {}).length >= 2 ? "single_correct" : "integer";
      const { data: qrow, error: qerr } = await context.supabase
        .from("questions")
        .insert({
          question_text: q.questionText,
          options: q.options ?? {},
          correct_answer: q.answer ?? "",
          type,
          difficulty: "medium",
          is_published: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (qerr || !qrow) continue;
      await context.supabase.from("test_questions").insert({
        test_id: data.testId,
        question_id: qrow.id,
        order_index: orderStart++,
      });
      inserted += 1;
    }
    return { inserted, parsed: parsed.length };
  });

// ---------------------------------------------------------------------------
// PUBLISH / UNPUBLISH
// ---------------------------------------------------------------------------

export const setTestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ testId: z.string().uuid(), status: StatusEnum }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("tests")
      .update({ status: data.status })
      .eq("id", data.testId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// CONTINUE FROM FAILED EXTRACTION JOB
// ---------------------------------------------------------------------------

export const continueExtractionManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: job, error: je } = await context.supabase
      .from("extraction_jobs")
      .select("id, title, exam, original_filename")
      .eq("id", data.jobId)
      .single();
    if (je || !job) throw new Error(je?.message ?? "Job not found");

    const { data: test, error: te } = await context.supabase
      .from("tests")
      .insert({
        title: job.title ?? job.original_filename,
        exam: job.exam ?? "jee_main",
        kind: "custom",
        duration_min: 60,
        status: "draft",
        extraction_job_id: job.id,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (te || !test) throw new Error(te?.message ?? "Failed to create test");

    // Copy any extraction_questions rows into questions + test_questions
    const { data: rows } = await context.supabase
      .from("extraction_questions")
      .select("*")
      .eq("job_id", job.id)
      .order("question_number", { ascending: true });

    let order = 0;
    let inserted = 0;
    for (const q of rows ?? []) {
      const { data: qrow, error } = await context.supabase
        .from("questions")
        .insert({
          question_text: q.question_text,
          options: q.options,
          correct_answer: q.answer ?? "",
          type: q.type,
          difficulty: "medium",
          is_published: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !qrow) continue;
      await context.supabase.from("test_questions").insert({
        test_id: test.id,
        question_id: qrow.id,
        order_index: order++,
      });
      inserted += 1;
    }
    return { testId: test.id, imported: inserted };
  });

// ---------------------------------------------------------------------------
// UPLOAD QUESTION IMAGE (returns long-lived signed URL)
// ---------------------------------------------------------------------------

export const uploadQuestionImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        testId: z.string().uuid(),
        filename: z.string().min(1).max(200),
        contentType: z.string().min(1).max(80),
        dataBase64: z.string().min(10),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `tests/${data.testId}/${Date.now()}-${safe}`;
    const { error } = await context.supabase.storage
      .from("question-images")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);
    const { data: signed, error: se } = await context.supabase.storage
      .from("question-images")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    if (se || !signed) throw new Error(se?.message ?? "Failed to sign URL");
    return { url: signed.signedUrl, path };
  });

// ---------------------------------------------------------------------------
// TEST BUILDER AUDIT
// ---------------------------------------------------------------------------

export const logTestAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        testId: z.string().uuid(),
        action: z.string().min(1),
        entity: z.string().min(1),
        entity_id: z.string().uuid().optional().nullable(),
        summary: z.string().optional().nullable(),
        diff: z.record(z.string(), z.unknown()).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("test_builder_audit").insert({
      test_id: data.testId,
      actor_id: context.userId,
      action: data.action,
      entity: data.entity,
      entity_id: data.entity_id ?? null,
      summary: data.summary ?? null,
      diff: (data.diff ?? null) as never,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTestAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ testId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("test_builder_audit")
      .select("id, action, entity, entity_id, summary, diff, created_at, actor_id, profiles:profiles!test_builder_audit_actor_id_fkey(full_name)")
      .eq("test_id", data.testId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      // profile FK may not exist; fall back
      const { data: rows2 } = await context.supabase
        .from("test_builder_audit")
        .select("*")
        .eq("test_id", data.testId)
        .order("created_at", { ascending: false })
        .limit(100);
      return { entries: rows2 ?? [] };
    }
    return { entries: rows ?? [] };
  });

