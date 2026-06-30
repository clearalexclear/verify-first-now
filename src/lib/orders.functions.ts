import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALLOWED_EXTS = ["pdf", "jpg", "jpeg", "png"];
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const MAX_FILES = 3;

const documentSchema = z.object({
  filename: z.string().min(1).max(300),
  category: z.enum(["business_licence", "certificate", "quotation"]).default("business_licence"),
  contentType: z.string().min(1).max(200),
  fileBase64: z.string().min(1),
});

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
  documents: z.array(documentSchema).max(MAX_FILES).optional().default([]),
});

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

const TIER_LABELS: Record<string, { name: string; price: number; hours: number }> = {
  standard: { name: "Standard", price: 490, hours: 72 },
  priority: { name: "Priority", price: 690, hours: 24 },
  onsite: { name: "On-Site", price: 1290, hours: 24 * 7 },
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

function safeExt(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export const submitOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => submitOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const caseStatus = "payment_pending";
    const paymentStatus = "pending";

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .upsert(
        { full_name: data.customer_name, company: data.customer_company, email: data.customer_email },
        { onConflict: "email,company" },
      )
      .select("id")
      .single();

    const { data: supplier } = await supabaseAdmin
      .from("suppliers")
      .insert({
        stated_name: data.supplier_company_name,
        cn_vn_legal_name: data.supplier_chinese_name || null,
        country: data.supplier_country,
        website: data.website_marketplace_url,
        marketplace_url: data.website_marketplace_url,
        contact_person: data.supplier_contact_person || null,
      })
      .select("id")
      .single();

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
        payment_status: paymentStatus,
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
    const statusToken = randomToken(40);

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
        upload_token: statusToken,
        status: caseStatus,
      })
      .select("id, case_reference")
      .single();
    if (caseErr) console.error("[submitOrder] case insert failed:", caseErr);

    if (caseRow) {
      await supabaseAdmin.from("orders").update({ case_id: caseRow.id }).eq("id", inserted.id);
      await supabaseAdmin.from("case_activity_log").insert({
        case_id: caseRow.id,
        action: "case_created",
        payload: { order_id: inserted.id, payment_status: paymentStatus, job_created: false } as any,
      });

      for (const d of data.documents) {
        const ext = safeExt(d.filename);
        if (!ALLOWED_EXTS.includes(ext)) continue;
        const bin = Buffer.from(d.fileBase64, "base64");
        if (bin.byteLength === 0 || bin.byteLength > MAX_BYTES_PER_FILE) continue;
        const safeName = d.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
        const path = `${caseRow.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("case-documents")
          .upload(path, bin, { contentType: d.contentType, upsert: false });
        if (upErr) {
          console.warn("[submitOrder] doc upload failed:", upErr.message);
          continue;
        }
        await supabaseAdmin.from("case_documents").insert({
          case_id: caseRow.id,
          filename: d.filename,
          storage_path: path,
          note: d.category,
        });
        await supabaseAdmin.from("case_activity_log").insert({
          case_id: caseRow.id,
          action: "document_uploaded",
          payload: { filename: d.filename, category: d.category, bytes: bin.byteLength } as any,
        });
      }
    }

    const orderReference = inserted.order_reference as string;
    const origin =
      process.env.PUBLIC_SITE_URL ||
      process.env.VITE_PUBLIC_SITE_URL ||
      "https://verify-first-now.lovable.app";
    const statusUrl = `${origin}/order/status/${statusToken}`;

    try {
      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (LOVABLE_API_KEY && RESEND_API_KEY) {
        const internalHtml = `
          <h2>New VerifyFirst pending order — ${orderReference}</h2>
          <p><strong>Payment:</strong> Pending Stripe confirmation. No investigation job has been created.</p>
          <p><strong>Tier:</strong> ${tier.name} (€${tier.price})</p>
          <p><strong>Case reference:</strong> ${caseRow?.case_reference ?? "—"}</p>
          <p><strong>Status URL:</strong> <a href="${statusUrl}">${statusUrl}</a></p>
          <h3>Customer</h3>
          <ul>
            <li>${escapeHtml(data.customer_name)} — ${escapeHtml(data.customer_company)} — ${escapeHtml(data.customer_email)}</li>
            <li>Order value: ${escapeHtml(data.estimated_order_value)}</li>
          </ul>
          <h3>Supplier</h3>
          <ul>
            <li>${escapeHtml(data.supplier_company_name)} (${escapeHtml(data.supplier_chinese_name || "no local name")})</li>
            <li>Country: ${escapeHtml(data.supplier_country)} → Destination: ${escapeHtml(data.destination_market)}</li>
            <li>URL: ${escapeHtml(data.website_marketplace_url)}</li>
            <li>Product: ${escapeHtml(data.product_category)}</li>
          </ul>
          <p>${data.documents.length} document(s) uploaded with order.</p>
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
            subject: `New VerifyFirst pending order — ${orderReference}`,
            html: internalHtml,
          }),
        }).catch((e) => console.warn("[submitOrder] internal email failed:", (e as Error).message));
      }
    } catch (e) {
      console.warn("[submitOrder] internal email error:", (e as Error).message);
    }

    return { orderReference, statusToken, statusUrl };
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
