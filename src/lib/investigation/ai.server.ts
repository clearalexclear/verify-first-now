// AI helper that wraps the Lovable AI Gateway with structured JSON output.
// Server-only. Used by document extraction, finding generation, and
// executive-summary writing inside the pipeline.

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "file"; file: { filename: string; file_data: string } }
  >;
};

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

export async function aiChat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

  const body = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };

  const maxRetries = opts.maxRetries ?? 1;
  let lastErr = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `AI gateway ${res.status}`;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`AI gateway ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    return (json.choices?.[0]?.message?.content as string) ?? "";
  }
  throw new Error(lastErr || "AI gateway unavailable");
}

/**
 * Ask the model for strict JSON conforming to a described shape, parse it,
 * and return the parsed object. Robust to surrounding text or ```json fences.
 */
export async function aiJson<T>(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<T> {
  const out = await aiChat(messages, opts);
  return parseJsonLoose<T>(out);
}

function tryParseJson<T>(candidate: string): T | null {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

export function parseJsonLoose<T>(raw: string): T {
  if (!raw) throw new Error("AI returned empty response");
  // Strip ```json fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const direct = tryParseJson<T>(candidate);
  if (direct !== null) return direct;

  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const objectCandidate = tryParseJson<T>(candidate.slice(first, last + 1));
    if (objectCandidate !== null) return objectCandidate;
  }

  const firstA = candidate.indexOf("[");
  const lastA = candidate.lastIndexOf("]");
  if (firstA >= 0 && lastA > firstA) {
    const arrayCandidate = tryParseJson<T>(candidate.slice(firstA, lastA + 1));
    if (arrayCandidate !== null) return arrayCandidate;
  }
  throw new Error("AI did not return valid JSON: " + candidate.slice(0, 200));
}

export type { ChatMessage };
