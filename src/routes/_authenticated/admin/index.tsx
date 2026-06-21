import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin — RankersTestHub" }] }),
  component: AdminHome,
});

function AdminHome() {
  const stats = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const [jobs, qs, tests] = await Promise.all([
        supabase.from("extraction_jobs").select("id, status", { count: "exact", head: false }),
        supabase.from("questions").select("id", { count: "exact", head: true }),
        supabase.from("tests").select("id", { count: "exact", head: true }),
      ]);
      return {
        jobs: jobs.count ?? 0,
        needsReview: (jobs.data ?? []).filter((j) => j.status === "needs_review").length,
        questions: qs.count ?? 0,
        tests: tests.count ?? 0,
      };
    },
  });

  const s = stats.data;
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Admin overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Pipeline status and content counts.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Extraction jobs" v={s?.jobs} />
        <Stat k="Awaiting review" v={s?.needsReview} accent />
        <Stat k="Published questions" v={s?.questions} />
        <Stat k="Published tests" v={s?.tests} />
      </div>

      <div className="mt-10 rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold">Get started</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a question paper PDF — the pipeline splits it into 2-page batches, extracts questions with Gemini, validates with Groq, and lets you review every question before publishing.
        </p>
        <Link
          to="/admin/extraction"
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open PDF → CBT pipeline
        </Link>
      </div>
    </main>
  );
}

function Stat({ k, v, accent }: { k: string; v: number | undefined; accent?: boolean }) {
  return (
    <div className={`rounded-xl border ${accent && v ? "border-primary/40 bg-accent" : "border-border bg-card"} p-5`}>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{v ?? "—"}</div>
    </div>
  );
}
