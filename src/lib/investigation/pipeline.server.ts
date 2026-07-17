import { extractDocument, type ExtractedDoc } from "./extract-documents.server";
import { resolveLegalEntity } from "./sources/entity-resolution.server";
import { screenSanctions } from "./sources/opensanctions.server";
import { screenUflpa } from "./sources/uflpa.server";
import { screenAdverseMedia, screenLitigation } from "./sources/adverse-media.server";
import { probeExportHistory, screenCertificates, screenWebsiteConsistency } from "./sources/web-research.server";
import { retrieveChinaRegistryEvidence } from "./sources/china-registry.server";
import { createOfficialRegistryTask, OFFICIAL_BROWSER_ASSISTED_PROVIDER } from "./sources/official-browser-assisted.server";
import { OPEN_WEB_CHINA_REGISTRY_LABEL, OPEN_WEB_CHINA_REGISTRY_PROVIDER } from "./sources/open-web-china-registry.server";
import { runConnectorEvidenceChecksDetailed, type ConnectorRunSummary } from "./connectors/findings.server";
import { applyOutcomeGating, buildCanonicalChecklist } from "./checklist";
import { computeOutcome, synthesiseNarrative } from "./synthesis.server";
import { buildVerifiedReportConsistency, extractVerifiedBusinessLicenceFields, extractVerifiedInvoiceFields, selectVerifiedReportEvidenceDocs, type VerifiedCertificateFields } from "./verified-report.server";
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
  opts: { jobId?: string | null; deliver?: boolean; allowRerun?: boolean } = {},
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
      estimated_order_value, customer_concerns, supplier_chinese_name, package
    `)
    .eq("id", caseId)
    .maybeSingle();
  if (cErr) return { ok: false, error: `Could not load supplier case: ${cErr.message ?? String(cErr)}` };
  if (!caseRow) return { ok: false, error: `Supplier case not found for ID: ${caseId}` };

  const { data: orderRow, error: oErr } = await db
    .from("orders")
    .select(
      "id, order_reference, supplier_company_name, supplier_country, website_marketplace_url, supplier_contact_person, customer_name, customer_company, customer_email",
    )
    .eq("case_id", caseId)
    .limit(1)
    .maybeSingle();
  if (oErr) return { ok: false, error: `Could not load order for case ${caseId}: ${oErr.message ?? String(oErr)}` };
  if (!orderRow) return { ok: false, error: `No order attached to supplier case ${caseId}` };
  const order = orderRow;
  if (!opts.allowRerun && ["report_ready", "delivered"].includes(String(caseRow.status))) {
    return { ok: false, error: "Already completed" };
  }
  const destinationMarket = caseRow.destination_market ?? "";

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

    const { entity: initialResolved, sources: entitySources } = await resolveLegalEntity({
      statedName: order.supplier_company_name,
      chineseName: caseRow.supplier_chinese_name ?? null,
      country: order.supplier_country,
      website: order.website_marketplace_url,
      extracted,
    });
    const registryResult = await retrieveChinaRegistryEvidence({
      statedName: order.supplier_company_name,
      chineseName: caseRow.supplier_chinese_name ?? null,
      country: order.supplier_country,
      website: order.website_marketplace_url,
      productCategory: caseRow.product_category ?? null,
      cityProvinceHint: caseRow.city_province_hint ?? null,
      resolved: initialResolved,
      extracted,
    });
    const resolved = registryResult.resolvedPatch
      ? {
          ...initialResolved,
          ...registryResult.resolvedPatch,
          registration_country: initialResolved.registration_country,
          sources: [
            ...(initialResolved.sources ?? []),
            ...(registryResult.resolvedPatch.sources ?? []),
          ],
        }
      : initialResolved;
    await db.from("supplier_cases").update({ resolved_entity: resolved }).eq("id", caseId);
    await log("evidence_added", { stage: "entity_resolution", matched: resolved.matched, china_registry_status: registryResult.status });

    const registryConnectorId =
      registryResult.provider === "qincheck"
        ? "china_registry_qincheck"
        : registryResult.provider === "panda360"
          ? "china_registry_panda360"
          : registryResult.provider === OFFICIAL_BROWSER_ASSISTED_PROVIDER
            ? "official_browser_assisted"
            : registryResult.provider === OPEN_WEB_CHINA_REGISTRY_PROVIDER
              ? "open_web_china_registry"
              : "china_registry_auto";
    const registryRunStatus =
      registryResult.status === "disabled" || registryResult.status === "pending_admin"
        ? "skipped"
        : registryResult.status === "ambiguous"
          ? "not_found"
          : registryResult.status;
    const { data: registryRun } = await db.from("connector_runs").insert({
      connector_id: registryConnectorId,
      case_id: caseId,
      job_id: opts.jobId ?? null,
      status: registryRunStatus,
      mode: registryResult.provider === OFFICIAL_BROWSER_ASSISTED_PROVIDER || registryResult.provider === OPEN_WEB_CHINA_REGISTRY_PROVIDER ? "official_free" : registryResult.status === "success" ? "paid_enabled" : "paid_disabled",
      retrieved_at: registryResult.retrievedAt,
      confidence: registryResult.status === "success" ? "high" : "low",
      source_url: registryResult.sourceUrl,
      raw_response_storage_allowed: registryResult.status === "success",
      error_message: registryResult.error ?? null,
      metadata: {
        provider: registryResult.provider,
        evidence_count: registryResult.evidenceCount,
        fields_returned: registryResult.fieldsReturned,
        diagnostics: registryResult.rawResponse && typeof registryResult.rawResponse === "object" && "diagnostics" in (registryResult.rawResponse as any)
          ? (registryResult.rawResponse as any).diagnostics
          : registryResult.rawResponse && typeof registryResult.rawResponse === "object" && "open_web_registry" in (registryResult.rawResponse as any)
            ? (registryResult.rawResponse as any).open_web_registry?.diagnostics
            : null,
        raw_response: registryResult.status === "success" ? registryResult.rawResponse : null,
      },
    }).select("id").maybeSingle();
    if (registryResult.status === "pending_admin") {
      await createOfficialRegistryTask({
        caseId,
        jobId: opts.jobId ?? null,
        searchTerms: [
          resolved.registration_number,
          resolved.legal_name_local,
          caseRow.supplier_chinese_name,
          order.supplier_company_name,
        ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
        reason: registryResult.error ?? "China registry APIs are unavailable; analyst official-source verification is required.",
      });
    }
    const registryFindings: Finding[] = [];
    for (const finding of registryResult.findings) {
      const { data: insertedEvidence } = await db.from("evidence_facts").insert({
        case_id: caseId,
        connector_run_id: registryRun?.id ?? null,
        finding_key: `${finding.section}:${finding.item}`,
        fact_key: finding.item,
        fact_value: { status: finding.status, excerpt: finding.evidence_excerpt },
        classification: finding.evidence_classification ?? "VERIFIED",
        confidence: finding.confidence,
        source_name: finding.source_name,
        source_url: finding.source_url,
        retrieval_date: finding.retrieval_date,
        evidence_excerpt: finding.evidence_excerpt,
        license_notes: registryResult.provider === OPEN_WEB_CHINA_REGISTRY_PROVIDER ? OPEN_WEB_CHINA_REGISTRY_LABEL : `Created from configured China registry provider ${registryResult.sourceName}`,
      }).select("id").maybeSingle();
      registryFindings.push({
        ...finding,
        evidence_ids: insertedEvidence?.id ? [...(finding.evidence_ids ?? []), insertedEvidence.id] : finding.evidence_ids ?? [],
      });
    }

    const nameForScreening = resolved.legal_name_en || order.supplier_company_name;
    const chineseForScreening = resolved.legal_name_local || caseRow.supplier_chinese_name || null;

    const connectorRunPromise = runConnectorEvidenceChecksDetailed({
      caseId,
      jobId: opts.jobId ?? null,
      website: order.website_marketplace_url,
      productQuery: caseRow.product_category ?? "",
    });

    const settled = await Promise.allSettled([
      screenSanctions({ name: nameForScreening, country: order.supplier_country }),
      screenUflpa({
        statedName: order.supplier_company_name,
        resolvedNameEn: resolved.legal_name_en,
        resolvedNameLocal: resolved.legal_name_local ?? caseRow.supplier_chinese_name ?? null,
        aliases: [],
        entityResolved: !!resolved.matched,
        destinationMarket,
      }),
      screenAdverseMedia({ name: nameForScreening, chineseName: chineseForScreening }),
      screenLitigation({ name: nameForScreening, chineseName: chineseForScreening }),
      screenWebsiteConsistency({ statedName: nameForScreening, website: order.website_marketplace_url, resolved }),
      screenCertificates({ extracted }),
      probeExportHistory({ name: nameForScreening, destinationMarket }),
      connectorRunPromise.then((r) => r.findings),
      Promise.resolve(registryFindings),
    ]);

    let connectorRuns: ConnectorRunSummary[] = [];
    try {
      connectorRuns = (await connectorRunPromise).runs;
    } catch {
      connectorRuns = [];
    }
    connectorRuns.push({
      connectorId: registryConnectorId,
      connectorName: registryResult.sourceName,
      category: "corporate_registry",
      status: registryRunStatus,
      mode: registryResult.provider === OFFICIAL_BROWSER_ASSISTED_PROVIDER || registryResult.provider === OPEN_WEB_CHINA_REGISTRY_PROVIDER ? "official_free" : registryResult.status === "success" ? "paid_enabled" : "paid_disabled",
      sourceUrl: registryResult.sourceUrl,
      retrievedAt: registryResult.retrievedAt,
      reason: registryResult.error ?? (registryResult.status === "success" ? `${registryResult.evidenceCount} registry evidence facts returned.` : "China registry provider not configured or did not return a selectable match."),
    });

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

    const isVerifiedReport = String(caseRow.package) === "verified_report";
    const verifiedDocs = isVerifiedReport ? selectVerifiedReportEvidenceDocs(extracted) : null;
    const verifiedConsistency = isVerifiedReport
      ? buildVerifiedReportConsistency({
          supplierName: order.supplier_company_name,
          website: order.website_marketplace_url,
          country: order.supplier_country,
          productCategory: caseRow.product_category ?? "",
          destinationMarket,
          orderValue: caseRow.estimated_order_value ?? "",
          businessLicence: extractVerifiedBusinessLicenceFields(verifiedDocs?.businessLicence),
          proformaInvoice: extractVerifiedInvoiceFields(verifiedDocs?.proformaInvoice),
          certificates: (verifiedDocs?.certificates ?? [])
            .map((doc): VerifiedCertificateFields => ({
              holderName: doc.extracted_entities.company_name_en ?? doc.extracted_entities.company_name_zh ?? null,
              certificateName: doc.extracted_entities.certificate_number ?? doc.filename,
              requiredForOrder: false,
            })),
        })
      : null;
    if (verifiedConsistency) findings.push(...verifiedConsistency.findings);

    const evidenceBackedFindings = await persistFindingEvidence(caseId, findings, opts.jobId ?? null);
    await log("evidence_added", { stage: "risk_screening", findings: evidenceBackedFindings.length });

    const overall = verifiedConsistency
      ? { overall: verifiedConsistency.overallRisk, outcome: verifiedConsistency.finalOutcome }
      : computeOutcome(evidenceBackedFindings);
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
        destination_market: destinationMarket,
        estimated_order_value: caseRow.estimated_order_value ?? "",
        product_category: caseRow.product_category ?? "",
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved,
      findings: evidenceBackedFindings,
      overall,
    });

    // ------ Sources triage: split into actually queried, customer evidence, and unavailable ------
    const sourcesQueriedMap = new Map<string, { name: string; url: string | null; retrieved_at: string; category?: string }>();
    const customerEvidenceMap = new Map<string, { name: string; url: string | null; retrieved_at: string; category?: string }>();
    const sourcesUnavailable: { name: string; reason: string; category?: string }[] = [];

    // Entity-resolution sources (only listed when they returned useful data)
    if (resolved.matched) {
      for (const s of entitySources) {
        const k = (s.url || s.name).toLowerCase();
        if (!sourcesQueriedMap.has(k)) sourcesQueriedMap.set(k, { ...s, retrieved_at: new Date().toISOString(), category: "entity_resolution" });
      }
    }
    // Customer-provided documents
    for (const doc of extracted) {
      const k = `upload:${doc.filename}`.toLowerCase();
      if (!customerEvidenceMap.has(k)) customerEvidenceMap.set(k, { name: `Customer upload: ${doc.filename}`, url: null, retrieved_at: new Date().toISOString(), category: "customer_upload" });
    }
    // Free connectors (RDAP, CPSC) and paid disabled connectors
    for (const run of connectorRuns) {
      if (run.status === "success" || run.status === "not_found") {
        const k = (run.sourceUrl || run.connectorName).toLowerCase();
        if (!sourcesQueriedMap.has(k)) sourcesQueriedMap.set(k, { name: run.connectorName, url: run.sourceUrl, retrieved_at: run.retrievedAt, category: run.category });
      } else if (run.status === "not_configured" || run.status === "skipped") {
        sourcesUnavailable.push({
          name: run.connectorName,
          reason: run.reason ?? "Not configured. No API request was made.",
          category: run.category,
        });
      } else if (run.status === "error" || run.status === "rate_limited") {
        sourcesUnavailable.push({
          name: run.connectorName,
          reason: run.reason ?? `Connector returned ${run.status}.`,
          category: run.category,
        });
      }
    }
    // Additional queried sources implied by findings we know DID execute (screens that produced
    // evidence excerpts): UFLPA, sanctions, adverse media, litigation, website consistency,
    // export history probe. Skip empty ones — no request = not "consulted".
    for (const f of evidenceBackedFindings) {
      if (!f.evidence_excerpt?.trim()) continue;
      const source = f.source_name || "";
      // Only include sources that clearly came from an actual retrieval — either official/free
      // connector or one of our resolvable screens with a URL / snapshot reference.
      if (
        /DHS UFLPA Entity List snapshot|OpenSanctions|CPSC recalls|RDAP|Public web search|Firecrawl|Customer upload|Supplier website|Public shipping-data web search/i.test(source) ||
        f.source_url
      ) {
        const k = (f.source_url || source).toLowerCase();
        if (/Customer upload/i.test(source)) {
          if (!customerEvidenceMap.has(k)) customerEvidenceMap.set(k, { name: source, url: f.source_url, retrieved_at: f.retrieval_date, category: "customer_upload" });
        } else {
          if (!sourcesQueriedMap.has(k)) sourcesQueriedMap.set(k, { name: source, url: f.source_url, retrieved_at: f.retrieval_date, category: "screening" });
        }
      }
    }

    const sourcesQueried = Array.from(sourcesQueriedMap.values());
    const customerEvidence = Array.from(customerEvidenceMap.values());

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
        destination_market: destinationMarket,
        estimated_order_value: caseRow.estimated_order_value ?? "",
        product_category: caseRow.product_category ?? "",
        concerns: caseRow.customer_concerns ?? null,
      },
      resolved_entity: resolved,
      findings: evidenceBackedFindings,
      checklist_results: [],
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
        "VerifyFirst stores every factual finding as structured evidence before report rendering. Every generated report includes the full 32-item canonical supplier-verification checklist. Paid registry, shipment, IAF and OpenSanctions connectors remain disabled until credentials are supplied. Generic web research is web intelligence only and cannot independently verify corporate registration, shipment history, certificate validity, sanctions status or litigation." +
        (registryResult.provider === OPEN_WEB_CHINA_REGISTRY_PROVIDER ? ` ${OPEN_WEB_CHINA_REGISTRY_LABEL}` : ""),
      limitations:
        "No-result searches are not proof that no record exists. Missing or unconfigured source data is reported as not independently verified. Production-grade QCC, ImportGenius, IAF CertSearch and OpenSanctions results require licensed credentials.",
      sources_used: [...sourcesQueried, ...customerEvidence],
      sources_queried: sourcesQueried,
      customer_evidence: customerEvidence,
      sources_unavailable: sourcesUnavailable,
      critical_blockers: [],
      verified_report_decision: verifiedConsistency?.decision,
    };
    report.checklist_results = buildCanonicalChecklist(report);

    // Apply post-checklist outcome gating: never allow GO / PROCEED_WITH_SAFEGUARDS while
    // critical identity, sanctions, or licence items remain NOT_VERIFIED.
    const hardStop = report.checklist_results.find((item) => ["sanctions_restricted_party", "uflpa_forced_labour"].includes(item.id) && item.status === "FAIL");
    const gated = isVerifiedReport
      ? {
          overall: hardStop ? "critical" as const : report.overall_risk_rating,
          outcome: hardStop ? "NO_GO" as const : report.final_outcome,
          blockers: [
            ...(verifiedConsistency?.decision.deal_specific_blockers ?? []),
            ...(hardStop ? [`${hardStop.title} is a hard blocker.`] : []),
          ],
        }
      : applyOutcomeGating(overall, report.checklist_results as any, { paymentDetailsProvided: false });
    if (gated.outcome !== report.final_outcome || gated.overall !== report.overall_risk_rating) {
      report.final_outcome = gated.outcome;
      report.overall_risk_rating = gated.overall;
      // Refresh the final_outcome checklist item so it reflects the gated recommendation.
      report.checklist_results = buildCanonicalChecklist(report);
    }
    report.critical_blockers = gated.blockers;


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
        overall_risk_rating: report.overall_risk_rating,
        final_outcome: mapOutcome(report.final_outcome),
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

    const jsonPath = `cases/${caseId}/${rv.id}.json`;
    const { error: jsonErr } = await db.storage
      .from("reports")
      .upload(jsonPath, JSON.stringify(report, null, 2), { contentType: "application/json", upsert: true });
    if (jsonErr) throw new Error("Could not store structured report JSON: " + jsonErr.message);

    await db.from("report_artifacts").insert({
      case_id: caseId,
      report_version_id: rv.id,
      artifact_type: "structured_json",
      storage_path: jsonPath,
      status: "generated",
      metadata: { finding_count: report.findings.length, checklist_count: report.checklist_results.length },
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
      metadata: { checklist_count: report.checklist_results.length },
    });
    await log("report_generated", { version: nextVersion, outcome: report.final_outcome, delivered: deliver });

    if (deliver) {
      const reportUrl = `${siteOrigin()}/r/${share_token}`;
      await emailReport({
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        orderReference: order.order_reference,
        supplierName: order.supplier_company_name,
        overallRating: report.overall_risk_rating,
        finalOutcome: OUTCOME_LABEL[report.final_outcome],
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
      overall_risk_rating: report.overall_risk_rating,
      suggested_outcome: mapOutcome(report.final_outcome),
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
    if (deliver) {
      await emailInvestigationFailed({
        orderReference: order.order_reference,
        customerEmail: order.customer_email,
        errorMessage,
      }).catch(() => {});
    }
    return { ok: false, error: errorMessage };
  }
}
