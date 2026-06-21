import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/tests/")({
  head: () => ({ meta: [{ title: "Tests — RankersTestHub" }] }),
  component: TestsCatalogue,
});

function TestsCatalogue() {
  const { user } = Route.useRouteContext();

  const tests = useQuery({
    queryKey: ["catalogue-tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tests")
        .select("id, title, description, exam, kind, duration_min, status, test_questions(count)")
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
        .select("id, test_id, status, score, total_marks, submitted_at")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const latestByTest = new Map<string, any>();
  for (const a of attempts.data ?? []) {
    if (!latestByTest.has(a.test_id)) latestByTest.set(a.test_id, a);
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Catalogue</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Published tests</h1>

        {tests.isLoading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-muted/40" />
            ))}
          </div>
        ) : !tests.data?.length ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No tests published yet. Once an admin approves an extraction job, tests appear here.
          </div>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tests.data.map((t) => {
              const qCount = (t.test_questions as { count: number }[] | null)?.[0]?.count ?? 0;
              const a = latestByTest.get(t.id);
              return (
                <div key={t.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">{t.exam}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{t.kind}</Badge>
                  </div>
                  <h2 className="mt-3 text-base font-semibold leading-snug">{t.title}</h2>
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                  )}
                  <div className="mt-4 flex items-center gap-4 font-mono text-xs text-muted-foreground">
                    <span>{qCount} Q</span>
                    <span>{t.duration_min} min</span>
                  </div>
                  <div className="mt-4 flex-1" />
                  <div className="mt-4 flex items-center justify-between">
                    {a?.status === "submitted" ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        Last score: {a.score ?? 0}/{a.total_marks ?? 0}
                      </span>
                    ) : a?.status === "in_progress" ? (
                      <span className="font-mono text-xs text-primary">In progress</span>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">Not attempted</span>
                    )}
                    <Link
                      to="/tests/$testId"
                      params={{ testId: t.id }}
                      className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                    >
                      {a?.status === "in_progress" ? "Resume" : a?.status === "submitted" ? "Retake" : "Start"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
