import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/investigate/$caseId")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          {
            ok: false,
            error:
              "Direct investigation triggering is disabled. Stripe-confirmed payments create durable jobs processed by the server-side worker.",
          },
          { status: 410 },
        ),
      GET: async () => new Response("POST only", { status: 405 }),
    },
  },
});
