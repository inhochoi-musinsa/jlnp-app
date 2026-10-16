import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface ApiOptions { apiKey: string; fetch?: FetchLike; timeoutMs?: number; baseUrl?: string }

/** Anthropic Messages API over fetch (no SDK dependency; the transport is injectable for tests). */
export class ApiProvider implements LlmProvider {
  readonly kind = "api" as const;
  private fetchFn: FetchLike;
  constructor(private o: ApiOptions) { this.fetchFn = o.fetch ?? ((u, i) => fetch(u, i) as ReturnType<FetchLike>); }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.o.apiKey) throw new LlmError("AUTH", "ANTHROPIC_API_KEY is not set");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 180000);
    let res;
    try {
      res = await this.fetchFn(`${this.o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens ?? 8192, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), messages: [{ role: "user", content: req.prompt }] }),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new LlmError(ctl.signal.aborted ? "TIMEOUT" : "OTHER", `network error: ${(e as Error).message}`);
    } finally { clearTimeout(timer); }
    const body = await res.text();
    if (res.status === 429 || res.status === 529) {
      const ra = Number(res.headers.get("retry-after"));
      throw new LlmError("RATE_LIMIT", `HTTP ${res.status}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("AUTH", `HTTP ${res.status}: check ANTHROPIC_API_KEY`);
    if (res.status >= 500) throw new LlmError("OTHER", `HTTP ${res.status}`);
    if (res.status !== 200) throw new LlmError("OTHER", `HTTP ${res.status}: ${body.slice(0, 200)}`);
    let j: any;
    try { j = JSON.parse(body); } catch { throw new LlmError("BAD_RESPONSE", "response is not JSON"); }
    const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return {
      text, resolvedModel: typeof j.model === "string" ? j.model : undefined, resolved: typeof j.model === "string",
      usage: j.usage ? { inputTokens: j.usage.input_tokens ?? 0, outputTokens: j.usage.output_tokens ?? 0, cacheCreationTokens: j.usage.cache_creation_input_tokens, cacheReadTokens: j.usage.cache_read_input_tokens } : undefined,
    };
  }
}
