// Document extraction. Uploaded files in the case-documents bucket are
// downloaded, sent to a multimodal model, and the structured extraction is
// persisted to case_documents.extracted_data.

import { aiJson } from "./ai.server";

export interface ExtractedDoc {
  filename: string;
  category: string | null;
  doc_type: string;
  extracted_entities: {
    company_name_en: string | null;
    company_name_zh: string | null;
    usci_number: string | null;
    registered_address: string | null;
    contact: string | null;
    dates: string[];
    amounts: string[];
    certificate_authority: string | null;
    certificate_number: string | null;
    validity_dates: string | null;
  };
  business_licence?: {
    chineseLegalName: string | null;
    englishName: string | null;
    uscc: string | null;
    registeredAddress: string | null;
    legalRepresentative: string | null;
    businessScope: string | null;
    licenceDate: string | null;
  };
  proforma_invoice?: {
    issuerSellerEntity: string | null;
    beneficiaryName: string | null;
    bankAccountName: string | null;
    bankCountry: string | null;
    invoiceAddress: string | null;
    currency: string | null;
    orderAmount: string | null;
    productDescription: string | null;
    buyerName: string | null;
  };
  summary: string;
}

const PROMPT_SYSTEM =
  "You extract structured information from supplier-due-diligence documents " +
  "(business licences, certificates, invoices, quotations). Return ONLY JSON. " +
  "Do NOT invent fields. Use null for missing fields. Do not output explanations.";

function mimeFromExt(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

export async function extractDocument(args: {
  filename: string;
  category: string | null;
  storagePath: string;
}): Promise<ExtractedDoc | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: fileData, error } = await supabaseAdmin.storage
    .from("case-documents")
    .download(args.storagePath);
  if (error || !fileData) {
    console.warn("[extractDocument] download failed", args.storagePath, error?.message);
    return null;
  }
  const buf = await fileData.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = mimeFromExt(args.filename);
  const isImage = mime.startsWith("image/");

  const userInstruction =
    `This is a supplier document tagged as "${args.category ?? "unknown"}". ` +
    "Extract: doc_type, company_name_en, company_name_zh, usci_number (Chinese 统一社会信用代码 if present), " +
    "registered_address, contact, dates (any visible), amounts, certificate_authority, certificate_number, " +
    "validity_dates. If this is a business licence, also extract business_licence: chineseLegalName, englishName, uscc, " +
    "registeredAddress, legalRepresentative, businessScope, licenceDate. If this is a proforma invoice, also extract " +
    "proforma_invoice: issuerSellerEntity, beneficiaryName, bankAccountName, bankCountry, invoiceAddress, currency, " +
    "orderAmount, productDescription, buyerName. Add a 1–3 sentence factual summary. Respond as JSON exactly matching:\n" +
    `{"doc_type":"","extracted_entities":{"company_name_en":null,"company_name_zh":null,` +
    `"usci_number":null,"registered_address":null,"contact":null,"dates":[],"amounts":[],` +
    `"certificate_authority":null,"certificate_number":null,"validity_dates":null},` +
    `"business_licence":{"chineseLegalName":null,"englishName":null,"uscc":null,"registeredAddress":null,` +
    `"legalRepresentative":null,"businessScope":null,"licenceDate":null},` +
    `"proforma_invoice":{"issuerSellerEntity":null,"beneficiaryName":null,"bankAccountName":null,` +
    `"bankCountry":null,"invoiceAddress":null,"currency":null,"orderAmount":null,` +
    `"productDescription":null,"buyerName":null},"summary":""}`;

  const content = isImage
    ? [
        { type: "text" as const, text: userInstruction },
        { type: "image_url" as const, image_url: { url: `data:${mime};base64,${b64}` } },
      ]
    : [
        { type: "text" as const, text: userInstruction },
        {
          type: "file" as const,
          file: { filename: args.filename, file_data: `data:${mime};base64,${b64}` },
        },
      ];

  try {
    const parsed = await aiJson<Omit<ExtractedDoc, "filename" | "category">>(
      [
        { role: "system", content: PROMPT_SYSTEM },
        { role: "user", content },
      ],
      { model: "google/gemini-2.5-flash" },
    );
    return { filename: args.filename, category: args.category, ...parsed };
  } catch (e) {
    console.warn("[extractDocument] AI failed for", args.filename, (e as Error).message);
    return null;
  }
}
