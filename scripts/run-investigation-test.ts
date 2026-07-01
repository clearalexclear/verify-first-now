import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runTestInvestigation } from "../src/lib/investigation/test-runner.server";

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

function arg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  loadDotEnv();
  const orderId = arg("--order-id");
  const caseId = arg("--case-id");
  const reason = arg("--reason") ?? "manual CLI investigation test";

  const result = await runTestInvestigation({ orderId, caseId, reason });
  console.log(JSON.stringify(result, null, 2));

  if (!result.report) {
    process.exitCode = 1;
    console.error("No report was generated. Check investigation_jobs.last_error and supplier_cases.investigation_error.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
