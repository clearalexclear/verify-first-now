// Admin diagnostic: run the automated China registry lookup (QINCheck /
// Panda360) on demand and return a structured trace. Does not persist
// evidence — this is a read-only probe so admins can see whether the
// automated pipeline is configured and what a live query returns.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  statedName: z.string().trim().min(1, "Company name is required"),
  chineseName: z.string().trim().nullable().optional(),
  uscc: z.string().trim().nullable().optional(),
  englishName: z.string().trim().nullable().optional(),
  website: z.string().trim().nullable().optional(),
});

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error("Role lookup failed");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin role required");
}

export const runChinaRegistryLookup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const env = process.env;
    const configured = {
      QINCHECK_API_KEY: Boolean(env.QINCHECK_API_KEY),
      PANDA360_API_KEY: Boolean(env.PANDA360_API_KEY),
      CHINA_REGISTRY_ENABLED: String(env.CHINA_REGISTRY_ENABLED ?? "").toLowerCase() === "true",
    };
    const anyProvider = configured.QINCHECK_API_KEY || configured.PANDA360_API_KEY;

    // Search order requested by product: USCC first, Chinese name second, English name last.
    const searchOrder = [
      { label: "USCC", value: data.uscc?.trim() || null },
      { label: "Chinese legal name", value: data.chineseName?.trim() || null },
      { label: "English name", value: (data.englishName?.trim() || data.statedName?.trim()) || null },
    ].filter((t) => Boolean(t.value));

    if (!anyProvider || !configured.CHINA_REGISTRY_ENABLED) {
      return {
        blocked: true,
        message:
          "China registry API not configured. Official registry verification cannot be automated yet.",
        configured,
        searchOrder,
        provider: null,
        status: "not_configured" as const,
        fieldsReturned: [] as string[],
        matchConfidence: null as string | null,
        error: !anyProvider
          ? "Neither QINCHECK_API_KEY nor PANDA360_API_KEY is set."
          : "CHINA_REGISTRY_ENABLED is not true.",
      };
    }

    const { retrieveChinaRegistryEvidence } = await import(
      "@/lib/investigation/sources/china-registry.server"
    );

    const result = await retrieveChinaRegistryEvidence({
      statedName: data.statedName,
      chineseName: data.chineseName?.trim() || null,
      country: "CN",
      website: data.website?.trim() || null,
      resolved: {
        matched: false,
        legal_name_en: data.englishName?.trim() || null,
        legal_name_local: data.chineseName?.trim() || null,
        registration_number: data.uscc?.trim() || null,
        confidence: "low",
        sources: [],
      } as any,
      extracted: [],
    }, env);

    return {
      blocked: false,
      message: null as string | null,
      configured,
      searchOrder,
      provider: result.provider,
      status: result.status,
      fieldsReturned: result.fieldsReturned,
      matchConfidence: result.resolvedPatch?.confidence ?? null,
      sourceUrl: result.sourceUrl,
      evidenceCount: result.evidenceCount,
      error: result.error ?? null,
    };
  });
