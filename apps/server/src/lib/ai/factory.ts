import type { ServerConfig } from "../../config.js";
import type { Logger } from "../log.js";
import { AnthropicProvider } from "./anthropic.js";
import { isOpenRouterModel, OpenRouterProvider, openRouterModelFor } from "./openrouter.js";
import type { ModelProvider } from "./provider.js";
import { RoutingProvider } from "./router.js";

/**
 * Builds the routing provider from the config: one Anthropic or OpenRouter provider per tier
 * (a model id with "/" runs on OpenRouter), plus OpenRouter failover for the Anthropic tiers
 * when a key is configured. Secrets are read from `env` here and never stored on the config.
 */
export function createRouter(config: ServerConfig, env: NodeJS.ProcessEnv, log: Logger): RoutingProvider {
  const openRouterKey = env.KAVANNAH_OPENROUTER_KEY?.trim() || undefined;
  const webSearch = config.webSearchEnabled;

  const make = (model: string): ModelProvider => {
    if (isOpenRouterModel(model)) {
      if (!openRouterKey) throw new Error(`Model "${model}" needs KAVANNAH_OPENROUTER_KEY.`);
      return new OpenRouterProvider({ apiKey: openRouterKey, model, webSearch, log });
    }
    return new AnthropicProvider({ model, effort: config.effort, webSearch, log });
  };

  const judge = make(config.model);
  const fast = config.modelFast && config.modelFast !== config.model ? make(config.modelFast) : undefined;
  const fastModel = fast?.model ?? judge.model;
  const search = config.searchModel && config.searchModel !== fastModel ? make(config.searchModel) : undefined;

  const failoverFor =
    openRouterKey && config.openRouterFailover
      ? (primary: ModelProvider): ModelProvider | null =>
          primary.name === "anthropic" ? new OpenRouterProvider({ apiKey: openRouterKey, model: openRouterModelFor(primary.model), webSearch, log }) : null
      : undefined;

  return new RoutingProvider({ tiers: { judge, fast, search }, effort: config.effort, failoverFor, log });
}
