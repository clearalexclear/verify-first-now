import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALLOWED_EXTS = ["pdf", "jpg", "jpeg", "png"];
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;

const documentSchema = z.object({
  filename: z.string().min(1).max(300),
  category: z.enum(["business_licence", "proforma_invoice", "certificate"]),
  contentType: z.string().min(1).max(200),
  fileBase64: z.string().min(1),
});

const verifiedReportSchema = z.object({
  supplier_name: z.string().trim().min(1).max(500),
  website: z.string().trim().min(1).max(1000),
  country: z.string().trim().min(1).max(100),
  product_category: z.string().trim().min(1).max(500),
  destination_market: z.string().trim().min(1).max(100),
  order_value: z.string().trim().min(1).max(100),
  customer_name: z.string().trim().min(1).max(200),
  customer_company: z.string().trim().min(1).max(200),
  customer_email: z.string().trim().email().max(320),
  supplier_refused_licence: z.boolean().optional().default(false),
  documents: z.array(documentSchema).max(5).optional().default([]),
});

export type SubmitVerifiedReportInput = z.infer<typeof verifiedReportSchema>;

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

export const submitVerifiedReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => verifiedReportSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const hasLicence = data.documents.some((doc) => doc.category === "business_licence");
    const hasInvoice = data.documents.some((doc) => doc.category === "proforma_invoice");
    const missing = [
      !hasLicence ? "Business licence" : null,
      !hasInvoice ? "Proforma invoice" : null,
    ].filter((item): item is string => Boolean(item));
    if (data.supplier_refused_licence && !missing.includes("Business licence")) missing.push("Business licence refusal explanation");

    const statusToken = randomToken(40);
    const incomplete = missing.length > 0 || data.supplier_refused_licence;

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
        stated_name: data.supplier_name,
        country: data.country,
        website: data.website,
        marketplace_url: data.website,
      })
      .select("id")
      .single();

    const { data: orderRow, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert([{
        tier_selected: "standard",
        supplier_company_name: data.supplier_name,
        supplier_country: data.country,
        destination_market: data.destination_market,
        website_marketplace_url: data.website,
        product_category: data.product_category,
        customer_name: data.customer_name,
        customer_company: data.customer_company,
        customer_email: data.customer_email,
        estimated_order_value: data.order_value,
        payment_status: "pending",
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
      }])
      .select("id, order_reference")
      .single();
    if (orderErr || !orderRow) throw new Error("Failed to create verified report order.");

    const { data: caseRow, error: caseErr } = await supabaseAdmin
      .from("supplier_cases")
      .insert({
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
        order_id: orderRow.id,
        product_category: data.product_category,
        destination_market: data.destination_market,
        estimated_order_value: data.order_value,
        package: "verified_report",
        deadline: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        upload_token: statusToken,
        status: incomplete ? "review_required" : "payment_pending",
        customer_concerns: data.supplier_refused_licence ? "Supplier refused to provide business licence." : null,
      })
      .select("id, case_reference")
      .single();
    if (caseErr || !caseRow) throw new Error("Failed to create verified report case.");

    await supabaseAdmin.from("orders").update({ case_id: caseRow.id }).eq("id", orderRow.id);
    await supabaseAdmin.from("case_activity_log").insert({
      case_id: caseRow.id,
      action: "case_created",
      payload: {
        source: "verified_report",
        order_id: orderRow.id,
        incomplete,
        missing_required_documents: missing,
        supplier_refused_licence: data.supplier_refused_licence,
      } as any,
    });

    for (const doc of data.documents) {
      const ext = safeExt(doc.filename);
      if (!ALLOWED_EXTS.includes(ext)) continue;
      const bin = Buffer.from(doc.fileBase64, "base64");
      if (bin.byteLength === 0 || bin.byteLength > MAX_BYTES_PER_FILE) continue;
      const safeName = doc.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
      const path = `${caseRow.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from("case-documents")
        .upload(path, bin, { contentType: doc.contentType, upsert: false });
      if (uploadErr) continue;
      await supabaseAdmin.from("case_documents").insert({
        case_id: caseRow.id,
        filename: doc.filename,
        storage_path: path,
        note: doc.category,
      });
      await supabaseAdmin.from("case_activity_log").insert({
        case_id: caseRow.id,
        action: "document_uploaded",
        payload: { filename: doc.filename, category: doc.category, bytes: bin.byteLength } as any,
      });
    }

    const origin =
      process.env.PUBLIC_SITE_URL ||
      process.env.VITE_PUBLIC_SITE_URL ||
      "https://verify-first-now.lovable.app";

    return {
      orderReference: orderRow.order_reference as string,
      caseReference: caseRow.case_reference as string,
      statusToken,
      statusUrl: `${origin}/order/status/${statusToken}`,
      incomplete,
      missingRequiredDocuments: missing,
    };
  });
