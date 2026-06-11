import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const submitOrderSchema = z.object({
  tier_selected: z.enum(["standard", "priority", "onsite"]),
  supplier_company_name: z.string().min(1).max(500),
  supplier_country: z.string().min(1).max(100),
  destination_market: z.string().min(1).max(100),
  website_marketplace_url: z.string().min(1).max(1000),
  supplier_contact_person: z.string().max(500).optional().default(""),
  product_category: z.string().min(1).max(500),
  certificates_info: z.string().max(2000).optional().default(""),
  concerns_text: z.string().max(5000).optional().default(""),
  customer_name: z.string().min(1).max(200),
  customer_company: z.string().min(1).max(200),
  customer_email: z.string().email().max(320),
  estimated_order_value: z.string().min(1).max(50),
});

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

const TIER_LABELS: Record<string, { name: string; price: number; delivery: string }> = {
  standard: { name: "Standard", price: 490, delivery: "72 hours" },
  priority: { name: "Priority", price: 690, delivery: "24 hours" },
  onsite: { name: "On-Site", price: 1290, delivery: "7 days" },
};

const NOTIFY_EMAIL = "masseyalexandre@gmail.com";

export const submitOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => submitOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inserted, error } = await supabaseAdmin
      .from("orders")
      .insert([data])
      .select("order_reference, created_at")
      .single();

    if (error || !inserted) {
      console.error("[submitOrder] insert failed:", error);
      throw new Error("Failed to save your order. Please try again or contact support.");
    }

    const orderReference = inserted.order_reference as string;
    const tier = TIER_LABELS[data.tier_selected];

    // Best-effort email notification via Resend connector
    try {
      const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      if (LOVABLE_API_KEY && RESEND_API_KEY) {
        const html = `
          <h2>New VerifyFirst order — ${orderReference}</h2>
          <p><strong>Tier:</strong> ${tier.name} (€${tier.price}, ${tier.delivery})</p>
          <h3>Supplier</h3>
          <ul>
            <li><strong>Company:</strong> ${escapeHtml(data.supplier_company_name)}</li>
            <li><strong>Country:</strong> ${escapeHtml(data.supplier_country)}</li>
            <li><strong>Destination market:</strong> ${escapeHtml(data.destination_market)}</li>
            <li><strong>URL:</strong> ${escapeHtml(data.website_marketplace_url)}</li>
            <li><strong>Contact:</strong> ${escapeHtml(data.supplier_contact_person || "—")}</li>
            <li><strong>Product:</strong> ${escapeHtml(data.product_category)}</li>
            <li><strong>Certificates:</strong> ${escapeHtml(data.certificates_info || "—")}</li>
            <li><strong>Concerns:</strong> ${escapeHtml(data.concerns_text || "—")}</li>
          </ul>
          <h3>Customer</h3>
          <ul>
            <li><strong>Name:</strong> ${escapeHtml(data.customer_name)}</li>
            <li><strong>Company:</strong> ${escapeHtml(data.customer_company)}</li>
            <li><strong>Email:</strong> ${escapeHtml(data.customer_email)}</li>
            <li><strong>Estimated order value:</strong> ${escapeHtml(data.estimated_order_value)}</li>
          </ul>
        `;

        const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: "VerifyFirst <onboarding@resend.dev>",
            to: [NOTIFY_EMAIL],
            subject: `New VerifyFirst order — ${orderReference}`,
            html,
          }),
        });
        if (!res.ok) {
          console.error("[submitOrder] resend send failed:", res.status, await res.text());
        }
      } else {
        console.warn("[submitOrder] email skipped: Resend connector not linked.");
      }
    } catch (e) {
      console.error("[submitOrder] email error:", e);
    }

    return { orderReference };
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
