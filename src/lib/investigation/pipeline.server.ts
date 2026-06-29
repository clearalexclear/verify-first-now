// The investigation orchestrator. Pulls all source modules together, writes
// the structured report into report_versions, generates the PDF, uploads to
// Storage, and emails the customer. Designed to be called from the
// /api/public/investigate/$caseId server route.

import { extractDocument, type ExtractedDoc } from "./extract-documents.server";
import { resolveLegalEntity } from "./sources/entity-resolution.server";
import { screenSanctions } from "./sources/opensanctions.server";
import { screenUflpa } from "./sources/uflpa.server";
import {
  screenAdverseMedia,
  screenLitigation,
} from "./sources/adverse-media.server";
import {
  probeExportHistory,
  screenCertificates,
  screenWebsiteConsistency,
} from "./sources/web-research.server";
import { computeOutcome, synthesiseNarrative } from "./synthesis.server";
import { renderReportPdf } from "./pdf.server";
import { emailReport, emailInvestigationFailed } from "./email.server";
import {
  OUTCOME_LABEL,
  type Finding,
  type InvestigationReport,
} from "./types";

function randomToken(len = 40): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function siteOrigin(): string {
  return (
    process.env.PUBLIC_SITE_URL ||
    process.env.VITE_PUBLIC_SITE_URL ||
    "https://verify-first-now.lovable.app"
  );
}

// Enforce evidence-required rule in code, not just in the prompt.
function enforceEvidence(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    if (f.status === "NOT_APPLICABLE") return f;
    if (!f.evidence_excerpt || !f.evidence_excerpt.trim()) {
      return { ...f, status: "NOT_VERIFIED", confidence: "low" };
    }
    return f;
  });
}

export async function runInvestigation(caseId: string): Promise<{ ok: true; share_token: string } | { ok: false; error: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const log = async (action: string, payload: unknown) => {
    await supabaseAdmin
      .from("case_activity_log")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ case_id: caseId, action: action as any, payload: payload as any });
  };

  // 1) Load case context
  const { data: caseRow, error: cErr } = await supabaseAdmin
    .from("supplier_cases")
    .select(`
      id, case_reference, status, product_category, destination_market,
      estimated_order_value, customer_concerns, supplier_chinese_name,
      orders(order_reference, supplier_company_name, supplier_country,
              website_marketplace_url, supplier_contact_person, customer_name,
              customer_company, customer_email)
    `)
    .eq("id", caseId)
    .maybeSingle();
  if (cErr || !caseRow) return { ok: false, error: "Case not found" };

  const order = Array.isArray(caseRow.orders) ? caseRow.orders[0] : (caseRow.orders as any);
  if (!order) return { ok: false, error: "No order attached to case" };

  // Idempotency guard — don't re-run an in-flight or completed investigation.
  if (caseRow.status === "investigating") return { ok: false, error: "Already investigating" };
  if (["report_ready", "delivered"].includes(String(caseRow.status))) {
    return { ok: false, error: "Already completed" };
  }

  await supabaseAdmin.from("supplier_cases").update({
    status: "investigating",
    investigation_started_at: new Date().toISOString(),
    investigation_error: null,
  }).eq("id", caseId);
  await log("status_changed", { to: "investigating" });

  try {
    // 2) Document extraction
    const { data: docs } = await supabaseAdmin
      .from("case_documents")
      .select("id, filename, note, storage_path")
      .eq("case_id", caseId);
    const extracted: ExtractedDoc[] = [];
    for (const d of docs ?? []) {
      const x = await extractDocument({
        filename: d.filename as string,
        category: (d.note as string) ?? null,
        storagePath: d.storage_path as string,
      });
      if (x) {
        extracted.push(x);
        await supabaseAdmin.from("case_documents").update({ extracted_data: x }).eq("id", d.id);
      }
    }
    await log("evidence_added", { stage: "document_extraction", count: extracted.length });

    // 3) Legal-entity resolution
    const { entity: resolved, sources: entitySources } = await resolveLegalEntity({
      statedName: order.supplier_company_name,
      chineseName: caseRow.supplier_chinese_name ?? null,
      country: order.supplier_country,
      website: order.website_marketplace_url,
      extracted,
    });
    await supabaseAdmin.from("supplier_cases").update({ resolved_entity: resolved }).eq("id", caseId);
    await log("evidence_added", { stage: "entity_resolution", matched: resolved.matched });

    const nameForScreening = resolved.legal_name_en || order.supplier_company_name;
    const chineseForScreening = resolved.legal_name_local || caseRow.supplier_chinese_name || null;

    // 4) Risk screening (parallel)
    const [sanctions, uflpa, adverse, litigation, website, certs, exports] = await Promise.all([
      screenSanctions({ name: nameForScreening, country: order.supplier_country }),
      screenUflpa({ name: nameForScreening, destinationMarket: order.destination_market }),
      screenAdverseMedia({ name: nameForScreening, chineseName: chineseForScreening }),
      screenLitigation({ name: nameForScreening, chineseName: chineseForScreening }),
      screenWebsiteConsistency({
        statedName: nameForScreening,
        website: order.website_marketplace_url,
        resolved,
      }),
      screenCertificates({ extracted }),
      probeExportHistory({ name: nameForScreening, destinationMarket: order.destination_market }),
    ]);

    let findings: Finding[] = [
      ...sanctions, ...uflpa, ...adverse, ...litigation, ...website, ...certs, ...exports,
    ];
    findings = enforceEvidence(findings);
    await log("evidence_added", { stage: "risk_screening", findings: findings.length });

    // 5) Outcome + narrative
    const overall = computeOutcome(findings);
    const synth = await synthesiseNarrative({
      supplier: {
        name: order.supplier_company_name,
        chinese_name: caseRow.supplier_chinese_name ?? null,
        country: order.supplier_country,
        url: order.website_marketplace_url,
        contact: order.supplier_contact_person ?? null,
      },
      customer: {
        name: order.customer_name,
        company: order.customer_company,
        email: order.customer_email,
        destination_market: order.destination_market,
        estimated_order_value: caseRow.estimated_order_value,
        product_category: caseRow.product_category,
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved,
      findings,
      overall,
    });

    // 6) Assemble structured report
    const sourceSet = new Map<string, { name: string; url: string | null; retrieved_at: string }>();
    for (const s of entitySources) {
      const k = (s.url || s.name).toLowerCase();
      if (!sourceSet.has(k)) sourceSet.set(k, { ...s, retrieved_at: new Date().toISOString() });
    }
    for (const f of findings) {
      const k = (f.source_url || f.source_name).toLowerCase();
      if (!sourceSet.has(k))
        sourceSet.set(k, { name: f.source_name, url: f.source_url, retrieved_at: f.retrieval_date });
    }

    const report: InvestigationReport = {
      generated_at: new Date().toISOString(),
      order_reference: order.order_reference,
      case_reference: caseRow.case_reference,
      supplier_input: {
        name: order.supplier_company_name,
        chinese_name: caseRow.supplier_chinese_name ?? null,
        country: order.supplier_country,
        url: order.website_marketplace_url,
        contact: order.supplier_contact_person ?? null,
      },
      customer_input: {
        name: order.customer_name,
        company: order.customer_company,
        email: order.customer_email,
        destination_market: order.destination_market,
        estimated_order_value: caseRow.estimated_order_value,
        product_category: caseRow.product_category,
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved_entity: resolved,
      findings,
      overall_risk_rating: overall.overall,
      final_outcome: overall.outcome,
      executive_summary: synth.executive_summary,
      key_findings: synth.key_findings,
      buyer_implications: synth.buyer_implications,
      recommended_safeguards: synth.recommended_safeguards,
      payment_recommendation: synth.payment_recommendation,
      inspection_recommendation: synth.inspection_recommendation,
      testing_recommendation: synth.testing_recommendation,
      methodology:
        "An automated AI pipeline extracted entities from customer-uploaded documents (Gemini multimodal); " +
        "resolved the likely legal entity from public registry mirrors and the supplier's own website; " +
        "screened the resolved entity against OpenSanctions consolidated sanctions data, the U.S. CBP UFLPA " +
        "Entity List snapshot, and public web sources for adverse media, litigation, certificates and shipping " +
        "history. Findings are classified as PASS / CAUTION / FAIL / NOT_VERIFIED / NOT_APPLICABLE and the " +
        "overall recommendation is computed deterministically from those statuses.",
      limitations:
        "Coverage of Chinese court judgments, shipping bills of lading, and offline corporate-registry filings " +
        "via public web search is limited. Absence of a finding in this report does not mean the underlying " +
        "event or record does not exist. For high-value orders, complement this report with a paid trade-data " +
        "search (ImportYeti / Panjiva / Sayari), a Chinese corporate-registry pull (Qichacha / Tianyancha / " +
        "OpenCorporates) and on-site inspection.",
      sources_used: Array.from(sourceSet.values()),
    };

    // 7) Persist report row
    const share_token = randomToken(40);
    const { data: existing } = await supabaseAdmin
      .from("report_versions")
      .select("version_number")
      .eq("case_id", caseId)
      .order("version_number", { ascending: false })
      .limit(1);
    const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

    const { data: rv, error: rvErr } = await supabaseAdmin
      .from("report_versions")
      .insert({
        case_id: caseId,
        version_number: nextVersion,
        status: "final",
        overall_risk_rating: overall.overall,
        final_outcome:
          overall.outcome === "GO"
            ? "go"
            : overall.outcome === "PROCEED_WITH_SAFEGUARDS"
            ? "proceed_with_safeguards"
            : overall.outcome === "PAUSE_PENDING_CLARIFICATION"
            ? "pause_pending_clarification"
            : "no_go",
        executive_summary: synth.executive_summary,
        key_findings: synth.key_findings,
        buyer_implications: synth.buyer_implications,
        recommended_safeguards: synth.recommended_safeguards,
        payment_recommendation: synth.payment_recommendation,
        inspection_recommendation: synth.inspection_recommendation,
        testing_recommendation: synth.testing_recommendation,
        methodology: report.methodology,
        limitations: report.limitations,
        snapshot: report as unknown as Record<string, unknown>,
        share_token,
        finalised_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (rvErr || !rv) throw new Error("Could not persist report: " + rvErr?.message);

    // 8) PDF + Storage
    const pdfBytes = await renderReportPdf(report);
    const pdfPath = `cases/${caseId}/${rv.id}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("reports")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error("Could not store PDF: " + upErr.message);
    await supabaseAdmin.from("report_versions").update({ pdf_storage_path: pdfPath }).eq("id", rv.id);
    await log("report_generated", { version: nextVersion, outcome: report.final_outcome });

    // 9) Email delivery
    const reportUrl = `${siteOrigin()}/r/${share_token}`;
    await emailReport({
      customerEmail: order.customer_email,
      customerName: order.customer_name,
      orderReference: order.order_reference,
      supplierName: order.supplier_company_name,
      overallRating: overall.overall,
      finalOutcome: OUTCOME_LABEL[overall.outcome],
      reportUrl,
      pdfBytes,
    });

    await supabaseAdmin.from("supplier_cases").update({
      status: "delivered",
      investigation_completed_at: new Date().toISOString(),
      overall_risk_rating: overall.overall,
      suggested_outcome:
        overall.outcome === "GO" ? "go" :
        overall.outcome === "PROCEED_WITH_SAFEGUARDS" ? "proceed_with_safeguards" :
        overall.outcome === "PAUSE_PENDING_CLARIFICATION" ? "pause_pending_clarification" : "no_go",
      completion_pct: 100,
    }).eq("id", caseId);
    await supabaseAdmin.from("report_versions").update({ delivered_at: new Date().toISOString() }).eq("id", rv.id);
    await log("report_delivered", { to: order.customer_email, reportUrl });

    return { ok: true, share_token };
  } catch (e) {
    const errorMessage = (e as Error).message;
    console.error("[runInvestigation] failed:", errorMessage);
    await supabaseAdmin.from("supplier_cases").update({
      status: "investigation_failed",
      investigation_error: errorMessage,
      investigation_completed_at: new Date().toISOString(),
    }).eq("id", caseId);
    await log("status_changed", { to: "investigation_failed", error: errorMessage });
    await emailInvestigationFailed({
      orderReference: order.order_reference,
      customerEmail: order.customer_email,
      errorMessage,
    }).catch(() => {});
    return { ok: false, error: errorMessage };
  }
}
