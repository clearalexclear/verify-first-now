import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("stripe-signature");
        const { handleStripeWebhook } = await import("@/lib/payments/stripe-webhook.server");
        const result = await handleStripeWebhook(rawBody, signature);
        if (!result.ok) return Response.json(result, { status: 400 });
        return Response.json(result);
      },
      GET: async () => new Response("POST only", { status: 405 }),
    },
  },
});
