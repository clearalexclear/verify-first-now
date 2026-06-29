// Public, HMAC-protected route that triggers the AI investigation pipeline.
// Called once from the success page, but safe to call multiple times
// (the pipeline rejects re-entry when status is already 'investigating' or
// the case is already delivered).

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/investigate/$caseId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const sig = request.headers.get("x-investigation-signature") ?? "";
        const { verifyCaseSignature } = await import("@/lib/investigation/hmac.server");
        const ok = await verifyCaseSignature(params.caseId, sig);
        if (!ok) return new Response("invalid signature", { status: 401 });

        // Pipeline is long; the worker may keep this request alive for the
        // full run. The browser can disconnect — the status route polls.
        const { runInvestigation } = await import("@/lib/investigation/pipeline.server");
        try {
          const result = await runInvestigation(params.caseId);
          return Response.json(result);
        } catch (e) {
          console.error("[investigate] crash:", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () => new Response("POST only", { status: 405 }),
    },
  },
});
