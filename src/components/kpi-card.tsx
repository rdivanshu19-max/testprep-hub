import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "primary",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive" | "cyan" | "violet" | "amber";
  className?: string;
}) {
  const accentMap: Record<string, string> = {
    primary: "from-indigo-400/30 to-indigo-500/0 text-indigo-200",
    success: "from-emerald-400/30 to-emerald-500/0 text-emerald-200",
    warning: "from-amber-400/30 to-amber-500/0 text-amber-200",
    destructive: "from-rose-400/30 to-rose-500/0 text-rose-200",
    cyan: "from-cyan-400/30 to-cyan-500/0 text-cyan-200",
    violet: "from-violet-400/30 to-violet-500/0 text-violet-200",
    amber: "from-amber-400/30 to-amber-500/0 text-amber-200",
  };
  return (
    <div className={cn("glass group relative overflow-hidden p-4", className)}>
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br blur-2xl opacity-70 transition group-hover:opacity-100",
          accentMap[accent],
        )}
      />
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        {Icon && (
          <div className={cn("rounded-md border border-white/10 bg-white/5 p-1.5", accentMap[accent].split(" ").pop())}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
