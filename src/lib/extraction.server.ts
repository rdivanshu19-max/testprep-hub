// SERVER-ONLY helpers for the PDF→CBT extraction pipeline.
// Imported dynamically from inside server-function handlers — never from client code.

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
  const { PDFDocument } = await import("pdf-lib/dist/pdf-lib.esm.js");
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
