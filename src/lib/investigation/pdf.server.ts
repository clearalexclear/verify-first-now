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

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function customerFacingText(s: string): string {
  return (s || "")
    .replace(/\bevidence[_ -]?ids?\s*[:=]\s*(?:\[[^\]]*\]|[0-9a-f,\s-]{20,})/gi, "evidence references")
    .replace(UUID_PATTERN, "internal reference")
    .replace(/\s+/g, " ")
    .trim();
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
  const trimmed = (name || "").trim();
  if (trimmed && trimmed.length <= 80) return trimmed;
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch { /* ignore */ }
  }
  return trimmed.slice(0, 80);
}

function checklistForReport(r: InvestigationReport): ChecklistReportResult[] {
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

async function embedCjkFont(doc: PDFDocument): Promise<PDFFont | null> {
  doc.registerFontkit(fontkit);
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
  drawWrapped(ctx, "Prepared for: " + r.customer_input.name + " (" + r.customer_input.company + ")", { size: 10 });
  drawWrapped(ctx, "Destination market: " + r.customer_input.destination_market, { size: 10 });
  drawWrapped(ctx, "Estimated order value: " + humanizeOrderValue(r.customer_input.estimated_order_value), { size: 10 });
  drawWrapped(ctx, "Report generated: " + r.generated_at.slice(0, 19).replace("T", " ") + " UTC", { size: 10, gap: 10 });

  drawStatusSummary(ctx, checklistForReport(r));
  drawBlockersBox(ctx, r.critical_blockers ?? []);

  drawSectionHeader(ctx, "Executive summary");
  drawWrapped(ctx, r.executive_summary || "(not generated)", { gap: 4 });
}

export async function renderReportPdf(r: InvestigationReport): Promise<Uint8Array> {
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
  drawSectionHeader(ctx, "Buyer implications and recommended safeguards");
  drawWrapped(ctx, r.buyer_implications || "Item-level checklist results are authoritative.");
  drawWrapped(ctx, r.recommended_safeguards || "Review unresolved checklist items before payment.");
  drawWrapped(ctx, "Payment: " + r.payment_recommendation);
  drawWrapped(ctx, "Pre-shipment inspection: " + r.inspection_recommendation);
  drawWrapped(ctx, "Product testing: " + r.testing_recommendation);

  newPage(ctx);
  drawSectionHeader(ctx, "Sources, methodology and limitations");
  drawWrapped(ctx, "Sources actually queried", { size: 11, bold: true, color: NAVY });
  if ((r.sources_queried ?? []).length === 0) {
    drawWrapped(ctx, "No independent source was successfully queried during this run.", { size: 9, color: GREY });
  } else {
    for (const s of r.sources_queried ?? []) {
      const marker = s.url ? ` [${footnoteFor(ctx, s.url)}]` : "";
      drawWrapped(ctx, `- ${shortSourceLabel(s.name, s.url)}${marker} (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
    }
  }
  drawWrapped(ctx, "Customer-provided evidence", { size: 11, bold: true, color: NAVY });
  if ((r.customer_evidence ?? []).length === 0) {
    drawWrapped(ctx, "No customer documents were uploaded.", { size: 9, color: GREY });
  } else {
    for (const s of r.customer_evidence ?? []) {
      drawWrapped(ctx, `- ${s.name} (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
    }
  }
  drawWrapped(ctx, "Sources unavailable or not configured", { size: 11, bold: true, color: NAVY });
  if ((r.sources_unavailable ?? []).length === 0) {
    drawWrapped(ctx, "All expected sources were reachable in this run.", { size: 9, color: GREY });
  } else {
    for (const s of r.sources_unavailable ?? []) {
      drawWrapped(ctx, `- ${s.name}: ${s.reason}`, { size: 9, color: GREY });
    }
  }
  drawWrapped(ctx, "Methodology", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.methodology);
  drawWrapped(ctx, "Checks verified by analyst review are labeled as such.", { size: 9 });
  drawWrapped(ctx, "Limitations", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.limitations);

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
