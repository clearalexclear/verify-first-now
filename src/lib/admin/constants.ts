// Shared helpers and constants for the admin UI.

export const CASE_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "information_required", label: "Information required" },
  { value: "research_in_progress", label: "Research in progress" },
  { value: "supplier_clarification_pending", label: "Supplier clarification pending" },
  { value: "review_required", label: "Review required" },
  { value: "report_ready", label: "Report ready" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const CHECK_STATUS_OPTIONS = [
  { value: "pass", label: "PASS" },
  { value: "caution", label: "CAUTION" },
  { value: "fail", label: "FAIL" },
  { value: "not_verified", label: "NOT VERIFIED" },
  { value: "not_applicable", label: "NOT APPLICABLE" },
] as const;

export const CONFIDENCE_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium_high", label: "Medium to High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

export const RISK_RATING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

export const FINAL_OUTCOME_OPTIONS = [
  { value: "go", label: "GO" },
  { value: "proceed_with_safeguards", label: "Proceed with safeguards" },
  { value: "pause_pending_clarification", label: "Pause pending clarification" },
  { value: "no_go", label: "NO-GO" },
] as const;

export const EVIDENCE_TYPE_OPTIONS = [
  { value: "screenshot", label: "Screenshot" },
  { value: "business_licence", label: "Business licence" },
  { value: "certificate", label: "Certificate" },
  { value: "registry_extract", label: "Registry extract" },
  { value: "court_record", label: "Court record" },
  { value: "shipment_data", label: "Shipment data extract" },
  { value: "supplier_email", label: "Supplier email" },
  { value: "quotation", label: "Quotation" },
  { value: "invoice", label: "Invoice" },
  { value: "bank_instructions", label: "Bank instructions" },
  { value: "test_report", label: "Test report" },
  { value: "website_page", label: "Website page" },
  { value: "other", label: "Other" },
] as const;

export const RESPONSE_STATUS_OPTIONS = [
  { value: "satisfactory", label: "Satisfactory" },
  { value: "incomplete", label: "Incomplete" },
  { value: "contradictory", label: "Contradictory" },
  { value: "no_response", label: "No response" },
] as const;

export const PACKAGE_LABELS: Record<string, string> = {
  standard: "Standard",
  priority: "Priority",
  onsite: "On-Site",
};

export function packageDeadlineHours(pkg: string): number {
  switch (pkg) {
    case "priority": return 24;
    case "onsite": return 24 * 7;
    case "standard":
    default: return 72;
  }
}

export function labelOf<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string | null | undefined,
): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}
