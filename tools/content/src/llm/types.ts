export type LlmErrorKind = "RATE_LIMIT" | "AUTH" | "TIMEOUT" | "BAD_RESPONSE" | "OTHER";

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly retryAfterMs?: number) { super(message); }
}

export interface LlmRequest {
  prompt: string;
  model: string;
  /** JSON Schema for structured output when the transport supports it (headless --json-schema). */
  schema?: object;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmUsage { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number }

export interface LlmResponse {
  text: string;
  usage?: LlmUsage;
  /** Model actually used, when the transport reports it. */
  resolvedModel?: string;
  /** false when only the requested alias is known (execution_plan §4.3.1). */
  resolved: boolean;
  /** Reference only: headless reports a list-price estimate, not subscription billing. */
  reportedCostUsd?: number;
}

export type ProviderKind = "api" | "headless";

export interface LlmProvider {
  readonly kind: ProviderKind;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface RoleConfig { provider: ProviderKind; model: string }

/** Wraps a provider and remembers which model actually answered (for provenance / verification records). */
export class TrackingProvider implements LlmProvider {
  resolvedModel?: string;
  resolved = false;
  constructor(private inner: LlmProvider) {}
  get kind(): ProviderKind { return this.inner.kind; }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const r = await this.inner.complete(req);
    if (r.resolvedModel) { this.resolvedModel = r.resolvedModel; this.resolved = r.resolved; }
    return r;
  }
}
