import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/taxonomy")({
  head: () => ({ meta: [{ title: "Taxonomy — Admin" }] }),
  component: AdminTaxonomy,
});

function AdminTaxonomy() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-taxonomy"],
    queryFn: async () => {
      const [subjects, chapters, topics] = await Promise.all([
        supabase.from("subjects").select("*").order("name"),
        supabase.from("chapters").select("*").order("order_index"),
        supabase.from("topics").select("*").order("order_index"),
      ]);
      return {
        subjects: subjects.data ?? [],
        chapters: chapters.data ?? [],
        topics: topics.data ?? [],
      };
    },
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Taxonomy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Subjects → Chapters → Topics. Used to tag every published question.
      </p>

      {isLoading ? (
        <div className="mt-8 h-40 animate-pulse rounded-xl bg-muted/40" />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Column title="Subjects" count={data!.subjects.length}>
            {data!.subjects.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.exam_scope?.join(", ")}</span>
              </li>
            ))}
          </Column>
          <Column title="Chapters" count={data!.chapters.length}>
            {data!.chapters.map((c) => {
              const s = data!.subjects.find((x) => x.id === c.subject_id);
              return (
                <li key={c.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                  <span className="text-sm">{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s?.name ?? "—"}</span>
                </li>
              );
            })}
          </Column>
          <Column title="Topics" count={data!.topics.length}>
            {data!.topics.map((t) => {
              const c = data!.chapters.find((x) => x.id === t.chapter_id);
              return (
                <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                  <span className="text-sm">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c?.name ?? "—"}</span>
                </li>
              );
            })}
          </Column>
        </div>
      )}

      <div className="mt-8 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        Subjects, chapters, and topics are auto-created during the PDF → CBT extraction flow.
        Inline editors land in the next iteration.
      </div>
    </main>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}
