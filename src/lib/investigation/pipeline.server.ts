import { extractDocument, type ExtractedDoc } from "./extract-documents.server";
import { resolveLegalEntity } from "./sources/entity-resolution.server";
import { screenSanctions } from "./sources/opensanctions.server";
import { screenUflpa } from "./sources/uflpa.server";
import { screenAdverseMedia, screenLitigation } from "./sources/adverse-media.server";
import { probeExportHistory, screenCertificates, screenWebsiteConsistency } from "./sources/web-research.server";
import { computeOutcome, synthesiseNarrative } from "./synthesis.server";
import { renderReportPdf } from "./pdf.server";
import { emailReport, emailInvestigationFailed } from "./email.server";
import { persistFindingEvidence } from "./evidence.server";
import { OUTCOME_LABEL, type Finding, type InvestigationReport } from "./types";

function randomToken(len = 40): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function siteOrigin(): string {
  return process.env.PUBLIC_SITE_URL || process.env.VITE_PUBLIC_SITE_URL || "https://verify-first-now.lovable.app";
}

function mapOutcome(outcome: string) {
  if (outcome === "GO") return "go";
  if (outcome === "PROCEED_WITH_SAFEGUARDS") return "proceed_with_safeguards";
  if (outcome === "PAUSE_PENDING_CLARIFICATION") return "pause_pending_clarification";
  return "no_go";
}

export async function runInvestigation(
  caseId: string,
  opts: { jobId?: string | null; deliver?: boolean } = {},
): Promise<{ ok: true; share_token: string } | { ok: false; error: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const deliver = opts.deliver ?? true;
  const log = async (action: string, payload: unknown) => {
    await db.from("case_activity_log").insert({ case_id: caseId, action, payload });
  };

  const { data: caseRow, error: cErr } = await db
    .from("supplier_cases")
    .select(`
      id, case_reference, status, product_category, destination_market,
      estimated_order_value, customer_concerns, supplier_chinese_name,
      orders(id, order_reference, supplier_company_name, supplier_country,
              website_marketplace_url, supplier_contact_person, customer_name,
              customer_company, customer_email)
    `)
    .eq("id", caseId)
    .maybeSingle();
  if (cErr || !caseRow) return { ok: false, error: "Case not found" };

  const order = Array.isArray(caseRow.orders) ? caseRow.orders[0] : caseRow.orders;
  if (!order) return { ok: false, error: "No order attached to case" };
  if (["report_ready", "delivered"].includes(String(caseRow.status))) return { ok: false, error: "Already completed" };

  await db.from("supplier_cases").update({
    status: "investigating",
    investigation_started_at: new Date().toISOString(),
    investigation_error: null,
  }).eq("id", caseId);
  await log("status_changed", { to: "investigating", job_id: opts.jobId ?? null });

  try {
    const { data: docs } = await db
      .from("case_documents")
      .select("id, filename, note, storage_path")
      .eq("case_id", caseId);

    const extracted: ExtractedDoc[] = [];
    for (const d of docs ?? []) {
      const x = await extractDocument({ filename: d.filename, category: d.note ?? null, storagePath: d.storage_path });
      if (!x) continue;
      extracted.push(x);
      await db.from("case_documents").update({ extracted_data: x }).eq("id", d.id);
      await db.from("evidence_facts").insert({
        case_id: caseId,
        fact_key: `uploaded_document.${d.filename}`,
        fact_value: x,
        classification: "SUPPLIER_CLAIMED",
        confidence: "medium",
        source_name: "Customer upload",
        retrieval_date: new Date().toISOString(),
        evidence_excerpt: x.summary,
      });
    }
    await log("evidence_added", { stage: "document_extraction", count: extracted.length });

    const { entity: resolved, sources: entitySources } = await resolveLegalEntity({
      statedName: order.supplier_company_name,
      chineseName: caseRow.supplier_chinese_name ?? null,
      country: order.supplier_country,
      website: order.website_marketplace_url,
      extracted,
    });
    await db.from("supplier_cases").update({ resolved_entity: resolved }).eq("id", caseId);
    await log("evidence_added", { stage: "entity_resolution", matched: resolved.matched });

    const nameForScreening = resolved.legal_name_en || order.supplier_company_name;
    const chineseForScreening = resolved.legal_name_local || caseRow.supplier_chinese_name || null;

    const settled = await Promise.allSettled([
      screenSanctions({ name: nameForScreening, country: order.supplier_country }),
      screenUflpa({ name: nameForScreening, destinationMarket: order.destination_market }),
      screenAdverseMedia({ name: nameForScreening, chineseName: chineseForScreening }),
      screenLitigation({ name: nameForScreening, chineseName: chineseForScreening }),
      screenWebsiteConsistency({ statedName: nameForScreening, website: order.website_marketplace_url, resolved }),
      screenCertificates({ extracted }),
      probeExportHistory({ name: nameForScreening, destinationMarket: order.destination_market }),
    ]);

    const findings: Finding[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") findings.push(...result.value);
      else findings.push({
        section: "digital_footprint",
        item: "Connector execution failure",
        status: "NOT_VERIFIED",
        confidence: "low",
        source_name: "Investigation worker",
        source_url: null,
        retrieval_date: new Date().toISOString(),
        evidence_excerpt: "",
        evidence_ids: [],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
        buyer_impact: "One evidence source failed and could not be used for factual findings.",
        recommended_action: `Review connector failure manually: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      });
    }

    const evidenceBackedFindings = await persistFindingEvidence(caseId, findings, opts.jobId ?? null);
    await log("evidence_added", { stage: "risk_screening", findings: evidenceBackedFindings.length });

    const overall = computeOutcome(evidenceBackedFindings);
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
        estimated_order_value: caseRow.estimated_order_value ?? "",
        product_category: caseRow.product_category ?? "",
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved,
      findings: evidenceBackedFindings,
      overall,
    });

    const sourceSet = new Map<string, { name: string; url: string | null; retrieved_at: string }>();
    for (const s of entitySources) {
      const k = (s.url || s.name).toLowerCase();
      if (!sourceSet.has(k)) sourceSet.set(k, { ...s, retrieved_at: new Date().toISOString() });
    }
    for (const f of evidenceBackedFindings) {
      const k = (f.source_url || f.source_name).toLowerCase();
      if (!sourceSet.has(k)) sourceSet.set(k, { name: f.source_name, url: f.source_url, retrieved_at: f.retrieval_date });
    }

    const report: InvestigationReport = {
      generated_at: new Date().toISOString(),
      order_reference: order.order_reference ?? "",
      case_reference: caseRow.case_reference ?? "",
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
        estimated_order_value: caseRow.estimated_order_value ?? "",
        product_category: caseRow.product_category ?? "",
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved_entity: resolved,
      findings: evidenceBackedFindings,
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
        "VerifyFirst stores every factual finding as structured evidence before report rendering. Paid registry, shipment, IAF and OpenSanctions connectors remain disabled until credentials are supplied. Generic web research is web intelligence only and cannot independently verify corporate registration, shipment history, certificate validity or litigation.",
      limitations:
        "No-result searches are not proof that no record exists. Missing or unconfigured source data is reported as not independently verified. Production-grade QCC, ImportGenius, IAF CertSearch and OpenSanctions results require licensed credentials.",
      sources_used: Array.from(sourceSet.values()),
    };

    const share_token = randomToken(40);
    const { data: existing } = await db
      .from("report_versions")
      .select("version_number")
      .eq("case_id", caseId)
      .order("version_number", { ascending: false })
      .limit(1);
    const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

    const { data: rv, error: rvErr } = await db
      .from("report_versions")
      .insert({
        case_id: caseId,
        version_number: nextVersion,
        status: "final",
        overall_risk_rating: overall.overall,
        final_outcome: mapOutcome(overall.outcome),
        executive_summary: synth.executive_summary,
        key_findings: synth.key_findings,
        buyer_implications: synth.buyer_implications,
        recommended_safeguards: synth.recommended_safeguards,
        payment_recommendation: synth.payment_recommendation,
        inspection_recommendation: synth.inspection_recommendation,
        testing_recommendation: synth.testing_recommendation,
        methodology: report.methodology,
        limitations: report.limitations,
        snapshot: report,
        share_token,
        finalised_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (rvErr || !rv) throw new Error("Could not persist report: " + rvErr?.message);

    await db.from("report_artifacts").insert({
      case_id: caseId,
      report_version_id: rv.id,
      artifact_type: "structured_json",
      status: "generated",
      metadata: { report },
    });

    const pdfBytes = await renderReportPdf(report);
    const pdfPath = `cases/${caseId}/${rv.id}.pdf`;
    const { error: upErr } = await db.storage
      .from("reports")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error("Could not store PDF: " + upErr.message);
    await db.from("report_versions").update({ pdf_storage_path: pdfPath }).eq("id", rv.id);
    await db.from("report_artifacts").insert({
      case_id: caseId,
      report_version_id: rv.id,
      artifact_type: "pdf",
      storage_path: pdfPath,
      status: "generated",
    });
    await log("report_generated", { version: nextVersion, outcome: report.final_outcome });

    if (deliver) {
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
      await db.from("report_versions").update({ delivered_at: new Date().toISOString() }).eq("id", rv.id);
      await db.from("report_artifacts").insert({
        case_id: caseId,
        report_version_id: rv.id,
        artifact_type: "email",
        status: "delivered",
        metadata: { to: order.customer_email, reportUrl },
      });
      await log("report_delivered", { to: order.customer_email, reportUrl });
    }

    await db.from("supplier_cases").update({
      status: deliver ? "delivered" : "report_ready",
      investigation_completed_at: new Date().toISOString(),
      overall_risk_rating: overall.overall,
      suggested_outcome: mapOutcome(overall.outcome),
      completion_pct: 100,
    }).eq("id", caseId);

    return { ok: true, share_token };
  } catch (e) {
    const errorMessage = (e as Error).message;
    console.error("[runInvestigation] failed:", errorMessage);
    await db.from("supplier_cases").update({
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
