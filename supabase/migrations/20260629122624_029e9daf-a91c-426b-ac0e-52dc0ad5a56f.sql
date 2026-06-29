-- Add new statuses for email-delivered flow
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'payment_pending';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'awaiting_documents';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'ready_for_research';

-- Add fields to supplier_cases for the simplified flow
ALTER TABLE public.supplier_cases
  ADD COLUMN IF NOT EXISTS upload_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS supplier_chinese_name TEXT,
  ADD COLUMN IF NOT EXISTS product_description TEXT;

CREATE INDEX IF NOT EXISTS supplier_cases_upload_token_idx ON public.supplier_cases(upload_token);
