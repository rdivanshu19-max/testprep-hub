import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function SiteHeader({ variant = "public" }: { variant?: "public" | "app" }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setEmail(s?.user?.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background">
            <span className="font-mono text-xs font-semibold">R</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">RankersTestHub</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {variant === "public" ? (
            <>
              <a href="#features" className="hover:text-foreground">Features</a>
              <a href="#cbt" className="hover:text-foreground">CBT engine</a>
              <a href="#analytics" className="hover:text-foreground">Analytics</a>
              <a href="#faq" className="hover:text-foreground">FAQ</a>
            </>
          ) : (
            <>
              <Link to="/dashboard" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
                Dashboard
              </Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {email ? (
            <>
              {variant === "public" && (
                <Link to="/dashboard">
                  <Button size="sm" variant="ghost">Dashboard</Button>
                </Link>
              )}
              <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
              <Button size="sm" variant="outline" onClick={onSignOut}>Sign out</Button>
            </>
          ) : (
            <>
              <Link to="/auth">
                <Button size="sm" variant="ghost">Sign in</Button>
              </Link>
              <Link to="/auth" search={{ mode: "signup" } as never}>
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
