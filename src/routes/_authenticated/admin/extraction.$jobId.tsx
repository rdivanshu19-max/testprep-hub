import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteExtractionQuestion,
  getExtractionJob,
  processNextBatch,
  publishExtractionJob,
  recoverStuckExtractionJobs,
  retryFailedStep,
  retryMissing,
  runValidation,
  runExtractionSmokeTest,
  splitExtractionJob,
  updateExtractionQuestion,
} from "@/lib/extraction.functions";
import { supabase } from "@/integrations/supabase/client";
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
  const retryFailed = useServerFn(retryFailedStep);
  const recover = useServerFn(recoverStuckExtractionJobs);
  const smokeTest = useServerFn(runExtractionSmokeTest);
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
  const [liveLogs, setLiveLogs] = useState<AuditLog[]>([]);
  const autoStartedRef = useRef(false);
  const runLockRef = useRef(false);

  const runAll = async () => {
    if (runLockRef.current) return;
    runLockRef.current = true;
    setRunning(true);
    setStageMsg("Extracting questions…");
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
      setStageMsg("Validating extraction…");
      await validate({ data: { jobId } });
      setStageMsg("");
      toast.success("Extraction + validation complete");
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      autoStartedRef.current = false;
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
      runLockRef.current = false;
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
    if (runLockRef.current) return;
    runLockRef.current = true;
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
      setStageMsg("Validating extraction…");
      await validate({ data: { jobId } });
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
      setStageMsg("");
      toast.success("Retry + validation complete");
    } catch (e) {
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
      runLockRef.current = false;
    }
  };

  const retryFailedStage = async () => {
    if (runLockRef.current) return;
    runLockRef.current = true;
    setRunning(true);
    try {
      setStageMsg("Detecting failed step…");
      const r = await retryFailed({ data: { jobId } });
      toast.message(`Retrying ${r.stage} stage`);
      if (r.stage === "splitting") {
        setStageMsg("Re-splitting PDF…");
        await split({ data: { jobId } });
        autoStartedRef.current = true;
        for (let i = 0; i < 200; i++) {
          const p = await proc({ data: { jobId } });
          qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
          if (p.done || !p.processedBatchId) break;
        }
        setStageMsg("Validating extraction…");
        await validate({ data: { jobId } });
      } else if (r.stage === "extracting") {
        setStageMsg(`Re-running ${r.batchIds.length} failed batch${r.batchIds.length === 1 ? "" : "es"}…`);
        for (let i = 0; i < 200; i++) {
          const p = await proc({ data: { jobId } });
          qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
          if (p.done || !p.processedBatchId) break;
        }
        setStageMsg("Validating extraction…");
        await validate({ data: { jobId } });
      } else if (r.stage === "validating") {
        setStageMsg("Re-running validation…");
        await validate({ data: { jobId } });
      }
      setStageMsg("");
      toast.success("Failed step retried successfully");
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
    } catch (e) {
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
      runLockRef.current = false;
    }
  };

  const retryBatch = async (batchId: string) => {
    if (runLockRef.current) return;
    runLockRef.current = true;
    setRunning(true);
    setStageMsg("Retrying failed batch…");
    try {
      const p = await proc({ data: { jobId, retryBatchId: batchId } });
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
      toast.success(`Batch retried${p.extractedCount ? ` — ${p.extractedCount} questions` : ""}`);
      setStageMsg("");
    } catch (e) {
      setStageMsg("");
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
      runLockRef.current = false;
    }
  };

  const runSmoke = async () => {
    if (runLockRef.current) return;
    runLockRef.current = true;
    setRunning(true);
    setStageMsg("Running full pipeline smoke test…");
    try {
      const r = await smokeTest();
      if (r.pass) {
        toast.success(`Smoke test passed — ${r.questionCount} questions published`);
        if (r.jobId) navigate({ to: "/admin/extraction/$jobId", params: { jobId: r.jobId } });
      } else {
        toast.error(`Smoke test failed: ${r.error ?? "See activity log"}`);
      }
      qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
      qc.invalidateQueries({ queryKey: ["extraction-jobs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStageMsg("");
      setRunning(false);
      runLockRef.current = false;
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

  useEffect(() => {
    setLiveLogs((data.data?.logs ?? []) as AuditLog[]);
  }, [data.data?.logs]);

  useEffect(() => {
    const channel = supabase
      .channel(`extraction-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "extraction_audit_log", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const next = payload.new as AuditLog;
          setLiveLogs((prev) => [next, ...prev.filter((l) => l.id !== next.id)].slice(0, 100));
          if (isErrorLog(next)) toast.error(`${next.action}: ${extractLogError(next)}`);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "extraction_jobs", filter: `id=eq.${jobId}` },
        () => qc.invalidateQueries({ queryKey: ["extraction-job", jobId] }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "extraction_batches", filter: `job_id=eq.${jobId}` },
        () => qc.invalidateQueries({ queryKey: ["extraction-job", jobId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, qc]);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await recover({ data: { timeoutMinutes: 10 } });
        if (r.recovered.length > 0) qc.invalidateQueries({ queryKey: ["extraction-job", jobId] });
      } catch {
        // Recovery is best-effort; the regular query will surface real job errors.
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [jobId, qc, recover]);


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
  const { job, questions, report, batches, logs } = data.data;
  const displayLogs = liveLogs.length > 0 ? liveLogs : (logs as AuditLog[]);
  const doneBatches = batches.filter((b) => b.status === "done").length;
  const failedBatches = batches.filter((b) => b.status === "failed").length;
  const totalBatches = batches.length;
  const progressPct = totalBatches > 0 ? Math.round((doneBatches / totalBatches) * 100) : 0;

  const pipelineStages = [
    { key: "uploaded", label: "Uploaded" },
    { key: "splitting", label: "Splitting" },
    { key: "extracting", label: "Extracting" },
    { key: "validating", label: "Validating" },
    { key: "needs_review", label: "Review" },
    { key: "published", label: "Published" },
  ];
  const stageOrder: Record<string, number> = {
    uploaded: 0, splitting: 1, extracting: 2, validating: 3, needs_review: 4, approved: 5, published: 5, failed: -1,
  };
  const currentStage = stageOrder[job.status] ?? 0;
  const failedStageIndex = inferFailedStage(job.status, displayLogs);

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
          <Button variant="outline" size="sm" onClick={resplit} disabled={running}>Re-split PDF</Button>
          <Button variant="outline" size="sm" onClick={retryFailedStage} disabled={running || job.status !== "failed"}>
            Retry failed step
          </Button>
          <Button variant="outline" size="sm" onClick={runSmoke} disabled={running}>Smoke test</Button>
          <Button onClick={runAll} disabled={running} size="sm">
            {running ? "Running…" : doneBatches === totalBatches && totalBatches > 0 ? "Re-run extraction" : "Run extraction + validate"}
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

      {/* PIPELINE STAGES */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          {pipelineStages.map((s, idx) => {
            const isDone = currentStage > idx;
            const isActive = currentStage === idx;
            const isFailed = job.status === "failed" && idx === failedStageIndex;
            return (
              <div key={s.key} className="flex flex-1 items-center gap-2">
                <div
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-mono " +
                    (isFailed
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : isDone
                      ? "border-success bg-success/10 text-success"
                      : isActive
                      ? "border-primary bg-primary/10 text-primary animate-pulse"
                      : "border-border text-muted-foreground")
                  }
                >
                  {isFailed ? "!" : isDone ? "✓" : idx + 1}
                </div>
                <span className={"text-xs " + (isFailed || isActive ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {s.label}
                </span>
                {idx < pipelineStages.length - 1 && <div className="h-px flex-1 bg-border" />}
              </div>
            );
          })}
        </div>

        {totalBatches > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Batches: {doneBatches}/{totalBatches} done{failedBatches > 0 ? ` · ${failedBatches} failed` : ""}
              </span>
              <span className="font-mono">{progressPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {stageMsg && <div className="mt-2 text-xs text-primary">{stageMsg}</div>}
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[300px_1fr]">
        {/* SIDEBAR — validation report + batches + logs */}
        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Status</div>
            <div className="mt-2 text-base font-semibold capitalize">{job.status.replace(/_/g, " ")}</div>
            {job.last_error && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-destructive/10 p-2 text-[10px] text-destructive">
                {job.last_error}
              </pre>
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
              {batches.length === 0 && <li className="text-muted-foreground">No batches yet — split the PDF.</li>}
              {batches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-muted-foreground">p{b.page_from}–{b.page_to}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={
                      b.status === "done" ? "border-success/40 text-success" :
                      b.status === "failed" ? "border-destructive/40 text-destructive" :
                      b.status === "running" ? "border-primary/40 text-primary animate-pulse" : ""
                    }>
                      {b.status}{b.attempts ? ` ·${b.attempts}` : ""}
                    </Badge>
                    {b.status === "failed" && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={running} onClick={() => retryBatch(b.id)}>
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Live activity log</div>
              <Badge variant="outline" className="border-success/40 text-success">streaming</Badge>
            </div>
            <ul className="mt-3 max-h-96 space-y-2 overflow-auto text-[11px]">
              {displayLogs.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
              {displayLogs.map((l) => {
                const error = isErrorLog(l);
                return (
                <li key={l.id} className={"border-l-2 pl-2 " + (error ? "border-destructive bg-destructive/5 py-1 text-destructive" : "border-border")}>
                  <div className="font-mono text-foreground">{l.action}</div>
                  <div className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</div>
                  {hasLogPayload(l.payload) && (
                    <pre className={"mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap " + (error ? "text-destructive" : "text-muted-foreground")}>
                      {JSON.stringify(l.payload, null, 0)}
                    </pre>
                  )}
                </li>
              );
              })}
            </ul>
          </div>
        </aside>

        {/* QUESTIONS */}
        <section>
          {questions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
              {running || job.status === "extracting"
                ? "Extraction in progress — questions will appear here as batches finish."
                : job.status === "splitting"
                ? "Splitting PDF into batches…"
                : <>No questions yet. Click <strong>Run extraction + validate</strong> to start.</>}
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

type AuditLog = {
  id: string;
  actor: string | null;
  action: string;
  payload: unknown;
  created_at: string;
};

function isErrorLog(log: AuditLog) {
  return /failed|error/i.test(log.action) || /error/i.test(JSON.stringify(log.payload ?? {}));
}

function extractLogError(log: AuditLog) {
  const payload = log.payload as { error?: string; reason?: string } | null;
  return (payload?.error ?? payload?.reason ?? "See activity log").slice(0, 160);
}

function hasLogPayload(payload: unknown): payload is Record<string, unknown> | unknown[] {
  if (payload == null) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  return typeof payload === "object" && Object.keys(payload).length > 0;
}

function inferFailedStage(status: string, logs: AuditLog[]) {
  if (status !== "failed") return -1;
  const lastFailure = logs.find((l) => /failed|error/i.test(l.action));
  const action = lastFailure?.action ?? "extract.failed";
  if (action.startsWith("split") || action.includes("splitting")) return 1;
  if (action.startsWith("validate") || action.includes("validating")) return 3;
  if (action.startsWith("publish")) return 5;
  return 2;
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
