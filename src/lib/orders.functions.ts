import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const submitOrderSchema = z.object({
  tier_selected: z.enum(["standard", "priority", "onsite"]),
  supplier_company_name: z.string().min(1).max(500),
  supplier_chinese_name: z.string().max(500).optional().default(""),
  supplier_country: z.string().min(1).max(100),
  destination_market: z.string().min(1).max(100),
  website_marketplace_url: z.string().min(1).max(1000),
  supplier_contact_person: z.string().max(500).optional().default(""),
  product_category: z.string().min(1).max(500),
  product_description: z.string().max(2000).optional().default(""),
  certificates_info: z.string().max(2000).optional().default(""),
  concerns_text: z.string().max(5000).optional().default(""),
  customer_name: z.string().min(1).max(200),
  customer_company: z.string().min(1).max(200),
  customer_email: z.string().email().max(320),
  estimated_order_value: z.string().min(1).max(50),
  payment_confirmed: z.boolean().optional().default(false),
});

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

const TIER_LABELS: Record<string, { name: string; price: number; delivery: string; hours: number }> = {
  standard: { name: "Standard", price: 490, delivery: "72 hours", hours: 72 },
  priority: { name: "Priority", price: 690, delivery: "24 hours", hours: 24 },
  onsite:   { name: "On-Site",  price: 1290, delivery: "7 days",  hours: 24 * 7 },
};

const NOTIFY_EMAIL = "masseyalexandre@gmail.com";

function randomToken(len = 40): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const submitOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => submitOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const paymentConfirmed = Boolean(data.payment_confirmed);
    const caseStatus = paymentConfirmed ? "awaiting_documents" : "payment_pending";

    // 1) Upsert customer
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .upsert(
        { full_name: data.customer_name, company: data.customer_company, email: data.customer_email },
        { onConflict: "email,company" },
      )
      .select("id")
      .single();

    // 2) Insert supplier
    const { data: supplier } = await supabaseAdmin
      .from("suppliers")
      .insert({
        stated_name: data.supplier_company_name,
        country: data.supplier_country,
        website: data.website_marketplace_url,
        marketplace_url: data.website_marketplace_url,
        contact_person: data.supplier_contact_person || null,
      })
      .select("id")
      .single();

    // 3) Insert order
    const { data: inserted, error } = await supabaseAdmin
      .from("orders")
      .insert([{
        tier_selected: data.tier_selected,
        supplier_company_name: data.supplier_company_name,
        supplier_country: data.supplier_country,
        destination_market: data.destination_market,
        website_marketplace_url: data.website_marketplace_url,
        supplier_contact_person: data.supplier_contact_person,
        product_category: data.product_category,
        certificates_info: data.certificates_info,
        concerns_text: data.concerns_text,
        customer_name: data.customer_name,
        customer_company: data.customer_company,
        customer_email: data.customer_email,
        estimated_order_value: data.estimated_order_value,
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
      }])
      .select("id, order_reference, created_at")
      .single();

    if (error || !inserted) {
      console.error("[submitOrder] insert failed:", error);
      throw new Error("Failed to save your order. Please try again or contact support.");
    }

    const tier = TIER_LABELS[data.tier_selected];
    const deadline = new Date(Date.now() + tier.hours * 3600 * 1000).toISOString();
    const uploadToken = randomToken(40);

    // 5) Create supplier case
    const { data: caseRow, error: caseErr } = await supabaseAdmin
      .from("supplier_cases")
      .insert({
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
        order_id: inserted.id,
        product_category: data.product_category,
        product_description: data.product_description || null,
        supplier_chinese_name: data.supplier_chinese_name || null,
        destination_market: data.destination_market,
        estimated_order_value: data.estimated_order_value,
        package: data.tier_selected,
        deadline,
        customer_concerns: data.concerns_text || null,
        upload_token: uploadToken,
        status: caseStatus,
      })
      .select("id, case_reference")
      .single();
    if (caseErr) console.error("[submitOrder] case insert failed:", caseErr);

    if (caseRow) {
      const { data: templates } = await supabaseAdmin
        .from("check_templates")
        .select("id, section_id, question, display_order, is_critical")
        .eq("is_active", true)
        .order("display_order");
      if (templates && templates.length) {
        const checks = templates.map((t: any) => ({
          case_id: caseRow.id,
          section_id: t.section_id,
          template_id: t.id,
          question: t.question,
          display_order: t.display_order,
          is_critical: t.is_critical,
        }));
        await supabaseAdmin.from("case_checks").insert(checks);
      }
      await supabaseAdmin.from("orders").update({ case_id: caseRow.id }).eq("id", inserted.id);
      await supabaseAdmin.from("case_activity_log").insert({
        case_id: caseRow.id,
        action: "case_created",
        payload: { order_id: inserted.id, payment_confirmed: paymentConfirmed },
      });
    }

    const orderReference = inserted.order_reference as string;
    const origin =
      process.env.PUBLIC_SITE_URL ||
      process.env.VITE_PUBLIC_SITE_URL ||
      "https://verify-first-now.lovable.app";
    const uploadUrl = `${origin}/upload/${uploadToken}`;

    // Best-effort emails
    try {
      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (LOVABLE_API_KEY && RESEND_API_KEY) {
        // Customer confirmation
        const customerHtml = `
          <h2>VerifyFirst order received — ${orderReference}</h2>
          <p>Thank you for your order.</p>
          <p>Your supplier verification reference is <strong>${orderReference}</strong>.</p>
          <p>Your report will be delivered by email as a PDF. Delivery begins after payment confirmation and receipt of the basic supplier information needed for the investigation.</p>
          <p>Please upload any available business licence, quotation, pro forma invoice, contract, payment or bank instructions, certificates, test reports, product specifications or factory presentations using the secure link below:</p>
          <p><a href="${uploadUrl}" style="display:inline-block;background:#0F2A43;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Upload supporting documents</a></p>
          <p style="font-size:12px;color:#555">Or paste this link into your browser:<br>${uploadUrl}</p>
          <p>Send whatever you have. Missing documents are fine — we will contact you directly if anything essential is required. You do not need an account or dashboard.</p>
          <p>— VerifyFirst</p>
        `;
        await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: "VerifyFirst <onboarding@resend.dev>",
            to: [data.customer_email],
            subject: `VerifyFirst order received — ${orderReference}`,
            html: customerHtml,
          }),
        }).catch((e) => console.error("[submitOrder] customer email failed:", e));

        // Internal team notification
        const internalHtml = `
          <h2>New VerifyFirst order — ${orderReference}</h2>
          <p><strong>Payment:</strong> ${paymentConfirmed ? "Confirmed (stub — Stripe not yet wired)" : "Pending"}</p>
          <p><strong>Tier:</strong> ${tier.name} (€${tier.price}, ${tier.delivery})</p>
          <p><strong>Deadline:</strong> ${new Date(deadline).toUTCString()}</p>
          <p><strong>Case reference:</strong> ${caseRow?.case_reference ?? "—"}</p>
          <p><strong>Internal case ID:</strong> ${caseRow?.id ?? "—"}</p>
          <h3>Customer</h3>
          <ul>
            <li>Name: ${escapeHtml(data.customer_name)}</li>
            <li>Company: ${escapeHtml(data.customer_company)}</li>
            <li>Email: ${escapeHtml(data.customer_email)}</li>
            <li>Estimated order value: ${escapeHtml(data.estimated_order_value)}</li>
          </ul>
          <h3>Supplier</h3>
          <ul>
            <li>Company: ${escapeHtml(data.supplier_company_name)}</li>
            <li>Chinese legal name: ${escapeHtml(data.supplier_chinese_name || "—")}</li>
            <li>Country: ${escapeHtml(data.supplier_country)}</li>
            <li>Website / marketplace: ${escapeHtml(data.website_marketplace_url)}</li>
            <li>Contact: ${escapeHtml(data.supplier_contact_person || "—")}</li>
          </ul>
          <h3>Product</h3>
          <ul>
            <li>Category: ${escapeHtml(data.product_category)}</li>
            <li>Description: ${escapeHtml(data.product_description || "—")}</li>
            <li>Destination market: ${escapeHtml(data.destination_market)}</li>
          </ul>
          <h3>Customer concerns</h3>
          <p>${escapeHtml(data.concerns_text || "—")}</p>
          <h3>Document upload link</h3>
          <p><a href="${uploadUrl}">${uploadUrl}</a></p>
        `;
        await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: "VerifyFirst <onboarding@resend.dev>",
            to: [NOTIFY_EMAIL],
            subject: `New VerifyFirst order — ${orderReference}${paymentConfirmed ? " (PAID)" : " (UNPAID)"}`,
            html: internalHtml,
          }),
        }).catch((e) => console.error("[submitOrder] internal email failed:", e));
      } else {
        console.warn("[submitOrder] email skipped: Resend connector not linked.");
      }
    } catch (e) {
      console.error("[submitOrder] email error:", e);
    }

    return { orderReference, uploadToken, uploadUrl };
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
