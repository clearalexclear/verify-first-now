// Buyer-facing demo: create minimal case records and run the real
// investigation pipeline immediately (no payment, no docs required).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const demoInput = z.object({
  supplier_name: z.string().trim().min(2).max(300),
  supplier_website: z.string().trim().min(3).max(500),
  supplier_country: z.string().trim().min(2).max(100),
  product_category: z.string().trim().min(2).max(300),
  destination_market: z.string().trim().min(2).max(100),
  estimated_order_value: z.string().trim().max(50).optional().default(""),
  buyer_email: z.string().trim().email().max(320).optional().or(z.literal("")).default(""),
});

export const runDemoInvestigation = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => demoInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runInvestigation } = await import("@/lib/investigation/pipeline.server");

    const email = data.buyer_email || "demo@verifyfirst.local";

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .upsert(
        { full_name: "Demo Buyer", company: "Demo", email },
        { onConflict: "email,company" },
      )
      .select("id")
      .single();

    const { data: supplier } = await supabaseAdmin
      .from("suppliers")
      .insert({
        stated_name: data.supplier_name,
        country: data.supplier_country,
        website: data.supplier_website,
        marketplace_url: data.supplier_website,
      })
      .select("id")
      .single();

    const { data: orderRow, error: oErr } = await supabaseAdmin
      .from("orders")
      .insert([{
        tier_selected: "standard",
        supplier_company_name: data.supplier_name,
        supplier_country: data.supplier_country,
        destination_market: data.destination_market,
        website_marketplace_url: data.supplier_website,
        product_category: data.product_category,
        customer_name: "Demo Buyer",
        customer_company: "Demo",
        customer_email: email,
        estimated_order_value: data.estimated_order_value || "unspecified",
        payment_status: "demo",
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
      }])
      .select("id, order_reference")
      .single();
    if (oErr || !orderRow) throw new Error("Failed to create demo order: " + (oErr?.message ?? ""));

    const { data: caseRow, error: cErr } = await supabaseAdmin
      .from("supplier_cases")
      .insert({
        customer_id: customer?.id ?? null,
        supplier_id: supplier?.id ?? null,
        order_id: orderRow.id,
        product_category: data.product_category,
        destination_market: data.destination_market,
        estimated_order_value: data.estimated_order_value || "unspecified",
        package: "standard",
        deadline: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        upload_token: crypto.randomUUID().replace(/-/g, ""),
        status: "investigating",
      })
      .select("id, case_reference")
      .single();
    if (cErr || !caseRow) throw new Error("Failed to create demo case: " + (cErr?.message ?? ""));

    await supabaseAdmin.from("orders").update({ case_id: caseRow.id }).eq("id", orderRow.id);
    await supabaseAdmin.from("case_activity_log").insert({
      case_id: caseRow.id,
      action: "case_created",
      payload: { source: "demo", order_id: orderRow.id } as any,
    });

    const result = await runInvestigation(caseRow.id, { deliver: false, allowRerun: true });
    if (!result.ok) throw new Error(result.error);

    return { shareToken: result.share_token, caseReference: caseRow.case_reference };
  });
