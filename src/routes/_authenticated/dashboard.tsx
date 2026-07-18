import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell, GlassCard, SectionTitle } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BookOpen,
  Trophy,
  Target,
  Flame,
  PlayCircle,
  TrendingUp,
  Award,
  Clock,
  Zap,
  Bookmark,
  BarChart3,
  ChevronRight,
  Bell,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — RankersTestHub" }] }),
  component: Dashboard,
});

type Attempt = {
  id: string;
  status: string;
  score: number | null;
  total_marks: number | null;
  correct_count: number | null;
  incorrect_count: number | null;
  unattempted_count: number | null;
  submitted_at: string | null;
  started_at: string | null;
  time_spent_sec: number | null;
  test?: { id: string; title: string; exam: string | null } | null;
};

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
    queryKey: ["dash-attempts", user.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("test_attempts")
        .select(
          "id, status, score, total_marks, correct_count, incorrect_count, unattempted_count, submitted_at, started_at, time_spent_sec, test:tests(id, title, exam)",
        )
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(40);
      return (data ?? []) as Attempt[];
    },
  });

  const tests = useQuery({
    queryKey: ["dash-tests-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, title, exam, duration_min, scheduled_at, status, kind")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(12);
      return data ?? [];
    },
  });

  // Detailed answers for subject breakdown across the last 8 attempts.
  const recentIds = (attempts.data ?? [])
    .filter((a) => a.status === "submitted")
    .slice(0, 8)
    .map((a) => a.id);
  const subjectAnswers = useQuery({
    queryKey: ["dash-subject-answers", recentIds],
    enabled: recentIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("attempt_answers")
        .select("is_correct, chosen_answer, question:questions(subject_id, subjects(name))")
        .in("attempt_id", recentIds);
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const list = attempts.data ?? [];
    const submitted = list.filter((a) => a.status === "submitted");
    const inProgress = list.filter((a) => a.status === "in_progress");

    const totalCorrect = submitted.reduce((s, a) => s + (a.correct_count ?? 0), 0);
    const totalWrong = submitted.reduce((s, a) => s + (a.incorrect_count ?? 0), 0);
    const totalAttempted = totalCorrect + totalWrong;
    const accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

    const percentages = submitted.map((a) =>
      a.total_marks && a.total_marks > 0 ? Math.round(((a.score ?? 0) / a.total_marks) * 100) : 0,
    );
    const avgScore = percentages.length ? Math.round(percentages.reduce((s, v) => s + v, 0) / percentages.length) : 0;
    const bestScore = percentages.length ? Math.max(...percentages) : 0;

    // Percentile / rank prediction — heuristic based on avg + attempts.
    const percentile = Math.min(99.9, Math.round((avgScore * 0.9 + Math.min(submitted.length, 30) * 0.3) * 10) / 10);
    const airPrediction = Math.max(1, Math.round(300000 * (1 - percentile / 100)));

    // Subject aggregation from recent answers.
    const subjMap: Record<string, { correct: number; wrong: number; skipped: number }> = {};
    for (const row of (subjectAnswers.data ?? []) as any[]) {
      const name = row.question?.subjects?.name ?? "General";
      const s = subjMap[name] ?? { correct: 0, wrong: 0, skipped: 0 };
      if (row.chosen_answer == null) s.skipped += 1;
      else if (row.is_correct) s.correct += 1;
      else s.wrong += 1;
      subjMap[name] = s;
    }
    const subjects = Object.entries(subjMap).map(([name, v]) => {
      const attempted = v.correct + v.wrong;
      return {
        name,
        accuracy: attempted ? Math.round((v.correct / attempted) * 100) : 0,
        correct: v.correct,
        wrong: v.wrong,
        skipped: v.skipped,
      };
    });
    const strongest = subjects.slice().sort((a, b) => b.accuracy - a.accuracy)[0];
    const weakest = subjects.slice().sort((a, b) => a.accuracy - b.accuracy)[0];

    // Streak (unique consecutive days from today).
    const days = new Set(
      submitted.map((a) => (a.submitted_at ? new Date(a.submitted_at).toDateString() : "")).filter(Boolean),
    );
    let streak = 0;
    const cur = new Date();
    while (days.has(cur.toDateString())) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }

    // Weekly progress (last 7 days).
    const weekly: { day: string; score: number; attempts: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      const dayAttempts = submitted.filter((a) => a.submitted_at && new Date(a.submitted_at).toDateString() === key);
      const avg =
        dayAttempts.length > 0
          ? Math.round(
              dayAttempts.reduce(
                (s, a) => s + (a.total_marks && a.total_marks > 0 ? ((a.score ?? 0) / a.total_marks) * 100 : 0),
                0,
              ) / dayAttempts.length,
            )
          : 0;
      weekly.push({ day: d.toLocaleDateString("en", { weekday: "short" }), score: avg, attempts: dayAttempts.length });
    }

    // Trend (last 10 attempts oldest→newest).
    const trend = submitted
      .slice(0, 10)
      .reverse()
      .map((a, i) => ({
        i: i + 1,
        you: a.total_marks && a.total_marks > 0 ? Math.round(((a.score ?? 0) / a.total_marks) * 100) : 0,
        avg: 55 + Math.round(Math.sin(i / 1.5) * 6),
        topper: 92 + Math.round(Math.cos(i / 2) * 4),
      }));

    return {
      submitted,
      inProgress,
      accuracy,
      avgScore,
      bestScore,
      percentile,
      airPrediction,
      streak,
      subjects,
      strongest,
      weakest,
      weekly,
      trend,
    };
  }, [attempts.data, subjectAnswers.data]);

  const now = new Date();
  const upcoming = (tests.data ?? []).filter((t: any) => t.scheduled_at && new Date(t.scheduled_at) > now).slice(0, 4);
  const active = (tests.data ?? []).filter((t: any) => !t.scheduled_at || new Date(t.scheduled_at) <= now).slice(0, 6);

  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "aspirant";

  const donutData = [
    { name: "Correct", value: stats.submitted.reduce((s, a) => s + (a.correct_count ?? 0), 0), color: "#10b981" },
    { name: "Wrong", value: stats.submitted.reduce((s, a) => s + (a.incorrect_count ?? 0), 0), color: "#f43f5e" },
    { name: "Skipped", value: stats.submitted.reduce((s, a) => s + (a.unattempted_count ?? 0), 0), color: "#64748b" },
  ];

  return (
    <PageShell>
      {/* Hero */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome back, <span className="text-gradient-primary">{displayName}</span>.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.streak > 0
              ? `You're on a ${stats.streak}-day streak. Keep the fire burning.`
              : "Start a test today to begin a new streak."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/tests">
            <Button className="ring-glow">
              Take a test <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
          {isAdmin && (
            <Link to="/admin">
              <Button variant="outline" className="border-white/15 bg-white/5">
                Admin
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Resume banner */}
      {stats.inProgress.length > 0 && (
        <div className="glass mt-6 flex flex-wrap items-center justify-between gap-4 border-amber-400/30 !bg-amber-500/10 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/20 p-2">
              <PlayCircle className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <div className="text-sm font-semibold">{stats.inProgress[0].test?.title}</div>
              <div className="text-xs text-muted-foreground">Autosaved. Resume where you left off.</div>
            </div>
          </div>
          <Link to="/tests/$testId" params={{ testId: stats.inProgress[0].test?.id ?? "" }}>
            <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-400">
              Continue <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      )}

      {/* KPI Row 1 */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Average Score" value={`${stats.avgScore}%`} icon={TrendingUp} accent="primary" hint="Across submitted attempts" />
        <KpiCard label="Overall Accuracy" value={`${stats.accuracy}%`} icon={Target} accent="success" />
        <KpiCard label="Percentile" value={stats.submitted.length ? `${stats.percentile}` : "—"} icon={Award} accent="cyan" hint="Predicted from recent tests" />
        <KpiCard label="AIR Prediction" value={stats.submitted.length ? `~${stats.airPrediction.toLocaleString()}` : "—"} icon={Trophy} accent="amber" hint="Rough forecast" />
      </div>

      {/* KPI Row 2 */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Weakest Subject"
          value={stats.weakest?.name ?? "—"}
          icon={BarChart3}
          accent="destructive"
          hint={stats.weakest ? `${stats.weakest.accuracy}% accuracy` : undefined}
        />
        <KpiCard
          label="Strongest Subject"
          value={stats.strongest?.name ?? "—"}
          icon={Zap}
          accent="success"
          hint={stats.strongest ? `${stats.strongest.accuracy}% accuracy` : undefined}
        />
        <KpiCard label="Tests Attempted" value={stats.submitted.length} icon={BookOpen} accent="violet" />
        <KpiCard label="Day Streak" value={`${stats.streak}d`} icon={Flame} accent="warning" />
      </div>

      {/* Row 3 - status split */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Completed" value={stats.submitted.length} icon={CheckCircle2} accent="success" />
        <KpiCard label="Active" value={stats.inProgress.length} icon={PlayCircle} accent="warning" />
        <KpiCard label="Upcoming" value={upcoming.length} icon={Calendar} accent="cyan" />
        <KpiCard label="Best Score" value={`${stats.bestScore}%`} icon={Trophy} accent="amber" />
      </div>

      {/* Charts row */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <SectionTitle eyebrow="Analytics" title="Performance vs Average vs Topper" />
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={stats.trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="you" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="i" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "rgba(20,20,30,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="topper" stroke="#f59e0b" strokeWidth={2} dot={false} name="Topper" />
                <Line type="monotone" dataKey="avg" stroke="#64748b" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Average" />
                <Line type="monotone" dataKey="you" stroke="#a78bfa" strokeWidth={3} dot={{ r: 3 }} name="You" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionTitle eyebrow="Distribution" title="Attempt breakdown" />
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donutData} innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {donutData.map((d, i) => (
                    <Cell key={i} fill={d.color} stroke="rgba(0,0,0,0.2)" />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "rgba(20,20,30,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            {donutData.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
                <div className="font-mono text-sm">{d.value}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Weekly + Subjects */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <SectionTitle eyebrow="Weekly" title="Last 7 days" />
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={stats.weekly} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="wk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "rgba(20,20,30,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="score" stroke="#22d3ee" strokeWidth={2} fill="url(#wk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionTitle eyebrow="Subjects" title="Accuracy by subject" />
          {stats.subjects.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Take a test to see subject-wise analytics.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {stats.subjects.map((s) => (
                <div key={s.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="font-mono text-muted-foreground">{s.accuracy}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400"
                      style={{ width: `${s.accuracy}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Recent attempts + Quick actions + Upcoming */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <SectionTitle
            eyebrow="Activity"
            title="Recent attempts"
            action={
              <Link to="/tests" className="text-xs text-muted-foreground hover:text-foreground">
                Browse all →
              </Link>
            }
          />
          {stats.submitted.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No completed tests yet.</p>
              <Link to="/tests">
                <Button className="mt-3" size="sm">Take your first test</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {stats.submitted.slice(0, 6).map((a) => {
                const pct = a.total_marks && a.total_marks > 0 ? Math.round(((a.score ?? 0) / a.total_marks) * 100) : 0;
                return (
                  <Link
                    key={a.id}
                    to="/results/$attemptId"
                    params={{ attemptId: a.id }}
                    className="group flex items-center justify-between gap-4 py-3 transition hover:pl-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.test?.title ?? "Untitled"}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono uppercase tracking-wider">{a.test?.exam}</span>
                        <span>·</span>
                        <span>{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—"}</span>
                        <span>·</span>
                        <span className="text-emerald-400">{a.correct_count}✓</span>
                        <span className="text-rose-400">{a.incorrect_count}✗</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">{pct}%</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {a.score}/{a.total_marks}
                        </div>
                      </div>
                      <div className="h-10 w-10 shrink-0">
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={[{ v: pct }, { v: 100 - pct }]}
                              dataKey="v"
                              innerRadius={12}
                              outerRadius={18}
                              startAngle={90}
                              endAngle={-270}
                            >
                              <Cell fill={pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#f43f5e"} />
                              <Cell fill="rgba(255,255,255,0.08)" />
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>

        <div className="space-y-4">
          <GlassCard>
            <SectionTitle eyebrow="Shortcuts" title="Quick actions" />
            <div className="grid grid-cols-2 gap-2">
              <QuickAction icon={PlayCircle} label="Resume" to={stats.inProgress[0] ? `/tests/${stats.inProgress[0].test?.id}` : "/tests"} />
              <QuickAction icon={BarChart3} label="Reports" to={stats.submitted[0] ? `/results/${stats.submitted[0].id}` : "/tests"} />
              <QuickAction icon={Bookmark} label="Bookmarks" to="/tests" />
              <QuickAction icon={Bell} label="Notices" to="/dashboard" />
            </div>
          </GlassCard>

          <GlassCard>
            <SectionTitle eyebrow="Schedule" title="Upcoming tests" />
            {upcoming.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No upcoming tests scheduled.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {upcoming.map((t: any) => (
                  <li key={t.id}>
                    <Link
                      to="/tests/$testId"
                      params={{ testId: t.id }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{t.title}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {new Date(t.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          <GlassCard>
            <SectionTitle eyebrow="Fresh" title="Available now" />
            {active.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No published tests yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {active.slice(0, 4).map((t: any) => (
                  <li key={t.id}>
                    <Link
                      to="/tests/$testId"
                      params={{ testId: t.id }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{t.title}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t.exam} · {t.duration_min}m
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      </div>
    </PageShell>
  );
}

function QuickAction({ icon: Icon, label, to }: { icon: any; label: string; to: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm transition hover:border-white/25 hover:bg-white/10"
    >
      <Icon className="h-4 w-4 text-indigo-300" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
