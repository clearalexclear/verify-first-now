
-- ================================================================
-- VerifyFirst investigation foundation (idempotent)
-- ================================================================

DO $$ BEGIN
  CREATE TYPE public.evidence_classification AS ENUM (
    'VERIFIED','CORROBORATED','SUPPLIER_CLAIMED','INFERRED','NOT_INDEPENDENTLY_VERIFIED','CONTRADICTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  error_message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.investigation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  priority integer NOT NULL DEFAULT 100,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS investigation_jobs_claim_idx
  ON public.investigation_jobs (status, next_run_at, priority, created_at);

CREATE TABLE IF NOT EXISTS public.investigation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.investigation_jobs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  started_at timestamptz,
  completed_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  input_hash text,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, step_key)
);

CREATE TABLE IF NOT EXISTS public.connectors (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('mock','official_free','paid_disabled','paid_enabled')),
  enabled boolean NOT NULL DEFAULT false,
  required_env text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_url text,
  raw_response_policy text NOT NULL DEFAULT 'metadata_only' CHECK (raw_response_policy IN ('store_raw','metadata_only','do_not_store')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.connector_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id text NOT NULL REFERENCES public.connectors(id),
  case_id uuid REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.investigation_jobs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success','not_configured','not_found','rate_limited','error','skipped')),
  mode text NOT NULL CHECK (mode IN ('mock','official_free','paid_disabled','paid_enabled')),
  request_hash text,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  confidence text CHECK (confidence IN ('high','medium_high','medium','low')),
  source_url text,
  raw_response_path text,
  raw_response_storage_allowed boolean NOT NULL DEFAULT false,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_runs_case_idx ON public.connector_runs(case_id, connector_id, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS public.evidence_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  connector_run_id uuid REFERENCES public.connector_runs(id) ON DELETE SET NULL,
  evidence_item_id uuid REFERENCES public.evidence_items(id) ON DELETE SET NULL,
  finding_key text,
  fact_key text NOT NULL,
  fact_value jsonb,
  classification public.evidence_classification NOT NULL DEFAULT 'NOT_INDEPENDENTLY_VERIFIED',
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium_high','medium','low')),
  source_name text NOT NULL,
  source_url text,
  retrieval_date timestamptz NOT NULL DEFAULT now(),
  evidence_excerpt text,
  raw_response_path text,
  license_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_facts_case_idx ON public.evidence_facts(case_id, classification, retrieval_date DESC);

CREATE TABLE IF NOT EXISTS public.report_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  report_version_id uuid REFERENCES public.report_versions(id) ON DELETE SET NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('structured_json','html','pdf','email')),
  storage_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','delivered','failed')),
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  source_url text NOT NULL,
  snapshot_version text NOT NULL,
  publication_date date,
  retrieval_date timestamptz NOT NULL DEFAULT now(),
  checksum text NOT NULL,
  last_successful_refresh timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, snapshot_version, checksum)
);
CREATE INDEX IF NOT EXISTS source_snapshots_latest_idx
  ON public.source_snapshots(source_key, retrieval_date DESC);

ALTER TABLE public.evidence_items
  ADD COLUMN IF NOT EXISTS classification public.evidence_classification DEFAULT 'NOT_INDEPENDENTLY_VERIFIED',
  ADD COLUMN IF NOT EXISTS connector_run_id uuid REFERENCES public.connector_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence text CHECK (confidence IN ('high','medium_high','medium','low')),
  ADD COLUMN IF NOT EXISTS raw_response_path text,
  ADD COLUMN IF NOT EXISTS license_notes text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

INSERT INTO public.connectors (id, name, category, mode, enabled, required_env, source_url, raw_response_policy, notes)
VALUES
  ('qcc_corporate_registry', 'QCC International API', 'corporate_registry', 'paid_disabled', false, ARRAY['QCC_API_KEY'], 'https://www.qcc.com/', 'metadata_only', 'Preferred Chinese corporate registry provider; disabled until commercial credentials and permitted fields are confirmed.'),
  ('importgenius_shipments', 'ImportGenius API', 'shipment_data', 'paid_disabled', false, ARRAY['IMPORTGENIUS_API_KEY'], 'https://www.importgenius.com/', 'metadata_only', 'Preferred US shipment-data provider; disabled until licensed API credentials are supplied.'),
  ('iaf_certsearch', 'IAF CertSearch', 'certification', 'paid_disabled', false, ARRAY['IAF_CERTSEARCH_API_KEY'], 'https://www.iafcertsearch.org/', 'metadata_only', 'Management-system certificates only; not universal product-certificate verification.'),
  ('opensanctions_commercial', 'OpenSanctions Commercial API', 'sanctions', 'paid_disabled', false, ARRAY['OPENSANCTIONS_API_KEY'], 'https://www.opensanctions.org/', 'metadata_only', 'Credentialed/pay-as-you-go connector for commercial use.'),
  ('dhs_uflpa', 'DHS UFLPA Entity List', 'uflpa_forced_labour', 'official_free', true, ARRAY[]::text[], 'https://www.dhs.gov/uflpa-entity-list', 'store_raw', 'Official refreshable UFLPA source snapshot.'),
  ('cbp_forced_labor', 'CBP forced-labor public sources', 'uflpa_forced_labour', 'official_free', true, ARRAY[]::text[], 'https://www.cbp.gov/trade/forced-labor', 'metadata_only', 'Official CBP forced-labor public source coverage where technically accessible.'),
  ('cpsc_recalls', 'CPSC recalls', 'product_recalls', 'official_free', true, ARRAY[]::text[], 'https://www.saferproducts.gov/RestWebServices/', 'store_raw', 'Official US consumer product recall data.'),
  ('domain_rdap', 'Domain RDAP', 'domain_website', 'official_free', true, ARRAY[]::text[], 'https://rdap.org/', 'store_raw', 'Official/free RDAP domain registration checks.'),
  ('firecrawl_web_intelligence', 'Firecrawl web intelligence', 'general_web_research', 'paid_disabled', false, ARRAY['FIRECRAWL_API_KEY','LOVABLE_API_KEY'], 'https://www.firecrawl.dev/', 'metadata_only', 'Generic web intelligence only; cannot verify registry, shipment, certificate validity or litigation alone.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, mode = EXCLUDED.mode, enabled = EXCLUDED.enabled,
  required_env = EXCLUDED.required_env, source_url = EXCLUDED.source_url,
  raw_response_policy = EXCLUDED.raw_response_policy, notes = EXCLUDED.notes, updated_at = now();

-- Lockdown: only service_role (server-side) touches these tables.
-- Anon/authenticated get no privileges, so browser clients cannot see them.
GRANT ALL ON public.webhook_events        TO service_role;
GRANT ALL ON public.investigation_jobs    TO service_role;
GRANT ALL ON public.investigation_steps   TO service_role;
GRANT ALL ON public.connectors            TO service_role;
GRANT ALL ON public.connector_runs        TO service_role;
GRANT ALL ON public.evidence_facts        TO service_role;
GRANT ALL ON public.report_artifacts      TO service_role;
GRANT ALL ON public.source_snapshots      TO service_role;

ALTER TABLE public.webhook_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connectors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_facts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_artifacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_snapshots    ENABLE ROW LEVEL SECURITY;
