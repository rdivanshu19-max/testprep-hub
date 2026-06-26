import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteExtractionQuestion,
  getExtractionJob,
  processNextBatch,
  publishExtractionJob,
  retryMissing,
  runValidation,
  splitExtractionJob,
  updateExtractionQuestion,
} from "@/lib/extraction.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { InlineMath } from "@/components/math";

export const Route = createFileRoute("/_authenticated/admin/extraction/$jobId")({
  head: () => ({ meta: [{ title: "Extraction job — Admin" }] }),
  component: JobPage,
});

function JobPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const get = useServerFn(getExtractionJob);
  const split = useServerFn(splitExtractionJob);
  const proc = useServerFn(processNextBatch);
  const validate = useServerFn(runValidation);
  const retry = useServerFn(retryMissing);
  const publish = useServerFn(publishExtractionJob);

  const data = useQuery({
    queryKey: ["extraction-job", jobId],
    queryFn: () => get({ data: { jobId } }),
    refetchInterval: (q) => {
      const s = q.state.data?.job.status;
      return s === "extracting" || s === "splitting" || s === "validating" ? 1200 : false;
    },
  });

  const [running, setRunning] = useState(false);
  const [stageMsg, setStageMsg] = useState<string>("");
  const autoStartedRef = useRef(false);

  const runAll = async () => {
    if (running) return;
    setRunning(true);
    setStageMsg("Extracting questions with Gemini…");
    try {
      for (let i = 0; i < 200; i++) {
        const r = await proc({ data: { jobId } });
        qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
        if (r.done) break;
        if (!r.processedBatchId) break;
        setStageMsg(
          `Extracted batch (pages ${r.pagesProcessed}, +${r.extractedCount} Qs). ${r.pendingCount} batches left…`,
        );
      }
      setStageMsg("Validating with Groq…");
      await validate({ data: { jobId } });
      setStageMsg("");
      toast.success("Extraction + validation complete");
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const resplit = async () => {
    try {
      autoStartedRef.current = false;
      await split({ data: { jobId } });
      toast.success("Re-split complete");
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const retryAndExtract = async () => {
    if (running) return;
    setRunning(true);
    setStageMsg("Re-queuing missing batches…");
    try {
      const r = await retry({ data: { jobId } });
      toast.message(`Re-queued ${r.batchIds.length} batches`);
      for (let i = 0; i < 200; i++) {
        const p = await proc({ data: { jobId } });
        qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
        if (p.done || !p.processedBatchId) break;
      }
      setStageMsg("Validating with Groq…");
      await validate({ data: { jobId } });
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
      setStageMsg("");
      toast.success("Retry + validation complete");
    } catch (e) {
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Auto-kick extraction whenever a job is freshly split (status=extracting with pending batches).
  useEffect(() => {
    const d = data.data;
    if (!d || running || autoStartedRef.current) return;
    const pending = d.batches.filter((b) => b.status === "pending").length;
    if (d.job.status === "extracting" && pending > 0) {
      autoStartedRef.current = true;
      void runAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data?.job.status, data.data?.batches.length]);


  const publishMut = useMutation({
    mutationFn: () => publish({ data: { jobId, durationMin: 180, markingScheme: { correct: 4, incorrect: -1, unattempted: 0 } } }),
    onSuccess: (r) => {
      toast.success(`Published — ${r.questionCount} questions live`);
      navigate({ to: "/admin/extraction" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (data.isLoading || !data.data) {
    return <main className="mx-auto max-w-7xl px-6 py-10 text-sm text-muted-foreground">Loading…</main>;
  }
  const { job, questions, report, batches } = data.data;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link to="/admin/extraction" className="text-xs text-muted-foreground hover:text-foreground">← All jobs</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{job.title ?? job.original_filename}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline">{job.exam}</Badge>
            <span>·</span>
            <span>{job.page_count ?? "—"} pages</span>
            <span>·</span>
            <span>Expected {job.expected_question_count ?? "?"}</span>
            <span>·</span>
            <span>Extracted {questions.length}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={resplit}>Re-split PDF</Button>
          <Button onClick={runAll} disabled={running} size="sm">
            {running ? "Running…" : "Run extraction + validate"}
          </Button>
          {report && (report.missing_numbers?.length ?? 0) > 0 && (
            <Button onClick={retryAndExtract} disabled={running} size="sm" variant="secondary">
              Retry {report.missing_numbers.length} missing
            </Button>
          )}
          <Button
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending || questions.length === 0 || job.status === "published"}
            size="sm"
          >
            {job.status === "published" ? "Published" : "Approve & Publish"}
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[300px_1fr]">
        {/* SIDEBAR — validation report + batches */}
        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Status</div>
            <div className="mt-2 text-base font-semibold">{job.status}</div>
            {job.last_error && (
              <div className="mt-2 text-xs text-destructive">{job.last_error}</div>
            )}
            <div className="mt-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">Extraction score</div>
            <div className="mt-1 font-mono text-3xl font-semibold">{report?.score ?? job.extraction_score ?? "—"}</div>
          </div>

          {report && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3 text-sm">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Validation</div>
              <ReportRow label="Missing" nums={report.missing_numbers} tone="destructive" />
              <ReportRow label="Duplicates" nums={report.duplicates} tone="warning" />
              <ReportRow label="Broken options" nums={report.broken_options} tone="warning" />
              <ReportRow label="Empty" nums={report.empty_questions} tone="warning" />
              <ReportRow label="Broken equations" nums={report.broken_equations} tone="warning" />
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Batches</div>
            <ul className="mt-3 space-y-1.5 text-xs">
              {batches.map((b) => (
                <li key={b.id} className="flex items-center justify-between">
                  <span className="font-mono text-muted-foreground">p{b.page_from}–{b.page_to}</span>
                  <Badge variant="outline" className={
                    b.status === "done" ? "border-success/40 text-success" :
                    b.status === "failed" ? "border-destructive/40 text-destructive" :
                    b.status === "running" ? "border-primary/40 text-primary" : ""
                  }>
                    {b.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* QUESTIONS */}
        <section>
          {questions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
              No questions yet. Click <strong>Run extraction</strong> once the PDF is split.
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => (
                <QuestionCard key={q.id} q={q as unknown as Q} jobId={jobId} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ReportRow({ label, nums, tone }: { label: string; nums: number[] | null; tone: "destructive" | "warning" }) {
  const list = nums ?? [];
  if (list.length === 0) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-success">none</span>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className={tone === "destructive" ? "text-destructive" : "text-warning-foreground"}>
          {list.length}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-mono">
        {list.slice(0, 50).map((n) => (
          <span key={n} className="rounded bg-muted px-1 py-0.5">{n}</span>
        ))}
      </div>
    </div>
  );
}

type Q = {
  id: string;
  question_number: number;
  type: string;
  subject: string | null;
  question_text: string;
  options: Record<string, string> | null;
  answer: string | null;
  has_image: boolean;
  status: string;
};

function QuestionCard({ q, jobId }: { q: Q; jobId: string }) {
  const qc = useQueryClient();
  const update = useServerFn(updateExtractionQuestion);
  const del = useServerFn(deleteExtractionQuestion);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.question_text);
  const [opts, setOpts] = useState<Record<string, string>>(q.options ?? { A: "", B: "", C: "", D: "" });
  const [answer, setAnswer] = useState(q.answer ?? "");

  const save = async () => {
    try {
      await update({ data: { id: q.id, questionText: text, options: opts, answer } });
      toast.success(`Q${q.question_number} saved`);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete Q${q.question_number}?`)) return;
    try {
      await del({ data: { id: q.id } });
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">Q{q.question_number}</span>
          <Badge variant="outline">{q.subject || "?"}</Badge>
          <Badge variant="outline">{q.type}</Badge>
          {q.has_image && <Badge variant="outline" className="border-warning/40 text-warning-foreground">image</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
          {editing && <Button size="sm" onClick={save}>Save</Button>}
          {editing && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          <Button size="sm" variant="ghost" onClick={remove}>Delete</Button>
        </div>
      </header>

      <div className="mt-4 space-y-3 text-sm">
        {editing ? (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        ) : (
          <MathText text={q.question_text} />
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {(["A", "B", "C", "D"] as const).map((k) => (
            <div key={k} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
              <span className="mt-0.5 font-mono text-xs text-muted-foreground">{k}.</span>
              <div className="flex-1">
                {editing ? (
                  <Input value={opts[k] ?? ""} onChange={(e) => setOpts({ ...opts, [k]: e.target.value })} />
                ) : (
                  <MathText text={opts[k] ?? ""} />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Label className="text-xs text-muted-foreground">Answer</Label>
          {editing ? (
            <Input value={answer} onChange={(e) => setAnswer(e.target.value)} className="h-8 w-24" />
          ) : (
            <span className="font-mono text-sm font-semibold">{q.answer || "—"}</span>
          )}
        </div>
      </div>
    </article>
  );
}

// Tiny LaTeX renderer: splits text on $...$ pairs and renders InlineMath between them.
function MathText({ text }: { text: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const parts: { kind: "text" | "math"; value: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const next = text.indexOf("$", i);
    if (next === -1) {
      parts.push({ kind: "text", value: text.slice(i) });
      break;
    }
    if (next > i) parts.push({ kind: "text", value: text.slice(i, next) });
    const close = text.indexOf("$", next + 1);
    if (close === -1) {
      parts.push({ kind: "text", value: text.slice(next) });
      break;
    }
    parts.push({ kind: "math", value: text.slice(next + 1, close) });
    i = close + 1;
  }
  return (
    <span className="text-sm leading-relaxed">
      {parts.map((p, idx) =>
        p.kind === "math" ? (
          <InlineMath key={idx} math={p.value} />
        ) : (
          <span key={idx} style={{ whiteSpace: "pre-wrap" }}>{p.value}</span>
        ),
      )}
    </span>
  );
}
