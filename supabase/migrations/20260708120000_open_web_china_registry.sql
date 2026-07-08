insert into public.connectors (
  id,
  name,
  category,
  mode,
  enabled,
  raw_response_policy,
  notes,
  created_at,
  updated_at
) values (
  'open_web_china_registry',
  'Open-web China registry resolver',
  'corporate_registry',
  'official_free',
  true,
  'metadata_only',
  'Firecrawl-backed public-source resolver used when QINCheck and Panda360 are unavailable. Does not bypass CAPTCHAs, does not scrape aggressively, and is not equivalent to direct official registry API verification.',
  now(),
  now()
)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  mode = excluded.mode,
  enabled = excluded.enabled,
  raw_response_policy = excluded.raw_response_policy,
  notes = excluded.notes,
  updated_at = now();
