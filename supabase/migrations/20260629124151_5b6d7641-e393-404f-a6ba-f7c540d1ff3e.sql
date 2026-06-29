
-- Add AI investigation status values
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'investigation_queued';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'investigating';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'investigation_failed';

-- Track extracted document content
ALTER TABLE public.case_documents
  ADD COLUMN IF NOT EXISTS extracted_data jsonb;

-- Track investigation lifecycle and resolved entity
ALTER TABLE public.supplier_cases
  ADD COLUMN IF NOT EXISTS resolved_entity jsonb,
  ADD COLUMN IF NOT EXISTS investigation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS investigation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS investigation_error text;

-- Public share token for the styled report page
ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS share_token text;
CREATE UNIQUE INDEX IF NOT EXISTS report_versions_share_token_unique
  ON public.report_versions (share_token)
  WHERE share_token IS NOT NULL;
