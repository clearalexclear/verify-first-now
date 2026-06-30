# Investigation Test Runbook

This phase tests automated supplier investigation and report generation without Stripe.

## 1. Configure Environment

Create `.env` from `.env.example` and fill only the values needed for this phase:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOVABLE_API_KEY`
- `FIRECRAWL_API_KEY`
- `PUBLIC_SITE_URL`
- `VITE_PUBLIC_SITE_URL`
- `VERIFYFIRST_ENABLE_TEST_INVESTIGATION=true`

Do not configure Stripe for this phase.

## 2. Apply The Migration

Apply `supabase/migrations/20260629120000_investigation_foundation.sql` through your normal Supabase migration process, for example:

```bash
supabase db push
```

If you do not use the Supabase CLI, paste the migration SQL into the Supabase SQL editor and run it against the target project.

## 3. Validate Schema And Preserved Data

Run:

```bash
npm run supabase:validate-investigation
```

The command checks that the investigation tables exist, required connector seed rows exist, and existing `orders` and `supplier_cases` remain countable. It prints counts so you can compare them with pre-migration expectations.

## 4. Refresh Official UFLPA Snapshot

The UFLPA checker needs a stored source snapshot. Run the snapshot refresh from a trusted server-side shell before the first test. The investigation report treats a missing snapshot as `NOT_VERIFIED`, never as a pass.

## 5. Run Jiangmen Changwen Test

Find the existing Jiangmen Changwen `case_id` or `order_id` in Supabase, then run one of:

```bash
npm run investigation:test -- --case-id <existing-case-uuid> --reason "Jiangmen Changwen first real test"
```

```bash
npm run investigation:test -- --order-id <existing-order-uuid> --reason "Jiangmen Changwen first real test"
```

The command is server-side only, requires `VERIFYFIRST_ENABLE_TEST_INVESTIGATION=true`, and does not expose any public browser route. In production it also requires `VERIFYFIRST_ALLOW_PRODUCTION_TEST_INVESTIGATION=true` for a controlled manual run.

## 6. Report Output

The command does not email the customer. It stores review artifacts in the `reports` bucket:

- Structured JSON: `cases/<case_id>/<report_version_id>.json`
- PDF: `cases/<case_id>/<report_version_id>.pdf`

It also writes `report_versions`, `report_artifacts`, `evidence_facts`, `connector_runs`, and `case_activity_log` rows.

## 7. Expected Weak Sections Until Paid Connectors Are Enabled

The following sections remain weak or `NOT_VERIFIED` without paid data access:

- Chinese legal entity registration and official registry status without QCC International API.
- Shareholders, registered capital, legal representative, and registered address without QCC.
- US shipment/export history without ImportGenius.
- Accredited management-system certificate validation without IAF CertSearch access.
- Sanctions/restricted-party screening without commercial OpenSanctions credentials.

Generic Firecrawl/web search may contribute `INFERRED` web-intelligence signals only. It cannot independently verify corporate registration, shipment history, certificate validity, or litigation.
