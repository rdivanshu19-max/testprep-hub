import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/results/$attemptId")({
  head: () => ({ meta: [{ title: "Results — RankersTestHub" }] }),
  component: Results,
});

function Results() {
  const { attemptId } = Route.useParams();

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
        .select("*, question:questions(id, question_text, options, correct_answer, solution_text)")
        .eq("attempt_id", attemptId);
      if (e2) throw e2;

      return { attempt: a, answers: ans ?? [] };
    },
  });

  if (isLoading) return <div className="min-h-screen bg-background p-10">Loading…</div>;
  if (!data?.attempt) return <div className="min-h-screen bg-background p-10 text-sm text-muted-foreground">Attempt not found.</div>;

  const a = data.attempt;
  const accuracy = a.correct_count + a.incorrect_count > 0
    ? Math.round((a.correct_count / (a.correct_count + a.incorrect_count)) * 100)
    : 0;
  const timeMin = Math.floor((a.time_spent_sec ?? 0) / 60);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Result</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{a.test?.title}</h1>

        <div className="mt-8 grid gap-3 sm:grid-cols-4">
          <Stat k="Score" v={`${a.score ?? 0} / ${a.total_marks ?? 0}`} />
          <Stat k="Accuracy" v={`${accuracy}%`} />
          <Stat k="Correct / Wrong" v={`${a.correct_count} / ${a.incorrect_count}`} />
          <Stat k="Time" v={`${timeMin} min`} />
        </div>

        <div className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold">Solutions</h2>
          {data.answers.map((row: any, i: number) => {
            const q = row.question;
            if (!q) return null;
            const opts: any[] = Array.isArray(q.options) ? q.options : [];
            return (
              <div key={row.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">Q{i + 1}</Badge>
                  {row.chosen_answer == null ? (
                    <Badge variant="secondary">Unattempted</Badge>
                  ) : row.is_correct ? (
                    <Badge className="bg-emerald-600/30 text-emerald-200 border border-emerald-600">Correct</Badge>
                  ) : (
                    <Badge className="bg-destructive/20 text-destructive border border-destructive">Wrong</Badge>
                  )}
                </div>
                <p className="mt-3 text-sm">{q.question_text}</p>
                <div className="mt-3 grid gap-2">
                  {opts.map((o: any, oi: number) => {
                    const v = typeof o === "string" ? String.fromCharCode(65 + oi) : (o.key ?? String.fromCharCode(65 + oi));
                    const label = typeof o === "string" ? o : (o.text ?? o.label ?? String(o));
                    const isCorrect = String(v).toLowerCase() === String(q.correct_answer).toLowerCase();
                    const isChosen = String(v) === String(row.chosen_answer);
                    return (
                      <div key={oi} className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        isCorrect && "border-emerald-600 bg-emerald-600/10",
                        isChosen && !isCorrect && "border-destructive bg-destructive/10",
                        !isCorrect && !isChosen && "border-border",
                      )}>
                        <span className="font-mono text-xs mr-2">{v}</span>{label}
                      </div>
                    );
                  })}
                </div>
                {q.solution_text && (
                  <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Solution: </span>{q.solution_text}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex gap-3">
          <Link to="/tests" className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent">← Back to catalogue</Link>
          <Link to="/dashboard" className="rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90">Dashboard</Link>
        </div>
      </main>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">{v}</div>
    </div>
  );
}
