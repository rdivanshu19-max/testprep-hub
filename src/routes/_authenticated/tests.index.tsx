import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, PlayCircle, Trophy, CalendarClock, AlertTriangle, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tests/")({
  head: () => ({ meta: [{ title: "My Tests — RankersTestHub" }] }),
  component: MyTests,
});

type TabKey = "active" | "upcoming" | "missed" | "completed" | "all";

function MyTests() {
  const { user } = Route.useRouteContext();
  const [tab, setTab] = useState<TabKey>("all");

  const tests = useQuery({
    queryKey: ["catalogue-tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tests")
        .select("id, title, description, exam, kind, duration_min, status, scheduled_at, test_questions(count)")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const attempts = useQuery({
    queryKey: ["my-attempts", user.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("test_attempts")
        .select("id, test_id, status, score, total_marks, submitted_at, started_at, last_activity_at, correct_count, incorrect_count, unattempted_count")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const buckets = useMemo(() => {
    const active: any[] = [];
    const upcoming: any[] = [];
    const missed: any[] = [];
    const completed: any[] = [];
    const now = Date.now();
    const latestByTest = new Map<string, any>();
    for (const a of attempts.data ?? []) if (!latestByTest.has(a.test_id)) latestByTest.set(a.test_id, a);
    for (const t of tests.data ?? []) {
      const a = latestByTest.get(t.id);
      const scheduled = t.scheduled_at ? new Date(t.scheduled_at).getTime() : null;
      if (a?.status === "in_progress") active.push({ t, a });
      if (a?.status === "submitted") completed.push({ t, a });
      if (!a && scheduled && scheduled > now) upcoming.push({ t, a });
      if (!a && scheduled && scheduled < now - 24 * 3600 * 1000) missed.push({ t, a });
    }
    return { active, upcoming, missed, completed };
  }, [tests.data, attempts.data]);

  const all = useMemo(() => {
    const latestByTest = new Map<string, any>();
    for (const a of attempts.data ?? []) if (!latestByTest.has(a.test_id)) latestByTest.set(a.test_id, a);
    return (tests.data ?? []).map((t) => ({ t, a: latestByTest.get(t.id) }));
  }, [tests.data, attempts.data]);

  const rows =
    tab === "active" ? buckets.active :
    tab === "upcoming" ? buckets.upcoming :
    tab === "missed" ? buckets.missed :
    tab === "completed" ? buckets.completed :
    all;

  const tabs: { key: TabKey; label: string; count: number; icon: any }[] = [
    { key: "all", label: "All", count: all.length, icon: BookOpen },
    { key: "active", label: "Active", count: buckets.active.length, icon: PlayCircle },
    { key: "upcoming", label: "Upcoming", count: buckets.upcoming.length, icon: CalendarClock },
    { key: "missed", label: "Missed", count: buckets.missed.length, icon: AlertTriangle },
    { key: "completed", label: "Completed", count: buckets.completed.length, icon: Trophy },
  ];

  return (
    <div className="min-h-screen bg-background app-surface-tinted">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Tests</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">My Tests</h1>
        <p className="mt-1 text-sm text-muted-foreground">Resume in‑progress attempts, join upcoming schedules, revisit completed reports.</p>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-border">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition",
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono">{t.count}</span>
              </button>
            );
          })}
        </div>

        {tests.isLoading ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted/40" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-12 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No tests in this bucket yet.
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ t, a }: any) => <TestCard key={t.id} t={t} a={a} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function TestCard({ t, a }: { t: any; a: any }) {
  const qCount = (t.test_questions as { count: number }[] | null)?.[0]?.count ?? 0;
  const scorePct = a?.total_marks > 0 ? Math.round(((a.score ?? 0) / a.total_marks) * 100) : 0;
  const scheduled = t.scheduled_at ? new Date(t.scheduled_at) : null;
  const status =
    a?.status === "in_progress" ? "active" :
    a?.status === "submitted" ? "completed" :
    scheduled && scheduled.getTime() > Date.now() ? "upcoming" :
    scheduled && scheduled.getTime() < Date.now() - 24 * 3600 * 1000 ? "missed" : "available";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px] uppercase">{t.exam}</Badge>
        <Badge variant="secondary" className="text-[10px]">{t.kind}</Badge>
        {status === "active" && <Badge className="ml-auto border border-primary/50 bg-primary/10 text-primary">Resume</Badge>}
        {status === "completed" && <Badge className="ml-auto border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Done</Badge>}
        {status === "upcoming" && <Badge className="ml-auto border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">Scheduled</Badge>}
        {status === "missed" && <Badge className="ml-auto border border-destructive/40 bg-destructive/10 text-destructive">Missed</Badge>}
      </div>
      <h2 className="mt-3 line-clamp-2 text-base font-semibold leading-snug">{t.title}</h2>
      {t.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" />{qCount} Q</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.duration_min}m</span>
        {scheduled && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{scheduled.toLocaleDateString()}</span>}
      </div>

      {status === "completed" && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Score</span>
            <span className="font-mono text-sm"><span className="text-foreground">{a.score ?? 0}</span>/<span className="text-muted-foreground">{a.total_marks ?? 0}</span> · {scorePct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-primary" style={{ width: `${scorePct}%` }} />
          </div>
        </div>
      )}

      <div className="mt-4 flex-1" />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status === "active" && (
          <Link to="/tests/$testId" params={{ testId: t.id }} className="flex-1 rounded-md bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground hover:opacity-90">Resume</Link>
        )}
        {status === "completed" && (
          <>
            <Link to="/results/$attemptId" params={{ attemptId: a.id }} className="flex-1 rounded-md bg-foreground px-3 py-1.5 text-center text-xs font-medium text-background hover:opacity-90">View report</Link>
            <Link to="/tests/$testId" params={{ testId: t.id }} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">Retake</Link>
          </>
        )}
        {status === "upcoming" && (
          <button disabled className="flex-1 cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">Opens {scheduled?.toLocaleString()}</button>
        )}
        {status === "missed" && (
          <Link to="/tests/$testId" params={{ testId: t.id }} className="flex-1 rounded-md border border-border px-3 py-1.5 text-center text-xs hover:bg-accent">Attempt now</Link>
        )}
        {status === "available" && (
          <Link to="/tests/$testId" params={{ testId: t.id }} className="flex-1 rounded-md bg-foreground px-3 py-1.5 text-center text-xs font-medium text-background hover:opacity-90">Start</Link>
        )}
      </div>
    </div>
  );
}
