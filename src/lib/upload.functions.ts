import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALLOWED_EXT = ["pdf", "docx", "xlsx", "jpg", "jpeg", "png"];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const DOC_CATEGORIES = [
  "business_licence",
  "quotation",
  "pro_forma_invoice",
  "contract",
  "payment_instructions",
  "certificate",
  "test_report",
  "product_specification",
  "factory_presentation",
  "other",
] as const;

export type DocCategory = typeof DOC_CATEGORIES[number];

function safeExt(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export const getUploadCase = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c, error } = await supabaseAdmin
      .from("supplier_cases")
      .select("id, case_reference, status, supplier_id, suppliers(stated_name)")
      .eq("upload_token", data.token)
      .maybeSingle();
    if (error || !c) throw new Error("This upload link is invalid or has expired.");

    const { data: docs } = await supabaseAdmin
      .from("case_documents")
      .select("id, filename, note, created_at")
      .eq("case_id", c.id)
      .order("created_at", { ascending: false });

    const supplier = Array.isArray(c.suppliers)
      ? (c.suppliers[0] as { stated_name?: string } | undefined)
      : (c.suppliers as { stated_name?: string } | null);

    return {
      caseId: c.id as string,
      caseReference: c.case_reference as string,
      status: c.status as string,
      supplierName: supplier?.stated_name ?? null,
      documents: (docs ?? []).map((d: any) => ({
        id: d.id,
        filename: d.filename,
        category: d.note,
        uploadedAt: d.created_at,
      })),
    };
  });

export const uploadCaseDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      token: z.string().min(10).max(128),
      filename: z.string().min(1).max(300),
      category: z.enum(DOC_CATEGORIES),
      contentType: z.string().min(1).max(200),
      fileBase64: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const ext = safeExt(data.filename);
    if (!ALLOWED_EXT.includes(ext)) {
      throw new Error(`Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXT.join(", ")}.`);
    }

    // Decode base64
    const bin = Buffer.from(data.fileBase64, "base64");
    if (bin.byteLength === 0) throw new Error("Empty file.");
    if (bin.byteLength > MAX_BYTES) throw new Error("File is too large (max 25 MB).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c, error: caseErr } = await supabaseAdmin
      .from("supplier_cases")
      .select("id, status")
      .eq("upload_token", data.token)
      .maybeSingle();
    if (caseErr || !c) throw new Error("This upload link is invalid or has expired.");

    const safeName = data.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
    const path = `${c.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("case-documents")
      .upload(path, bin, { contentType: data.contentType, upsert: false });
    if (upErr) {
      console.error("[uploadCaseDocument] storage error:", upErr);
      throw new Error("Could not save your file. Please try again.");
    }

    await supabaseAdmin.from("case_documents").insert({
      case_id: c.id,
      filename: data.filename,
      storage_path: path,
      note: data.category,
    });

    // Move case forward when documents start arriving
    if (c.status === "awaiting_documents") {
      await supabaseAdmin
        .from("supplier_cases")
        .update({ status: "ready_for_research" })
        .eq("id", c.id);
    }

    await supabaseAdmin.from("case_activity_log").insert({
      case_id: c.id,
      action: "document_uploaded",
      payload: { filename: data.filename, category: data.category, bytes: bin.byteLength },
    });

    return { ok: true, filename: data.filename };
  });
