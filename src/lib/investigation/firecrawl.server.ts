// Thin Firecrawl client used by the investigation pipeline. Server-only.
// Goes through the Lovable connector gateway so the connection key is rotated
// and audited centrally. Never exposes FIRECRAWL_API_KEY to the browser.

const GATEWAY = "https://connector-gateway.lovable.dev/firecrawl";

function authHeaders() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY missing — connect Firecrawl in Settings → Connectors.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": FIRECRAWL_API_KEY,
  } as Record<string, string>;
}

async function call<T = unknown>(path: string, body: unknown, timeoutMs = 25_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Surface enough info to debug, but don't throw — many of the pipeline
      // sources are best-effort and should degrade gracefully.
      throw new Error(`firecrawl ${path} ${res.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface FirecrawlSearchHit {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

export interface FirecrawlSearchResult {
  success?: boolean;
  data?: FirecrawlSearchHit[];
  web?: FirecrawlSearchHit[];
}

export async function fcSearch(query: string, opts: {
  limit?: number;
  tbs?: string;
  country?: string;
  scrape?: boolean;
} = {}): Promise<FirecrawlSearchHit[]> {
  try {
    const body: Record<string, unknown> = {
      query,
      limit: opts.limit ?? 5,
    };
    if (opts.tbs) body.tbs = opts.tbs;
    if (opts.country) body.country = opts.country;
    if (opts.scrape) body.scrapeOptions = { formats: ["markdown"] };
    const json = await call<FirecrawlSearchResult>("/v2/search", body);
    const arr = json.data ?? json.web ?? [];
    return Array.isArray(arr) ? arr.slice(0, opts.limit ?? 5) : [];
  } catch (e) {
    console.warn("[fcSearch]", (e as Error).message);
    return [];
  }
}

export interface FirecrawlScrapeResult {
  success?: boolean;
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: { title?: string; description?: string; sourceURL?: string };
  };
}

export async function fcScrape(url: string, opts: { formats?: string[]; onlyMainContent?: boolean } = {}): Promise<{
  markdown: string;
  links: string[];
  title: string;
  sourceURL: string;
} | null> {
  try {
    const json = await call<FirecrawlScrapeResult>("/v2/scrape", {
      url,
      formats: opts.formats ?? ["markdown", "links"],
      onlyMainContent: opts.onlyMainContent ?? true,
    });
    const md = json.markdown ?? json.data?.markdown ?? "";
    const links = json.links ?? json.data?.links ?? [];
    const meta = json.metadata ?? json.data?.metadata ?? {};
    return {
      markdown: typeof md === "string" ? md : "",
      links: Array.isArray(links) ? links : [],
      title: meta.title ?? "",
      sourceURL: meta.sourceURL ?? url,
    };
  } catch (e) {
    console.warn("[fcScrape]", url, (e as Error).message);
    return null;
  }
}
