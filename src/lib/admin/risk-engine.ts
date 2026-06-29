// Pure risk derivation — no DB, no React.
// Used both client-side (live risk summary) and server-side (suggested outcome).

export type CheckStatus = "pass" | "caution" | "fail" | "not_verified" | "not_applicable";
export type FinalOutcome = "go" | "proceed_with_safeguards" | "pause_pending_clarification" | "no_go";
export type RiskRating = "low" | "medium" | "high" | "critical";

export interface CheckInput {
  id: string;
  section_slug?: string | null;
  status: CheckStatus | null;
  is_critical: boolean;
  finding?: string | null;
  // Optional flags that drive specific hard-stops when set by analyst
  hard_stop_flags?: HardStopKey[] | null;
}

export type HardStopKey =
  | "legal_entity_unidentified"
  | "company_inactive"
  | "payment_beneficiary_individual"
  | "payment_beneficiary_unrelated"
  | "sanctions_match"
  | "documents_altered"
  | "factory_concealed"
  | "facility_refused"
  | "inspection_refused"
  | "bank_change_unverified";

export const HARD_STOP_LABELS: Record<HardStopKey, string> = {
  legal_entity_unidentified: "Legal entity cannot be identified",
  company_inactive: "Company is inactive, dissolved, or revoked",
  payment_beneficiary_individual: "Payment beneficiary is an individual",
  payment_beneficiary_unrelated: "Payment beneficiary is an unrelated entity without explanation",
  sanctions_match: "Confirmed sanctions or restricted-party match",
  documents_altered: "Materially altered or fabricated documents",
  factory_concealed: "Claimed factory relationship is concealed or misrepresented",
  facility_refused: "Supplier refuses to identify the production facility",
  inspection_refused: "Supplier refuses inspection before final payment",
  bank_change_unverified: "Unverified change of bank details",
};

export interface RiskSummary {
  total: number;
  pass: number;
  caution: number;
  fail: number;
  not_verified: number;
  not_applicable: number;
  missing: number; // never treated as PASS
  completion_pct: number;
  hard_stops: HardStopKey[];
  suggested_outcome: FinalOutcome;
  suggested_rating: RiskRating;
}

export function deriveRisk(checks: CheckInput[]): RiskSummary {
  let pass = 0, caution = 0, fail = 0, not_verified = 0, not_applicable = 0, missing = 0;
  const hardStopSet = new Set<HardStopKey>();

  for (const c of checks) {
    if (!c.status) { missing++; continue; }
    if (c.status === "pass") pass++;
    else if (c.status === "caution") caution++;
    else if (c.status === "fail") fail++;
    else if (c.status === "not_verified") not_verified++;
    else if (c.status === "not_applicable") not_applicable++;

    if (c.hard_stop_flags) for (const f of c.hard_stop_flags) hardStopSet.add(f);
  }

  const applicable = checks.length - not_applicable;
  const answered = pass + caution + fail + not_verified;
  const completion_pct = applicable > 0 ? Math.round((answered / applicable) * 100) : 0;

  const hard_stops = Array.from(hardStopSet);

  let suggested_outcome: FinalOutcome;
  let suggested_rating: RiskRating;

  if (hard_stops.length > 0) {
    suggested_outcome = "no_go";
    suggested_rating = "critical";
  } else if (fail > 0) {
    suggested_outcome = "pause_pending_clarification";
    suggested_rating = "high";
  } else if (caution > 0 || not_verified > 0 || missing > 0) {
    suggested_outcome = "proceed_with_safeguards";
    suggested_rating = caution + not_verified + missing >= 3 ? "high" : "medium";
  } else {
    suggested_outcome = "go";
    suggested_rating = "low";
  }

  return {
    total: checks.length,
    pass, caution, fail, not_verified, not_applicable, missing,
    completion_pct,
    hard_stops,
    suggested_outcome,
    suggested_rating,
  };
}
