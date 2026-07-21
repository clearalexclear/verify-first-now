// Source: website + digital footprint, certificate cross-check, and a
// best-effort export-history probe. Each helper returns Finding[] and is
// imported by the orchestrator. Designed so paid APIs can replace each
// function later without changing the orchestrator.

import { aiJson } from "../ai.server";
import { fcScrape, fcSearch, type FirecrawlSearchHit } from "../firecrawl.server";
import type { Finding } from "../types";
import type { ExtractedDoc } from "../extract-documents.server";
import type { ResolvedEntity } from "../types";

export async function screenWebsiteConsistency(args: {
  statedName: string;
  website: string;
  resolved: ResolvedEntity;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  if (!args.website) {
    return [{
      section: "digital_footprint",
      item: "Website and domain consistency",
      status: "NOT_APPLICABLE",
      confidence: "high",
      source_name: "n/a",
      source_url: null,
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact: "No website was provided.",
      recommended_action: "Request the supplier's official website for future investigations.",
    }];
  }
  const scraped = await fcScrape(args.website, { formats: ["markdown", "links"] });
  if (!scraped) {
    return [{
      section: "digital_footprint",
      item: "Website and domain consistency",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: args.website,
      source_url: args.website,
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact: "Website could not be fetched.",
      recommended_action: "Confirm the URL with the supplier and re-scan.",
    }];
  }
  try {
    const cls = await aiJson<{
      status: "PASS" | "CAUTION" | "FAIL" | "NOT_VERIFIED";
      confidence: "high" | "medium_high" | "medium" | "low";
      evidence_excerpt: string;
      buyer_impact: string;
      recommended_action: string;
    }>(
      [
        {
          role: "system",
          content:
            "Compare a supplier's website content against the resolved legal entity. " +
            "Flag CAUTION when the website lists no contactable address, no legal name, or claims " +
            "manufacturing capability the resolved entity does not have. Return ONLY JSON.",
        },
        {
          role: "user",
          content:
            `Website markdown (truncated):\n${scraped.markdown.slice(0, 6_000)}\n\n` +
            `Resolved legal entity JSON:\n${JSON.stringify(args.resolved)}\n\n` +
            `JSON: {status,confidence,evidence_excerpt,buyer_impact,recommended_action}`,
        },
      ],
      { model: "google/gemini-3-flash-preview" },
    );
    // Website/domain existence alone is NOT supplier-identity verification. If the legal entity
    // has not been resolved via a corporate registry, refuse to PASS this check.
    let status = cls.status;
    let confidence = cls.confidence;
    let excerpt = cls.evidence_excerpt;
    let impact = cls.buyer_impact;
    let action = cls.recommended_action;
    if (!args.resolved?.matched && status === "PASS") {
      status = "NOT_VERIFIED";
      confidence = "low";
      excerpt = `Website was fetched and its content did not obviously contradict the supplier claim, but the supplier's registered legal entity has not been resolved. Domain existence is not supplier-identity verification. ${excerpt}`;
      impact = "The website exists but its company name, contact details, address and domain ownership have not been compared against a verified legal entity.";
      action = "Verify the supplier's registered legal name/address via QCC or an official registry, then compare against website 'About / Contact' details before treating the website as consistent.";
    }
    return [{
      section: "digital_footprint",
      item: "Website and domain consistency",
      status,
      confidence,
      source_name: scraped.title || args.website,
      source_url: scraped.sourceURL,
      retrieval_date: now,
      evidence_excerpt: excerpt,
      buyer_impact: impact,
      recommended_action: action,
    }];
  } catch (e) {
    return [{
      section: "digital_footprint",
      item: "Website and domain consistency",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: args.website,
      source_url: args.website,
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact: `Could not classify: ${(e as Error).message}`,
      recommended_action: "Re-run the check manually.",
    }];
  }
}

export async function screenCertificates(args: {
  extracted: ExtractedDoc[];
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const certs = args.extracted.filter(
    (d) =>
      d.category === "certificate" ||
      d.category === "certificate_or_test_report" ||
      /certificat|cert|iso |ce |fda|reach|rohs/i.test(d.doc_type || ""),
  );
  if (certs.length === 0) {
    // No uploaded certificates. Absence of evidence is NOT the same as "not applicable"; keep
    // supplier_document_consistency, certificate_authenticity and product_certificates_test_reports
    // NOT_VERIFIED and show the customer what to provide.
    const base = {
      section: "certificates_documents" as const,
      status: "NOT_VERIFIED" as const,
      confidence: "low" as const,
      source_name: "Customer upload",
      source_url: null,
      retrieval_date: now,
      evidence_ids: [],
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED" as const,
    };
    return [
      {
        ...base,
        item: "Uploaded supplier documents (business licence, ID)",
        evidence_excerpt: "No supplier documents were uploaded by the customer. Missing information required: business licence, official company profile.",
        buyer_impact: "Supplier document consistency cannot be checked without at least a business licence or equivalent registry extract.",
        recommended_action: "Request the supplier's business licence and one form of official corporate ID, and re-run the check.",
      },
      {
        ...base,
        item: "Certificate authenticity",
        evidence_excerpt: "No certificates were uploaded by the customer. Missing information required: relevant certificate scans (ISO, CE, FDA, REACH/RoHS).",
        buyer_impact: "Certificate authenticity cannot be checked without at least one certificate scan or issuer reference number.",
        recommended_action: "Request certificates from the supplier and re-run the check.",
      },
      {
        ...base,
        item: "Product certificates and test reports (CE, FDA, REACH, RoHS)",
        evidence_excerpt: "No product certificates or test reports were uploaded by the customer. Missing information required: product-specific certificates and lab test reports for the intended SKUs.",
        buyer_impact: "Product-certificate coverage of the exact SKU cannot be verified without the underlying documents.",
        recommended_action: "Request product-specific certificates and test reports covering the exact SKU, and re-run the check.",
      },
    ];
  }

  const out: Finding[] = [];
  for (const c of certs) {
    const ents = c.extracted_entities;
    if (!ents.certificate_number || !ents.certificate_authority) {
      out.push({
        section: "certificates_documents",
        item: `Certificate: ${c.filename}`,
        status: "NOT_VERIFIED",
        confidence: "low",
        source_name: c.filename,
        source_url: null,
        retrieval_date: now,
        evidence_excerpt: c.summary || "",
        buyer_impact: "Certificate number or issuing authority could not be extracted; authenticity cannot be checked.",
        recommended_action: "Request a clearer scan and re-verify with the issuing body's online database.",
      });
      continue;
    }
    const q = `"${ents.certificate_number}" ${ents.certificate_authority}`;
    const hits = await fcSearch(q, { limit: 3 });
    if (hits.length === 0) {
      out.push({
        section: "certificates_documents",
        item: `Certificate: ${ents.certificate_authority} #${ents.certificate_number}`,
        status: "NOT_VERIFIED",
        confidence: "low",
        source_name: ents.certificate_authority,
        source_url: null,
        retrieval_date: now,
        evidence_excerpt:
          `No public confirmation of certificate "${ents.certificate_number}" via web search. ` +
          `Validity dates per document: ${ents.validity_dates ?? "not stated"}.`,
        buyer_impact: "Certificate is unverified — may be expired, forged, or never issued.",
        recommended_action: "Ask the supplier for the issuer's online verification URL and screenshot.",
      });
    } else {
      out.push({
        section: "certificates_documents",
        item: `Certificate: ${ents.certificate_authority} #${ents.certificate_number}`,
        status: "PASS",
        confidence: "medium",
        source_name: ents.certificate_authority,
        source_url: hits[0].url,
        retrieval_date: now,
        evidence_excerpt:
          `Web search returned references to this certificate number from "${hits[0].title ?? hits[0].url}". ` +
          `Validity dates per document: ${ents.validity_dates ?? "not stated"}.`,
        buyer_impact: "Certificate appears to exist publicly; scope and current validity still need direct issuer confirmation.",
        recommended_action: "Confirm certificate scope covers the exact product variant being purchased.",
      });
    }
  }
  return out;
}

export async function probeExportHistory(args: {
  name: string;
  website?: string | null;
  destinationMarket: string;
  search?: typeof fcSearch;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const search = args.search ?? fcSearch;
  // TODO: plug-in seam — replace with ImportYeti / Panjiva / Sayari API.
  const hits = await search(
    `"${args.name}" (importyeti OR panjiva OR shipment OR bill of lading)`,
    { limit: 4 },
  );
  if (hits.length === 0) {
    return [{
      section: "export_history",
      item: "Export and shipment history",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "Public shipping-data web search",
      source_url: null,
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact:
        "Coverage of bill-of-lading data via public search is limited. Absence of hits does not mean no exports.",
      recommended_action:
        "If the order value warrants it, query a paid trade-data provider (ImportYeti, Panjiva, Sayari).",
    }];
  }
  const relevantHits = hits.filter((hit) => isSupplierLinkedExportHit(hit, args.name, args.website) && !isLowQualityExportHit(hit));
  if (relevantHits.length === 0) {
    return [{
      section: "export_history",
      item: "Export and shipment history",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "Public shipping-data web search",
      source_url: null,
      retrieval_date: now,
      evidence_excerpt: "No reliable shipment-history evidence identified from public sources.",
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      evidence_ids: [],
      buyer_impact:
        "Public directory or multilingual snippets were not clearly tied to the submitted supplier, so they were not used as shipment-history evidence.",
      recommended_action:
        `Verify shipment history to ${args.destinationMarket} with ImportGenius or another licensed trade-data source before relying on prior export claims.`,
    }];
  }
  return [{
    section: "export_history",
    item: "Export and shipment history",
    status: "CAUTION",
    confidence: "low",
    source_name: "Shipping aggregator result",
    source_url: relevantHits[0].url,
    retrieval_date: now,
    evidence_excerpt:
      `Possible references to this supplier on shipping-aggregator sites. Snippets:\n` +
      relevantHits.map((h) => `- ${h.title ?? ""} (${h.url})`).join("\n"),
    buyer_impact:
      "Some public references exist; depth and accuracy of the data behind these aggregators cannot be confirmed for free.",
    recommended_action:
      `Verify whether this supplier has shipped to ${args.destinationMarket} in the past 24 months via a paid trade-data source.`,
  }];
}

function exportTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["company", "limited", "ltd", "supplier", "factory", "manufacturer", "trading", "industry", "trade", "export", "import"].includes(token));
}

function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isSupplierLinkedExportHit(hit: FirecrawlSearchHit, supplierName: string, website?: string | null): boolean {
  const text = `${hit.title ?? ""}\n${hit.description ?? ""}\n${hit.markdown ?? ""}\n${hit.url ?? ""}`.toLowerCase();
  const exact = supplierName.replace(/\s+/g, " ").trim().toLowerCase();
  if (exact && text.includes(exact)) return true;
  const domain = domainFromUrl(website);
  if (domain && text.includes(domain.toLowerCase())) return true;
  const tokens = exportTokens(supplierName);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => text.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

export function isLowQualityExportHit(hit: FirecrawlSearchHit): boolean {
  const text = `${hit.title ?? ""}\n${hit.description ?? ""}\n${hit.markdown ?? ""}`;
  if (/deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU/i.test(text)) return true;
  if (/代码|国Unified Social Credit Code公|名称Unified Social Credit Code注册/i.test(text)) return true;
  if (/[\u0600-\u06ff]/.test(text)) return true;
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjkCount > 0 && latinCount > 0 && /Unified Social Credit Code|Registration status|Legal representative/i.test(text)) return true;
  const directoryNoise = /GlobalSources|directory|manufacturers|catalogue|catalog|OEM products|multilingual|fabricants|fournisseur|hersteller|lieferant|مصنع|مورد/i.test(text)
    && !/bill of lading|shipment record|consignee|shipper/i.test(text);
  return directoryNoise;
}
