import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  CLASSIFICATION_LABEL,
  CONFIDENCE_LABEL,
  OUTCOME_LABEL,
  SECTION_TITLES,
  STATUS_LABEL,
  humanizeOrderValue,
  type ChecklistReportResult,
  type FindingStatus,
  type ReportSectionKey,
} from "./types";
import { VERIFYFIRST_CJK_FONT_BASE64 } from "./cjk-font-subset";
import {
  buildBuyerFacingReportViewModel,
  displaySourceName,
  MISSING_BENEFICIARY_WORDING,
  NO_RELIABLE_SHIPMENT_HISTORY,
  sanitizeBuyerText as customerFacingText,
  type BuyerFacingReportViewModel,
} from "./report-sanitizer";
import type { InvestigationReport } from "./types";

const NAVY = rgb(0x0f / 255, 0x2a / 255, 0x43 / 255);
const GREEN = rgb(0x16 / 255, 0xa3 / 255, 0x4a / 255);
const AMBER = rgb(0xd9 / 255, 0x77 / 255, 0x06 / 255);
const RED = rgb(0xdc / 255, 0x26 / 255, 0x26 / 255);
const GREY = rgb(0.4, 0.4, 0.42);
const LIGHT = rgb(0.93, 0.94, 0.95);
const TEXT = rgb(0.13, 0.15, 0.18);

const MARGIN = 50;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface FootnoteMap {
  order: string[];
  index: Map<string, number>;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  cjkRegular: PDFFont | null;
  footnotes: FootnoteMap;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 40) newPage(ctx);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = (text || "").replace(/[\u200B-\u200F]/g, "").replace(/\s+/g, " ").trim();
  if (!safe) return [""];
  const words = safe.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function visibleText(s: string | null | undefined): string {
  return customerFacingText(s ?? "");
}

function pdfSafe(s: string, cjkAvailable: boolean): string {
  const normalized = (s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...")
    .replace(/[\u200B-\u200F]/g, "");
  return [...normalized].filter((char) => {
    const code = char.charCodeAt(0);
    if (code < 32) return false;
    return cjkAvailable || code <= 126;
  }).join("");
}

function needsCjkFont(text: string): boolean {
  return /[^\x20-\x7E]/.test(text);
}

function fontForText(ctx: Ctx, text: string, bold = false): PDFFont {
  if (needsCjkFont(text) && ctx.cjkRegular) return ctx.cjkRegular;
  return bold ? ctx.bold : ctx.regular;
}

function drawWrapped(ctx: Ctx, text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
  const size = opts.size ?? 10;
  const safe = pdfSafe(customerFacingText(text), Boolean(ctx.cjkRegular));
  const font = fontForText(ctx, safe, opts.bold);
  const color = opts.color ?? TEXT;
  const lines = wrap(safe, font, size, CONTENT_W);
  const lh = size * 1.35;
  ensureSpace(ctx, lh * lines.length + 2);
  for (const line of lines) {
    if (ctx.y - lh < MARGIN + 30) newPage(ctx);
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - size, size, font, color });
    ctx.y -= lh;
  }
  if (opts.gap !== undefined) ctx.y -= opts.gap;
}

function drawSectionHeader(ctx: Ctx, title: string) {
  ensureSpace(ctx, 38);
  const safeTitle = pdfSafe(customerFacingText(title), Boolean(ctx.cjkRegular));
  const font = fontForText(ctx, safeTitle, true);
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 22, width: CONTENT_W, height: 26, color: NAVY });
  ctx.page.drawText(safeTitle, {
    x: MARGIN + 10,
    y: ctx.y - 16,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });
  ctx.y -= 32;
}

function statusColor(status: FindingStatus): ReturnType<typeof rgb> {
  switch (status) {
    case "PASS": return GREEN;
    case "CAUTION": return AMBER;
    case "FAIL": return RED;
    case "NOT_VERIFIED": return GREY;
    case "NOT_APPLICABLE": return GREY;
  }
}

function statusBadgeWidth(bold: PDFFont, status: FindingStatus): number {
  const label = STATUS_LABEL[status];
  return bold.widthOfTextAtSize(label, 8) + 14;
}

function drawStatusBadge(ctx: Ctx, status: FindingStatus, x: number, y: number, width?: number) {
  const label = STATUS_LABEL[status];
  const w = width ?? statusBadgeWidth(ctx.bold, status);
  ctx.page.drawRectangle({ x, y: y - 3, width: w, height: 13, color: statusColor(status) });
  ctx.page.drawText(label, { x: x + 6, y, size: 8, font: ctx.bold, color: rgb(1, 1, 1) });
}

function footnoteFor(ctx: Ctx, url: string): number {
  const existing = ctx.footnotes.index.get(url);
  if (existing) return existing;
  const n = ctx.footnotes.order.length + 1;
  ctx.footnotes.order.push(url);
  ctx.footnotes.index.set(url, n);
  return n;
}

function shortSourceLabel(name: string, url: string | null): string {
  return displaySourceName(name, url);
}

function checklistForReport(r: BuyerFacingReportViewModel): ChecklistReportResult[] {
  return r.checklist_results ?? [];
}

function drawChecklistItem(ctx: Ctx, item: ChecklistReportResult) {
  ensureSpace(ctx, 92);
  const displayStatus = displayStatusForItem(item);
  const badgeW = statusBadgeWidth(ctx.bold, displayStatus);
  const title = pdfSafe(customerFacingText(item.title), Boolean(ctx.cjkRegular));
  const titleFont = fontForText(ctx, title, true);
  const titleLines = wrap(title, titleFont, 10, CONTENT_W - badgeW - 10);
  ctx.page.drawText(titleLines[0], { x: MARGIN, y: ctx.y - 10, size: 10, font: titleFont, color: NAVY });
  drawStatusBadge(ctx, displayStatus, MARGIN + CONTENT_W - badgeW, ctx.y - 10, badgeW);
  ctx.y -= 14;
  for (let i = 1; i < titleLines.length; i++) {
    ctx.page.drawText(titleLines[i], { x: MARGIN, y: ctx.y - 10, size: 10, font: titleFont, color: NAVY });
    ctx.y -= 14;
  }

  const meta = [
    `Classification: ${CLASSIFICATION_LABEL[item.evidence_classification]}`,
    `Confidence: ${CONFIDENCE_LABEL[item.confidence]}`,
    `Retrieved: ${item.last_retrieval_date ? item.last_retrieval_date.slice(0, 10) : "not retrieved"}`,
  ].join("  |  ");
  drawWrapped(ctx, meta, { size: 8.5, color: GREY });

  const sourceLabels: string[] = [];
  const nameList = item.source_names.length ? item.source_names : [];
  const urlList = item.source_urls;
  if (nameList.length === 0 && urlList.length === 0) {
    sourceLabels.push("No independent source evidence");
  } else {
    for (let i = 0; i < Math.max(nameList.length, urlList.length); i++) {
      const name = nameList[i] ?? nameList[0] ?? "";
      const url = urlList[i] ?? null;
      const short = shortSourceLabel(name, url);
      const marker = url ? ` [${footnoteFor(ctx, url)}]` : "";
      sourceLabels.push(`${short}${marker}`);
    }
  }
  drawWrapped(ctx, `Sources: ${sourceLabels.join("; ")}`, { size: 8.5, color: GREY });
  if (item.paid_connector_dependency) drawWrapped(ctx, `Paid connector dependency: ${item.paid_connector_dependency}`, { size: 8.5, color: GREY });
  drawWrapped(ctx, "Explanation: " + item.explanation, { size: 9.5 });
  if (item.missing_information_required.length) {
    drawWrapped(ctx, "Missing information required: " + item.missing_information_required.join("; "), { size: 9.5, color: RED });
  }
  if (item.buyer_impact && !/^\s*(LOW|MEDIUM|HIGH)\s*$/i.test(item.buyer_impact)) drawWrapped(ctx, "Buyer impact: " + item.buyer_impact, { size: 9.5 });
  if (item.recommended_action) drawWrapped(ctx, "Recommended action: " + item.recommended_action, { size: 9.5 });
  ctx.y -= 6;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + CONTENT_W, y: ctx.y }, thickness: 0.5, color: LIGHT });
  ctx.y -= 10;
}

function displayStatusForItem(item: ChecklistReportResult): FindingStatus {
  if (item.id === "recommended_next_actions" && item.recommended_action.trim()) return "CAUTION";
  if (item.id === "adverse_media" && item.status === "PASS" && item.source_names.some((source) => /firecrawl|public web search/i.test(source))) return "NOT_VERIFIED";
  if (item.status === "NOT_VERIFIED" && item.evidence_ids.length > 0 && item.evidence_classification !== "NOT_INDEPENDENTLY_VERIFIED") {
    return item.evidence_classification === "CONTRADICTED" ? "CAUTION" : item.status;
  }
  return item.status;
}

async function tryReadFont(path: string): Promise<Uint8Array | null> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

function decodeBase64Font(base64: string): Uint8Array {
  const compact = base64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(compact, "base64"));
  const binary = globalThis.atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function embedCjkFont(doc: PDFDocument): Promise<PDFFont | null> {
  doc.registerFontkit(fontkit);
  try {
    return await doc.embedFont(decodeBase64Font(VERIFYFIRST_CJK_FONT_BASE64), { subset: true });
  } catch {
    // Fall back to configured/system fonts if the bundled subset cannot be embedded.
  }
  const candidates = [
    process.env.VERIFYFIRST_CJK_FONT_PATH,
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const bytes = await tryReadFont(candidate);
    if (!bytes) continue;
    try {
      return await doc.embedFont(bytes, { subset: true });
    } catch {
      continue;
    }
  }
  return null;
}

function drawStatusSummary(ctx: Ctx, checklist: ChecklistReportResult[]) {
  const order: FindingStatus[] = ["PASS", "CAUTION", "FAIL", "NOT_VERIFIED", "NOT_APPLICABLE"];
  const counts: Record<FindingStatus, number> = { PASS: 0, CAUTION: 0, FAIL: 0, NOT_VERIFIED: 0, NOT_APPLICABLE: 0 };
  for (const c of checklist) counts[c.status] = (counts[c.status] ?? 0) + 1;

  ensureSpace(ctx, 70);
  ctx.y -= 4;
  drawWrapped(ctx, "Checklist status summary", { size: 11, bold: true, color: NAVY });
  ctx.y -= 4;
  const boxH = 34;
  const cellW = CONTENT_W / order.length;
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    const x = MARGIN + i * cellW;
    ctx.page.drawRectangle({ x, y: ctx.y - boxH, width: cellW - 4, height: boxH, color: statusColor(s) });
    ctx.page.drawText(String(counts[s]), { x: x + 10, y: ctx.y - 20, size: 14, font: ctx.bold, color: rgb(1, 1, 1) });
    ctx.page.drawText(STATUS_LABEL[s].toUpperCase(), { x: x + 10, y: ctx.y - 30, size: 6.5, font: ctx.bold, color: rgb(1, 1, 1) });
  }
  ctx.y -= boxH + 10;
}

function drawBlockersBox(ctx: Ctx, blockers: string[]) {
  ensureSpace(ctx, 60);
  ctx.y -= 4;
  drawWrapped(ctx, "Critical blockers before payment", { size: 11, bold: true, color: RED });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 6, width: CONTENT_W, height: 3, color: RED });
  ctx.y -= 12;
  if (blockers.length === 0) {
    drawWrapped(ctx, "No critical blockers identified from the current evidence set. Item-level findings below remain authoritative.", { size: 9.5, color: TEXT });
  } else {
    for (const b of blockers) drawWrapped(ctx, `- ${b}`, { size: 9.5, color: TEXT });
  }
  ctx.y -= 6;
}

function drawVerifiedDecisionBox(ctx: Ctx, r: BuyerFacingReportViewModel) {
  const inferredDocuments = inferVerifiedReportDocumentsChecked(r);
  const decision = r.verified_report_decision ?? {
    payment_decision: r.final_outcome === "NO_GO" ? "NO_GO" as const : r.final_outcome === "PAUSE_PENDING_CLARIFICATION" ? "PAUSE" as const : "PROCEED" as const,
    why: inferVerifiedReportWhy(r),
    deal_specific_blockers: r.critical_blockers ?? [],
    entity_payment_consistency: "NOT_VERIFIED" as const,
    documents_checked: inferredDocuments,
    ask_supplier_before_payment: [],
  };
  const documentsChecked = decision.documents_checked.length ? decision.documents_checked : inferredDocuments;
  const why = decision.why.length ? decision.why : inferVerifiedReportWhy(r);
  ensureSpace(ctx, 150);
  const label = `Payment decision: ${decision.payment_decision === "NO_GO" ? "No-Go" : decision.payment_decision === "PAUSE" ? "Pause" : "Proceed"}`;
  const color = decision.payment_decision === "NO_GO" ? RED : decision.payment_decision === "PAUSE" ? AMBER : GREEN;
  ctx.y -= 4;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 24, width: CONTENT_W, height: 28, color });
  ctx.page.drawText(label, { x: MARGIN + 10, y: ctx.y - 17, size: 12, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.y -= 34;
  drawWrapped(ctx, `Entity/payment consistency: ${displayEntityPaymentConsistency(decision.entity_payment_consistency)}`, { size: 9.5, bold: true });
  drawWrapped(ctx, `Documents checked: ${documentsChecked.length ? documentsChecked.join("; ") : "No required documents checked"}`, { size: 9.5 });
  drawWrapped(ctx, "Why: " + (why.length ? why.join(" ") : "See item-level checklist findings."), { size: 9.5 });
  drawWrapped(ctx, "Deal-specific blockers: " + (decision.deal_specific_blockers.length ? decision.deal_specific_blockers.join(" ") : "None identified from the extracted payment fields."), { size: 9.5, color: decision.deal_specific_blockers.length ? RED : TEXT });
  drawWrapped(ctx, "Ask supplier before payment: " + (decision.ask_supplier_before_payment.length ? decision.ask_supplier_before_payment.join(" ") : "Resolve all Not Verified checklist items before payment."), { size: 9.5 });
  ctx.y -= 6;
}

function displayEntityPaymentConsistency(value: string): string {
  if (value === "NOT_VERIFIED") return "CANNOT CONFIRM";
  return value.replace(/_/g, " ");
}

function inferVerifiedReportDocumentsChecked(r: BuyerFacingReportViewModel): string[] {
  const text = JSON.stringify({
    customer_evidence: r.customer_evidence,
    checklist_results: r.checklist_results,
    sources_used: r.sources_used,
  }).toLowerCase();
  const docs: string[] = [];
  if (/business[_\s-]?licen[cs]e|supplier-provided business licen[cs]e/.test(text)) docs.push("Business licence");
  if (/proforma[_\s-]?invoice|pro.?forma|supplier-provided proforma invoice/.test(text)) docs.push("Proforma invoice");
  if (
    /certificate[_\s-]?or[_\s-]?test[_\s-]?report|certificate\/test report|test report/.test(text)
  ) docs.push("1 certificate/test report(s)");
  return docs;
}

function inferVerifiedReportWhy(r: BuyerFacingReportViewModel): string[] {
  const text = JSON.stringify({
    checklist_results: r.checklist_results,
    payment_recommendation: r.payment_recommendation,
  });
  if (/Payment beneficiary (?:was )?not extracted/i.test(text)) {
    return [MISSING_BENEFICIARY_WORDING];
  }
  return [];
}

function drawCover(ctx: Ctx, r: BuyerFacingReportViewModel) {
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: NAVY });
  ctx.page.drawText("VerifyFirst", { x: MARGIN, y: PAGE_H - 55, size: 26, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText("Independent supplier verification report", {
    x: MARGIN, y: PAGE_H - 80, size: 11, font: ctx.regular, color: rgb(0.85, 0.9, 0.95),
  });
  ctx.y = PAGE_H - 140;
  drawWrapped(ctx, r.supplier.name, { size: 22, bold: true, color: NAVY });
  const resolvedName = visibleText(r.supplier.resolved_entity_name);
  if (resolvedName && resolvedName !== visibleText(r.supplier.name)) {
    drawWrapped(ctx, "Resolved entity: " + resolvedName, { size: 11, color: GREY });
  }
  const localName = visibleText(r.supplier.local_name);
  if (localName) drawWrapped(ctx, "Local name: " + localName, { size: 11, color: GREY });

  ctx.y -= 10;
  const outcomeText = OUTCOME_LABEL[r.final_outcome];
  const outcomeColor =
    r.final_outcome === "GO" ? GREEN :
    r.final_outcome === "PROCEED_WITH_SAFEGUARDS" ? AMBER :
    r.final_outcome === "PAUSE_PENDING_CLARIFICATION" ? AMBER : RED;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 70, width: CONTENT_W, height: 70, color: outcomeColor });
  ctx.page.drawText("Commercial recommendation", { x: MARGIN + 14, y: ctx.y - 22, size: 9, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText(outcomeText, { x: MARGIN + 14, y: ctx.y - 50, size: 20, font: ctx.bold, color: rgb(1, 1, 1) });
  const riskLabel = `Overall risk: ${r.overall_risk_rating.charAt(0).toUpperCase() + r.overall_risk_rating.slice(1)}`;
  ctx.page.drawText(riskLabel, {
    x: MARGIN + CONTENT_W - ctx.bold.widthOfTextAtSize(riskLabel, 11) - 14,
    y: ctx.y - 45,
    size: 11,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  ctx.y -= 82;

  drawWrapped(ctx, "Order reference: " + r.order_reference, { size: 10, bold: true });
  drawWrapped(ctx, "Case reference: " + r.case_reference, { size: 10 });
  drawWrapped(ctx, "Prepared for: " + r.customer.name + " (" + r.customer.company + ")", { size: 10 });
  drawWrapped(ctx, "Destination market: " + r.customer.destination_market, { size: 10 });
  drawWrapped(ctx, "Estimated order value: " + humanizeOrderValue(r.customer.estimated_order_value), { size: 10 });
  drawWrapped(ctx, "Report generated: " + r.generated_at.slice(0, 19).replace("T", " ") + " UTC", { size: 10, gap: 10 });

  drawStatusSummary(ctx, checklistForReport(r));
  drawVerifiedDecisionBox(ctx, r);
  drawBlockersBox(ctx, r.critical_blockers ?? []);

  drawSectionHeader(ctx, "Executive summary");
  drawWrapped(ctx, r.executive_summary || "(not generated)", { gap: 4 });
}

function drawStrictVerifiedCover(ctx: Ctx, r: BuyerFacingReportViewModel) {
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: NAVY });
  ctx.page.drawText("VerifyFirst", { x: MARGIN, y: PAGE_H - 55, size: 26, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText("Verified Supplier Report", {
    x: MARGIN, y: PAGE_H - 80, size: 11, font: ctx.regular, color: rgb(0.85, 0.9, 0.95),
  });
  ctx.y = PAGE_H - 140;
  drawWrapped(ctx, r.supplier.name, { size: 20, bold: true, color: NAVY });
  drawWrapped(ctx, "Order reference: " + r.order_reference, { size: 10, bold: true });
  drawWrapped(ctx, "Case reference: " + r.case_reference, { size: 10 });
  drawWrapped(ctx, "Prepared for: " + r.customer.name + " (" + r.customer.company + ")", { size: 10 });
  drawWrapped(ctx, "Destination market: " + r.customer.destination_market, { size: 10 });
  drawWrapped(ctx, "Report generated: " + r.generated_at.slice(0, 19).replace("T", " ") + " UTC", { size: 10, gap: 10 });

  const decision = r.verified_report_decision;
  drawSectionHeader(ctx, "Decision summary");
  drawWrapped(ctx, `Payment decision: ${decision?.payment_decision === "NO_GO" ? "No-Go" : decision?.payment_decision === "PROCEED" ? "Proceed" : "Pause"}`, { size: 13, bold: true, color: AMBER });
  drawWrapped(ctx, `Entity/payment consistency: ${displayEntityPaymentConsistency(decision?.entity_payment_consistency ?? "NOT_VERIFIED")}`, { size: 10, bold: true });
  drawWrapped(ctx, `Documents checked: ${(decision?.documents_checked ?? inferVerifiedReportDocumentsChecked(r)).join("; ")}`, { size: 10 });
  drawWrapped(ctx, `Why: ${(decision?.why.length ? decision.why : inferVerifiedReportWhy(r)).join(" ")}`, { size: 10 });
  drawWrapped(ctx, `Ask supplier before payment: ${(decision?.ask_supplier_before_payment.length ? decision.ask_supplier_before_payment : ["Confirm payment beneficiary/account holder, confirm the uploaded business licence against GSXT/CODS or licensed registry data, verify TUV SUD certificate, and use escrow/LC tied to inspection."]).join(" ")}`, { size: 10 });
}

function drawStrictStatusTable(ctx: Ctx, r: BuyerFacingReportViewModel) {
  drawSectionHeader(ctx, "Checklist status appendix");
  for (const item of checklistForReport(r)) {
    ensureSpace(ctx, 30);
    drawWrapped(ctx, `${item.title}: ${STATUS_LABEL[displayStatusForItem(item)]}. ${item.recommended_action || "Resolve before payment."}`, { size: 8.5 });
  }
}

function drawStrictVerifiedReport(ctx: Ctx, r: BuyerFacingReportViewModel) {
  drawStrictVerifiedCover(ctx, r);

  newPage(ctx);
  drawSectionHeader(ctx, "1. Documents reviewed");
  drawWrapped(ctx, (r.verified_report_decision?.documents_checked ?? inferVerifiedReportDocumentsChecked(r)).join("; "), { size: 10, bold: true });
  drawWrapped(ctx, "Business licence and proforma invoice were treated as required buyer-provided documents. Certificate/test report evidence is reviewed as supporting evidence only.");

  drawSectionHeader(ctx, "2. Entity & payment consistency");
  drawWrapped(ctx, `Entity/payment consistency: ${displayEntityPaymentConsistency(r.verified_report_decision?.entity_payment_consistency ?? "NOT_VERIFIED")}`, { bold: true });
  drawWrapped(ctx, MISSING_BENEFICIARY_WORDING);

  drawSectionHeader(ctx, "3. What could be confirmed");
  drawWrapped(ctx, `English entity name: ${r.legal_entity_summary.english_entity_name}`);
  drawWrapped(ctx, `USCC: ${r.legal_entity_summary.uscc_note}`);
  drawWrapped(ctx, r.uflpa_summary.english_screening);

  drawSectionHeader(ctx, "4. What could not be independently verified");
  drawWrapped(ctx, `Chinese legal name: ${r.legal_entity_summary.chinese_legal_name}`);
  drawWrapped(ctx, `Registered address: ${r.legal_entity_summary.registered_address}`);
  drawWrapped(ctx, `Registered capital: ${r.legal_entity_summary.registered_capital}`);
  drawWrapped(ctx, `Business licence validation: ${r.legal_entity_summary.business_licence_validation}`);
  drawWrapped(ctx, r.uflpa_summary.local_name_screening);
  drawWrapped(ctx, r.uflpa_summary.limitation);
  drawWrapped(ctx, NO_RELIABLE_SHIPMENT_HISTORY);

  drawSectionHeader(ctx, "5. Required actions before payment");
  drawWrapped(ctx, (r.verified_report_decision?.ask_supplier_before_payment ?? []).join(" ") || "Confirm payment beneficiary/account holder, confirm the uploaded business licence against GSXT/CODS or licensed registry data, verify TUV SUD certificate, and use escrow/LC tied to inspection.");

  newPage(ctx);
  drawSectionHeader(ctx, "6. Methodology / limitations");
  drawWrapped(ctx, "This customer PDF uses a strict buyer-facing template. Raw OCR output, raw checklist explanations and internal evidence identifiers are not rendered in the verified-report PDF.");
  drawWrapped(ctx, r.methodology);
  drawWrapped(ctx, r.limitations);
  drawStrictStatusTable(ctx, r);
}

export async function renderReportPdf(r: InvestigationReport, opts: { forceVerifiedReport?: boolean } = {}): Promise<Uint8Array> {
  const report = buildBuyerFacingReportViewModel(r, opts);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cjkRegular = await embedCjkFont(doc);
  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    regular,
    bold,
    cjkRegular,
    footnotes: { order: [], index: new Map() },
  };

  if (report.is_verified_report) {
    drawStrictVerifiedReport(ctx, report);
  } else {
    drawCover(ctx, report);

    const order: ReportSectionKey[] = [
      "legal_entity",
      "ownership",
      "factory_vs_trader",
      "digital_footprint",
      "certificates_documents",
      "sanctions_forced_labour",
      "litigation_enforcement",
      "export_history",
      "regulatory",
      "payment_safeguards",
    ];
    const checklist = checklistForReport(report);
    for (const sectionKey of order) {
      const items = checklist.filter((item) => item.section === sectionKey);
      if (items.length === 0) continue;
      newPage(ctx);
      const title = sectionKey === "payment_safeguards"
        ? "Contradictions, missing information and next actions"
        : SECTION_TITLES[sectionKey];
      drawSectionHeader(ctx, title);
      for (const item of items) drawChecklistItem(ctx, item);
    }

    newPage(ctx);
    drawSectionHeader(ctx, "Buyer implications and recommended safeguards");
    drawWrapped(ctx, report.buyer_implications || "Item-level checklist results are authoritative.");
    drawWrapped(ctx, report.recommended_safeguards || "Review unresolved checklist items before payment.");
    drawWrapped(ctx, "Payment: " + report.payment_recommendation);
    drawWrapped(ctx, "Pre-shipment inspection: " + report.inspection_recommendation);
    drawWrapped(ctx, "Product testing: " + report.testing_recommendation);
  }

  if (!report.is_verified_report) {
    newPage(ctx);
    drawSectionHeader(ctx, "Sources, methodology and limitations");
    drawWrapped(ctx, "Sources actually queried", { size: 11, bold: true, color: NAVY });
    if ((report.sources_queried ?? []).length === 0) {
      drawWrapped(ctx, "No independent source was successfully queried during this run.", { size: 9, color: GREY });
    } else {
      for (const s of report.sources_queried ?? []) {
        const marker = s.url ? ` [${footnoteFor(ctx, s.url)}]` : "";
        drawWrapped(ctx, `- ${shortSourceLabel(s.name, s.url)}${marker} (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
      }
    }
    drawWrapped(ctx, "Customer-provided evidence", { size: 11, bold: true, color: NAVY });
    if ((report.customer_evidence ?? []).length === 0) {
      drawWrapped(ctx, "No customer documents were uploaded.", { size: 9, color: GREY });
    } else {
      for (const s of report.customer_evidence ?? []) {
        drawWrapped(ctx, `- ${s.name} (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
      }
    }
    drawWrapped(ctx, "Sources unavailable or not configured", { size: 11, bold: true, color: NAVY });
    if ((report.sources_unavailable ?? []).length === 0) {
      drawWrapped(ctx, "All expected sources were reachable in this run.", { size: 9, color: GREY });
    } else {
      for (const s of report.sources_unavailable ?? []) {
        drawWrapped(ctx, `- ${s.name}: ${s.reason}`, { size: 9, color: GREY });
      }
    }
    drawWrapped(ctx, "Methodology", { size: 11, bold: true, color: NAVY });
    drawWrapped(ctx, report.methodology);
    drawWrapped(ctx, "Checks verified by analyst review are labeled as such.", { size: 9 });
    drawWrapped(ctx, "Limitations", { size: 11, bold: true, color: NAVY });
    drawWrapped(ctx, report.limitations);
  }

  if (ctx.footnotes.order.length > 0) {
    drawWrapped(ctx, "Source references", { size: 11, bold: true, color: NAVY });
    for (let i = 0; i < ctx.footnotes.order.length; i++) {
      drawWrapped(ctx, `[${i + 1}] ${ctx.footnotes.order[i]}`, { size: 8, color: GREY });
    }
  }

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawText("VerifyFirst - independent supplier verification", { x: MARGIN, y: 20, size: 8, font: regular, color: GREY });
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pageLabel, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(pageLabel, 8), y: 20, size: 8, font: regular, color: GREY });
  }

  return await doc.save();
}
