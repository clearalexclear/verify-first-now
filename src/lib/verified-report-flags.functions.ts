import { createServerFn } from "@tanstack/react-start";
import { verifiedReportBypassEnabled } from "@/lib/verified-report.functions";

// Public read-only runtime flag check for the /verified-report page.
// Returns whether the temporary Stripe-bypass test mode is active on the server.
export const getVerifiedReportFlags = createServerFn({ method: "GET" }).handler(async () => {
  const bypassEnabled = verifiedReportBypassEnabled(process.env);
  const raw = process.env.VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS ?? null;
  return {
    bypassEnabled,
    rawValue: raw,
    checkedAt: new Date().toISOString(),
  };
});
