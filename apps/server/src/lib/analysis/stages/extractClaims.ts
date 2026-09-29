import type { Claim, PostContext } from "@kavannah/shared";
import type { ModelProvider, ModelResult } from "../../ai/provider.js";
import { extractClaimsPrompt } from "../prompts.js";
import { ClaimsOutputSchema, type ClaimsOutput } from "../schemas.js";

export const MAX_CLAIMS = 6;

/** Stage 1: extract claims (structured). */
export function extractClaims(provider: ModelProvider, post: PostContext): Promise<ModelResult<ClaimsOutput>> {
  return provider.structured({
    stage: "extractClaims",
    system: extractClaimsPrompt.system,
    user: extractClaimsPrompt.user(post),
    schema: ClaimsOutputSchema,
  });
}

/** Assigns stable ids (c1, c2, ...) and drops empty/duplicate claims. */
export function toClaims(output: ClaimsOutput): Claim[] {
  const seen = new Set<string>();
  const claims: Claim[] = [];
  for (const raw of output.claims) {
    const text = raw.text.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const claim: Claim = {
      id: `c${claims.length + 1}`,
      text,
      type: raw.type,
      // Only factual claims can be check-worthy, whatever the model said.
      checkworthy: raw.checkworthy && raw.type === "factual",
    };
    if (raw.reason.trim()) claim.reason = raw.reason.trim();
    claims.push(claim);
    if (claims.length >= MAX_CLAIMS) break;
  }
  return claims;
}
