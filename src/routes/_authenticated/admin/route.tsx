import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/dashboard" });
  },
  component: AdminShell,
});

function AdminShell() {
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
        </div>
      </div>
      <Outlet />
    </div>
  );
}
