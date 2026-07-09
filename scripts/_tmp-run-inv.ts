import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
function loadDotEnv() {
  const p = resolve(".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p,"utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t||t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq<0) continue;
    const k = t.slice(0,eq).trim(); let v = t.slice(eq+1).trim();
    if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v = v.slice(1,-1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const db = supabaseAdmin as any;
const caseId = "2d9adba1-7762-4fb2-bd59-b236cd353128";
const { data: order, error } = await db.from("orders").select("id, order_reference, supplier_company_name, customer_email").eq("case_id", caseId).order("created_at",{ascending:false}).limit(1).maybeSingle();
if (error||!order) { console.error("no order", error); process.exit(1); }
console.log("order", order.id);

const { createTestInvestigationJobForOrder } = await import("@/lib/investigation/job-queue.server");
const { runInvestigationWorkerOnce } = await import("@/lib/investigation/worker.server");
const job = await createTestInvestigationJobForOrder({ orderId: order.id, caseId, reason: "PR#9 verification" });
console.log("job", job);
const worker = await runInvestigationWorkerOnce(`test-${crypto.randomUUID()}`, { deliver: false, allowRerun: true });
console.log("worker", JSON.stringify(worker, null, 2));

const { data: report } = await db.from("report_versions").select("id, share_token, finalised_at, snapshot").eq("case_id", caseId).order("version_number",{ascending:false}).limit(1).maybeSingle();
if (!report) { console.error("no report"); process.exit(1); }
const snap = report.snapshot;
console.log("REPORT_ID", report.id, "finalised", report.finalised_at);
console.log("outcome", snap.final_outcome, "risk", snap.overall_risk_rating);
console.log("disclaimer_present", JSON.stringify(snap).includes("Open-web registry intelligence"));
console.log("resolved_entity", JSON.stringify(snap.resolved_entity, null, 2));
console.log("critical_blockers", snap.critical_blockers);

const { data: runs } = await db.from("connector_runs").select("id, connector_id, status, confidence, retrieved_at, metadata, error_message").eq("case_id", caseId).order("retrieved_at",{ascending:false}).limit(20);
console.log("CONNECTOR_RUNS");
for (const r of runs||[]) console.log(" -", r.connector_id, r.status, r.confidence, r.error_message||"");

const { data: facts } = await db.from("evidence_facts").select("fact_key, classification, confidence, source_name, evidence_excerpt, fact_value").eq("case_id", caseId).order("created_at",{ascending:false}).limit(40);
console.log("EVIDENCE_FACTS (open-web only)");
for (const f of facts||[]) {
  if (!(f.source_name||"").toLowerCase().includes("open-web")) continue;
  console.log(" -", f.fact_key, f.classification, "|", (f.evidence_excerpt||"").slice(0,180));
  console.log("   value:", JSON.stringify(f.fact_value).slice(0,300));
}

console.log("CHECKLIST_SUMMARY");
const checklist = snap.checklist_results||[];
const bystatus: Record<string,number> = {};
for (const c of checklist) bystatus[c.status] = (bystatus[c.status]||0)+1;
console.log(bystatus);
console.log("CAUTION/FAIL items:");
for (const c of checklist) if (c.status==="CAUTION"||c.status==="FAIL") console.log(" -", c.id, c.status, c.evidence_classification, "|", (c.explanation||"").slice(0,180));
