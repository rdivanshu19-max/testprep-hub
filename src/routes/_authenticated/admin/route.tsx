import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  component: AdminShell,
});

function AdminShell() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-admin", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  useEffect(() => {
    if (!isLoading && isAdmin === false) {
      navigate({ to: "/dashboard" });
    }
  }, [isLoading, isAdmin, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader variant="app" />
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-32 w-full animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader variant="app" />
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <h1 className="text-2xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account doesn't have admin permissions. Redirecting…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader variant="app" />
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3 text-sm">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Admin</span>
          <Link to="/admin" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }} activeOptions={{ exact: true }}>
            Overview
          </Link>
          <Link to="/admin/extraction" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            PDF → CBT
          </Link>
          <Link to="/admin/tests" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Tests
          </Link>
          <Link to="/admin/taxonomy" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Taxonomy
          </Link>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
