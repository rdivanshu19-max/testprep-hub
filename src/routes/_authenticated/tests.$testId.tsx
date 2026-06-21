import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InlineMath, BlockMath } from "react-katex";

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
  // Split on $$...$$ and $...$ math.
  const parts: { type: "text" | "inline" | "block"; v: string }[] = [];
  let rest = text || "";
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

  // Find or create attempt
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

  useEffect(() => {
    if (answersQ.data) {
      const init: typeof answers = {};
      for (const [k, v] of Object.entries(answersQ.data as any)) {
        init[k] = { chosen: (v as any).chosen_answer, marked: (v as any).marked_for_review, visited: (v as any).visited };
      }
      setAnswers(init);
    }
  }, [answersQ.data]);

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
    setAnswers((a) => ({ ...a, [current.id]: { ...(a[current.id] ?? {}), visited: true } }));
  }, [current?.id]);

  const saveAnswer = useMutation({
    mutationFn: async (payload: { questionId: string; chosen?: string | null; marked?: boolean }) => {
      if (!attemptQ.data) return;
      await (supabase as any).from("attempt_answers").upsert(
        {
          attempt_id: attemptQ.data.id,
          question_id: payload.questionId,
          chosen_answer: payload.chosen ?? null,
          marked_for_review: payload.marked ?? false,
          visited: true,
        },
        { onConflict: "attempt_id,question_id" },
      );
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!attemptQ.data || !testQ.data) return;
      const scheme = (testQ.data.test.marking_scheme as any) ?? { correct: 4, incorrect: -1 };
      let correct = 0, incorrect = 0, unattempted = 0, score = 0, total = 0;
      for (const q of questions) {
        total += scheme.correct ?? 4;
        const a = answers[q.id];
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
  }, [remaining]);

  if (testQ.isLoading || attemptQ.isLoading) {
    return <div className="min-h-screen bg-background p-10"><div className="h-8 w-40 animate-pulse rounded bg-muted" /></div>;
  }
  if (testQ.error) {
    return <div className="min-h-screen bg-background p-10 text-sm text-destructive">Test not available.</div>;
  }
  if (!current) {
    return <div className="min-h-screen bg-background p-10 text-sm text-muted-foreground">This test has no questions yet.</div>;
  }

  const opts: { value: string; label: string }[] =
    Array.isArray(current.options)
      ? current.options.map((o: any, i: number) =>
          typeof o === "string"
            ? { value: String.fromCharCode(65 + i), label: o }
            : { value: o.key ?? o.value ?? String.fromCharCode(65 + i), label: o.text ?? o.label ?? String(o) },
        )
      : [];

  const mins = Math.floor(remaining / 60), secs = remaining % 60;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{testQ.data!.test.exam}</div>
            <div className="text-sm font-semibold">{testQ.data!.test.title}</div>
          </div>
          <div className="flex items-center gap-4">
            <div className={cn(
              "rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums",
              remaining < 60 ? "border-destructive text-destructive" : "border-border",
            )}>
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </div>
            <Button size="sm" variant="default" onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_280px]">
        {/* Question pane */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-mono">Q{idx + 1} / {questions.length}</Badge>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setAnswers((a) => {
                  const next = { ...a, [current.id]: { ...(a[current.id] ?? {}), marked: !a[current.id]?.marked } };
                  saveAnswer.mutate({ questionId: current.id, chosen: next[current.id].chosen, marked: next[current.id].marked });
                  return next;
                });
              }}
            >
              {answers[current.id]?.marked ? "★ Marked for review" : "☆ Mark for review"}
            </button>
          </div>

          <div className="prose prose-invert mt-6 max-w-none text-[15px] leading-relaxed">
            {renderMath(current.question_text)}
          </div>
          {current.question_image_url && (
            <img src={current.question_image_url} alt="" className="mt-4 max-w-full rounded-md border border-border" />
          )}

          <div className="mt-8 space-y-3">
            {opts.map((o) => {
              const selected = answers[current.id]?.chosen === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => {
                    setAnswers((a) => {
                      const next = { ...a, [current.id]: { ...(a[current.id] ?? {}), chosen: o.value, visited: true } };
                      saveAnswer.mutate({ questionId: current.id, chosen: o.value, marked: next[current.id].marked });
                      return next;
                    });
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition",
                    selected ? "border-primary bg-primary/10" : "border-border hover:border-foreground/40",
                  )}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current font-mono text-xs">{o.value}</span>
                  <span className="flex-1">{renderMath(o.label)}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button variant="outline" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
              ← Previous
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setAnswers((a) => {
                    const next = { ...a, [current.id]: { ...(a[current.id] ?? {}), chosen: undefined } };
                    saveAnswer.mutate({ questionId: current.id, chosen: null, marked: next[current.id].marked });
                    return next;
                  });
                }}
              >
                Clear
              </Button>
              <Button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={idx === questions.length - 1}>
                Save & Next →
              </Button>
            </div>
          </div>
        </div>

        {/* Palette */}
        <aside className="rounded-xl border border-border bg-card p-4">
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
                    "grid h-9 w-9 place-items-center rounded-md border text-xs font-mono",
                    i === idx && "ring-2 ring-primary",
                    state === "answered" && "border-emerald-600 bg-emerald-600/15 text-emerald-200",
                    state === "marked" && "border-purple-500 bg-purple-500/15 text-purple-200",
                    state === "answered-marked" && "border-purple-500 bg-emerald-600/30 text-purple-100",
                    state === "visited" && "border-amber-500/60 bg-amber-500/10 text-amber-200",
                    state === "untouched" && "border-border text-muted-foreground",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-1.5 text-[11px] text-muted-foreground">
            <Legend color="bg-emerald-600/40" label="Answered" />
            <Legend color="bg-purple-500/40" label="Marked" />
            <Legend color="bg-amber-500/30" label="Visited" />
            <Legend color="bg-muted" label="Untouched" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-3 w-3 rounded-sm border border-border", color)} />
      <span>{label}</span>
    </div>
  );
}
