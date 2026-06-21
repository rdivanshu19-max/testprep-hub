import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Dashboard</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Welcome back{user.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ""}.
            </h1>
          </div>
          {isAdmin && (
            <Link to="/admin">
              <Button variant="outline">Open admin →</Button>
            </Link>
          )}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "Tests taken", v: "—" },
            { k: "Accuracy", v: "—" },
            { k: "Weak chapters", v: "—" },
            { k: "Streak", v: "0d" },
          ].map((c) => (
            <div key={c.k} className="rounded-xl border border-border bg-card p-5">
              <div className="text-xs text-muted-foreground">{c.k}</div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{c.v}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <Link to="/tests" className="group rounded-xl border border-border bg-card p-6 hover:border-foreground/40">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Practice</div>
            <h3 className="mt-2 text-lg font-semibold">Browse published tests →</h3>
            <p className="mt-1 text-sm text-muted-foreground">Full-length CBTs, chapter tests, and PYQs ready to attempt.</p>
          </Link>
          {isAdmin ? (
            <Link to="/admin/extraction" className="group rounded-xl border border-border bg-card p-6 hover:border-foreground/40">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Admin</div>
              <h3 className="mt-2 text-lg font-semibold">PDF → CBT pipeline →</h3>
              <p className="mt-1 text-sm text-muted-foreground">Ingest a question paper PDF and publish it as a CBT.</p>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              More widgets — recent attempts, weak chapters, streak — land here next.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
