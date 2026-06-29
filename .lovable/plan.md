## VerifyFirst Internal Case Management — Build Plan

A protected `/admin` workspace for analysts and admins to manage supplier verification cases generated from the public order form, with full investigation workflow, evidence handling, and versioned reports.

---

### 1. Auth & Roles

- Enable Supabase email/password auth (no signup from UI — admins invite/create users; signup disabled).
- `app_role` enum: `admin`, `analyst`.
- `user_roles` table (separate from profiles) + `has_role(uuid, app_role)` security-definer function.
- `profiles` table (id → auth.users, full_name, email).
- Protected route subtree: `src/routes/_authenticated/admin/*` using the integration-managed `_authenticated` gate.
- `/auth` public page for sign-in. Server-side role checks in every protected server fn via `requireSupabaseAuth` + `has_role`.

### 2. Database schema (one migration)

Tables (all with RLS + GRANTs, timestamps, update triggers):

- `profiles` — user profile data
- `user_roles` — role assignments
- `customers` — derived from order form (name, company, email)
- `orders` — extends existing table OR new; link to customer + case
- `suppliers` — supplier master (stated_name, registered_legal_name, cn_vn_legal_name, country, website, marketplace_url, contact)
- `supplier_cases` — main case entity; FKs to customer, supplier, order; package, deadline, assigned_analyst, status enum, overall_risk_rating enum, final_outcome enum, completion_pct, suggested_outcome
- `check_sections` — 15 fixed investigation sections (seeded)
- `check_templates` — reusable question templates per section (active flag, order)
- `case_checks` — per-case copy of template at case creation; finding, status enum, confidence enum, evidence_summary, source_name/url/date, buyer_impact, recommended_action, internal_notes, include_in_report, reviewer_approved
- `case_documents` — uploaded customer docs at intake
- `evidence_items` — storage_path or url, evidence_type enum, source, retrieval_date, related_entity, related_check_id, comments, client_visible
- `supplier_communications` — date, question, response, docs_received, analyst_assessment, response_status enum
- `report_versions` — case_id, version_number, status (draft/final/delivered), overall_risk_rating, executive_summary, key_findings (jsonb), section_summaries (jsonb), buyer_implications, recommended_safeguards, payment_recommendation, inspection_recommendation, testing_recommendation, methodology, limitations, independence_statement, generated_pdf_path, created_by, created_at
- `case_activity_log` — case_id, actor_id, action enum, payload jsonb, created_at

Enums: `case_status`, `check_status` (PASS/CAUTION/FAIL/NOT_VERIFIED/NOT_APPLICABLE), `confidence_level`, `risk_rating`, `final_outcome`, `evidence_type`, `response_status`, `activity_action`, `app_role`.

Storage buckets: `case-documents` (private), `evidence` (private), `reports` (private).

RLS: only authenticated admins/analysts can read; admins can write everything; analysts can write to cases they're assigned to OR any case (configurable — default: any analyst can edit any case but only admin can delete/finalize outcomes).

### 3. Public order integration

When a customer submits the existing order form (`src/lib/orders.functions.ts`):

- Upsert customer
- Insert supplier (stated_name from form)
- Insert order
- Insert supplier_case with status `New`, deadline computed from tier
- Copy all `check_templates WHERE is_active` into `case_checks` for this case
- Log `case_created` activity

All inside the existing server fn using `supabaseAdmin` (already does this for orders).

### 4. Admin UI

Routes (all under `_authenticated/admin/`):

- `/admin` — dashboard table of cases with filters (status, analyst, deadline range, country, risk rating), sortable columns, search by Case ID/customer/supplier
- `/admin/cases/$caseId` — case detail with tabs:
  - **Overview** — all header fields, editable
  - **Investigation** — 15 sections (accordion), each lists `case_checks` with inline editing for finding/status/confidence/etc., evidence drawer
  - **Evidence** — all evidence items for the case, upload form
  - **Communications** — supplier comms log
  - **Risk summary** — live counts, hard-stop warnings, suggested outcome, final outcome selector (gated to admin/analyst), completion %
  - **Report** — report builder, version list, preview, PDF generation, deliver
  - **Activity** — activity log timeline
- `/admin/templates` — admin-only management of `check_sections` + `check_templates`
- `/admin/users` — admin-only role management

Sticky top header with VerifyFirst branding (navy), sidebar nav, breadcrumbs.

### 5. Risk engine (client-side derivation)

Pure function takes `case_checks[]` → `{ pass, caution, fail, not_verified, completion_pct, hard_stops[], suggested_outcome }`.

Hard-stop rules per spec. Missing finding ≠ PASS. Suggested outcome:
- Any hard-stop → `NO_GO`
- Any FAIL → `PAUSE_PENDING_CLARIFICATION`
- Any CAUTION or NOT_VERIFIED on critical sections → `PROCEED_WITH_SAFEGUARDS`
- Else → `GO`

### 6. Report builder

Form-driven; on "Create version" snapshots a `report_versions` row. PDF generation reuses existing print CSS from `sample-report.tsx` against a server-rendered (or window.print) report view. Past versions immutable. "Mark delivered" updates case status to `Delivered` + activity log.

### 7. Design system

- Reuse existing tokens (navy `--primary`, green `--success`, amber `--warning`, red `--danger`).
- Status badges via `RiskBadge` pattern + new `CaseStatusBadge`, `ConfidenceBadge`.
- Inter typography (already loaded).
- Tables: shadcn `Table` with sticky header.
- No decorative imagery in admin area — dense, information-first layout.

---

### Technical notes

- **Server functions** under `src/lib/admin/*.functions.ts` with `requireSupabaseAuth` middleware + `has_role` check at the top of every handler.
- **Default order tiers → deadline**: Basic 5d, Standard 3d, Premium 24h (configurable later).
- **Activity log** written from inside each mutating server fn — single helper `logActivity(supabase, { case_id, action, payload })`.
- **PDF**: first version uses browser print of `/admin/cases/$id/report/$versionId/print` (no extra deps). Upload to `reports` bucket on "finalize".
- **Seed data**: migration inserts 15 sections and a starter set of 3-5 template questions per section so the first case has something to work with.
- **No external data automation** — all findings entered manually by analysts, per spec.

### Out of scope (this iteration)

- Automated OSINT / sanctions API integration
- Email notifications to customers
- In-app chat
- Analytics dashboards beyond the case table
- Multi-tenancy

### Build order

1. Migration (schema + enums + RLS + seed sections/templates) → wait for approval
2. Auth pages + role middleware + admin shell layout
3. Patch order server fn to create case + copy templates
4. Dashboard + filters
5. Case detail (overview, investigation, evidence, comms)
6. Risk engine + summary panel
7. Report builder + versioning + PDF
8. Templates admin + users admin + activity log view

This is a large build — I'll ship it in sequential turns starting with the migration once you approve this plan.