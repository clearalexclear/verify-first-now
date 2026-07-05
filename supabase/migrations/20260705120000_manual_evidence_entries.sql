-- Manual analyst evidence entries for canonical checklist fulfillment.
-- Uses evidence_facts so manual findings flow through the same verifier/report path
-- as provider-sourced evidence.

ALTER TABLE public.evidence_facts
  ADD COLUMN IF NOT EXISTS checklist_id text,
  ADD COLUMN IF NOT EXISTS source_citation text,
  ADD COLUMN IF NOT EXISTS attachment_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_entry_created_by uuid,
  ADD COLUMN IF NOT EXISTS retracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retracted_by uuid,
  ADD COLUMN IF NOT EXISTS retraction_reason text;

CREATE INDEX IF NOT EXISTS evidence_facts_manual_active_idx
  ON public.evidence_facts(case_id, checklist_id, retracted_at)
  WHERE source_name = 'manual_analyst_entry';

INSERT INTO public.connectors (id, name, category, mode, enabled, required_env, source_url, raw_response_policy, notes)
VALUES
  ('manual_analyst_entry', 'Analyst verification', 'manual_evidence', 'mock', true, ARRAY[]::text[], null, 'metadata_only', 'Manual analyst-entered evidence. Stored in evidence_facts and consumed through the same finding/checklist path as connector evidence.')
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
