CREATE TABLE IF NOT EXISTS public.official_registry_verification_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.investigation_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  requested_search_terms text[] NOT NULL DEFAULT ARRAY[]::text[],
  reason text,
  evidence_fact_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS official_registry_verification_tasks_case_status_idx
  ON public.official_registry_verification_tasks(case_id, status);

CREATE INDEX IF NOT EXISTS official_registry_verification_tasks_case_idx
  ON public.official_registry_verification_tasks(case_id, updated_at DESC);

ALTER TABLE public.official_registry_verification_tasks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.official_registry_verification_tasks TO service_role;

INSERT INTO public.connectors (id, name, category, mode, enabled, required_env, source_url, raw_response_policy, notes)
VALUES
  ('official_browser_assisted', 'Official browser-assisted verification', 'corporate_registry', 'official_free', true, ARRAY[]::text[], null, 'metadata_only', 'Admin-assisted official/public China registry verification. Does not bypass CAPTCHAs and does not produce verified findings until analyst-cited or attached official evidence is saved.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  mode = EXCLUDED.mode,
  enabled = EXCLUDED.enabled,
  required_env = EXCLUDED.required_env,
  source_url = EXCLUDED.source_url,
  raw_response_policy = EXCLUDED.raw_response_policy,
  notes = EXCLUDED.notes,
  updated_at = now();
