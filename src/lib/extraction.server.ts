// SERVER-ONLY helpers for the PDF→CBT extraction pipeline.
// Imported dynamically from inside server-function handlers — never from client code.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";

export const BATCH_PAGE_SIZE = 2;

// ---------------------------------------------------------------------------
// PDF SPLITTING
// ---------------------------------------------------------------------------

export type PdfBatch = {
  batchIndex: number;
  pageFrom: number; // 1-based inclusive
  pageTo: number; // 1-based inclusive
  bytes: Uint8Array;
};

export async function splitPdfIntoBatches(pdfBytes: Uint8Array): Promise<{
  pageCount: number;
  batches: PdfBatch[];
}> {
  // pdf-lib's package ESM entry imports tslib/pako in a way that can break under
  // Vite/Rolldown interop (`__toESM(...).default` undefined). The bundled ESM
  // build is self-contained and avoids that crash.
  const { PDFDocument } = (await import("pdf-lib/dist/pdf-lib.esm.js")) as typeof import("pdf-lib");
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const batches: PdfBatch[] = [];
  for (let start = 0; start < pageCount; start += BATCH_PAGE_SIZE) {
    const end = Math.min(start + BATCH_PAGE_SIZE, pageCount);
    const dst = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await dst.copyPages(src, indices);
    copied.forEach((p) => dst.addPage(p));
    const bytes = await dst.save();
    batches.push({
      batchIndex: start / BATCH_PAGE_SIZE,
      pageFrom: start + 1,
      pageTo: end,
      bytes,
    });
  }
  return { pageCount, batches };
}

export async function createSmokeTestPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = (await import("pdf-lib/dist/pdf-lib.esm.js")) as typeof import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines = [
    { text: "RankersTestHub PDF Pipeline Smoke Test", size: 18, bold: true },
    { text: "Question Paper - JEE Main", size: 12 },
    { text: "", size: 10 },
    { text: "1. Chemistry: What is the value of 2 + 2?", size: 12 },
    { text: "A. 2", size: 11 },
    { text: "B. 3", size: 11 },
    { text: "C. 4", size: 11 },
    { text: "D. 5", size: 11 },
    { text: "Answer: C", size: 11 },
    { text: "", size: 10 },
    { text: "2. Physics: If speed = distance / time, what is speed for 10 m in 2 s?", size: 12 },
    { text: "A. 2 m/s", size: 11 },
    { text: "B. 5 m/s", size: 11 },
    { text: "C. 10 m/s", size: 11 },
    { text: "D. 20 m/s", size: 11 },
    { text: "Answer: B", size: 11 },
  ];
  let y = 790;
  for (const line of lines) {
    if (line.text) {
      page.drawText(line.text, {
        x: 50,
        y,
        size: line.size,
        font: line.bold ? bold : font,
        color: line.bold ? rgb(0.05, 0.1, 0.2) : rgb(0, 0, 0),
      });
    }
    y -= line.size + 8;
  }
  return pdf.save();
}

export async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    disableWorker: true,
    useSystemFonts: true,
  } as object);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join("\n");
    pages.push(lines);
  }
  await (pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> }).destroy?.();
  await (pdf as unknown as { cleanup?: () => Promise<void> }).cleanup?.();
  return pages.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// BASE64 — safe for large binaries (chunked to avoid call-stack overflow)
// ---------------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa exists in Node 22 (workerd) and Cloudflare Workers runtime.
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// GEMINI — vision extraction of one 2-page PDF batch
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.0-flash";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";

export type ExtractedQuestion = {
  questionNumber: number;
  questionType:
    | "single_correct"
    | "multiple_correct"
    | "integer"
    | "matrix_match"
    | "assertion_reason"
    | "paragraph";
  subject: string;
  questionText: string;
  options: Record<string, string>;
  answer: string;
  hasImage: boolean;
  imageUrl: string;
  sourcePage?: number;
};

const EXTRACTION_PROMPT = `You are extracting JEE / NEET exam questions from the attached PDF pages.

CRITICAL RULES:
1. Only return questions from the QUESTION PAPER sections.
2. NEVER convert "Answer Key", "Answers", "Solutions", "Hints" or "Explanations" sections into questions. Skip those pages entirely.
3. Preserve mathematical expressions using LaTeX (wrap inline math in $...$ and display math in $$...$$). Do not lose subscripts/superscripts.
4. For options, use keys "A","B","C","D" (and "E" if present). For integer questions return options:{}.
5. questionType must be one of: single_correct | multiple_correct | integer | matrix_match | assertion_reason | paragraph.
6. subject must be one of: Physics | Chemistry | Mathematics | Biology.
7. If the question has any diagram, graph, figure, circuit or geometric image, set hasImage:true. Leave imageUrl as empty string.
8. If you cannot determine the answer from the visible pages, leave "answer" as empty string. DO NOT invent answers.
9. Use the printed question number (not your own counter). If a question spans across the page break and only its options are visible, still emit one entry using the visible number.
10. Output STRICTLY a JSON array of question objects matching the schema. No prose, no markdown fences.

Schema per question (exact keys, exact casing):
{
  "questionNumber": number,
  "questionType": string,
  "subject": string,
  "questionText": string,
  "options": { "A": string, "B": string, "C": string, "D": string },
  "answer": string,
  "hasImage": boolean,
  "imageUrl": ""
}`;

const EXTRACTION_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      questionNumber: { type: "INTEGER" },
      questionType: { type: "STRING" },
      subject: { type: "STRING" },
      questionText: { type: "STRING" },
      options: {
        type: "OBJECT",
        properties: {
          A: { type: "STRING" },
          B: { type: "STRING" },
          C: { type: "STRING" },
          D: { type: "STRING" },
        },
      },
      answer: { type: "STRING" },
      hasImage: { type: "BOOLEAN" },
      imageUrl: { type: "STRING" },
    },
    required: ["questionNumber", "questionType", "subject", "questionText", "hasImage"],
  },
};

const ExtractedQuestionSchema = z.object({
  questionNumber: z.coerce.number().int().min(1),
  questionType: z.enum(["single_correct", "multiple_correct", "integer", "matrix_match", "assertion_reason", "paragraph"]),
  subject: z.string().default(""),
  questionText: z.string().default(""),
  options: z.record(z.string(), z.string()).default({}),
  answer: z.string().default(""),
  hasImage: z.boolean().default(false),
  imageUrl: z.string().default(""),
});

function createLovableGateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
    supportsStructuredOutputs: true,
  });
}

async function extractQuestionsWithLovableAi(
  apiKey: string,
  pdfBytes: Uint8Array,
): Promise<{ questions: ExtractedQuestion[]; raw: unknown }> {
  const gateway = createLovableGateway(apiKey);
  const { output, text, usage, finishReason } = await generateText({
    model: gateway(LOVABLE_MODEL),
    output: Output.object({
      schema: z.object({ questions: z.array(ExtractedQuestionSchema) }),
      name: "extracted_questions",
    }),
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: pdfBytes, mediaType: "application/pdf", filename: "batch.pdf" },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
    temperature: 0.1,
    maxRetries: 1,
    timeout: 60_000,
  });
  return { questions: output.questions as ExtractedQuestion[], raw: { text, usage, finishReason, provider: "lovable-ai" } };
}

export async function extractQuestionsWithGemini(
  apiKey: string,
  pdfBytes: Uint8Array,
): Promise<{ questions: ExtractedQuestion[]; raw: unknown }> {
  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: toBase64(pdfBytes),
            },
          },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  let questions: ExtractedQuestion[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) questions = parsed as ExtractedQuestion[];
  } catch (err) {
    throw new Error(
      `Gemini returned non-JSON output: ${text.slice(0, 300)} (${(err as Error).message})`,
    );
  }
  return { questions, raw: json };
}

export async function extractQuestions(
  keys: { geminiKey?: string; lovableKey?: string },
  pdfBytes: Uint8Array,
): Promise<{ questions: ExtractedQuestion[]; raw: unknown }> {
  const failures: string[] = [];
  try {
    const text = await extractPdfText(pdfBytes);
    const questions = parseQuestionsFromText(text);
    if (questions.length > 0) {
      return {
        questions,
        raw: {
          provider: "pdf-text-primary",
          textPreview: text.slice(0, 1000),
        },
      };
    }
    failures.push("PDF text parser: no parseable questions found");
  } catch (err) {
    failures.push(errorSummary("PDF text parser", err));
  }

  if (keys.geminiKey) {
    try {
      return await extractQuestionsWithGemini(keys.geminiKey, pdfBytes);
    } catch (err) {
      failures.push(errorSummary("Gemini", err));
    }
  }
  if (keys.lovableKey) {
    try {
      return await extractQuestionsWithLovableAi(keys.lovableKey, pdfBytes);
    } catch (err) {
      failures.push(errorSummary("Lovable AI", err));
    }
  }
  throw new Error(`All extraction providers failed: ${failures.join(" | ") || "no provider key configured"}`);
}

function parseQuestionsFromText(text: string): ExtractedQuestion[] {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const questions: ExtractedQuestion[] = [];
  let current: ExtractedQuestion | null = null;
  let currentOption: string | null = null;
  let inAnswerKey = false;

  const flush = () => {
    if (!current) return;
    current.questionText = current.questionText.replace(/\s+/g, " ").trim();
    current.options = Object.fromEntries(
      Object.entries(current.options ?? {}).map(([key, value]) => [key, value.replace(/\s+/g, " ").trim()]),
    );
    if (current.questionText.length > 0) questions.push(current);
    current = null;
    currentOption = null;
  };

  for (const line of lines) {
    if (/^(answer\s*key|solutions?|hints?|explanations?)\b/i.test(line)) {
      inAnswerKey = true;
      continue;
    }

    const qMatch = /^(?:Q\s*)?(\d{1,3})[.)\s]+(.+)$/.exec(line);
    if (qMatch && !inAnswerKey) {
      flush();
      const rawQuestion = qMatch[2].trim();
      const subjectMatch = /^(Physics|Chemistry|Mathematics|Maths|Biology)\s*[:\-]\s*(.+)$/i.exec(rawQuestion);
      const subject = normalizeSubject(subjectMatch?.[1] ?? inferSubject(rawQuestion));
      current = {
        questionNumber: Number(qMatch[1]),
        questionType: "single_correct",
        subject,
        questionText: subjectMatch?.[2]?.trim() ?? rawQuestion,
        options: {},
        answer: "",
        hasImage: /\b(diagram|figure|graph|circuit|image)\b/i.test(rawQuestion),
        imageUrl: "",
      };
      currentOption = null;
      continue;
    }

    if (!current) continue;

    const optionMatch = /^([A-E])[.)\s]+(.+)$/.exec(line);
    if (optionMatch) {
      current.options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
      currentOption = optionMatch[1].toUpperCase();
      continue;
    }

    const answerMatch = /^(?:Answer|Ans)\s*[:\-]?\s*(.+)$/i.exec(line);
    if (answerMatch) {
      current.answer = answerMatch[1].trim();
      currentOption = null;
      continue;
    }

    if (currentOption && current.options[currentOption]) {
      current.options[currentOption] = `${current.options[currentOption]} ${line}`;
    } else {
      current.questionText = `${current.questionText} ${line}`;
    }
  }

  flush();
  return questions.map((question) => ({
    ...question,
    questionType: Object.keys(question.options ?? {}).length >= 2 ? "single_correct" : "integer",
  }));
}

function normalizeSubject(subject: string) {
  const s = subject.toLowerCase();
  if (s.includes("chem")) return "Chemistry";
  if (s.includes("math")) return "Mathematics";
  if (s.includes("bio")) return "Biology";
  return "Physics";
}

function inferSubject(text: string) {
  if (/chem|mole|atom|organic|inorganic|reaction/i.test(text)) return "Chemistry";
  if (/math|function|integral|matrix|trigonometry/i.test(text)) return "Mathematics";
  if (/bio|cell|plant|animal|genetic/i.test(text)) return "Biology";
  return "Physics";
}

function errorSummary(provider: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return `${provider}: ${msg.slice(0, 500)}`;
}

// ---------------------------------------------------------------------------
// GROQ — validation pass over the merged question list
// ---------------------------------------------------------------------------

const GROQ_MODEL = "llama-3.3-70b-versatile";

export type ValidationReport = {
  missingNumbers: number[];
  duplicates: number[];
  brokenOptions: number[];
  emptyQuestions: number[];
  brokenEquations: number[];
  invalidJson: boolean;
  score: number;
  notes: string;
};

export async function validateWithGroq(
  apiKey: string,
  questions: ExtractedQuestion[],
  expectedCount: number | null,
): Promise<{ report: ValidationReport; raw: unknown }> {
  const compact = questions.map((q) => ({
    n: q.questionNumber,
    t: q.questionType,
    s: q.subject,
    qLen: q.questionText.length,
    qSample: q.questionText.slice(0, 160),
    opts: Object.keys(q.options ?? {}),
    optLens: Object.fromEntries(Object.entries(q.options ?? {}).map(([k, v]) => [k, String(v).length])),
    a: q.answer ?? "",
    hasImage: q.hasImage,
  }));

  const sys = `You are a strict validator for JEE/NEET question extraction results.
Return ONLY valid JSON matching this exact schema:
{
  "missingNumbers": number[],
  "duplicates": number[],
  "brokenOptions": number[],
  "emptyQuestions": number[],
  "brokenEquations": number[],
  "invalidJson": boolean,
  "score": number,          // 0-100, weighted: completeness 40, optionCompleteness 25, equationAccuracy 15, imageAwareness 10, jsonValidity 10
  "notes": string
}
Rules:
- missingNumbers: numbers in the contiguous range [1..expected] (or [1..max(n)] if expected null) that are NOT present in the extracted set.
- duplicates: question numbers that appear more than once.
- brokenOptions: single_correct/multiple_correct questions missing A/B/C/D OR with any option whose optLen<2.
- emptyQuestions: qLen < 20.
- brokenEquations: questions whose qSample contains unbalanced "$" signs or stray "\\" indicating broken LaTeX.
- invalidJson: false (input is already parsed).
- Be terse. Do not invent numbers.`;

  const user = JSON.stringify({ expected: expectedCount, questions: compact });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<ValidationReport>;
  const report: ValidationReport = {
    missingNumbers: Array.isArray(parsed.missingNumbers) ? parsed.missingNumbers : [],
    duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [],
    brokenOptions: Array.isArray(parsed.brokenOptions) ? parsed.brokenOptions : [],
    emptyQuestions: Array.isArray(parsed.emptyQuestions) ? parsed.emptyQuestions : [],
    brokenEquations: Array.isArray(parsed.brokenEquations) ? parsed.brokenEquations : [],
    invalidJson: false,
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 0,
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
  return { report, raw: json };
}

export async function validateQuestions(
  apiKey: string | undefined,
  questions: ExtractedQuestion[],
  expectedCount: number | null,
): Promise<{ report: ValidationReport; raw: unknown }> {
  if (apiKey) {
    try {
      return await validateWithGroq(apiKey, questions, expectedCount);
    } catch (err) {
      const local = validateQuestionsLocally(questions, expectedCount);
      return {
        report: local,
        raw: {
          provider: "local-validation-fallback",
          warning: errorSummary("Groq", err),
        },
      };
    }
  }
  return { report: validateQuestionsLocally(questions, expectedCount), raw: { provider: "local-validation-fallback" } };
}

function validateQuestionsLocally(questions: ExtractedQuestion[], expectedCount: number | null): ValidationReport {
  const numbers = questions.map((q) => Number(q.questionNumber)).filter((n) => Number.isFinite(n) && n > 0);
  const maxNumber = expectedCount ?? Math.max(0, ...numbers);
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const n of numbers) {
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
  }
  const missingNumbers: number[] = [];
  for (let n = 1; n <= maxNumber; n += 1) {
    if (!seen.has(n)) missingNumbers.push(n);
  }
  const brokenOptions = questions
    .filter((q) => {
      if (q.questionType !== "single_correct" && q.questionType !== "multiple_correct") return false;
      const options = q.options ?? {};
      return ["A", "B", "C", "D"].some((key) => !String(options[key] ?? "").trim());
    })
    .map((q) => q.questionNumber);
  const emptyQuestions = questions.filter((q) => q.questionText.trim().length < 20).map((q) => q.questionNumber);
  const brokenEquations = questions
    .filter((q) => (q.questionText.match(/\$/g)?.length ?? 0) % 2 !== 0)
    .map((q) => q.questionNumber);
  const penalties = missingNumbers.length * 15 + duplicates.size * 10 + brokenOptions.length * 8 + emptyQuestions.length * 10 + brokenEquations.length * 5;
  return {
    missingNumbers,
    duplicates: Array.from(duplicates),
    brokenOptions,
    emptyQuestions,
    brokenEquations,
    invalidJson: false,
    score: Math.max(0, Math.min(100, 100 - penalties)),
    notes: "Validated locally after extraction.",
  };
}
