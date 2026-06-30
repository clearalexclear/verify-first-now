// PDF renderer using pdf-lib. Lays out a branded VerifyFirst report with
// brand colours, sectioned per the customer spec. Runs in a Cloudflare
// Worker — no fonts beyond the standard 14, no images, no system access.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  OUTCOME_LABEL,
  SECTION_TITLES,
  STATUS_LABEL,
  type Finding,
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

function isPdfSafeAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
}

// pdf-lib's standard fonts (WinAnsi) don't support CJK / curly quotes / em-dash.
// Down-translate so glyphs render; CJK becomes [non-Latin].
function asciiSafe(s: string): string {
  return (s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]+/g, (m) => {
      if ([...m].every(isPdfSafeAscii)) return m;
      return `[${m.length}-char non-Latin]`;
    });
}

function drawWrapped(ctx: Ctx, text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.regular;
  const color = opts.color ?? TEXT;
  const lines = wrap(asciiSafe(text), font, size, CONTENT_W);
  const lh = size * 1.35;
  ensureSpace(ctx, lh * lines.length);
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

function statusColor(status: Finding["status"]): ReturnType<typeof rgb> {
  switch (status) {
    case "PASS": return GREEN;
    case "CAUTION": return AMBER;
    case "FAIL": return RED;
    case "NOT_VERIFIED": return GREY;
    case "NOT_APPLICABLE": return GREY;
  }
}

function drawStatusBadge(ctx: Ctx, status: Finding["status"], x: number, y: number) {
  const label = STATUS_LABEL[status].toUpperCase();
  const w = ctx.bold.widthOfTextAtSize(label, 8) + 10;
  ctx.page.drawRectangle({ x, y: y - 2, width: w, height: 12, color: statusColor(status) });
  ctx.page.drawText(label, { x: x + 5, y, size: 8, font: ctx.bold, color: rgb(1, 1, 1) });
}

function drawFinding(ctx: Ctx, f: Finding) {
  const titleSize = 10;
  ensureSpace(ctx, 70);
  // Title row
  const titleLines = wrap(asciiSafe(f.item), ctx.bold, titleSize, CONTENT_W - 90);
  ctx.page.drawText(titleLines[0], {
    x: MARGIN,
    y: ctx.y - titleSize,
    size: titleSize,
    font: ctx.bold,
    color: NAVY,
  });
  drawStatusBadge(ctx, f.status, MARGIN + CONTENT_W - 88, ctx.y - 10);
  ctx.y -= titleSize * 1.4;
  for (let i = 1; i < titleLines.length; i++) {
    ctx.page.drawText(titleLines[i], {
      x: MARGIN,
      y: ctx.y - titleSize,
      size: titleSize,
      font: ctx.bold,
      color: NAVY,
    });
    ctx.y -= titleSize * 1.4;
  }

  const meta = `Confidence: ${f.confidence.replace("_", "-")}  •  Source: ${f.source_name}  •  Retrieved: ${f.retrieval_date.slice(0, 10)}`;
  drawWrapped(ctx, meta, { size: 8.5, color: GREY });
  if (f.source_url) drawWrapped(ctx, f.source_url, { size: 8.5, color: GREY });

  if (f.evidence_excerpt) {
    drawWrapped(ctx, "Evidence: " + f.evidence_excerpt, { size: 9.5 });
  } else {
    drawWrapped(ctx, "Evidence: (none independently retrieved — finding marked accordingly)", {
      size: 9.5,
      color: GREY,
    });
  }
  if (f.buyer_impact) drawWrapped(ctx, "Buyer impact: " + f.buyer_impact, { size: 9.5 });
  if (f.recommended_action) drawWrapped(ctx, "Recommended action: " + f.recommended_action, { size: 9.5 });
  ctx.y -= 6;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + CONTENT_W, y: ctx.y },
    thickness: 0.5,
    color: LIGHT,
  });
  ctx.y -= 10;
}

function drawCover(ctx: Ctx, r: InvestigationReport) {
  // Top navy band
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
  if (r.supplier_input.chinese_name)
    drawWrapped(ctx, "Local name: " + r.supplier_input.chinese_name, { size: 11, color: GREY });

  ctx.y -= 10;
  // Outcome card
  const outcomeText = OUTCOME_LABEL[r.final_outcome];
  const outcomeColor =
    r.final_outcome === "GO" ? GREEN :
    r.final_outcome === "PROCEED_WITH_SAFEGUARDS" ? AMBER :
    r.final_outcome === "PAUSE_PENDING_CLARIFICATION" ? AMBER : RED;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 70, width: CONTENT_W, height: 70, color: outcomeColor });
  ctx.page.drawText("FINAL RECOMMENDATION", { x: MARGIN + 14, y: ctx.y - 22, size: 9, font: ctx.bold, color: rgb(1, 1, 1) });
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
  if (r.key_findings.length) {
    drawWrapped(ctx, "Key findings", { size: 11, bold: true, color: NAVY });
    for (const k of r.key_findings) drawWrapped(ctx, "• " + k);
  }
}

export async function renderReportPdf(r: InvestigationReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, regular, bold };

  drawCover(ctx, r);

  // Resolved entity section
  newPage(ctx);
  drawSectionHeader(ctx, SECTION_TITLES.legal_entity);
  const re = r.resolved_entity;
  const pair = (k: string, v: string | null) =>
    drawWrapped(ctx, `${k}: ${v && v.length ? v : "Not independently verified"}`, { size: 10 });
  pair("Legal name (English)", re.legal_name_en);
  pair("Legal name (local)", re.legal_name_local);
  pair("Registration number", re.registration_number);
  pair("Country", re.registration_country);
  pair("Registration status", re.registration_status);
  pair("Registration date", re.registration_date);
  pair("Registered capital", re.registered_capital);
  pair("Registered address", re.registered_address);
  pair("Legal representative", re.legal_representative);
  pair("Business scope", re.business_scope);
  drawWrapped(ctx, `Shareholders: ${re.shareholders.length ? re.shareholders.join("; ") : "Not independently verified"}`);
  drawWrapped(ctx, `Related companies: ${re.related_companies.length ? re.related_companies.join("; ") : "Not independently verified"}`);
  drawWrapped(ctx, `Manufacturer indicators: ${re.manufacturer_indicators.length ? re.manufacturer_indicators.join("; ") : "None identified"}`);
  drawWrapped(ctx, `Trading-company indicators: ${re.trading_indicators.length ? re.trading_indicators.join("; ") : "None identified"}`);
  drawWrapped(ctx, `Confidence in resolution: ${re.confidence.replace("_", "-")}`, { gap: 6 });
  if (re.notes) drawWrapped(ctx, "Notes: " + re.notes, { size: 9.5, color: GREY, gap: 6 });

  // Findings grouped by section
  const order: ReportSectionKey[] = [
    "legal_entity",
    "entity_payment_match",
    "factory_vs_trader",
    "ownership",
    "product_capacity_fit",
    "export_history",
    "certificates_documents",
    "regulatory",
    "litigation_enforcement",
    "sanctions_forced_labour",
    "digital_footprint",
    "payment_safeguards",
  ];
  for (const key of order) {
    if (key === "legal_entity") continue; // handled above
    const section = r.findings.filter((f) => f.section === key);
    if (section.length === 0) continue;
    newPage(ctx);
    drawSectionHeader(ctx, SECTION_TITLES[key]);
    for (const f of section) drawFinding(ctx, f);
  }

  // Buyer implications + safeguards
  newPage(ctx);
  drawSectionHeader(ctx, "Buyer implications");
  drawWrapped(ctx, r.buyer_implications);
  drawSectionHeader(ctx, "Recommended safeguards");
  drawWrapped(ctx, r.recommended_safeguards);
  drawWrapped(ctx, "Payment: " + r.payment_recommendation);
  drawWrapped(ctx, "Pre-shipment inspection: " + r.inspection_recommendation);
  drawWrapped(ctx, "Product testing: " + r.testing_recommendation);

  // Sources, methodology, limitations
  newPage(ctx);
  drawSectionHeader(ctx, "Sources, methodology and limitations");
  drawWrapped(ctx, "Methodology", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.methodology);
  drawWrapped(ctx, "Limitations", { size: 11, bold: true, color: NAVY });
  drawWrapped(ctx, r.limitations);
  drawWrapped(ctx, "Sources consulted", { size: 11, bold: true, color: NAVY });
  for (const s of r.sources_used) {
    drawWrapped(ctx, `• ${s.name}${s.url ? " — " + s.url : ""}  (retrieved ${s.retrieved_at.slice(0, 10)})`, { size: 9 });
  }

  // Footer on every page
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawText("VerifyFirst — independent supplier verification", {
      x: MARGIN, y: 20, size: 8, font: regular, color: GREY,
    });
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pageLabel, {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(pageLabel, 8),
      y: 20, size: 8, font: regular, color: GREY,
    });
  }

  return await doc.save();
}
