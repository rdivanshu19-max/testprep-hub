import { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

/**
 * Page wrapper for authenticated CBT surfaces.
 * Follows the site theme — light by default, glass/dark automatically when
 * the user toggles dark mode (the `.dark` class on <html> flips the tokens).
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-screen bg-background text-foreground app-surface-tinted", className)}>
      <SiteHeader variant="app" />
      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">{children}</main>
    </div>
  );
}

export function GlassCard({
  children,
  className,
  strong = false,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-sm",
        strong && "shadow-md",
        "dark:bg-card/60 dark:backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
        )}
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}
