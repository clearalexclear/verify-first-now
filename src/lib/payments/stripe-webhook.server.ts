import { createInvestigationJobForOrder } from "@/lib/investigation/job-queue.server";

export interface StripeWebhookResult {
  ok: boolean;
  replay?: boolean;
  ignored?: boolean;
  eventId?: string;
  jobId?: string;
  error?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return { timestamp, signatures };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string, toleranceSeconds = 300) {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((sig) => timingSafeEqual(expected, sig.toLowerCase()));
}

function extractOrderId(event: any): string | null {
  const object = event?.data?.object ?? {};
  return (
    object?.metadata?.order_id ??
    object?.metadata?.verifyfirst_order_id ??
    object?.client_reference_id ??
    null
  );
}

function extractPaymentIds(event: any) {
  const object = event?.data?.object ?? {};
  return {
    checkoutSessionId: event?.type === "checkout.session.completed" ? object?.id ?? null : null,
    paymentIntentId:
      typeof object?.payment_intent === "string"
        ? object.payment_intent
        : object?.payment_intent?.id ?? (event?.type === "payment_intent.succeeded" ? object?.id ?? null : null),
  };
}

function isConfirmedPayment(event: any): boolean {
  if (event?.type === "checkout.session.completed") {
    const object = event?.data?.object ?? {};
    return object.payment_status === "paid" || object.status === "complete";
  }
  return event?.type === "payment_intent.succeeded";
}

export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<StripeWebhookResult> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: "STRIPE_WEBHOOK_SECRET missing" };
  if (!signatureHeader) return { ok: false, error: "Missing Stripe signature" };

  const valid = await verifyStripeSignature(rawBody, signatureHeader, secret);
  if (!valid) return { ok: false, error: "Invalid Stripe signature" };

  const event = JSON.parse(rawBody);
  const eventId = event.id as string | undefined;
  if (!eventId) return { ok: false, error: "Stripe event missing id" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { error: insertError } = await db.from("webhook_events").insert({
    provider: "stripe",
    provider_event_id: eventId,
    event_type: event.type ?? "unknown",
    signature_valid: true,
    processing_status: "received",
    payload: event,
  });

  if (insertError) {
    if (String(insertError.code) === "23505" || /duplicate/i.test(insertError.message ?? "")) {
      return { ok: true, replay: true, eventId };
    }
    return { ok: false, eventId, error: insertError.message };
  }

  if (!isConfirmedPayment(event)) {
    await db
      .from("webhook_events")
      .update({ processing_status: "ignored", processed_at: new Date().toISOString() })
      .eq("provider", "stripe")
      .eq("provider_event_id", eventId);
    return { ok: true, ignored: true, eventId };
  }

  const orderId = extractOrderId(event);
  if (!orderId) {
    const error = "Confirmed Stripe event did not include order id metadata";
    await db
      .from("webhook_events")
      .update({ processing_status: "failed", processed_at: new Date().toISOString(), error_message: error })
      .eq("provider", "stripe")
      .eq("provider_event_id", eventId);
    return { ok: false, eventId, error };
  }

  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id, case_id, payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order?.case_id) {
    const error = orderError?.message ?? "Order or case not found";
    await db
      .from("webhook_events")
      .update({ processing_status: "failed", processed_at: new Date().toISOString(), error_message: error })
      .eq("provider", "stripe")
      .eq("provider_event_id", eventId);
    return { ok: false, eventId, error };
  }

  const paymentIds = extractPaymentIds(event);
  await db
    .from("orders")
    .update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: paymentIds.checkoutSessionId,
      stripe_payment_intent_id: paymentIds.paymentIntentId,
    })
    .eq("id", order.id);

  const { jobId } = await createInvestigationJobForOrder({
    orderId: order.id,
    caseId: order.case_id,
    sourceEventId: eventId,
  });

  await db
    .from("webhook_events")
    .update({ processing_status: "processed", processed_at: new Date().toISOString() })
    .eq("provider", "stripe")
    .eq("provider_event_id", eventId);

  return { ok: true, eventId, jobId };
}
