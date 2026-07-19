import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InlineMath, BlockMath } from "@/components/math";
import { CheckCircle2, XCircle, MinusCircle, Trophy, Clock, Target, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/results/$attemptId")({
  head: () => ({ meta: [{ title: "Results — RankersTestHub" }] }),
  component: Results,
});

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

type Tab = "overview" | "subjects" | "difficulty" | "time" | "report" | "solutions" | "insights" | "proctor";

function Results() {
  const { attemptId } = Route.useParams();
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState<"all" | "correct" | "wrong" | "skipped">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["attempt-result", attemptId],
    queryFn: async () => {
      const { data: a, error: e1 } = await (supabase as any)
        .from("test_attempts")
        .select("*, test:tests(id, title, exam, duration_min)")
        .eq("id", attemptId)
        .maybeSingle();
      if (e1) throw e1;

      const { data: ans, error: e2 } = await (supabase as any)
        .from("attempt_answers")
        .select("*, question:questions(id, question_text, question_image_url, options, correct_answer, solution_text, difficulty, subject_id, chapter_id, subjects(name))")
        .eq("attempt_id", attemptId);
      if (e2) throw e2;


      return { attempt: a, answers: ans ?? [] };
    },
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const a = data.attempt;
    const attempted = (a.correct_count ?? 0) + (a.incorrect_count ?? 0);
    const total = (a.correct_count ?? 0) + (a.incorrect_count ?? 0) + (a.unattempted_count ?? 0);
    const accuracy = attempted > 0 ? Math.round(((a.correct_count ?? 0) / attempted) * 100) : 0;
    const attemptRate = total > 0 ? Math.round((attempted / total) * 100) : 0;
    const timeMin = Math.floor((a.time_spent_sec ?? 0) / 60);
    const timeSec = (a.time_spent_sec ?? 0) % 60;
    const avgPerQ = total > 0 ? Math.round((a.time_spent_sec ?? 0) / total) : 0;

    // Subject breakdown
    const subjMap: Record<string, { name: string; correct: number; wrong: number; skipped: number; total: number }> = {};
    const diffMap: Record<string, { name: string; correct: number; wrong: number; skipped: number; total: number }> = {};
    for (const row of data.answers as any[]) {
      const sname = row.question?.subjects?.name ?? "General";
      const entry = subjMap[sname] ?? { name: sname, correct: 0, wrong: 0, skipped: 0, total: 0 };
      entry.total += 1;
      if (row.chosen_answer == null) entry.skipped += 1;
      else if (row.is_correct) entry.correct += 1;
      else entry.wrong += 1;
      subjMap[sname] = entry;

      const dname = row.question?.difficulty ?? "unrated";
      const dentry = diffMap[dname] ?? { name: dname, correct: 0, wrong: 0, skipped: 0, total: 0 };
      dentry.total += 1;
      if (row.chosen_answer == null) dentry.skipped += 1;
      else if (row.is_correct) dentry.correct += 1;
      else dentry.wrong += 1;
      diffMap[dname] = dentry;
    }
    return { accuracy, attemptRate, timeMin, timeSec, avgPerQ, subjects: Object.values(subjMap), difficulty: Object.values(diffMap), attempted, total };
  }, [data]);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader variant="app" />
        <div className="mx-auto max-w-5xl p-10">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {[0,1,2,3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
          </div>
        </div>
      </div>
    );
  }
  if (!data?.attempt) return <div className="min-h-screen bg-background p-10 text-sm text-muted-foreground">Attempt not found.</div>;

  const a = data.attempt;
  const scorePct = a.total_marks > 0 ? Math.round(((a.score ?? 0) / a.total_marks) * 100) : 0;

  const filtered = (data.answers as any[]).filter((row) => {
    if (filter === "all") return true;
    if (filter === "skipped") return row.chosen_answer == null;
    if (filter === "correct") return row.is_correct === true;
    if (filter === "wrong") return row.chosen_answer != null && !row.is_correct;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Result · {a.test?.exam}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{a.test?.title}</h1>
            <div className="mt-1 text-xs text-muted-foreground">
              Submitted {a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/tests" className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent">Back to tests</Link>
            <Link to="/dashboard" className="rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90">Dashboard</Link>
          </div>
        </div>

        {/* Hero score card */}
        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-card/50 p-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" /> Final score
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-5xl font-semibold tracking-tight">{a.score ?? 0}</span>
              <span className="font-mono text-lg text-muted-foreground">/ {a.total_marks ?? 0}</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-primary" style={{ width: `${Math.max(0, scorePct)}%` }} />
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">{scorePct}% of maximum</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<Target className="h-4 w-4" />} k="Accuracy" v={`${stats?.accuracy ?? 0}%`} />
            <StatCard icon={<TrendingUp className="h-4 w-4" />} k="Attempt rate" v={`${stats?.attemptRate ?? 0}%`} />
            <StatCard icon={<Clock className="h-4 w-4" />} k="Time" v={`${stats?.timeMin ?? 0}m ${stats?.timeSec ?? 0}s`} />
            <StatCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} k="Correct" v={`${a.correct_count ?? 0}`} />
            <StatCard icon={<XCircle className="h-4 w-4 text-destructive" />} k="Wrong" v={`${a.incorrect_count ?? 0}`} />
            <StatCard icon={<MinusCircle className="h-4 w-4 text-muted-foreground" />} k="Skipped" v={`${a.unattempted_count ?? 0}`} />
            <StatCard k="Avg / Q" v={`${stats?.avgPerQ ?? 0}s`} />
            <StatCard k="Duration" v={`${a.test?.duration_min ?? 0}m`} />
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-10 flex flex-wrap gap-1 border-b border-border">
          {(["overview","subjects","difficulty","time","report","solutions","proctor","insights"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium capitalize transition -mb-px border-b-2",
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "proctor" ? "Anti‑cheat" : t === "report" ? "Question report" : t}
            </button>
          ))}
        </div>


        {/* Overview */}
        {tab === "overview" && (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">Attempt distribution</h3>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
                <div className="bg-emerald-500" style={{ width: `${((a.correct_count ?? 0) / (stats?.total || 1)) * 100}%` }} />
                <div className="bg-destructive" style={{ width: `${((a.incorrect_count ?? 0) / (stats?.total || 1)) * 100}%` }} />
                <div className="bg-muted-foreground/30" style={{ width: `${((a.unattempted_count ?? 0) / (stats?.total || 1)) * 100}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 mr-1.5" />Correct <span className="font-mono">{a.correct_count ?? 0}</span></div>
                <div><span className="inline-block h-2 w-2 rounded-sm bg-destructive mr-1.5" />Wrong <span className="font-mono">{a.incorrect_count ?? 0}</span></div>
                <div><span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground/40 mr-1.5" />Skipped <span className="font-mono">{a.unattempted_count ?? 0}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">Verdict</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {scorePct >= 80 ? "Excellent work. You're in top-tier territory — sharpen the last few weak topics." :
                 scorePct >= 60 ? "Solid attempt. Focus on the wrong answers below — most gains come from fixing consistent misconceptions." :
                 scorePct >= 40 ? "Fair. Review skipped questions and time management; you attempted only " + (stats?.attemptRate ?? 0) + "%." :
                 "Rebuild from fundamentals. Start with the weakest subject in the breakdown."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setTab("solutions")} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">Review solutions</button>
                <button onClick={() => setTab("subjects")} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">Subject breakdown</button>
              </div>
            </div>
          </div>
        )}

        {/* Subjects */}
        {tab === "subjects" && (
          <div className="mt-6 space-y-3">
            {stats?.subjects.length === 0 && <p className="text-sm text-muted-foreground">No subject data.</p>}
            {stats?.subjects.map((s) => {
              const acc = s.correct + s.wrong > 0 ? Math.round((s.correct / (s.correct + s.wrong)) * 100) : 0;
              return (
                <div key={s.name} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{s.name}</div>
                    <div className="font-mono text-sm text-muted-foreground">{s.correct}/{s.total} · <span className="text-foreground">{acc}%</span></div>
                  </div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className="bg-emerald-500" style={{ width: `${(s.correct / s.total) * 100}%` }} />
                    <div className="bg-destructive" style={{ width: `${(s.wrong / s.total) * 100}%` }} />
                    <div className="bg-muted-foreground/30" style={{ width: `${(s.skipped / s.total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Difficulty */}
        {tab === "difficulty" && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {stats?.difficulty.length === 0 && <p className="text-sm text-muted-foreground">No difficulty labels on these questions.</p>}
            {stats?.difficulty.map((d) => {
              const acc = d.correct + d.wrong > 0 ? Math.round((d.correct / (d.correct + d.wrong)) * 100) : 0;
              return (
                <div key={d.name} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold capitalize">{d.name}</div>
                    <span className="font-mono text-sm text-muted-foreground">{d.total} Q</span>
                  </div>
                  <div className="mt-2 font-mono text-2xl">{acc}%</div>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className="bg-emerald-500" style={{ width: `${(d.correct / d.total) * 100}%` }} />
                    <div className="bg-destructive" style={{ width: `${(d.wrong / d.total) * 100}%` }} />
                    <div className="bg-muted-foreground/30" style={{ width: `${(d.skipped / d.total) * 100}%` }} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px] text-muted-foreground">
                    <span>✓ {d.correct}</span><span>✗ {d.wrong}</span><span>− {d.skipped}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Time management */}
        {tab === "time" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard k="Total time" v={`${stats?.timeMin ?? 0}m ${stats?.timeSec ?? 0}s`} />
            <StatCard k="Allotted" v={`${a.test?.duration_min ?? 0}m`} />
            <StatCard k="Avg / question" v={`${stats?.avgPerQ ?? 0}s`} />
            <StatCard k="Ideal / question" v={`${a.test?.duration_min && stats?.total ? Math.round((a.test.duration_min * 60) / stats.total) : 0}s`} />
            <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">Pacing</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                You used {Math.round(((a.time_spent_sec ?? 0) / ((a.test?.duration_min ?? 1) * 60)) * 100)}% of the allotted window.
                {((stats?.avgPerQ ?? 0) > 90) ? " Consider skipping tough questions on the first pass and returning later." : " Your average per question is within a healthy band."}
              </p>
            </div>
          </div>
        )}

        {/* Question report — compact table */}
        {tab === "report" && (
          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Subject</th>
                  <th className="px-3 py-2 text-left font-medium">Difficulty</th>
                  <th className="px-3 py-2 text-left font-medium">Your answer</th>
                  <th className="px-3 py-2 text-left font-medium">Correct</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.answers as any[]).map((row, i) => {
                  const q = row.question;
                  const status = row.chosen_answer == null ? "skipped" : row.is_correct ? "correct" : "wrong";
                  return (
                    <tr key={row.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">Q{i + 1}</td>
                      <td className="px-3 py-2 text-xs">{q?.subjects?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs capitalize">{q?.difficulty ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.chosen_answer ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{q?.correct_answer ?? "—"}</td>
                      <td className="px-3 py-2">
                        {status === "correct" && <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono uppercase text-emerald-600 dark:text-emerald-300">Correct</span>}
                        {status === "wrong" && <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-mono uppercase text-destructive">Wrong</span>}
                        {status === "skipped" && <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">Skipped</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Anti‑cheat / proctoring */}
        {tab === "proctor" && (
          <ProctorPanel a={a} />
        )}


        {/* Insights */}
        {tab === "insights" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <InsightCard title="Time efficiency" body={`You spent ${stats?.avgPerQ ?? 0}s on average per question. ${((stats?.avgPerQ ?? 0) > 90) ? "Try to pace faster on easy questions." : "Good pacing."}`} />
            <InsightCard title="Strong area" body={stats?.subjects.length ? `Highest accuracy: ${topBy(stats.subjects, "acc")}.` : "—"} />
            <InsightCard title="Weak area" body={stats?.subjects.length ? `Lowest accuracy: ${bottomBy(stats.subjects, "acc")}.` : "—"} />
            <InsightCard title="Guess check" body={`${a.unattempted_count ?? 0} skipped. If confident on ~half, attempts could add ~${Math.round(((a.unattempted_count ?? 0) / 2) * 4)} marks (before negatives).`} />
          </div>
        )}

        {/* Solutions */}
        {tab === "solutions" && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {(["all","correct","wrong","skipped"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs capitalize",
                    filter === f ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f} {f === "correct" ? `(${a.correct_count ?? 0})` : f === "wrong" ? `(${a.incorrect_count ?? 0})` : f === "skipped" ? `(${a.unattempted_count ?? 0})` : `(${stats?.total ?? 0})`}
                </button>
              ))}
            </div>
            <div className="space-y-4">
              {filtered.map((row: any, i: number) => {
                const q = row.question;
                if (!q) return null;
                const raw = q.options;
                const opts: { v: string; label: string }[] = Array.isArray(raw)
                  ? raw.map((o: any, oi: number) => typeof o === "string" ? { v: String.fromCharCode(65 + oi), label: o } : { v: o.key ?? String.fromCharCode(65 + oi), label: o.text ?? o.label ?? String(o) })
                  : (raw && typeof raw === "object" ? Object.entries(raw).map(([k, v]) => ({ v: k, label: String(v) })) : []);
                const status = row.chosen_answer == null ? "skipped" : row.is_correct ? "correct" : "wrong";
                return (
                  <div key={row.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono">Q{i + 1}</Badge>
                      {status === "skipped" && <Badge variant="secondary">Unattempted</Badge>}
                      {status === "correct" && <Badge className="border border-emerald-600 bg-emerald-600/20 text-emerald-200">Correct · +4</Badge>}
                      {status === "wrong" && <Badge className="border border-destructive bg-destructive/20 text-destructive">Wrong · −1</Badge>}
                      {q.subjects?.name && <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{q.subjects.name}</span>}
                    </div>
                    <div className="prose prose-invert mt-3 max-w-none text-sm">{renderMath(q.question_text)}</div>
                    <div className="mt-3 grid gap-2">
                      {opts.map((o) => {
                        const isCorrect = String(o.v).toLowerCase() === String(q.correct_answer).toLowerCase();
                        const isChosen = String(o.v) === String(row.chosen_answer);
                        return (
                          <div key={o.v} className={cn(
                            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                            isCorrect && "border-emerald-600 bg-emerald-600/10",
                            isChosen && !isCorrect && "border-destructive bg-destructive/10",
                            !isCorrect && !isChosen && "border-border",
                          )}>
                            <span className="font-mono text-xs">{o.v}</span>
                            <span className="flex-1">{renderMath(o.label)}</span>
                            {isCorrect && <span className="text-[10px] font-mono text-emerald-400">CORRECT</span>}
                            {isChosen && !isCorrect && <span className="text-[10px] font-mono text-destructive">YOUR PICK</span>}
                          </div>
                        );
                      })}
                    </div>
                    {q.solution_text && (
                      <div className="mt-3 rounded-md border border-border/50 bg-muted/30 p-3 text-xs">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Solution</div>
                        <div className="text-foreground/90">{renderMath(q.solution_text)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground">No questions match this filter.</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function topBy(arr: any[], _k: string) {
  const sorted = [...arr].sort((a, b) => {
    const ac = a.correct + a.wrong ? a.correct / (a.correct + a.wrong) : 0;
    const bc = b.correct + b.wrong ? b.correct / (b.correct + b.wrong) : 0;
    return bc - ac;
  });
  return sorted[0]?.name ?? "—";
}
function bottomBy(arr: any[], _k: string) {
  const sorted = [...arr].sort((a, b) => {
    const ac = a.correct + a.wrong ? a.correct / (a.correct + a.wrong) : 0;
    const bc = b.correct + b.wrong ? b.correct / (b.correct + b.wrong) : 0;
    return ac - bc;
  });
  return sorted[0]?.name ?? "—";
}

function StatCard({ icon, k, v }: { icon?: React.ReactNode; k: string; v: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}{k}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">{v}</div>
    </div>
  );
}

function InsightCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <p className="mt-2 text-sm">{body}</p>
    </div>
  );
}

function ProctorPanel({ a }: { a: any }) {
  const tabs = a.tab_switches ?? 0;
  const focus = a.focus_losses ?? 0;
  const fs = a.fullscreen_exits ?? 0;
  const events = Array.isArray(a.proctoring_events) ? a.proctoring_events : [];
  const total = tabs + focus + fs;
  // Simple heuristic: 0 → 0%, 1–2 → 20%, 3–5 → 50%, 6–10 → 75%, 10+ → 95%
  const prob = total === 0 ? 0 : total <= 2 ? 20 : total <= 5 ? 50 : total <= 10 ? 75 : 95;
  const risk = prob >= 75 ? "High" : prob >= 40 ? "Medium" : prob > 0 ? "Low" : "None";
  const riskClass = prob >= 75 ? "text-destructive" : prob >= 40 ? "text-amber-500" : prob > 0 ? "text-emerald-500" : "text-muted-foreground";

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard k="Tab switches" v={String(tabs)} />
        <StatCard k="Focus losses" v={String(focus)} />
        <StatCard k="Fullscreen exits" v={String(fs)} />
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[11px] text-muted-foreground">Cheating probability</div>
          <div className={"mt-1 font-mono text-xl font-semibold " + riskClass}>{prob}% · {risk}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={"h-full " + (prob >= 75 ? "bg-destructive" : prob >= 40 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${prob}%` }} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Suspicious activity timeline</h3>
        {total === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No suspicious activity was detected during this attempt.</p>
        ) : events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {tabs} tab switch(es), {focus} focus loss(es), {fs} fullscreen exit(s) were recorded. Per‑event timestamps will appear here on future attempts.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {events.map((e: any, i: number) => (
              <li key={i} className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/20 p-2 text-xs">
                <span className="font-mono text-muted-foreground">{e.at ? new Date(e.at).toLocaleTimeString() : "—"}</span>
                <span className="capitalize">{e.type ?? "event"}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

