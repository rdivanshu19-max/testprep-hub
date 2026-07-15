
# Alternatives to the fragile PDF→CBT auto-extraction

You're right — relying only on Gemini/Groq for PDF extraction is brittle (quota 429s, scanned PDFs, math/LaTeX loss, layout drift). We should stop treating auto-extraction as the only path and give admins **3 reliable ways** to publish a CBT test. All three feed the same `tests` / `questions` tables, so the student CBT player and results page don't change.

## The 3 input paths

### 1. Manual Question Builder (most reliable — zero AI)
A new admin page `/admin/tests/new` with a form to build a test question-by-question:
- Test metadata (title, subject, duration, marks, negative marks)
- Add question → rich text (with a math toolbar that inserts `$...$` KaTeX), 4 options, correct answer, optional image upload to `question-images` bucket
- Reorder / delete / duplicate questions
- Save as draft → Preview in CBT player → Publish

This path never touches Gemini/Groq/pdf-lib. It is the guaranteed fallback whenever extraction fails.

### 2. Paste / Upload structured text (fast — no vision AI)
A new tab "Import from text" on the same page that accepts either:
- Pasted plain text following a simple documented format (`1. question... A) ... B) ... Answer: C`)
- A `.txt`, `.docx`, `.csv`, or `.json` file
- A PDF that has embedded text (we already have `extractPdfText` via pdf.js — reuse it, skip the vision call)

Runs the existing `parseQuestionsFromText` regex parser locally. Shows a preview table where admin can fix any row before publishing. No API keys required.

### 3. Existing PDF pipeline — kept as "best effort" with clearer fallback
Keep the current split→Gemini→Groq flow but:
- If it fails or extracts 0 questions, the job page shows a **"Continue in manual builder"** button that pre-creates the test shell and drops the admin into path #1
- Add a "Switch to text-only extract" button that re-runs just `extractPdfText` + `parseQuestionsFromText` (no AI) on the uploaded PDF
- Surface the actual failure reason (quota, scan, parse) in plain language

## What I'll build

**Frontend**
- `src/routes/_authenticated/admin/tests.new.tsx` — manual builder + text-import tabs, question editor with KaTeX preview and image upload
- Update `src/routes/_authenticated/admin/tests.tsx` — "New test" button, "Edit" per row
- Update `src/routes/_authenticated/admin/extraction.$jobId.tsx` — "Continue manually" and "Retry as text-only" buttons on failed/empty jobs

**Backend (server functions in `src/lib/tests.functions.ts`)**
- `createTestDraft(meta)` → inserts into `tests`
- `upsertQuestion(testId, question)` → inserts/updates `questions` row
- `deleteQuestion(id)`, `reorderQuestions(testId, ids[])`
- `importQuestionsFromText(testId, text)` → reuses `parseQuestionsFromText`
- `importQuestionsFromPdfTextOnly(testId, storagePath)` → reuses `extractPdfText` + parser, no AI
- `publishTest(testId)` → flips status to published
- `uploadQuestionImage` → signed upload URL for `question-images` bucket

**DB**
No schema change needed if `tests` and `questions` already exist. I'll audit them first and only add columns if something is missing (e.g. `image_url` on questions).

## Out of scope (this plan)
- Rewriting the Gemini/Groq pipeline itself
- OCR for scanned PDFs (would need a new provider; can be a follow-up)
- Bulk CSV import spec beyond a simple documented column layout

## Ask before I build
1. For path #2 (text/CSV import), is a simple documented format fine, or do you want me to also accept a specific format your existing question banks use? If you have a sample file, paste it.
2. Should the manual builder support **sections** (Physics / Chem / Math with per-section timing) in v1, or is a flat question list enough for now?

Once you confirm, I'll implement all three paths and verify by creating a test end-to-end through the manual builder and through text import.
