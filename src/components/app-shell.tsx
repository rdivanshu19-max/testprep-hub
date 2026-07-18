import { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

/** Premium dark + glassmorphism page wrapper for authenticated CBT surfaces. */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("dark app-surface", className)}>
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
  return <div className={cn(strong ? "glass-strong" : "glass", "p-5", className)}>{children}</div>;
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
