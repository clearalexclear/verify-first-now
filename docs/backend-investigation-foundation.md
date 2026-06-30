# VerifyFirst backend investigation foundation

## Security model

- Browser order submission creates a pending order only.
- The browser cannot mark payment as confirmed.
- Investigations start only after a Stripe webhook with a valid signature is persisted and processed.
- Webhook events are stored in `webhook_events` with a unique `(provider, provider_event_id)` key for replay protection.
- The Stripe webhook creates an `investigation_jobs` row idempotently using `stripe-paid:{order_id}`.
- Durable workers claim queued jobs, lock them, run resumable steps, and retry with exponential backoff.

## Required environment variables

### Supabase

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Stripe

- `STRIPE_SECRET_KEY` - required when checkout/session creation is added.
- `STRIPE_WEBHOOK_SECRET` - required for `/api/stripe/webhook` signature verification.
- `STRIPE_PRICE_STANDARD`
- `STRIPE_PRICE_PRIORITY`
- `STRIPE_PRICE_ONSITE`

### Email and AI

- `LOVABLE_API_KEY`
- `RESEND_API_KEY`
- `PUBLIC_SITE_URL` or `VITE_PUBLIC_SITE_URL`

### Connector credentials

- `QCC_API_KEY` - preferred Chinese corporate registry connector, disabled until supplied.
- `IMPORTGENIUS_API_KEY` - preferred US shipment-data connector, disabled until supplied.
- `IAF_CERTSEARCH_API_KEY` - management-system certificate checks only, disabled until access/licensing is confirmed.
- `OPENSANCTIONS_API_KEY` - commercial/pay-as-you-go sanctions connector, disabled until supplied.
- `FIRECRAWL_API_KEY` - general web intelligence only; cannot independently verify registry, shipment, certificate validity or litigation.

## Connector policy

- `mock`: test-only connector mode.
- `official_free`: official/free source with no paid credential requirement.
- `paid_disabled`: preferred paid source, must return `not_configured` until credentials and licensing rules are supplied.
- `paid_enabled`: production paid source after credentials and licensing are configured.

Current paid-disabled connectors:

- QCC International API for Chinese corporate registry.
- ImportGenius API for US shipment history.
- IAF CertSearch for accredited management-system certificates only.
- OpenSanctions Commercial API for sanctions/restricted-party screening.

Official/free connectors:

- DHS UFLPA source snapshots, via `source_snapshots` with source URL, snapshot version, retrieval date, checksum, and last successful refresh.
- CPSC recalls API.
- RDAP domain checks.
- CBP forced-labour public sources where technically accessible.

## Evidence rules

- Every factual finding must cite stored `evidence_facts.id` values before final report generation.
- No evidence means `NOT_VERIFIED`.
- Generic search/web intelligence alone cannot verify corporate registration, shipment history, certificate validity, or litigation.
- A no-result response must not be converted into “no record exists.”
- Raw responses are preserved only where the connector's licensing policy permits it.

## Deployment steps

1. Apply Supabase migrations, including `20260629120000_investigation_foundation.sql`.
2. Ensure Storage buckets exist: `case-documents` and `reports`.
3. Configure Supabase service-role secrets server-side only.
4. Configure `STRIPE_WEBHOOK_SECRET` before enabling Stripe webhook processing.
5. Point Stripe webhook events to `/api/stripe/webhook` for `checkout.session.completed` and `payment_intent.succeeded`.
6. Run a server-side worker schedule that calls `runInvestigationWorkerOnce()` repeatedly, or wire it to the hosting platform's queue/cron mechanism.
7. Refresh DHS UFLPA snapshots before production screening and monitor `source_snapshots.last_successful_refresh`.
8. Add paid connector credentials only after vendor contracts confirm API access and raw-response storage rights.

## Remaining vendor decisions

- QCC International API contract, fields, rate limits, storage/license terms.
- ImportGenius API contract, shipment coverage, rate limits, storage/license terms.
- IAF CertSearch API access and management-system certificate scope.
- OpenSanctions commercial plan and usage terms.
- Firecrawl usage limits and whether snippets may be retained.
- CBP forced-labour source coverage beyond UFLPA entity list.
