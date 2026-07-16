import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen, Trophy, Target, Flame, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — RankersTestHub" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();

  const roles = useQuery({
    queryKey: ["roles", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return (data ?? []).map((r) => r.role);
    },
  });
  const isAdmin = roles.data?.includes("admin");

  const attempts = useQuery({
    queryKey: ["my-attempts", user.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("test_attempts")
        .select("id, status, score, total_marks, correct_count, incorrect_count, unattempted_count, submitted_at, started_at, time_spent_sec, test:tests(id, title, exam)")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const availableTests = useQuery({
    queryKey: ["dash-tests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, title, exam, duration_min")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(4);
      return data ?? [];
    },
  });

  const submitted = (attempts.data ?? []).filter((a: any) => a.status === "submitted");
  const inProgress = (attempts.data ?? []).filter((a: any) => a.status === "in_progress");
  const testsTaken = submitted.length;
  const totalCorrect = submitted.reduce((s: number, a: any) => s + (a.correct_count ?? 0), 0);
  const totalAttempted = submitted.reduce((s: number, a: any) => s + (a.correct_count ?? 0) + (a.incorrect_count ?? 0), 0);
  const avgAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const bestScore = submitted.length
    ? Math.max(...submitted.map((a: any) => a.total_marks > 0 ? Math.round((a.score / a.total_marks) * 100) : 0))
    : 0;

  // Streak: unique submitted days consecutive
  const streak = calcStreak(submitted.map((a: any) => a.submitted_at).filter(Boolean));

  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "there";

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Dashboard</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Welcome back, {displayName}.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Here's a snapshot of your prep. Keep pushing.</p>
          </div>
          <div className="flex gap-2">
            <Link to="/tests"><Button>Take a test <ArrowRight className="ml-1 h-4 w-4" /></Button></Link>
            {isAdmin && <Link to="/admin"><Button variant="outline">Open admin</Button></Link>}
          </div>
        </div>

        {/* In-progress banner */}
        {inProgress.length > 0 && (
          <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">Resume test</div>
                <div className="mt-1 text-sm font-semibold">{inProgress[0].test?.title}</div>
                <div className="text-xs text-muted-foreground">You have an unfinished attempt — your progress was autosaved.</div>
              </div>
              <Link to="/tests/$testId" params={{ testId: inProgress[0].test?.id }}>
                <Button size="sm"><PlayCircle className="mr-1 h-4 w-4" />Continue</Button>
              </Link>
            </div>
          </div>
        )}

        {/* KPI cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<Trophy className="h-4 w-4 text-amber-400" />} label="Tests taken" value={String(testsTaken)} />
          <Kpi icon={<Target className="h-4 w-4 text-emerald-400" />} label="Avg accuracy" value={`${avgAccuracy}%`} />
          <Kpi icon={<BookOpen className="h-4 w-4 text-primary" />} label="Best score" value={`${bestScore}%`} />
          <Kpi icon={<Flame className="h-4 w-4 text-rose-400" />} label="Day streak" value={`${streak}d`} />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
          {/* Recent attempts */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-5">
              <h3 className="font-semibold">Recent attempts</h3>
              <Link to="/tests" className="text-xs text-muted-foreground hover:text-foreground">Browse tests →</Link>
            </div>
            {submitted.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm text-muted-foreground">No completed tests yet.</p>
                <Link to="/tests"><Button className="mt-4" size="sm">Take your first test</Button></Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {submitted.slice(0, 6).map((a: any) => {
                  const pct = a.total_marks > 0 ? Math.round((a.score / a.total_marks) * 100) : 0;
                  return (
                    <Link
                      key={a.id}
                      to="/results/$attemptId"
                      params={{ attemptId: a.id }}
                      className="flex items-center justify-between gap-4 p-4 transition hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.test?.title ?? "Untitled test"}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono uppercase">{a.test?.exam}</span> · {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—"} · {a.correct_count}✓ {a.incorrect_count}✗
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold">{a.score}/{a.total_marks}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{pct}%</div>
                        </div>
                        <div className="h-8 w-16 overflow-hidden rounded bg-muted">
                          <div className="h-full bg-gradient-to-r from-emerald-500 to-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick actions + Available tests */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">Quick actions</h3>
              <div className="mt-4 space-y-2">
                <QuickLink to="/tests" label="Browse tests" desc="Full-length CBTs & PYQs" />
                <QuickLink to="/dashboard" label="Mistake journal" desc="Auto-populated wrong answers" disabled />
                <QuickLink to="/dashboard" label="Bookmarks" desc="Saved questions & sets" disabled />
                {isAdmin && <QuickLink to="/admin" label="Admin console" desc="Manage tests & content" />}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">Fresh tests</h3>
              {availableTests.data?.length ? (
                <ul className="mt-3 space-y-2">
                  {availableTests.data.map((t: any) => (
                    <li key={t.id}>
                      <Link
                        to="/tests/$testId"
                        params={{ testId: t.id }}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm transition hover:border-foreground/40 hover:bg-accent/40"
                      >
                        <div className="min-w-0">
                          <div className="truncate">{t.title}</div>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{t.exam} · {t.duration_min}m</div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No published tests yet.</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function QuickLink({ to, label, desc, disabled }: { to: string; label: string; desc: string; disabled?: boolean }) {
  const cls = "block rounded-md border border-border/60 px-3 py-2 transition hover:border-foreground/40 hover:bg-accent/40";
  const inner = (
    <>
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        {disabled ? <span className="text-[10px] text-muted-foreground">Soon</span> : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </>
  );
  if (disabled) return <div className={cls + " opacity-60"}>{inner}</div>;
  return <Link to={to} className={cls}>{inner}</Link>;
}

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const days = new Set(dates.map((d) => new Date(d).toDateString()));
  let streak = 0;
  const cur = new Date();
  while (days.has(cur.toDateString())) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}
