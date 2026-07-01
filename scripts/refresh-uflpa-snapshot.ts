import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { refreshUflpaSnapshot } from "../src/lib/investigation/sources/uflpa.server";

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

refreshUflpaSnapshot()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
