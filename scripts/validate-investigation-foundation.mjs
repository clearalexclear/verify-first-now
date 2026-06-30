import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path = ".env") {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return;
  const text = readFileSync(fullPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env var(s): ${missing.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const requiredTables = [
  "orders",
  "supplier_cases",
  "investigation_jobs",
  "investigation_steps",
  "connectors",
  "connector_runs",
  "evidence_facts",
  "report_artifacts",
  "webhook_events",
  "source_snapshots",
];

const requiredConnectors = [
  "qcc_corporate_registry",
  "importgenius_shipments",
  "iaf_certsearch",
  "opensanctions_commercial",
  "dhs_uflpa",
  "cbp_forced_labor",
  "cpsc_recalls",
  "domain_rdap",
  "firecrawl_web_intelligence",
];

const summary = { tables: {}, connectors: {}, preservedData: {} };

for (const table of requiredTables) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.error(`Missing or inaccessible table ${table}: ${error.message}`);
    process.exit(1);
  }
  summary.tables[table] = count ?? 0;
}

for (const table of ["orders", "supplier_cases"]) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.error(`Could not count preserved ${table}: ${error.message}`);
    process.exit(1);
  }
  summary.preservedData[table] = count ?? 0;
}

const { data: connectors, error: connectorsError } = await supabase
  .from("connectors")
  .select("id, mode, enabled")
  .in("id", requiredConnectors);
if (connectorsError) {
  console.error(`Could not read connector seed rows: ${connectorsError.message}`);
  process.exit(1);
}

for (const id of requiredConnectors) {
  const row = connectors.find((connector) => connector.id === id);
  if (!row) {
    console.error(`Missing connector seed row: ${id}`);
    process.exit(1);
  }
  summary.connectors[id] = { mode: row.mode, enabled: row.enabled };
}

console.log(JSON.stringify(summary, null, 2));
