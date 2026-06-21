
# RankersTestHub — PRD & Development Roadmap

A premium JEE/NEET CBT platform. This plan delivers the full PRD up front, then phases the build starting with the **critical PDF→CBT extraction pipeline** (your stated priority), with the student-facing CBT, dashboards, and ancillary modules layered on top.

---

## 1. Product Overview

**Vision:** A premium, NTA-faithful CBT ecosystem for JEE Main / Advanced / NEET aspirants and coaching institutes — combining the familiarity of the real exam with Linear/Stripe/Notion-grade UX.

**Primary users:**
- Student (aspirant)
- Admin (content team / coaching ops)

**Differentiators:**
- Reliable PDF→CBT pipeline (2-page batching, image-aware, answer-key/solution aware, auto-retry on missing questions only).
- True NTA-style test engine.
- Mistake Journal + Topper Comparison + Weak/Strong chapter analytics as first-class objects, not afterthoughts.

---

## 2. Design Direction

**Inspiration:** Linear (density + keyboard feel), Stripe (typographic clarity + restrained color), Notion (information architecture), Vercel (monochrome + sharp accent).

**Aesthetic rules (explicit "do nots" honored):**
- No AI illustrations, no cartoons, no coaching banners, no neon gradients, no generic SaaS hero blobs.
- Monochrome base (near-black `#0A0A0A`, paper `#FAFAF9`), single restrained accent (deep indigo or graphite-blue), one subject-coded palette for Physics / Chemistry / Math / Biology used *only* inside analytics and test UI.
- Typography: **Geist** or **Inter Tight** for UI, **Geist Mono** for numerics (timers, scores, question numbers). Serif (e.g. **Source Serif**) for long-form reading in reports/notes only.
- Motion: subtle, functional (200–250ms), framer-motion for palette transitions and review-mode reveals.
- Density: Linear-style compact tables in admin; airy reading layouts in student reports.

---

## 3. Information Architecture & Routes

TanStack Start file-based routes under `src/routes/`.

**Public**
- `/` Landing
- `/features`, `/cbt-preview`, `/pricing` (optional), `/faq`
- `/auth` (login/register/forgot)
- `/legal/terms`, `/legal/privacy`

**Authenticated student** (`_authenticated/`)
- `/dashboard`
- `/tests` (catalog), `/tests/$testId` (instructions), `/tests/$testId/attempt` (CBT engine, fullscreen)
- `/tests/$testId/result/$attemptId` (score card + tabs: subject / chapter / accuracy / time / question / topper)
- `/practice` (filters), `/practice/session/$sessionId`
- `/mistake-journal`, `/bookmarks`, `/bookmarks/$collectionId`
- `/resources` (notes / formulas / books / DPP / PYQ), `/resources/$resourceId`
- `/video-solutions`, `/video-solutions/$videoId`
- `/leaderboard` (weekly / monthly / all-time tabs)
- `/announcements`
- `/profile`, `/profile/settings`

**Admin** (`_authenticated/admin/`, gated by `has_role('admin')`)
- `/admin` dashboard
- `/admin/users`
- `/admin/questions`, `/admin/questions/$questionId`
- `/admin/tests`, `/admin/tests/new`, `/admin/tests/$testId`
- `/admin/extraction` (PDF upload + pipeline console)
- `/admin/extraction/$jobId` (review / approve screen)
- `/admin/resources`, `/admin/videos`, `/admin/announcements`, `/admin/analytics`

**Server routes** (`src/routes/api/`)
- `api/extraction/process-batch` (internal, server fn preferred)
- `api/public/webhooks/*` for any future external triggers
- `api/cron/extraction-retry` (stable URL for pg_cron)

---

## 4. Tech Architecture

- **Frontend:** React 19 + TanStack Start + Tailwind v4 + shadcn/ui.
- **Backend:** Your own Supabase project, wired via Lovable's Supabase integration (auth, migrations, generated types).
- **Server logic:** `createServerFn` for app-internal calls; **Supabase Edge Functions (Deno)** for the heavy/long-running PDF pipeline (better CPU/time limits than the Worker SSR runtime, which stubs `child_process` and has tight budgets).
- **Storage:** Supabase Storage buckets — `pdf-uploads` (private), `question-images` (private, signed URLs), `resources` (mixed), `avatars` (public).
- **AI:** Your **Gemini** key (vision/extraction) + your **Groq** key (validation) stored as secrets: `GEMINI_API_KEY`, `GROQ_API_KEY`.
- **Queue/state:** A `extraction_jobs` table with status machine drives the pipeline; pg_cron + an edge function poll for retries.

---

## 5. Database Schema (high level)

Auth & roles
- `profiles` (id → auth.users, full_name, photo_url, target_exam, target_score, phone, created_at)
- `app_role` enum (`admin`, `student`)
- `user_roles` (user_id, role) + `has_role()` security-definer (per platform rule — roles NEVER on profiles)

Content
- `subjects`, `chapters` (subject_id), `topics` (chapter_id)
- `questions` (id, subject_id, chapter_id, topic_id, type enum, difficulty, question_text, question_image_url, options jsonb, correct_answer, solution_text, solution_video_id, source, pyq_year, created_by, status)
- `question_images` (question_id, url, role: 'inline'|'option_a'…)
- `tests` (id, title, exam enum, type: 'full'|'subject'|'chapter'|'pyq', duration_min, marking_scheme jsonb, scheduled_at, status)
- `test_questions` (test_id, question_id, order_index, section)
- `test_sections` (test_id, name, subject_id, question_count)

Attempts
- `test_attempts` (id, user_id, test_id, started_at, submitted_at, total_score, status)
- `attempt_answers` (attempt_id, question_id, chosen, status: answered/marked/marked_answered/skipped/not_visited, time_spent_ms, is_correct, marks_awarded)
- `attempt_section_stats`, `attempt_subject_stats` (materialized for fast report rendering)

Engagement
- `bookmarks`, `bookmark_collections`, `mistake_journal_entries` (auto-populated post-submit), `student_notes`
- `practice_sessions`, `practice_session_questions`
- `leaderboard_snapshots` (period, user_id, score, rank)

Resources & media
- `resources` (type, title, subject_id, chapter_id, file_url, published)
- `videos` (title, kind: 'solution'|'paper_discussion'|'chapter', url, question_id?, chapter_id?)
- `announcements` (title, body, audience, published_at)

**Extraction pipeline tables (critical)**
- `extraction_jobs` (id, pdf_url, original_filename, page_count, status: uploaded/splitting/extracting/validating/needs_review/approved/published/failed, expected_question_count, extraction_score, created_by, created_at)
- `extraction_pages` (job_id, page_number, image_url, status, last_error)
- `extraction_batches` (job_id, page_from, page_to, gemini_request_id, raw_response jsonb, parsed jsonb, status, attempts)
- `extraction_questions` (job_id, question_number, type, subject, question_text, options jsonb, answer, has_image, image_url, source_page, source_batch_id, status: draft/edited/approved/rejected, validation_flags jsonb)
- `extraction_validation_reports` (job_id, missing_numbers int[], duplicates int[], broken_options int[], invalid_json bool, score, generated_at)
- `extraction_audit_log` (job_id, actor, action, payload jsonb, at)

All public tables get explicit `GRANT`s + RLS:
- Students: read published content; read/write only their own attempts/bookmarks/notes/journal.
- Admins (`has_role('admin')`): full read/write on content + extraction tables. Extraction tables are admin-only.
- Service role (edge functions): unrestricted writes during pipeline steps.

---

## 6. Admin PDF → CBT Pipeline (the critical system)

### State machine

```
uploaded → splitting → extracting → validating
                            ↑           ↓
                            └── retry ← needs_review (admin edits)
                                        ↓
                                     approved → published
```

### Step-by-step

1. **Upload** — Admin uploads PDF via `/admin/extraction`. Stored in `pdf-uploads` bucket (private). `extraction_jobs` row created with `expected_question_count` entered by admin (e.g. 75 / 90 / 180).
2. **Split & rasterize** — Edge function `extraction-split` uses `pdfjs-dist` (pure JS) to count pages, then renders each page to PNG (target 1600px wide, 200 DPI equivalent) via `pdfjs` + `@napi-rs/canvas` alternative or `pdf-to-png-converter`. Images written to `question-images/jobs/{jobId}/pages/{n}.png`. Each page → `extraction_pages` row.
3. **Batch into 2-page chunks** — Hard rule: pages `[1-2], [3-4], …`. `extraction_batches` rows created. Never send full PDF.
4. **Gemini extraction (per batch)** — Edge function `extraction-extract-batch`:
   - Calls Gemini 2.x vision with both page images.
   - System prompt enforces: detect question vs answer-key vs solution sections; ignore the latter two; output strict JSON array of the schema below; flag `hasImage` and return per-image crop hints (bounding boxes) so we can crop diagrams.
   - For each `hasImage:true` question, a secondary call crops the page (using returned bbox via `sharp`-equivalent JS lib in edge runtime, e.g. `@cf/photon` or do crop client-side in Deno via `Image` API) and uploads to `question-images/jobs/{jobId}/q-{n}.png`.
   - Schema per question matches the spec exactly:
     ```json
     {"questionNumber":1,"questionType":"single_correct","subject":"Physics","questionText":"","options":{"A":"","B":"","C":"","D":""},"answer":"","hasImage":false,"imageUrl":""}
     ```
   - Supports: `single_correct`, `multiple_correct`, `integer`, `matrix_match`, `assertion_reason`, `paragraph`.
5. **Merge** — All batch outputs merged into `extraction_questions` ordered by `questionNumber`.
6. **Groq validation** — Edge function `extraction-validate` sends the merged question list (text only, no images) to Groq with a validator prompt that returns:
   - `missing_numbers`, `duplicates`, `broken_options`, `empty_questions`, `invalid_json_indices`, `broken_equations`, `number_gaps`, plus an `extraction_score` 0–100 across the 5 metrics specified.
   - Result stored in `extraction_validation_reports`.
7. **Selective auto-retry** — If `missing_numbers` non-empty: map each missing question number → source page → batch → re-run **only those batches** (max 2 retries). Never reprocess full PDF.
8. **Admin review screen** (`/admin/extraction/$jobId`):
   - Left: validation report (score, missing, duplicates, flags).
   - Center: question-by-question preview with text/LaTeX (KaTeX), options, answer, image preview.
   - Per-question actions: Edit text, Edit options, Replace image (re-upload or re-crop), Change answer, Delete, Add missing question manually, **Re-run extraction for this page**.
   - No auto-publish. "Approve & Publish" enabled only when admin explicitly clicks.
9. **Publish** — On approval, server fn:
   - Inserts into `questions` (+ `question_images`).
   - Creates `tests` row with metadata (title, exam, duration, marking scheme defaults editable beforehand).
   - Populates `test_questions` in original order.
   - Generates question palette config (just an ordered array — palette is computed client-side from attempt state).
   - Marks job `published`.

### Reliability guarantees (mapped to your stated past failures)

| Past failure | Mitigation |
|---|---|
| Skipped questions | Expected count + Groq missing-number detection + targeted page retry |
| Lost diagrams | Per-question bbox extraction → cropped image upload → `hasImage`/`imageUrl` |
| Integer questions breaking | Explicit `integer` type in schema + Groq check for non-MCQ shape |
| Equations broken | Gemini prompted for LaTeX; Groq flags `broken_equations`; KaTeX render in preview |
| Answer key interference | Section classifier in Gemini prompt + post-filter dropping `answer_key`/`solution` blocks |
| Large PDF failure | Strict 2-page batching, never full-PDF call |
| Invalid JSON | Schema-constrained Gemini response + Groq JSON validity check + per-batch isolation |

---

## 7. CBT Test Engine (NTA-faithful)

- Fullscreen lock, blocked right-click, tab-switch counter.
- Question palette colored: Not Visited (gray), Not Answered (red), Answered (green), Marked (purple), Answered & Marked (purple+green dot).
- Subject tabs (Physics / Chemistry / Math or Biology) with per-section timer if test config requires.
- Controls: Save & Next, Save & Mark for Review, Clear Response, Mark for Review & Next.
- Language selector (English / Hindi) per question if translations stored.
- Auto-save every 5s + on every state change (idempotent upsert into `attempt_answers`).
- Auto-submit on timer = 0.
- Zoom +/- and image lightbox; bookmark icon; calculator (NEET = none, JEE = on-screen scientific where allowed).
- Keyboard shortcuts (1–4 for options, N for next, M for mark).

---

## 8. Reports & Analytics

Post-submit batch job computes:
- Score card (overall, per section, per subject).
- Accuracy = correct / attempted; Attempt rate = attempted / total.
- Time analysis: avg time per question, time-to-correct, time-wasters (high time + wrong).
- Chapter & topic strength (rolling across attempts).
- **Topper comparison:** compare against top-N percentile attempt aggregates per test.
- Question analysis: per-question correct%, your status, video solution link.
- Auto-populate Mistake Journal with wrong + skipped questions.

---

## 9. Other Modules (concise)

- **Practice:** Filter by exam/subject/chapter/topic/difficulty/PYQ → generates a `practice_session`; same engine, lighter chrome, instant feedback toggle.
- **Bookmarks:** Default collection + user-created collections; revision mode = spaced shuffle.
- **Resources:** Filtered grid by type/subject/chapter; signed URLs for downloads; view counts.
- **Video Solutions:** YouTube/Vimeo/Mux embed; linked to question / chapter / paper.
- **Leaderboard:** Materialized snapshots refreshed by pg_cron weekly/monthly/all-time.
- **Announcements:** Admin-authored; surfaced in dashboard banner + `/announcements`.
- **FAQ:** Searchable static content (MDX or DB-backed).
- **Profile:** Edit details, photo (avatars bucket), target exam/score, change password, connected providers.

---

## 10. Auth

- Supabase Auth: email/password + Google OAuth (via Lovable broker — `lovable.auth.signInWithOAuth('google', …)`; we'll call `supabase--configure_social_auth` when wiring Google).
- `/reset-password` page mandatory.
- `profiles` auto-created via trigger on `auth.users` insert.
- Role assigned via `user_roles` (first admin seeded by migration to a designated email).

---

## 11. Development Roadmap

**You chose: PRD + start with the PDF→CBT pipeline.** Phases below; each phase ends with a working, testable slice.

### Phase 0 — Foundation (prerequisite, ~1 build)
- Wire your Supabase project via the integration.
- Add secrets: `GEMINI_API_KEY`, `GROQ_API_KEY`.
- Base design tokens in `src/styles.css`, install Geist fonts, set up shadcn theme.
- Minimal landing page + `/auth` (email + Google) + `profiles` + `user_roles` + `has_role()` + seed first admin.
- `_authenticated` and `_authenticated/admin` route gates.

### Phase 1 — PDF → CBT Pipeline MVP (the priority)
- Schema: `extraction_jobs`, `extraction_pages`, `extraction_batches`, `extraction_questions`, `extraction_validation_reports`, `extraction_audit_log`.
- Storage buckets: `pdf-uploads` (private), `question-images` (private).
- Admin route `/admin/extraction` (upload + jobs list).
- Edge functions: `extraction-split`, `extraction-extract-batch`, `extraction-validate`, `extraction-retry`, `extraction-publish`.
- Admin review screen `/admin/extraction/$jobId` with full edit capabilities.
- KaTeX rendering for equations.
- Minimal `questions` + `tests` + `test_questions` write on publish.

**Exit criteria:** Admin uploads a 30-page mixed JEE PDF; system produces a publishable CBT with images, ≥95% question completeness, answer-key blocks excluded, missing-question retry verified.

### Phase 2 — Student CBT Engine
- `/tests` catalog, instructions page, attempt engine with full NTA features, auto-save/submit, palette, fullscreen.
- `test_attempts`, `attempt_answers` + scoring on submit.

### Phase 3 — Reports + Mistake Journal + Bookmarks
- Score card and all analysis tabs.
- Auto-populate mistake journal.
- Bookmarks + collections.

### Phase 4 — Practice + Resources + Videos
- Practice session generator + engine.
- Resources library.
- Video solutions linked to questions.

### Phase 5 — Dashboard + Leaderboard + Announcements + Profile + FAQ
- Student dashboard widgets (pulling from existing aggregates).
- Leaderboard with pg_cron snapshots.
- Announcements, Profile, FAQ.

### Phase 6 — Admin polish + analytics
- Full admin user/test/question/resource/video management UIs.
- Admin analytics dashboard.

### Phase 7 — Landing polish, SEO, performance pass, billing (if needed later).

---

## 12. Open Items to Confirm Before Phase 1

1. **Expected first PDF type** — JEE Main / Advanced / NEET sample so I can tune the Gemini prompt and section classifier first.
2. **First admin email** to seed in the migration.
3. **Marking scheme defaults** — confirm: JEE Main +4/−1, JEE Adv variable, NEET +4/−1. I'll use these unless told otherwise.
4. **Languages** — English-only at launch, or English+Hindi from day one (affects question schema)?

I'll proceed to Phase 0 + Phase 1 once you approve this plan; after approval I'll request the two API keys via the secrets form and the Supabase connection.
