// Email delivery for the finished report. Uses Resend through the Lovable
// connector gateway with the PDF attached + a signed link to the styled
// HTML report.

const RESEND = "https://connector-gateway.lovable.dev/resend/emails";
const INTERNAL = "masseyalexandre@gmail.com";
const FROM = "VerifyFirst <onboarding@resend.dev>";

interface SendArgs {
  customerEmail: string;
  customerName: string;
  orderReference: string;
  supplierName: string;
  overallRating: string;
  finalOutcome: string;
  reportUrl: string;
  pdfBytes: Uint8Array;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));
}

async function send(body: unknown) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    console.warn("[email] keys missing — skipping");
    return;
  }
  const res = await fetch(RESEND, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": RESEND_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("[email] send failed", res.status, await res.text().catch(() => ""));
  }
}

export async function emailCustomerStarted(args: {
  customerEmail: string;
  customerName: string;
  orderReference: string;
  supplierName: string;
}) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <h2 style="color:#0F2A43;margin:0 0 12px">Your VerifyFirst investigation has started</h2>
      <p>Hi ${escapeHtml(args.customerName)},</p>
      <p>Your VerifyFirst investigation has started. Your report will be researched by our
      automated supplier-intelligence system and delivered as a PDF to this email address.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Order</td><td style="font-family:ui-monospace,Menlo,monospace"><strong>${escapeHtml(args.orderReference)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Supplier</td><td>${escapeHtml(args.supplierName)}</td></tr>
      </table>
      <p>You will receive a follow-up email with the completed report. No action is required from you.</p>
      <p style="color:#666;font-size:12px">Questions? Reply to this email.</p>
      <p style="color:#0F2A43;margin-top:24px">— VerifyFirst</p>
    </div>`;
  await send({
    from: FROM,
    to: [args.customerEmail],
    subject: `VerifyFirst investigation started — ${args.orderReference}`,
    html,
  });
}

export async function emailReport(args: SendArgs) {
  const pdfBase64 = Buffer.from(args.pdfBytes).toString("base64");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto">
      <h2 style="color:#0F2A43;margin:0 0 12px">Your VerifyFirst report is ready</h2>
      <p>Hi ${escapeHtml(args.customerName)},</p>
      <p>The independent verification of <strong>${escapeHtml(args.supplierName)}</strong> is complete.
      The full report is attached as a PDF. You can also view it online any time at the link below.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Order</td><td style="font-family:ui-monospace,Menlo,monospace"><strong>${escapeHtml(args.orderReference)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Supplier</td><td>${escapeHtml(args.supplierName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Overall rating</td><td><strong>${escapeHtml(args.overallRating.toUpperCase())}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Final recommendation</td><td><strong>${escapeHtml(args.finalOutcome)}</strong></td></tr>
      </table>
      <p>
        <a href="${args.reportUrl}" style="display:inline-block;background:#0F2A43;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          View the full report online
        </a>
      </p>
      <p style="color:#666;font-size:12px">Questions? Reply to this email — a human will get back to you.</p>
      <p style="color:#0F2A43;margin-top:24px">— VerifyFirst</p>
    </div>`;
  await send({
    from: FROM,
    to: [args.customerEmail],
    subject: `VerifyFirst report ready — ${args.orderReference} — ${args.finalOutcome}`,
    html,
    attachments: [
      {
        filename: `VerifyFirst-${args.orderReference}.pdf`,
        content: pdfBase64,
      },
    ],
  });
  // Internal copy without attachment, for ops awareness.
  await send({
    from: FROM,
    to: [INTERNAL],
    subject: `[VerifyFirst] Report delivered — ${args.orderReference} — ${args.finalOutcome}`,
    html: `<p>Order ${escapeHtml(args.orderReference)} for ${escapeHtml(args.supplierName)} delivered to ${escapeHtml(args.customerEmail)}.</p><p>Outcome: <strong>${escapeHtml(args.finalOutcome)}</strong> / Rating: ${escapeHtml(args.overallRating)}.</p><p><a href="${args.reportUrl}">View report</a></p>`,
  });
}

export async function emailInvestigationFailed(args: {
  orderReference: string;
  customerEmail: string;
  errorMessage: string;
}) {
  await send({
    from: FROM,
    to: [INTERNAL],
    subject: `[VerifyFirst] Investigation FAILED — ${args.orderReference}`,
    html: `<p>The AI investigation for order <strong>${escapeHtml(args.orderReference)}</strong> failed.</p>
           <p>Customer: ${escapeHtml(args.customerEmail)}</p>
           <pre style="background:#f3f4f6;padding:12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(args.errorMessage)}</pre>
           <p>Resolve manually and resend.</p>`,
  });
}
