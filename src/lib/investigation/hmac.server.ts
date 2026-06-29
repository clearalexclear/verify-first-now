// HMAC verifier shared by the investigation trigger route and the
// orders.functions.ts kick-off helper. Kept in a *.server.ts file so it
// never ships to the browser bundle.

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

export async function signCaseId(caseId: string): Promise<string> {
  const secret = process.env.INVESTIGATION_HMAC_SECRET;
  if (!secret) throw new Error("INVESTIGATION_HMAC_SECRET missing");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(caseId));
  return toHex(sig);
}

export async function verifyCaseSignature(caseId: string, signature: string): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = await signCaseId(caseId);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}
