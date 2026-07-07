INSERT INTO public.connectors (id, name, category, mode, enabled, required_env, source_url, raw_response_policy, notes)
VALUES
  ('china_registry_auto', 'China registry provider auto-select', 'corporate_registry', 'paid_disabled', false, ARRAY['CHINA_REGISTRY_ENABLED'], null, 'metadata_only', 'Swappable China registry layer. Uses QINCheck first, then Panda360, when enabled and credentials are present.'),
  ('china_registry_qincheck', 'QINCheck China registry', 'corporate_registry', 'paid_disabled', false, ARRAY['QINCHECK_API_KEY'], 'https://qincheck.com/api/report', 'metadata_only', 'Preferred China registry provider. Enabled only when CHINA_REGISTRY_ENABLED=true and QINCHECK_API_KEY is configured.'),
  ('china_registry_panda360', 'Panda360 China registry', 'corporate_registry', 'paid_disabled', false, ARRAY['PANDA360_API_KEY'], 'https://www.chinacheckup.com/wp-json/chinacheckup/v1/', 'metadata_only', 'Fallback China registry provider. Enabled only when CHINA_REGISTRY_ENABLED=true and PANDA360_API_KEY is configured.')
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
