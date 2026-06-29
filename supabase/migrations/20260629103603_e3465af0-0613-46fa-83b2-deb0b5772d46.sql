
CREATE TYPE public.app_role AS ENUM ('admin', 'analyst');
CREATE TYPE public.case_status AS ENUM (
  'new','information_required','research_in_progress','supplier_clarification_pending',
  'review_required','report_ready','delivered','cancelled'
);
CREATE TYPE public.check_status AS ENUM ('pass','caution','fail','not_verified','not_applicable');
CREATE TYPE public.confidence_level AS ENUM ('high','medium_high','medium','low');
CREATE TYPE public.risk_rating AS ENUM ('low','medium','high','critical');
CREATE TYPE public.final_outcome AS ENUM ('go','proceed_with_safeguards','pause_pending_clarification','no_go');
CREATE TYPE public.evidence_type AS ENUM (
  'screenshot','business_licence','certificate','registry_extract','court_record',
  'shipment_data','supplier_email','quotation','invoice','bank_instructions',
  'test_report','website_page','other'
);
CREATE TYPE public.response_status AS ENUM ('satisfactory','incomplete','contradictory','no_response');
CREATE TYPE public.activity_action AS ENUM (
  'case_created','analyst_assigned','status_changed','document_uploaded',
  'finding_modified','risk_rating_modified','report_generated','report_delivered',
  'outcome_set','evidence_added','communication_logged'
);
CREATE TYPE public.report_status AS ENUM ('draft','final','delivered');

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','analyst'))
$$;

CREATE POLICY "Staff read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "User reads own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "User updates own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admin manages profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Staff read roles" ON public.user_roles FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Admin manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, company)
);
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "Staff manage customers" ON public.customers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stated_name TEXT NOT NULL,
  registered_legal_name TEXT,
  cn_vn_legal_name TEXT,
  country TEXT NOT NULL,
  website TEXT,
  marketplace_url TEXT,
  contact_person TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "Staff manage suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS case_id UUID;

CREATE POLICY "Staff read orders" ON public.orders FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
GRANT SELECT ON public.orders TO authenticated;

CREATE SEQUENCE IF NOT EXISTS public.cases_ref_seq;

CREATE TABLE public.supplier_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference TEXT NOT NULL UNIQUE DEFAULT ('VFC-'||EXTRACT(year FROM now())::text||'-'||lpad(nextval('public.cases_ref_seq')::text,4,'0')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  product_category TEXT,
  destination_market TEXT,
  estimated_order_value TEXT,
  package TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  assigned_analyst UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status case_status NOT NULL DEFAULT 'new',
  overall_risk_rating risk_rating,
  suggested_outcome final_outcome,
  final_outcome final_outcome,
  completion_pct INT NOT NULL DEFAULT 0,
  customer_concerns TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_cases TO authenticated;
GRANT ALL ON public.supplier_cases TO service_role;
ALTER TABLE public.supplier_cases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON public.supplier_cases FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "Staff read cases" ON public.supplier_cases FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff insert cases" ON public.supplier_cases FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff update cases" ON public.supplier_cases FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Admin deletes cases" ON public.supplier_cases FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.orders
  ADD CONSTRAINT orders_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.supplier_cases(id) ON DELETE SET NULL;

CREATE TABLE public.check_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.check_sections TO authenticated;
GRANT ALL ON public.check_sections TO service_role;
ALTER TABLE public.check_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read sections" ON public.check_sections FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Admin manages sections" ON public.check_sections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.check_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.check_sections(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  guidance TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.check_templates TO authenticated;
GRANT ALL ON public.check_templates TO service_role;
ALTER TABLE public.check_templates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON public.check_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "Staff read templates" ON public.check_templates FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Admin manages templates" ON public.check_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.case_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.check_sections(id),
  template_id UUID REFERENCES public.check_templates(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  finding TEXT,
  status check_status,
  confidence confidence_level,
  evidence_summary TEXT,
  source_name TEXT,
  source_url TEXT,
  source_retrieval_date DATE,
  buyer_impact TEXT,
  recommended_action TEXT,
  internal_notes TEXT,
  include_in_report BOOLEAN NOT NULL DEFAULT false,
  reviewer_approved BOOLEAN NOT NULL DEFAULT false,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_checks TO authenticated;
GRANT ALL ON public.case_checks TO service_role;
ALTER TABLE public.case_checks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_case_checks_updated BEFORE UPDATE ON public.case_checks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_case_checks_case ON public.case_checks(case_id);
CREATE POLICY "Staff manage case_checks" ON public.case_checks FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT,
  url TEXT,
  note TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_documents TO authenticated;
GRANT ALL ON public.case_documents TO service_role;
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage case_documents" ON public.case_documents FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  check_id UUID REFERENCES public.case_checks(id) ON DELETE SET NULL,
  evidence_type evidence_type NOT NULL,
  title TEXT NOT NULL,
  storage_path TEXT,
  url TEXT,
  source TEXT,
  retrieval_date DATE,
  related_legal_entity TEXT,
  analyst_comments TEXT,
  client_visible BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_items TO authenticated;
GRANT ALL ON public.evidence_items TO service_role;
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_evidence_case ON public.evidence_items(case_id);
CREATE POLICY "Staff manage evidence" ON public.evidence_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.supplier_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  comm_date DATE NOT NULL DEFAULT CURRENT_DATE,
  question TEXT NOT NULL,
  response TEXT,
  documents_received TEXT,
  analyst_assessment TEXT,
  response_status response_status,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_communications TO authenticated;
GRANT ALL ON public.supplier_communications TO service_role;
ALTER TABLE public.supplier_communications ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_comms_updated BEFORE UPDATE ON public.supplier_communications FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "Staff manage comms" ON public.supplier_communications FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status report_status NOT NULL DEFAULT 'draft',
  overall_risk_rating risk_rating,
  final_outcome final_outcome,
  executive_summary TEXT,
  key_findings JSONB DEFAULT '[]'::jsonb,
  section_summaries JSONB DEFAULT '{}'::jsonb,
  buyer_implications TEXT,
  recommended_safeguards TEXT,
  payment_recommendation TEXT,
  inspection_recommendation TEXT,
  testing_recommendation TEXT,
  methodology TEXT,
  limitations TEXT,
  independence_statement TEXT,
  included_check_ids UUID[] DEFAULT '{}',
  snapshot JSONB,
  pdf_storage_path TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  finalised_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, version_number)
);
GRANT SELECT, INSERT, UPDATE ON public.report_versions TO authenticated;
GRANT ALL ON public.report_versions TO service_role;
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read reports" ON public.report_versions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff insert reports" ON public.report_versions FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff update draft reports" ON public.report_versions FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()) AND status = 'draft')
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.case_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.supplier_cases(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action activity_action NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.case_activity_log TO authenticated;
GRANT ALL ON public.case_activity_log TO service_role;
ALTER TABLE public.case_activity_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_case ON public.case_activity_log(case_id, created_at DESC);
CREATE POLICY "Staff read activity" ON public.case_activity_log FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff insert activity" ON public.case_activity_log FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff read case-documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-documents' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff write case-documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-documents' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff update case-documents" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'case-documents' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff delete case-documents" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-documents' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff read evidence" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'evidence' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff write evidence" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff update evidence" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'evidence' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff delete evidence" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff read reports bucket" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff write reports bucket" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports' AND public.is_staff(auth.uid()));

INSERT INTO public.check_sections (slug, name, display_order, description) VALUES
  ('identity','Supplier identity and entity matching',1,'Confirm the supplier is who they claim to be.'),
  ('legal','Legal registration and corporate status',2,'Verify legal existence and active status.'),
  ('ownership','Ownership and related companies',3,'Map ownership and affiliated entities.'),
  ('factory_vs_trader','Factory versus trading company determination',4,'Establish whether the supplier manufactures or resells.'),
  ('scale','Operating scale and capacity',5,'Assess production scale and resources.'),
  ('product_fit','Product-category fit',6,'Determine if the product category matches supplier expertise.'),
  ('export','Export and shipment history',7,'Check shipment records for the product category and destination.'),
  ('certs','Certification and document authenticity',8,'Verify certificates and documents are genuine and current.'),
  ('legal_disputes','Legal disputes and regulatory history',9,'Search for litigation, sanctions, or enforcement actions.'),
  ('sanctions','Sanctions, forced-labour and restricted-party screening',10,'Screen against sanctions and forced-labour lists.'),
  ('media','Adverse media and reputation',11,'Review media coverage and online reputation.'),
  ('digital','Digital and contact consistency',12,'Cross-check digital footprint and contact details.'),
  ('commercial','Commercial and payment-risk assessment',13,'Review payment terms, banking, and commercial risks.'),
  ('responsiveness','Supplier responsiveness and transparency',14,'Evaluate supplier cooperation during the investigation.'),
  ('final','Final assessment',15,'Overall conclusion and recommended outcome.');

WITH s AS (SELECT id, slug FROM public.check_sections)
INSERT INTO public.check_templates (section_id, question, display_order, is_critical)
SELECT s.id, q.question, q.ord, q.crit FROM s
JOIN LATERAL (VALUES
  ('identity','Does the stated company name match a single, identifiable legal entity?',1,true),
  ('identity','Are the Chinese/Vietnamese legal name and English name consistent across sources?',2,false),
  ('identity','Are the registered address and stated trading address consistent?',3,false),
  ('legal','Is the company currently active in the official business registry?',1,true),
  ('legal','When was the company incorporated and is its registered capital appropriate?',2,false),
  ('legal','Is the legal representative consistent across registry, website, and contracts?',3,false),
  ('ownership','Who are the ultimate beneficial owners?',1,false),
  ('ownership','Are there related or affiliated companies with overlapping ownership?',2,false),
  ('ownership','Does ownership match what the supplier disclosed?',3,false),
  ('factory_vs_trader','Does the supplier own or operate the production facility, or is it a trading company?',1,true),
  ('factory_vs_trader','If a trader, has the actual factory been disclosed and verified?',2,true),
  ('factory_vs_trader','Are the factory address and registry data internally consistent?',3,false),
  ('scale','What is the declared production capacity and is it credible?',1,false),
  ('scale','How many employees does the supplier claim, and does it match registry data?',2,false),
  ('scale','Is the registered floor area consistent with stated production scale?',3,false),
  ('product_fit','Is the product category within the supplier''s declared business scope?',1,false),
  ('product_fit','Does the supplier have demonstrable experience in this category?',2,false),
  ('product_fit','Are product references, samples, or portfolio items available?',3,false),
  ('export','Are there shipment records for the supplier exporting this product category?',1,false),
  ('export','Have shipments to the destination market been recorded?',2,false),
  ('export','Are export volumes consistent with the claimed scale?',3,false),
  ('certs','Are the certificates the supplier presented currently valid?',1,true),
  ('certs','Can each certificate be verified against the issuing body''s registry?',2,true),
  ('certs','Are the certificates issued to the supplier''s legal entity or to a third party?',3,true),
  ('legal_disputes','Are there court cases or judgments involving the supplier?',1,false),
  ('legal_disputes','Are there regulatory enforcement actions, fines, or recalls?',2,false),
  ('legal_disputes','Are there customs or import-control issues?',3,false),
  ('sanctions','Does the supplier appear on any sanctions list (OFAC, EU, UK, UN)?',1,true),
  ('sanctions','Is the supplier or its owners on a forced-labour or UFLPA-related list?',2,true),
  ('sanctions','Are there restricted-party flags via screening providers?',3,true),
  ('media','Is there adverse media coverage of the supplier or its principals?',1,false),
  ('media','What is the supplier''s online review/reputation profile?',2,false),
  ('media','Are there industry forum complaints or scam reports?',3,false),
  ('digital','Is the website domain registered to the supplier''s legal entity?',1,false),
  ('digital','Are the email domains and phone numbers consistent with the legal entity?',2,false),
  ('digital','Are marketplace storefront details consistent with the registered company?',3,false),
  ('commercial','Is the payment beneficiary the same legal entity as the supplier?',1,true),
  ('commercial','Are bank details from a bank in the supplier''s registered country?',2,true),
  ('commercial','Are payment terms reasonable and consistent with industry norms?',3,false),
  ('responsiveness','Did the supplier respond to verification questions within agreed timeframes?',1,false),
  ('responsiveness','Did the supplier provide requested documents without obstruction?',2,false),
  ('responsiveness','Were responses internally consistent and non-contradictory?',3,false),
  ('final','Are there any unresolved hard-stop findings?',1,true),
  ('final','What is the overall risk rating and recommended outcome?',2,false),
  ('final','What safeguards should the buyer require if proceeding?',3,false)
) AS q(slug, question, ord, crit) ON q.slug = s.slug;
