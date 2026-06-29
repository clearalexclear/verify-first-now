# AI investigation pipeline

## What we're building

After Stripe (stubbed for now) confirms payment, the system automatically runs a research-and-reasoning pipeline, generates a sourced report, and emails the customer both a PDF attachment and a signed link to the styled report page. No accounts, no dashboards.

## Prerequisite the user will need to approve

**Link Firecrawl connector** (one form click). It provides web search, page scrape, and (optional) JSON extraction with one connection key. Without it, the AI agent has no eyes on the public web. I'll trigger the connect dialog as the first step.

If a Firecrawl connection already exists in the workspace, I'll reuse it.

## Customer flow (rewritten)

1. `/order` — same form, refined to spec:
   - Required: supplier name, country (China/Vietnam), URL, product category, destination, order value, customer name/company/email.
   - Optional: Chinese/Vietnamese legal name, supplier contact, customer concerns.
   - **Document upload moved inline into the form**, max 3 files, ≤10 MB each, PDF/JPG/JPEG/PNG only. Each file has a category dropdown: business licence · certificate/test report · quotation/payment instructions.
   - "Documents are optional. We can start without them."
2. Step 3 = stub payment (as today). On click:
   - Order + `supplier_case` created with `status = investigation_queued`.
   - Files uploaded into private bucket `case-documents`.
   - **Customer confirmation email** sent immediately with spec text: "Your VerifyFirst investigation has started…"
   - Browser is redirected to `/order/status/$token` which kicks the pipeline and polls for completion.
3. `/order/status/$token` — public, no auth. Triggers `POST /api/public/investigate/$caseId` (HMAC-signed) once, then polls `case.status` every 5 s. Shows a clean "AI investigation in progress" progress UI (steps: Document analysis → Legal entity → Risk screening → Report generation → Delivery), updates from `case_activity_log`. If the customer closes the tab, the pipeline keeps running server-side (it's a separate HTTP request, not bound to their connection).
4. On completion, the page shows the order ID + "We've emailed your report to *email*" + the signed report link.

## Public, no-auth routes

- `/order/status/$token` — investigation progress + final outcome.
- `/r/$token` — styled HTML report page (reuses the existing `sample-report.tsx` layout). 30-day signed token stored on `report_versions`. Includes "Save as PDF" button using the existing print CSS.
- `/upload/$token` — kept for legacy orders; new flow uses inline upload.
- `/api/public/investigate/$caseId` — HMAC-protected pipeline trigger.

## Removed / hidden

- Inline "delivered within 72 h / 24 h" copy gets the spec-required wording: "delivered as a PDF to this email address" (no fixed timing promise — tier just informs internal priority).

## AI investigation pipeline (server-side, single `runInvestigation(caseId)` server function)

Runs in a server route `/api/public/investigate/$caseId` (HMAC-verified) so it isn't tied to the customer's browser session.

Stage 1 — **Document extraction.** Each uploaded file fetched from Storage. PDFs/images sent to `google/gemini-2.5-flash` (multimodal) with structured-output `Output.object` schema → `{ doc_type, extracted_entities: { company_name_en, company_name_zh, usci_number, registered_address, contact, dates, amounts, certificate_authority, certificate_number, validity_dates }, summary }`. Persisted to `case_documents.extracted_data` (new JSONB column).

Stage 2 — **Legal-entity resolution.** Firecrawl `search` against:
- `site:gsxt.gov.cn` and `site:qcc.com` + supplier name + Chinese name
- Generic search for the English name + "limited" + country
- Customer-provided website (Firecrawl `scrape` → markdown + branding) to extract footer registration info.
LLM agent then proposes one or more candidate legal entities, each with a `match_confidence` and source list. Chosen candidate stored on `supplier_cases.resolved_entity` (JSONB).

Stage 3 — **Risk screening.** Parallel:
- **Sanctions / restricted-party**: fetch the public OpenSanctions consolidated dataset (`https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json` filtered, or their free `/match/sanctions` API endpoint with no auth). Name + country matched, score recorded.
- **UFLPA Entity List**: bundled JSON snapshot of the U.S. CBP UFLPA Entity List (committed in `src/lib/risk-data/uflpa.json`, refresh date noted in report). Exact and fuzzy name match.
- **Adverse media**: Firecrawl `search` "<entity name>" + ("fraud" OR "scam" OR "complaint" OR "lawsuit") with `tbs: 'qdr:y'`. Top 5 results scraped, summarised, classified.
- **Domain / website consistency**: Firecrawl `scrape` with `formats: ['markdown','branding','links']`; LLM compares site claims against extracted-doc claims and registry data.
- **Export history / manufacturer-vs-trader**: Firecrawl search on shipping aggregators (importyeti.com, panjiva.com snippets) — best-effort; flagged "Not independently verified" when only behind paywalls. Plug-in seam: a `searchExportHistory()` helper with a TODO stub for ImportYeti/Sayari API.
- **Litigation / enforcement**: Firecrawl search on Chinese judgment sites + the entity name. Best-effort; marked accordingly.
- **Certificate validity**: per extracted certificate, Firecrawl search on the issuing body + cert number.

Each screening returns a structured `Finding { item, status: PASS|CAUTION|FAIL|NOT_VERIFIED|NOT_APPLICABLE, confidence: high|medium_high|medium|low, source_name, source_url, retrieval_date, evidence_excerpt, buyer_impact, recommended_action }`. **Hard rule in the system prompt and validated in code**: any finding whose `evidence_excerpt` is empty must be downgraded to `NOT_VERIFIED`; the model is never permitted to invent registry numbers, dates, or addresses.

Stage 4 — **Risk synthesis.** Reuses the existing `risk-engine.ts` to compute overall outcome. The LLM is asked only for executive summary, buyer-impact prose, and the recommended actions — *not* for the outcome calculation (which stays deterministic and explainable).

Stage 5 — **Report assembly.** All findings + outcome → a new `report_versions` row (status `final`) with the full structured JSON. A unique 40-char `share_token` is stored on the row.

Stage 6 — **PDF generation.** `pdf-lib` server-side. A `renderReportPdf(report)` helper lays out the report with the brand colours (#0F2A43 navy, #16A34A green, amber, red), sectioned exactly per the spec: Executive summary, overall risk, key findings, legal-entity, factory-vs-trader, ownership, product fit, export history, certificates, regulatory, litigation, sanctions, digital footprint, payment safeguards, final recommendation, sources/methodology/limitations. Embedded into Storage bucket `reports` at `cases/$caseId/$reportId.pdf`.

Stage 7 — **Delivery email.** Resend (already wired) with:
- Subject: `Your VerifyFirst report is ready — <ORDER_REF> — <OVERALL_RATING>`
- Body: spec text + Order ID + Supplier + Rating + signed link + contact email.
- PDF attached (Resend supports base64 attachments up to 40 MB).
- Internal email to ops with the same.
- Case status → `report_delivered`, `case_activity_log` rows for each stage.

If any stage fails: case status → `investigation_failed`, internal alert email sent, customer is *not* emailed a broken report.

## Schema additions

One migration:
- `case_documents.extracted_data JSONB`
- `supplier_cases.resolved_entity JSONB`, `investigation_started_at`, `investigation_completed_at`, `investigation_error TEXT`
- Enum `case_status` values: `investigation_queued`, `investigating`, `investigation_failed` (add only if missing)
- `report_versions.share_token TEXT UNIQUE`, `report_versions.pdf_storage_path TEXT`
- Storage bucket `reports` (already exists, just confirm RLS deny-all public)

## Where API/plug-in seams live

`src/lib/investigation/sources/` — one file per data source. Each exports a `lookup({entity, country}) → Finding[]`. Today: `web-search.ts` (Firecrawl), `opensanctions.ts` (free API), `uflpa.ts` (bundled JSON), `adverse-media.ts`. Tomorrow you drop in `opencorporates.ts`, `importyeti.ts`, `sayari.ts` and they get composed automatically by `runInvestigation`.

## Front-end touch points

- `src/routes/order.tsx` — slimmer form, inline 3-file upload, refined confirmation copy.
- `src/routes/order.status.$token.tsx` — new progress + outcome screen.
- `src/routes/r.$token.tsx` — new signed report view (reuses `sample-report.tsx` layout, fed by `getReportByToken` server fn).
- `src/components/InvestigationProgress.tsx` — step list + spinner.
- Public landing page copy gets a small adjustment: "AI-powered supplier investigation, delivered as a PDF" — no other landing changes.

## What I'm intentionally NOT building

- Customer dashboards, accounts, login, multi-tenancy.
- Real Stripe charge (still stubbed; same flag flips real when Stripe is enabled).
- Real-time chat / SLA timers.
- Paid-API integrations (left as seams).
- Editor for ops to amend a generated report (the existing hidden `/admin` views still work for that).

## Open dependencies on you

1. Approve the Firecrawl connector dialog when it appears.
2. The first investigation will burn ~50 k–150 k Lovable AI tokens (cents) + a handful of Firecrawl credits. Confirm you're OK with that per order.
3. You said earlier to keep `/admin` files hidden — confirmed, no admin UI work in this scope.

After you approve I'll execute in this order: migration → Firecrawl link → schema/types → source modules → pipeline orchestrator → PDF renderer → report route → status route → form refactor → wire success page → verify a synthetic case end-to-end.
