import { Check, AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";

type Level = "pass" | "caution" | "fail";

const styles: Record<Level, string> = {
  pass: "bg-success/10 text-success border-success/30",
  caution: "bg-warning/15 text-warning-foreground border-warning/40",
  fail: "bg-danger/10 text-danger border-danger/30",
};

const icons: Record<Level, ReactNode> = {
  pass: <Check className="h-3.5 w-3.5" />,
  caution: <AlertTriangle className="h-3.5 w-3.5" />,
  fail: <X className="h-3.5 w-3.5" />,
};

export function RiskBadge({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${styles[level]}`}>
      {icons[level]}
      {children}
    </span>
  );
}
