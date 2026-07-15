import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createTestDraft } from "@/lib/tests.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/tests")({
  head: () => ({ meta: [{ title: "Tests — Admin" }] }),
  component: AdminTests,
});

function AdminTests() {
  const navigate = useNavigate();
  const create = useServerFn(createTestDraft);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tests")
        .select("id, title, exam, kind, status, duration_min, created_at, test_questions(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const newTest = async () => {
    setCreating(true);
    try {
      const r = await create({
        data: { title: "Untitled test", exam: "jee_main", kind: "custom", duration_min: 60 },
      });
      navigate({ to: "/admin/test-builder/$testId", params: { testId: r.testId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Tests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every published or draft test in the catalogue.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={newTest} disabled={creating}>
            {creating ? "Creating…" : "+ New test"}
          </Button>
          <Link
            to="/admin/extraction"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
          >
            + From PDF
          </Link>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Exam</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Questions</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                No tests yet. Click “New test” to build one, or ingest a PDF.
              </td></tr>
            ) : data.map((t) => {
              const qCount = (t.test_questions as { count: number }[] | null)?.[0]?.count ?? 0;
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3 uppercase text-xs font-mono">{t.exam}</td>
                  <td className="px-4 py-3 text-xs">{t.kind}</td>
                  <td className="px-4 py-3 font-mono">{qCount}</td>
                  <td className="px-4 py-3 font-mono">{t.duration_min}m</td>
                  <td className="px-4 py-3">
                    <Badge variant={t.status === "published" ? "default" : "secondary"}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/admin/test-builder/$testId"
                      params={{ testId: t.id }}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
