
CREATE SEQUENCE IF NOT EXISTS public.orders_ref_seq START 1001;

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT UNIQUE NOT NULL DEFAULT ('VF-' || EXTRACT(YEAR FROM now())::text || '-' || lpad(nextval('public.orders_ref_seq')::text, 4, '0')),
  tier_selected TEXT NOT NULL,
  supplier_company_name TEXT NOT NULL,
  supplier_country TEXT NOT NULL,
  destination_market TEXT NOT NULL,
  website_marketplace_url TEXT NOT NULL,
  supplier_contact_person TEXT,
  product_category TEXT NOT NULL,
  certificates_info TEXT,
  concerns_text TEXT,
  customer_name TEXT NOT NULL,
  customer_company TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  estimated_order_value TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.orders TO service_role;
GRANT USAGE ON SEQUENCE public.orders_ref_seq TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: all writes go through service-role server function.
-- Deny-all by default (no policies = no access for non-service roles).
