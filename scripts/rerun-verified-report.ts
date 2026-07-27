import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path = ".env") {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return;
  for (const line of readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const SOURCE_CASE = "4b59e55a-b909-464e-9aae-9dd10e45b387";

async function main() {
  loadDotEnv();
  process.env.VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS = "true";

  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const { submitVerifiedReportImpl } = await import("../src/lib/verified-report.functions");
  const { createTestInvestigationJobForOrder } = await import("../src/lib/investigation/job-queue.server");
  const { runInvestigationJobById } = await import("../src/lib/investigation/worker.server");

  const { data: docs } = await supabaseAdmin
    .from("case_documents")
    .select("filename, storage_path, note")
    .eq("case_id", SOURCE_CASE);

  const categoryMap: Record<string, string> = {
    business_licence: "business_licence",
    proforma_invoice: "proforma_invoice",
    certificate_or_test_report: "certificate_or_test_report",
  };

  const payloadDocs = [] as any[];
  for (const doc of docs ?? []) {
    const { data: blob, error } = await supabaseAdmin.storage.from("case-documents").download(doc.storage_path);
    if (error || !blob) throw new Error(`download failed: ${doc.storage_path} ${error?.message}`);
    const buf = Buffer.from(await blob.arrayBuffer());
    const ext = doc.filename.toLowerCase().split(".").pop();
    const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
    payloadDocs.push({
      filename: doc.filename,
      category: categoryMap[doc.note as string],
      contentType,
      fileBase64: buf.toString("base64"),
    });
    console.log("prepared", doc.filename, categoryMap[doc.note as string], buf.byteLength);
  }

  const result = await submitVerifiedReportImpl(
    {
      supplier_name: "Yangjiang Justa Industry&trade Co., Ltd.",
      website: "https://justa.en.alibaba.com/",
      country: "China",
      product_category: "Kitchenware Stainless steel kitchen set",
      destination_market: "USA",
      order_value: "10_50k",
      customer_name: "Alexandre Massey",
      customer_company: "SOFTORG SARL",
      customer_email: "masseyalexandre@gmail.com",
      supplier_refused_licence: false,
      documents: payloadDocs,
    } as any,
    {
      supabaseAdmin,
      env: process.env,
      createInvestigationJob: createTestInvestigationJobForOrder,
      runJobById: runInvestigationJobById,
    },
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
