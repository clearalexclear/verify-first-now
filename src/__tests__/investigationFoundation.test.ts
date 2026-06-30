import { describe, expect, it } from "vitest";
import { enforceEvidenceIds } from "../lib/investigation/evidence.server";
import { connectorRegistry } from "../lib/investigation/connectors/registry.server";
import { jobIdempotencyKey, nextBackoff } from "../lib/investigation/job-queue.server";
import { verifyStripeSignature } from "../lib/payments/stripe-webhook.server";
import type { Finding } from "../lib/investigation/types";

async function stripeSignature(raw: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

const baseFinding: Finding = {
  section: "export_history",
  item: "Shipment history",
  status: "PASS",
  confidence: "medium",
  source_name: "Public shipping-data web search",
  source_url: "https://example.test",
  retrieval_date: "2026-06-29T00:00:00.000Z",
  evidence_excerpt: "A generic search snippet mentions the company.",
  buyer_impact: "Potential shipment history.",
  recommended_action: "Use licensed shipment data.",
};

describe("payment security", () => {
  it("does not model frontend payment confirmation as a job idempotency key", () => {
    expect(jobIdempotencyKey("order-123")).toBe("stripe-paid:order-123");
  });

  it("verifies valid Stripe signatures and rejects forged signatures", async () => {
    const raw = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
    const valid = await stripeSignature(raw, "whsec_test");
    await expect(verifyStripeSignature(raw, valid, "whsec_test")).resolves.toBe(true);
    await expect(verifyStripeSignature(raw, "t=123,v1=bad", "whsec_test")).resolves.toBe(false);
  });
});

describe("job retry foundation", () => {
  it("uses exponential backoff for retries", () => {
    const start = Date.parse("2026-06-29T00:00:00.000Z");
    expect(nextBackoff(1, start)).toBe("2026-06-29T00:01:00.000Z");
    expect(nextBackoff(3, start)).toBe("2026-06-29T00:04:00.000Z");
  });
});

describe("connectors", () => {
  it("keeps QCC, ImportGenius, IAF and OpenSanctions disabled until credentials are supplied", async () => {
    for (const id of ["qcc_corporate_registry", "importgenius_shipments", "iaf_certsearch", "opensanctions_commercial"]) {
      const connector = connectorRegistry.find((c) => c.id === id);
      expect(connector).toBeTruthy();
      expect(connector?.mode).toBe("paid_disabled");
      expect(connector?.isEnabled({})).toBe(false);
      const result = await connector!.run({}, { caseId: "case-1", env: {} });
      expect(result.status).toBe("not_configured");
      expect(result.evidence).toHaveLength(0);
    }
  });

  it("classifies Firecrawl as web intelligence only", () => {
    const connector = connectorRegistry.find((c) => c.id === "firecrawl_web_intelligence");
    expect(connector?.category).toBe("general_web_research");
    expect(connector?.mode).toBe("paid_disabled");
  });
});

describe("evidence enforcement", () => {
  it("downgrades findings without stored evidence IDs", () => {
    const [finding] = enforceEvidenceIds([{ ...baseFinding, source_name: "ImportGenius API", evidence_ids: [] }]);
    expect(finding.status).toBe("NOT_VERIFIED");
    expect(finding.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("does not let generic search verify shipment history", () => {
    const [finding] = enforceEvidenceIds([{ ...baseFinding, evidence_ids: ["ev_1"] }]);
    expect(finding.status).toBe("NOT_VERIFIED");
    expect(finding.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("preserves hard-stop evidence when backed by evidence IDs", () => {
    const [finding] = enforceEvidenceIds([{
      ...baseFinding,
      section: "sanctions_forced_labour",
      item: "Restricted-party match",
      status: "FAIL",
      confidence: "high",
      source_name: "OpenSanctions Commercial API",
      evidence_ids: ["ev_hard_stop"],
      evidence_classification: "VERIFIED",
    }]);
    expect(finding.status).toBe("FAIL");
    expect(finding.evidence_ids).toEqual(["ev_hard_stop"]);
  });
});

describe("Jiangmen Changwen mock case classification", () => {
  it("shows which findings are verified, supplier-claimed, inferred or not independently verified", () => {
    const findings = enforceEvidenceIds([
      {
        ...baseFinding,
        section: "certificates_documents",
        item: "Uploaded business licence names Jiangmen Changwen",
        status: "CAUTION",
        source_name: "Customer upload",
        evidence_ids: ["ev_supplier_doc"],
        evidence_classification: "SUPPLIER_CLAIMED",
      },
      {
        ...baseFinding,
        section: "digital_footprint",
        item: "Website mentions Jiangmen Changwen product category",
        status: "CAUTION",
        source_name: "Firecrawl web intelligence",
        evidence_ids: ["ev_web"],
        evidence_classification: "INFERRED",
      },
      {
        ...baseFinding,
        section: "sanctions_forced_labour",
        item: "Stored official UFLPA snapshot screening",
        status: "PASS",
        source_name: "DHS UFLPA Entity List snapshot",
        evidence_ids: ["ev_uflpa"],
        evidence_classification: "VERIFIED",
      },
      {
        ...baseFinding,
        section: "export_history",
        item: "ImportGenius shipment history",
        status: "NOT_VERIFIED",
        source_name: "ImportGenius API",
        evidence_excerpt: "",
        evidence_ids: [],
      },
    ]);

    expect(findings.map((f) => [f.item, f.evidence_classification, f.status])).toEqual([
      ["Uploaded business licence names Jiangmen Changwen", "SUPPLIER_CLAIMED", "CAUTION"],
      ["Website mentions Jiangmen Changwen product category", "INFERRED", "CAUTION"],
      ["Stored official UFLPA snapshot screening", "VERIFIED", "PASS"],
      ["ImportGenius shipment history", "NOT_INDEPENDENTLY_VERIFIED", "NOT_VERIFIED"],
    ]);
  });
});
