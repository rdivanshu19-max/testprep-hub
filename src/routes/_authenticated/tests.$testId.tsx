import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InlineMath, BlockMath } from "@/components/math";
import { Bookmark, Maximize2, Minimize2, Check, Keyboard, Delete } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tests/$testId")({
  head: () => ({ meta: [{ title: "Test — RankersTestHub" }] }),
  component: TestPlayer,
});

type Q = {
  id: string;
  question_text: string;
  options: any;
  type: string;
  correct_answer: string;
  question_image_url: string | null;
  subject_id: string | null;
};

function renderMath(text: string) {
  const parts: { type: "text" | "inline" | "block"; v: string }[] = [];
  const rest = text || "";
  const re = /(\$\$[^$]+\$\$|\$[^$\n]+\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    if (m.index > last) parts.push({ type: "text", v: rest.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("$$")) parts.push({ type: "block", v: tok.slice(2, -2) });
    else parts.push({ type: "inline", v: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < rest.length) parts.push({ type: "text", v: rest.slice(last) });
  return parts.map((p, i) => {
    if (p.type === "text") return <span key={i}>{p.v}</span>;
    if (p.type === "inline") return <InlineMath key={i} math={p.v} />;
    return <BlockMath key={i} math={p.v} />;
  });
}

function TestPlayer() {
  const { testId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const testQ = useQuery({
    queryKey: ["test-full", testId],
    queryFn: async () => {
      const { data: test, error: e1 } = await supabase
        .from("tests")
        .select("id, title, duration_min, marking_scheme, exam")
        .eq("id", testId)
        .maybeSingle();
      if (e1) throw e1;
      if (!test) throw new Error("Test not found");

      const { data: tq, error: e2 } = await supabase
        .from("test_questions")
        .select("order_index, section, question:questions(id, question_text, options, type, correct_answer, question_image_url, subject_id)")
        .eq("test_id", testId)
        .order("order_index");
      if (e2) throw e2;

      const questions = (tq ?? [])
        .map((r) => r.question as unknown as Q)
        .filter(Boolean);
      return { test, questions };
    },
  });

  const attemptQ = useQuery({
    queryKey: ["attempt", testId, user.id],
    enabled: !!testQ.data,
    queryFn: async () => {
      const { data: existing } = await (supabase as any)
        .from("test_attempts")
        .select("*")
        .eq("user_id", user.id)
        .eq("test_id", testId)
        .eq("status", "in_progress")
        .maybeSingle();
      if (existing) return existing;
      const { data: created, error } = await (supabase as any)
        .from("test_attempts")
        .insert({ user_id: user.id, test_id: testId })
        .select()
        .single();
      if (error) throw error;
      return created;
    },
  });

  const answersQ = useQuery({
    queryKey: ["attempt-answers", attemptQ.data?.id],
    enabled: !!attemptQ.data,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attempt_answers")
        .select("*")
        .eq("attempt_id", attemptQ.data.id);
      if (error) throw error;
      const map: Record<string, any> = {};
      for (const a of data ?? []) map[a.question_id] = a;
      return map;
    },
  });

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { chosen?: string; marked?: boolean; visited?: boolean }>>({});
  const [elapsed, setElapsed] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  const dirtyRef = useRef<Set<string>>(new Set());
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Hydrate from server
  useEffect(() => {
    if (answersQ.data) {
      const init: typeof answers = {};
      for (const [k, v] of Object.entries(answersQ.data as any)) {
        init[k] = { chosen: (v as any).chosen_answer, marked: (v as any).marked_for_review, visited: (v as any).visited };
      }
      setAnswers(init);
    }
  }, [answersQ.data]);

  // Timer
  useEffect(() => {
    if (!attemptQ.data) return;
    const start = new Date(attemptQ.data.started_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attemptQ.data]);

  const questions = testQ.data?.questions ?? [];
  const current = questions[idx];

  // Mark visited
  useEffect(() => {
    if (!current) return;
    setAnswers((a) => {
      if (a[current.id]?.visited) return a;
      dirtyRef.current.add(current.id);
      return { ...a, [current.id]: { ...(a[current.id] ?? {}), visited: true } };
    });
  }, [current?.id]);

  // Tab-switch counter
  useEffect(() => {
    const onBlur = () => setTabSwitches((n) => n + 1);
    const onVis = () => { if (document.hidden) setTabSwitches((n) => n + 1); };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Fullscreen tracking
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const flushSave = useCallback(async () => {
    if (!attemptQ.data) return;
    const ids = Array.from(dirtyRef.current);
    if (!ids.length) return;
    dirtyRef.current.clear();
    setSaveState("saving");
    const rows = ids.map((qid) => ({
      attempt_id: attemptQ.data.id,
      question_id: qid,
      chosen_answer: answersRef.current[qid]?.chosen ?? null,
      marked_for_review: answersRef.current[qid]?.marked ?? false,
      visited: true,
    }));
    const { error } = await (supabase as any)
      .from("attempt_answers")
      .upsert(rows, { onConflict: "attempt_id,question_id" });
    if (error) {
      setSaveState("error");
      // Re-mark for retry
      for (const qid of ids) dirtyRef.current.add(qid);
    } else {
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
    }
  }, [attemptQ.data]);

  // Autosave every 5s + on unload
  useEffect(() => {
    const t = setInterval(flushSave, 5000);
    const onBeforeUnload = () => { flushSave(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushSave();
    };
  }, [flushSave]);

  const markDirty = (qid: string) => { dirtyRef.current.add(qid); };

  const setChosen = (qid: string, chosen: string | undefined) => {
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? {}), chosen, visited: true } }));
    markDirty(qid);
  };
  const toggleMark = (qid: string) => {
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? {}), marked: !a[qid]?.marked, visited: true } }));
    markDirty(qid);
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!attemptQ.data || !testQ.data) return;
      await flushSave();
      const scheme = (testQ.data.test.marking_scheme as any) ?? { correct: 4, incorrect: -1 };
      let correct = 0, incorrect = 0, unattempted = 0, score = 0, total = 0;
      for (const q of questions) {
        total += scheme.correct ?? 4;
        const a = answersRef.current[q.id];
        if (!a?.chosen) { unattempted++; continue; }
        const isCorrect = String(a.chosen).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
        if (isCorrect) { correct++; score += scheme.correct ?? 4; }
        else { incorrect++; score += scheme.incorrect ?? -1; }
        await (supabase as any).from("attempt_answers").upsert(
          { attempt_id: attemptQ.data.id, question_id: q.id, chosen_answer: a.chosen, is_correct: isCorrect, marked_for_review: a.marked ?? false, visited: true },
          { onConflict: "attempt_id,question_id" },
        );
      }
      await (supabase as any).from("test_attempts").update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        time_spent_sec: elapsed,
        score,
        total_marks: total,
        correct_count: correct,
        incorrect_count: incorrect,
        unattempted_count: unattempted,
      }).eq("id", attemptQ.data.id);
      return attemptQ.data.id;
    },
    onSuccess: (attemptId) => {
      qc.invalidateQueries({ queryKey: ["my-attempts"] });
      if (attemptId) navigate({ to: "/results/$attemptId", params: { attemptId } });
    },
  });

  const remaining = useMemo(() => {
    if (!testQ.data) return 0;
    return Math.max(0, testQ.data.test.duration_min * 60 - elapsed);
  }, [testQ.data, elapsed]);

  useEffect(() => {
    if (remaining === 0 && attemptQ.data?.status === "in_progress" && testQ.data && elapsed > 0) {
      submit.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const opts: { value: string; label: string }[] = useMemo(() => {
    if (!current) return [];
    const raw = current.options;
    if (Array.isArray(raw)) {
      return raw.map((o: any, i: number) =>
        typeof o === "string"
          ? { value: String.fromCharCode(65 + i), label: o }
          : { value: o.key ?? o.value ?? String.fromCharCode(65 + i), label: o.text ?? o.label ?? String(o) },
      );
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([k, v]) => ({ value: k, label: String(v) }));
    }
    return [];
  }, [current]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key >= "1" && e.key <= "9") {
        const i = parseInt(e.key, 10) - 1;
        if (opts[i]) setChosen(current.id, opts[i].value);
      } else if (e.key.toLowerCase() === "n") {
        setIdx((i) => Math.min(questions.length - 1, i + 1));
      } else if (e.key.toLowerCase() === "p") {
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key.toLowerCase() === "m") {
        toggleMark(current.id);
      } else if (e.key.toLowerCase() === "c") {
        setChosen(current.id, undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, opts, questions.length]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  if (testQ.isLoading || attemptQ.isLoading) {
    return <div className="min-h-screen bg-background p-10"><div className="h-8 w-40 animate-pulse rounded bg-muted" /></div>;
  }
  if (testQ.error) {
    return <div className="min-h-screen bg-background p-10 text-sm text-destructive">Test not available.</div>;
  }
  if (!current) {
    return <div className="min-h-screen bg-background p-10 text-sm text-muted-foreground">This test has no questions yet.</div>;
  }

  const mins = Math.floor(remaining / 60), secs = remaining % 60;
  const answered = questions.filter((q) => answers[q.id]?.chosen).length;
  const markedCount = questions.filter((q) => answers[q.id]?.marked).length;

  return (
    <div className="min-h-screen bg-background" onContextMenu={(e) => e.preventDefault()}>
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{testQ.data!.test.exam}</div>
            <div className="truncate text-sm font-semibold">{testQ.data!.test.title}</div>
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} />
            {tabSwitches > 0 && (
              <span className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
                Tab-switch × {tabSwitches}
              </span>
            )}
            <button onClick={toggleFullscreen} className="rounded-md border border-border p-1.5 hover:bg-accent" aria-label="Fullscreen">
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <div className={cn(
              "rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums",
              remaining < 60 ? "border-destructive text-destructive animate-pulse" : "border-border",
            )}>
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </div>
            <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit test"}
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl items-center gap-4 border-t border-border/50 px-6 py-1.5 text-[11px] text-muted-foreground">
          <span>Answered: <span className="font-mono text-foreground">{answered}</span></span>
          <span>Marked: <span className="font-mono text-foreground">{markedCount}</span></span>
          <span>Total: <span className="font-mono text-foreground">{questions.length}</span></span>
          <span className="ml-auto hidden sm:inline">Shortcuts: 1–{Math.min(9, opts.length)} option · N next · P prev · M mark · C clear</span>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_300px]">
        {/* Question pane */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-mono">Q{idx + 1} / {questions.length}</Badge>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition",
                answers[current.id]?.marked
                  ? "border-purple-500 bg-purple-500/15 text-purple-200"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
              onClick={() => toggleMark(current.id)}
            >
              <Bookmark className="h-3.5 w-3.5" />
              {answers[current.id]?.marked ? "Marked" : "Mark for review"}
            </button>
          </div>

          <div className="prose prose-invert mt-6 max-w-none text-[15px] leading-relaxed">
            {renderMath(current.question_text)}
          </div>
          {current.question_image_url && (
            <>
              <img
                src={current.question_image_url}
                alt=""
                className="mt-4 max-w-full cursor-zoom-in rounded-md border border-border"
                onClick={() => setShowLightbox(true)}
              />
              {showLightbox && (
                <div
                  className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-8"
                  onClick={() => setShowLightbox(false)}
                >
                  <img src={current.question_image_url} alt="" className="max-h-full max-w-full" />
                </div>
              )}
            </>
          )}

          <div className="mt-8 space-y-3">
            {opts.map((o, i) => {
              const selected = answers[current.id]?.chosen === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setChosen(current.id, o.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition",
                    selected ? "border-primary bg-primary/10" : "border-border hover:border-foreground/40",
                  )}
                >
                  <span className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-xs",
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-current",
                  )}>{o.value}</span>
                  <span className="flex-1">{renderMath(o.label)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
              ← Previous
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setChosen(current.id, undefined)}>Clear</Button>
              <Button
                variant="outline"
                onClick={() => {
                  toggleMark(current.id);
                  setIdx((i) => Math.min(questions.length - 1, i + 1));
                }}
              >
                Mark & Next
              </Button>
              <Button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}>
                Save & Next →
              </Button>
            </div>
          </div>
        </div>

        {/* Palette */}
        <aside className="rounded-xl border border-border bg-card p-4 lg:sticky lg:top-32 lg:self-start">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Question palette</div>
          <div className="mt-4 grid grid-cols-6 gap-2">
            {questions.map((q, i) => {
              const a = answers[q.id];
              const state =
                a?.marked && a?.chosen ? "answered-marked"
                : a?.marked ? "marked"
                : a?.chosen ? "answered"
                : a?.visited ? "visited"
                : "untouched";
              return (
                <button
                  key={q.id}
                  onClick={() => setIdx(i)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-md border text-xs font-mono transition",
                    i === idx && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                    state === "answered" && "border-emerald-600 bg-emerald-600/20 text-emerald-200",
                    state === "marked" && "border-purple-500 bg-purple-500/20 text-purple-200",
                    state === "answered-marked" && "border-purple-500 bg-emerald-600/30 text-purple-100",
                    state === "visited" && "border-rose-500/60 bg-rose-500/10 text-rose-200",
                    state === "untouched" && "border-border text-muted-foreground",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-1.5 text-[11px] text-muted-foreground">
            <Legend color="bg-emerald-600/40 border-emerald-600" label={`Answered (${answered})`} />
            <Legend color="bg-purple-500/40 border-purple-500" label={`Marked (${markedCount})`} />
            <Legend color="bg-rose-500/20 border-rose-500/60" label="Visited, not answered" />
            <Legend color="bg-muted border-border" label="Not visited" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return <span className="font-mono text-[10px] text-muted-foreground">Autosave on</span>;
  if (state === "saving") return <span className="font-mono text-[10px] text-muted-foreground animate-pulse">Saving…</span>;
  if (state === "error") return <span className="font-mono text-[10px] text-destructive">Save failed — retrying</span>;
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400">
      <Check className="h-3 w-3" /> Saved
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-3 w-3 rounded-sm border", color)} />
      <span>{label}</span>
    </div>
  );
}
