import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import path from "node:path";

// Regression: /order must be a leaf (order.index.tsx). If order.tsx exists as a
// non-layout route it becomes a parent of /order/status/$token in TanStack's
// flat file-based routing, and /order/status/{token} renders the /order
// payment-setup screen instead of the status page — which meant a
// bypassed_test verified_report user landed on Stripe checkout copy and could
// even create a duplicate pending order.
describe("order route layout", () => {
  const routes = path.resolve(__dirname, "..", "routes");

  it("keeps /order as a leaf so /order/status/$token renders the status page", () => {
    expect(existsSync(path.join(routes, "order.tsx"))).toBe(false);
    expect(existsSync(path.join(routes, "order.index.tsx"))).toBe(true);
  });

  it("status route shows bypass and report_ready copy for verified_report bypass mode", () => {
    const src = readFileSync(path.join(routes, "order.status.$token.tsx"), "utf8");
    expect(src).toMatch(/payment_bypassed_for_test/);
    expect(src).toMatch(/Test mode: payment bypassed/);
    expect(src).toMatch(/report_ready/);
    expect(src).toMatch(/Open report online/);
    // Must never render the /order Stripe payment-setup copy from this file.
    expect(src).not.toMatch(/Review & payment setup/);
    expect(src).not.toMatch(/Create pending order/);
  });
});
