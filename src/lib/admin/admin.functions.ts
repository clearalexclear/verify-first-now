// All admin server functions. Every handler requires staff role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { packageDeadlineHours } from "./constants";

// ---- helpers ----
async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error("Role lookup failed");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("analyst")) {
    throw new Error("Forbidden: staff role required");
  }
  return roles as ("admin" | "analyst")[];
}

async function assertAdmin(supabase: any, userId: string) {
  const roles = await assertStaff(supabase, userId);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin role required");
}

async function logActivity(
  supabase: any,
  caseId: string,
  actorId: string,
  action: string,
  payload?: any,
) {
  await supabase.from("case_activity_log").insert({
    case_id: caseId, actor_id: actorId, action, payload: payload ?? null,
  });
}

// ============================================================
// CASES
// ============================================================

export const listCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data, error } = await supabase
      .from("supplier_cases")
      .select(`
        id, case_reference, status, package, deadline, completion_pct,
        overall_risk_rating, product_category, estimated_order_value, assigned_analyst,
        created_at,
        customer:customers(id, full_name, company, email),
        supplier:suppliers(id, stated_name, country)
      `)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // attach analyst names
    const analystIds = Array.from(new Set((data ?? []).map((c: any) => c.assigned_analyst).filter(Boolean)));
    let analystMap: Record<string, string> = {};
    if (analystIds.length) {
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name, email").in("id", analystIds);
      analystMap = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name || p.email]));
    }
    return (data ?? []).map((c: any) => ({
      ...c,
      analyst_name: c.assigned_analyst ? analystMap[c.assigned_analyst] ?? null : null,
    }));
  });

export const getCase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);

    const { data: caseRow, error } = await supabase
      .from("supplier_cases")
      .select(`
        *,
        customer:customers(*),
        supplier:suppliers(*),
        order:orders(*)
      `)
      .eq("id", data.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!caseRow) throw new Error("Case not found");

    const [sectionsRes, checksRes, evidenceRes, commsRes, docsRes, reportsRes, activityRes, rolesRes] = await Promise.all([
      supabase.from("check_sections").select("*").order("display_order"),
      supabase.from("case_checks").select("*").eq("case_id", data.caseId).order("display_order"),
      supabase.from("evidence_items").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
      supabase.from("supplier_communications").select("*").eq("case_id", data.caseId).order("comm_date", { ascending: false }),
      supabase.from("case_documents").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
      supabase.from("report_versions").select("*").eq("case_id", data.caseId).order("version_number", { ascending: false }),
      supabase.from("case_activity_log").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }).limit(100),
      supabase.from("user_roles").select("user_id, role").in("role", ["analyst", "admin"]),
    ]);

    const staffIds = Array.from(new Set((rolesRes.data ?? []).map((r: any) => r.user_id)));
    const { data: analystsProfiles } = staffIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", staffIds)
      : { data: [] as any[] };


    let analystName: string | null = null;
    if (caseRow.assigned_analyst) {
      const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", caseRow.assigned_analyst).maybeSingle();
      analystName = p ? p.full_name || p.email : null;
    }

    return {
      caseRow: { ...caseRow, analyst_name: analystName },
      sections: sectionsRes.data ?? [],
      checks: checksRes.data ?? [],
      evidence: evidenceRes.data ?? [],
      communications: commsRes.data ?? [],
      documents: docsRes.data ?? [],
      reports: reportsRes.data ?? [],
      activity: activityRes.data ?? [],
      analysts: (analystsRes.data ?? []).map((r: any) => r.profile).filter(Boolean),
    };
  });

export const updateCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    caseId: z.string().uuid(),
    patch: z.object({
      status: z.string().optional(),
      assigned_analyst: z.string().uuid().nullable().optional(),
      overall_risk_rating: z.string().nullable().optional(),
      suggested_outcome: z.string().nullable().optional(),
      final_outcome: z.string().nullable().optional(),
      deadline: z.string().nullable().optional(),
      package: z.string().optional(),
      completion_pct: z.number().int().min(0).max(100).optional(),
      customer_concerns: z.string().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const roles = await assertStaff(supabase, userId);
    const patch: Record<string, any> = { ...data.patch };

    // Setting final_outcome requires admin
    if ("final_outcome" in patch && patch.final_outcome) {
      if (!roles.includes("admin") && !roles.includes("analyst")) {
        throw new Error("Forbidden");
      }
    }

    const { data: before } = await supabase.from("supplier_cases").select("*").eq("id", data.caseId).maybeSingle();
    if (!before) throw new Error("Case not found");

    const { error } = await supabase.from("supplier_cases").update(patch).eq("id", data.caseId);
    if (error) throw new Error(error.message);

    if (patch.status && patch.status !== before.status) {
      await logActivity(supabase, data.caseId, userId, "status_changed", { from: before.status, to: patch.status });
    }
    if ("assigned_analyst" in patch && patch.assigned_analyst !== before.assigned_analyst) {
      await logActivity(supabase, data.caseId, userId, "analyst_assigned", { to: patch.assigned_analyst });
    }
    if ("overall_risk_rating" in patch && patch.overall_risk_rating !== before.overall_risk_rating) {
      await logActivity(supabase, data.caseId, userId, "risk_rating_modified", { to: patch.overall_risk_rating });
    }
    if ("final_outcome" in patch && patch.final_outcome !== before.final_outcome) {
      await logActivity(supabase, data.caseId, userId, "outcome_set", { to: patch.final_outcome });
    }

    return { ok: true };
  });

// ============================================================
// CASE CHECKS
// ============================================================

export const updateCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    checkId: z.string().uuid(),
    patch: z.object({
      finding: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      confidence: z.string().nullable().optional(),
      evidence_summary: z.string().nullable().optional(),
      source_name: z.string().nullable().optional(),
      source_url: z.string().nullable().optional(),
      source_retrieval_date: z.string().nullable().optional(),
      buyer_impact: z.string().nullable().optional(),
      recommended_action: z.string().nullable().optional(),
      internal_notes: z.string().nullable().optional(),
      include_in_report: z.boolean().optional(),
      reviewer_approved: z.boolean().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data: row, error } = await supabase
      .from("case_checks").update(data.patch).eq("id", data.checkId)
      .select("case_id, question").single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, row.case_id, userId, "finding_modified", { question: row.question, patch: data.patch });
    return { ok: true };
  });

// ============================================================
// EVIDENCE
// ============================================================

export const addEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    case_id: z.string().uuid(),
    check_id: z.string().uuid().nullable().optional(),
    evidence_type: z.string(),
    title: z.string().min(1),
    url: z.string().nullable().optional(),
    storage_path: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    retrieval_date: z.string().nullable().optional(),
    related_legal_entity: z.string().nullable().optional(),
    analyst_comments: z.string().nullable().optional(),
    client_visible: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { error } = await supabase.from("evidence_items").insert({ ...data, uploaded_by: userId });
    if (error) throw new Error(error.message);
    await logActivity(supabase, data.case_id, userId, "evidence_added", { title: data.title, type: data.evidence_type });
    return { ok: true };
  });

export const deleteEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { error } = await supabase.from("evidence_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// COMMUNICATIONS
// ============================================================

export const addCommunication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    case_id: z.string().uuid(),
    comm_date: z.string().optional(),
    question: z.string().min(1),
    response: z.string().nullable().optional(),
    documents_received: z.string().nullable().optional(),
    analyst_assessment: z.string().nullable().optional(),
    response_status: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { error } = await supabase.from("supplier_communications").insert({ ...data, created_by: userId });
    if (error) throw new Error(error.message);
    await logActivity(supabase, data.case_id, userId, "communication_logged", { question: data.question });
    return { ok: true };
  });

// ============================================================
// REPORTS (versioned, immutable once finalised)
// ============================================================

export const createReportDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ case_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data: existing } = await supabase
      .from("report_versions").select("version_number").eq("case_id", data.case_id)
      .order("version_number", { ascending: false }).limit(1);
    const next = ((existing?.[0]?.version_number ?? 0) as number) + 1;
    const { data: row, error } = await supabase.from("report_versions").insert({
      case_id: data.case_id, version_number: next, status: "draft", created_by: userId,
    }).select().single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, data.case_id, userId, "report_generated", { version: next });
    return row;
  });

export const updateReportDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    patch: z.record(z.string(), z.any()),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    // RLS prevents updating non-draft
    const { error } = await supabase.from("report_versions").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const finaliseReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data: row, error } = await supabase.from("report_versions")
      .update({ status: "final", finalised_at: new Date().toISOString() })
      .eq("id", data.id).select("case_id, version_number").single();
    if (error) throw new Error(error.message);
    await supabase.from("supplier_cases").update({ status: "report_ready" }).eq("id", row.case_id);
    await logActivity(supabase, row.case_id, userId, "report_generated", { finalised_version: row.version_number });
    return { ok: true };
  });

export const markReportDelivered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    // need to allow updating delivered_at on a final report — use admin
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("report_versions")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", data.id).select("case_id, version_number").single();
    if (error) throw new Error(error.message);
    await supabase.from("supplier_cases").update({ status: "delivered" }).eq("id", row.case_id);
    await logActivity(supabase, row.case_id, userId, "report_delivered", { version: row.version_number });
    return { ok: true };
  });

// ============================================================
// TEMPLATES (admin only)
// ============================================================

export const listTemplatesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const [sections, templates] = await Promise.all([
      supabase.from("check_sections").select("*").order("display_order"),
      supabase.from("check_templates").select("*").order("display_order"),
    ]);
    return { sections: sections.data ?? [], templates: templates.data ?? [] };
  });

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    section_id: z.string().uuid(),
    question: z.string().min(1),
    guidance: z.string().nullable().optional(),
    display_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    is_critical: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    if (data.id) {
      const { error } = await supabase.from("check_templates").update(data).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("check_templates").insert(data);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("check_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// USERS / ROLES (admin only)
// ============================================================

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const rolesByUser: Record<string, string[]> = {};
    for (const r of roles ?? []) {
      (rolesByUser[r.user_id] ||= []).push(r.role);
    }
    return (profiles ?? []).map((p: any) => ({ ...p, roles: rolesByUser[p.id] ?? [] }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    user_id: z.string().uuid(),
    role: z.enum(["admin", "analyst"]),
    grant: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    if (data.grant) {
      const { error } = await supabase.from("user_roles").insert({ user_id: data.user_id, role: data.role });
      if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").delete()
        .eq("user_id", data.user_id).eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ============================================================
// CURRENT USER + BOOTSTRAP
// ============================================================

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (data ?? []).map((r: any) => r.role) as string[];
    return {
      userId,
      email: claims?.email ?? null,
      roles,
      isStaff: roles.includes("admin") || roles.includes("analyst"),
      isAdmin: roles.includes("admin"),
    };
  });

// Bootstrap: if no admin exists, grant the calling user admin.
// Safe — once an admin exists, this is a no-op for everyone else.
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) > 0) {
      return { ok: false, reason: "An admin already exists." };
    }
    await supabaseAdmin.from("user_roles").insert([
      { user_id: userId, role: "admin" },
      { user_id: userId, role: "analyst" },
    ]);
    return { ok: true };
  });

export { packageDeadlineHours };
