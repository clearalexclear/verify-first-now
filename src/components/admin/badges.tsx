import { Badge } from "@/components/ui/badge";
import { Check, AlertTriangle, X, HelpCircle, Minus } from "lucide-react";
import type { ReactNode } from "react";

const STATUS_META: Record<string, { label: string; cls: string; icon: ReactNode }> = {
  pass: { label: "PASS", cls: "bg-success/15 text-success border-success/40", icon: <Check className="h-3 w-3" /> },
  caution: { label: "CAUTION", cls: "bg-warning/20 text-warning-foreground border-warning/40", icon: <AlertTriangle className="h-3 w-3" /> },
  fail: { label: "FAIL", cls: "bg-danger/15 text-danger border-danger/40", icon: <X className="h-3 w-3" /> },
  not_verified: { label: "NOT VERIFIED", cls: "bg-muted text-muted-foreground border-border", icon: <HelpCircle className="h-3 w-3" /> },
  not_applicable: { label: "N/A", cls: "bg-primary/10 text-primary border-primary/30", icon: <Minus className="h-3 w-3" /> },
};

export function CheckStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground italic">unset</span>;
  const m = STATUS_META[value];
  if (!m) return <Badge variant="outline">{value}</Badge>;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

const CASE_STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-primary/10 text-primary border-primary/30" },
  information_required: { label: "Info required", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  research_in_progress: { label: "Research", cls: "bg-primary/10 text-primary border-primary/30" },
  supplier_clarification_pending: { label: "Supplier clarification", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  review_required: { label: "Review required", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  report_ready: { label: "Report ready", cls: "bg-success/15 text-success border-success/40" },
  delivered: { label: "Delivered", cls: "bg-success/15 text-success border-success/40" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
};

export function CaseStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const m = CASE_STATUS_META[value] ?? { label: value, cls: "bg-muted" };
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

const RISK_META: Record<string, { label: string; cls: string }> = {
  low: { label: "Low", cls: "bg-success/15 text-success border-success/40" },
  medium: { label: "Medium", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  high: { label: "High", cls: "bg-danger/15 text-danger border-danger/40" },
  critical: { label: "Critical", cls: "bg-danger text-destructive-foreground border-danger" },
};

export function RiskRatingBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground italic">unset</span>;
  const m = RISK_META[value];
  if (!m) return <Badge variant="outline">{value}</Badge>;
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${m.cls}`}>{m.label}</span>;
}

const OUTCOME_META: Record<string, { label: string; cls: string }> = {
  go: { label: "GO", cls: "bg-success/15 text-success border-success/40" },
  proceed_with_safeguards: { label: "Proceed with safeguards", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  pause_pending_clarification: { label: "Pause pending clarification", cls: "bg-warning/20 text-warning-foreground border-warning/40" },
  no_go: { label: "NO-GO", cls: "bg-danger/15 text-danger border-danger/40" },
};

export function OutcomeBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground italic">not set</span>;
  const m = OUTCOME_META[value] ?? { label: value, cls: "bg-muted" };
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${m.cls}`}>{m.label}</span>;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High", medium_high: "Medium-High", medium: "Medium", low: "Low",
};

export function ConfidenceBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground italic">—</span>;
  return <span className="inline-flex items-center rounded border border-primary/30 bg-primary/5 text-primary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">{CONFIDENCE_LABELS[value] ?? value}</span>;
}
