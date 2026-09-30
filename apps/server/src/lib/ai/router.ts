import type { Logger } from "../log.js";
import { silentLogger } from "../log.js";
import type { Effort, ModelProvider, ModelResult, SearchOutcome, SearchRequest, StructuredRequest } from "./provider.js";

/**
 * Routes each pipeline stage to a model tier and retries retryable failures on a failover
 * provider. The pipeline keeps calling one ModelProvider; the routing is invisible to it.
 *
 * Tiers:
 * - judge: the model that decides (classification, evidence verdicts, the IHRA review, the two
 *   recommendations, drafts). KAVANNAH_MODEL, Opus by default.
 * - fast: extraction and the web-search research calls, where a small model is as good and
 *   several times faster. KAVANNAH_MODEL_FAST (Haiku); falls back to the judge.
 * - search: the research calls only, when a different backend should run them
 *   (KAVANNAH_SEARCH_MODEL, e.g. an OpenRouter model with its web plugin); falls back to fast.
 */
export type StageRole = "judge" | "fast" | "search";

/** `draft:reply` → `draft`. */
export function baseStage(stage: string): string {
  return stage.split(":")[0] ?? stage;
}

export const STAGE_ROLES: Record<string, StageRole> = {
  extractClaims: "fast",
  classifyContent: "judge",
  retrieveEvidence: "search",
  researchIhra: "search",
  assessEvidence: "judge",
  assessIhra: "judge",
  recommendEngagement: "judge",
  recommendCommunityNote: "judge",
  draft: "judge",
};

export function roleFor(stage: string): StageRole {
  return STAGE_ROLES[baseStage(stage)] ?? "judge";
}

/**
 * Reasoning depth per stage. Extraction, searches and the two short recommendations run at
 * low effort (they apply rules to context the pipeline already gathered); the judgement-heavy
 * stages use the configured effort.
 */
export function effortFor(stage: string, configured: Effort): Effort {
  switch (baseStage(stage)) {
    case "extractClaims":
    case "retrieveEvidence":
    case "researchIhra":
    case "recommendEngagement":
    case "recommendCommunityNote":
      return "low";
    default:
      return configured;
  }
}

export interface RouterTiers {
  judge: ModelProvider;
  fast?: ModelProvider;
  search?: ModelProvider;
}

export interface RoutingProviderOptions {
  tiers: RouterTiers;
  /** Default effort for judge stages. */
  effort: Effort;
  /** Returns the provider to retry a retryable failure on, or null when none applies. */
  failoverFor?: (primary: ModelProvider) => ModelProvider | null;
  log?: Logger;
}

export class RoutingProvider implements ModelProvider {
  readonly name = "router";
  readonly model: string;
  readonly webSearchAvailable: boolean;
  readonly tiers: RouterTiers;
  private readonly effort: Effort;
  private readonly failoverFor: (primary: ModelProvider) => ModelProvider | null;
  private readonly log: Logger;
  private readonly failovers = new Map<string, ModelProvider | null>();

  constructor(options: RoutingProviderOptions) {
    this.tiers = options.tiers;
    this.model = options.tiers.judge.model;
    this.effort = options.effort;
    this.failoverFor = options.failoverFor ?? (() => null);
    this.log = options.log ?? silentLogger;
    this.webSearchAvailable = this.searchTier().webSearchAvailable;
  }

  private searchTier(): ModelProvider {
    return this.tiers.search ?? this.tiers.fast ?? this.tiers.judge;
  }

  providerFor(stage: string): ModelProvider {
    switch (roleFor(stage)) {
      case "fast":
        return this.tiers.fast ?? this.tiers.judge;
      case "search":
        return this.searchTier();
      default:
        return this.tiers.judge;
    }
  }

  private failover(primary: ModelProvider): ModelProvider | null {
    const key = `${primary.name}:${primary.model}`;
    if (!this.failovers.has(key)) this.failovers.set(key, this.failoverFor(primary));
    return this.failovers.get(key) ?? null;
  }

  private async withFailover<T>(stage: string, primary: ModelProvider, run: (provider: ModelProvider) => Promise<ModelResult<T>>): Promise<ModelResult<T>> {
    const first = await run(primary);
    if (first.ok || !first.retryable) return first;
    const alternate = this.failover(primary);
    if (!alternate) return first;
    this.log.warn(`stage ${stage}: ${primary.name} ${primary.model} failed (${first.reason}: ${first.message}); retrying on ${alternate.name} ${alternate.model}`);
    const second = await run(alternate);
    if (second.ok) return second;
    // Report the primary failure: it names the API the operator configured.
    return { ...first, message: `${first.message}; failover to ${alternate.name} also failed (${second.reason}: ${second.message})` };
  }

  structured<T>(request: StructuredRequest<T>): Promise<ModelResult<T>> {
    const effort = request.effort ?? effortFor(request.stage, this.effort);
    return this.withFailover(request.stage, this.providerFor(request.stage), (provider) => provider.structured({ ...request, effort }));
  }

  search(request: SearchRequest): Promise<ModelResult<SearchOutcome>> {
    const effort = request.effort ?? effortFor(request.stage, this.effort);
    return this.withFailover(request.stage, this.providerFor(request.stage), (provider) => provider.search({ ...request, effort }));
  }

  /** Startup banner lines. */
  describe(): string[] {
    const tier = (label: string, provider: ModelProvider | undefined, fallback: string) =>
      `  ${label.padEnd(12)} ${provider ? `${provider.model} (${provider.name})` : fallback}`;
    const judgeFailover = this.failover(this.tiers.judge);
    const fastFailover = this.tiers.fast ? this.failover(this.tiers.fast) : null;
    const failover = [judgeFailover, fastFailover]
      .filter((p): p is ModelProvider => Boolean(p))
      .map((p) => `${p.model} (${p.name})`)
      .filter((v, i, all) => all.indexOf(v) === i)
      .join(", ");
    return [
      tier("judge", this.tiers.judge, ""),
      tier("fast", this.tiers.fast, "same as judge"),
      tier("search", this.tiers.search, this.tiers.fast ? "fast tier" : "judge"),
      `  ${"failover".padEnd(12)} ${failover || "none"}`,
    ];
  }
}
