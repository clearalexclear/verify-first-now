import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  CLASSIFICATION_LABEL,
  CONFIDENCE_LABEL,
  OUTCOME_LABEL,
  SECTION_TITLES,
  STATUS_LABEL,
  type ChecklistReportResult,
  type FindingStatus,
  type InvestigationReport,
  type ReportSectionKey,
} from "./types";

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

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
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

function asciiSafe(s: string): string {
  return (s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]+/g, (m) => `[${m.length}-char non-Latin]`);
}

function drawWrapped(ctx: Ctx, text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.regular;
  const color = opts.color ?? TEXT;
  const lines = wrap(asciiSafe(text), font, size, CONTENT_W);
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
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 22, width: CONTENT_W, height: 26, color: NAVY });
  ctx.page.drawText(asciiSafe(title), {
    x: MARGIN + 10,
    y: ctx.y - 16,
    size: 12,
    font: ctx.bold,
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

function drawStatusBadge(ctx: Ctx, status: FindingStatus, x: number, y: number) {
  const label = STATUS_LABEL[status].toUpperCase();
  const w = Math.min(ctx.bold.widthOfTextAtSize(label, 8) + 10, 120);
  ctx.page.drawRectangle({ x, y: y - 2, width: w, height: 12, color: statusColor(status) });
  ctx.page.drawText(label, { x: x + 5, y, size: 8, font: ctx.bold, color: rgb(1, 1, 1) });
}

function checklistForReport(r: InvestigationReport): ChecklistReportResult[] {
  return r.checklist_results ?? [];
}

function drawChecklistItem(ctx: Ctx, item: ChecklistReportResult) {
  ensureSpace(ctx, 92);
  const titleLines = wrap(asciiSafe(`${item.id}: ${item.title}`), ctx.bold, 10, CONTENT_W - 120);
  ctx.page.drawText(titleLines[0], { x: MARGIN, y: ctx.y - 10, size: 10, font: ctx.bold, color: NAVY });
  drawStatusBadge(ctx, item.status, MARGIN + CONTENT_W - 118, ctx.y - 10);
  ctx.y -= 14;
  for (let i = 1; i < titleLines.length; i++) {
    ctx.page.drawText(titleLines[i], { x: MARGIN, y: ctx.y - 10, size: 10, font: ctx.bold, color: NAVY });
    ctx.y -= 14;
  }

  const meta = [
    `Classification: ${CLASSIFICATION_LABEL[item.evidence_classification]}`,
    `Confidence: ${CONFIDENCE_LABEL[item.confidence]}`,
    `Retrieved: ${item.last_retrieval_date ? item.last_retrieval_date.slice(0, 10) : "not retrieved"}`,
  ].join("  |  ");
  drawWrapped(ctx, meta, { size: 8.5, color: GREY });
  drawWrapped(ctx, `Sources: ${item.source_names.length ? item.source_names.join("; ") : "No independent source evidence"}`, { size: 8.5, color: GREY });
  if (item.source_urls.length) drawWrapped(ctx, `Source URLs: ${item.source_urls.join("; ")}`, { size: 8.5, color: GREY });
  if (item.paid_connector_dependency) drawWrapped(ctx, `Paid connector dependency: ${item.paid_connector_dependency}`, { size: 8.5, color: GREY });
  drawWrapped(ctx, "Explanation: " + item.explanation, { size: 9.5 });
  if (item.missing_information_required.length) {
    drawWrapped(ctx, "Missing information required: " + item.missing_information_required.join("; "), { size: 9.5, color: RED });
  }
  if (item.buyer_impact) drawWrapped(ctx, "Buyer impact: " + item.buyer_impact, { size: 9.5 });
  if (item.recommended_action) drawWrapped(ctx, "Recommended action: " + item.recommended_action, { size: 9.5 });
  ctx.y -= 6;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + CONTENT_W, y: ctx.y }, thickness: 0.5, color: LIGHT });
  ctx.y -= 10;
}

function drawCover(ctx: Ctx, r: InvestigationReport) {
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: NAVY });
  ctx.page.drawText("VerifyFirst", { x: MARGIN, y: PAGE_H - 55, size: 26, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText("Independent supplier verification report", {
    x: MARGIN, y: PAGE_H - 80, size: 11, font: ctx.regular, color: rgb(0.85, 0.9, 0.95),
  });
  ctx.y = PAGE_H - 140;
  drawWrapped(ctx, r.supplier_input.name, { size: 22, bold: true, color: NAVY });
  if (r.resolved_entity.legal_name_en && r.resolved_entity.legal_name_en !== r.supplier_input.name) {
    drawWrapped(ctx, "Resolved entity: " + r.resolved_entity.legal_name_en, { size: 11, color: GREY });
  }
  if (r.supplier_input.chinese_name) drawWrapped(ctx, "Local name: " + r.supplier_input.chinese_name, { size: 11, color: GREY });

  ctx.y -= 10;
  const outcomeText = OUTCOME_LABEL[r.final_outcome];
  const outcomeColor =
    r.final_outcome === "GO" ? GREEN :
    r.final_outcome === "PROCEED_WITH_SAFEGUARDS" ? AMBER :
    r.final_outcome === "PAUSE_PENDING_CLARIFICATION" ? AMBER : RED;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 70, width: CONTENT_W, height: 70, color: outcomeColor });
  ctx.page.drawText("COMMERCIAL RECOMMENDATION", { x: MARGIN + 14, y: ctx.y - 22, size: 9, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText(outcomeText, { x: MARGIN + 14, y: ctx.y - 50, size: 22, font: ctx.bold, color: rgb(1, 1, 1) });
  ctx.page.drawText(`Overall risk: ${r.overall_risk_rating.toUpperCase()}`, {
    x: MARGIN + CONTENT_W - ctx.bold.widthOfTextAtSize(`Overall risk: ${r.overall_risk_rating.toUpperCase()}`, 11) - 14,
    y: ctx.y - 45,
    size: 11,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  ctx.y -= 90;

  drawWrapped(ctx, "Order reference: " + r.order_reference, { size: 10, bold: true });
  drawWrapped(ctx, "Case reference: " + r.case_reference, { size: 10 });
  drawWrapped(ctx, "Prepared for: " + r.customer_input.name + " (" + r.customer_input.company + ")", { size: 10 });
  drawWrapped(ctx, "Destination market: " + r.customer_input.destination_market, { size: 10 });
  drawWrapped(ctx, "Estimated order value: " + r.customer_input.estimated_order_value, { size: 10 });
  drawWrapped(ctx, "Report generated: " + r.generated_at.slice(0, 19).replace("T", " ") + " UTC", { size: 10, gap: 14 });

  drawSectionHeader(ctx, "Executive summary");
  drawWrapped(ctx, r.executive_summary || "(not generated)", { gap: 8 });
  drawWrapped(ctx, `Canonical checklist items: ${checklistForReport(r).length}`, { size: 10, bold: true, color: NAVY });
}

export async function renderReportPdf(r: InvestigationReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, regular, bold };

  drawCover(ctx, r);

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
  const checklist = checklistForReport(r);
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
  drawSectionHeader(ctx, "Buyer implications");
  drawWrapped(ctx, r.buyer_implications || "Item-level checklist results are authoritative.");
  drawSectionHeader(ctx, "Recommended safeguards");
  drawWrapped(ctx, r.recommended_safeguards || "Review unresolved checklist items before payment.");
  drawWrapped(ctx, "Payment: " + r.payment_recommendation);
  drawWrapped(ctx, "Pre-shipment inspection: " + r.inspection_recommendation);
  drawWrapped(ctx, "Product testing: " + r.testing_recommendation);

  newPage(ctx);
  drawSectionHeader(ctx, "Sources, methodology and limitations");
  drawWrapped(ctx, "Methodology", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.methodology);
  drawWrapped(ctx, "Limitations", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.limitations);
  drawWrapped(ctx, "Sources consulted", { size: 11, bold: true, color: NAVY });
  for (const s of r.sources_used) {
    drawWrapped(ctx, `- ${s.name}${s.url ? " - " + s.url : ""} (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
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
