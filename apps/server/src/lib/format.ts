import { scoreBand, type AnalyzePostResponse, type DraftResponse } from "@kavannah/shared";

function wrap(text: string, indent: string, width = 100): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

const ENGAGE_LABEL = { engage: "ENGAGE", do_not_engage: "DO NOT ENGAGE", uncertain: "UNCERTAIN" } as const;
const NOTE_LABEL = { recommended: "RECOMMENDED", not_recommended: "NOT RECOMMENDED", uncertain: "UNCERTAIN" } as const;

/** Human-readable summary of an analysis for the CLI. */
export function formatAnalysis(analysis: AnalyzePostResponse): string {
  const { post, classification: c, meta } = analysis;
  const out: string[] = [];
  const modeLabel = meta.mode === "mock" ? `mock${meta.fixtureId ? ` (fixture: ${meta.fixtureId})` : ""}` : `live (${meta.model ?? "?"})`;
  out.push(`Kavannah analysis — ${modeLabel} — ${meta.durationMs} ms`);
  out.push(`Post: ${post.author?.handle ?? "(unknown author)"} — ${post.url}`);
  out.push(wrap(`"${post.text}"`, "  "));
  out.push("");
  out.push(`Headline:      ${c.headline}`);
  out.push(`Score:         ${c.disinformationScore}/100 (${scoreBand(c.disinformationScore).label}) — confidence: ${c.confidence}`);
  out.push(`Labels:        ${c.labels.join(", ")}`);
  out.push(`Antisemitism:  ${c.antisemitism.assessment}${c.antisemitism.categories.length ? ` [${c.antisemitism.categories.join(", ")}]` : ""}`);
  out.push(wrap(c.antisemitism.explanation, "               "));
  out.push("Explanation:");
  out.push(wrap(c.explanation, "  "));
  out.push("");

  out.push(`Claims (${analysis.claims.length}):`);
  if (!analysis.claims.length) out.push("  (none)");
  for (const claim of analysis.claims) {
    out.push(`  ${claim.id} [${claim.type}${claim.checkworthy ? ", check-worthy" : ""}] ${claim.text}`);
    if (claim.reason) out.push(wrap(claim.reason, "       "));
  }
  out.push("");

  out.push(`Evidence (${analysis.evidence.length}):`);
  if (!analysis.evidence.length) out.push("  (no claims were checked against sources)");
  for (const item of analysis.evidence) {
    out.push(`  ${item.claimId} ${item.verdict.toUpperCase()} — ${item.claim}`);
    out.push(wrap(item.summary, "     "));
    if (!item.sources.length) out.push("     sources: none");
    for (const s of item.sources) {
      out.push(`     - [${s.verified ? "verified" : "unverified"}] ${s.title} — ${s.publisher ?? ""}`);
      out.push(`       ${s.url}`);
      if (s.whyItMatters) out.push(wrap(`why: ${s.whyItMatters}`, "       "));
    }
  }
  out.push("");

  out.push(`Should I engage?                 ${ENGAGE_LABEL[analysis.engagement.recommendation]}`);
  out.push(wrap(analysis.engagement.rationale, "  "));
  out.push(`Should I add a Community Note?   ${NOTE_LABEL[analysis.communityNote.recommendation]}`);
  out.push(wrap(analysis.communityNote.rationale, "  "));
  out.push("");

  out.push(`Stages: ${meta.stages.map((s) => `${s.name} ${s.ms}ms ${s.ok ? "ok" : "FAILED"}${s.note ? ` (${s.note})` : ""}`).join(" | ")}`);
  out.push(`Warnings (${meta.warnings.length}):`);
  for (const w of meta.warnings) out.push(`  - ${w}`);
  if (!meta.warnings.length) out.push("  (none)");
  return out.join("\n");
}

export function formatDraft(draft: DraftResponse): string {
  const out: string[] = [];
  out.push(`Draft ${draft.kind === "reply" ? "reply" : "Community Note"} (${draft.meta.mode}, ${draft.meta.durationMs} ms, ${draft.text.length} chars):`);
  out.push(wrap(draft.text, "  "));
  out.push(`Sources cited: ${draft.sources.length ? draft.sources.map((s) => `${s.url} [${s.verified ? "verified" : "unverified"}]`).join(", ") : "none"}`);
  for (const w of draft.warnings) out.push(`  ! ${w}`);
  return out.join("\n");
}
