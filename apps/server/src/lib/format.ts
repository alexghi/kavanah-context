import {
  ANALOGY_MECHANISMS,
  COMPARISON_DIMENSIONS,
  IHRA_PATTERNS,
  scoreBand,
  type AnalyzePostResponse,
  type DraftResponse,
  type IhraAssessment,
} from "@kavannah/shared";

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
  const patterns = c.antisemitism.patterns?.length ? c.antisemitism.patterns : c.antisemitism.categories;
  out.push(`Antisemitism:  ${c.antisemitism.assessment}${patterns.length ? ` [${patterns.join(", ")}]` : ""}`);
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

  if (analysis.ihra) {
    out.push(formatIhra(analysis.ihra));
    out.push("");
  }

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

/** The IHRA ANTISEMITISM ASSESSMENT and COMMUNITY NOTE 2.0, in the framework's own layout. */
export function formatIhra(ihra: IhraAssessment): string {
  const out: string[] = [];
  const cite = (ids: string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");
  out.push("IHRA ANTISEMITISM ASSESSMENT");
  out.push(`Assessment:    ${ihra.assessment.toUpperCase()} — confidence: ${ihra.confidence}`);
  out.push(wrap(ihra.summary, "  "));
  if (!ihra.findings.length) out.push("Relevant IHRA pattern: none");
  for (const f of ihra.findings) {
    const info = IHRA_PATTERNS[f.pattern];
    out.push(`Relevant IHRA pattern: ${info.number ? `${info.number}. ` : ""}${info.label} (${f.pattern}) — confidence: ${f.confidence}`);
    out.push(wrap(`Evidence in the post: “${f.trigger}”`, "  "));
    out.push(wrap(`IHRA example: ${f.ihraExample}`, "  "));
    out.push(wrap(`Why it applies: ${f.whyItApplies}`, "  "));
    for (const s of f.strengthens) out.push(wrap(`+ ${s}`, "    "));
    for (const s of f.weakens) out.push(wrap(`- ${s}`, "    "));
    for (const s of f.facts) out.push(wrap(`fact: ${s}`, "    "));
    for (const s of f.interpretations) out.push(wrap(`interpretation: ${s}`, "    "));
  }
  if (ihra.mechanism) out.push(wrap(`Semantic / narrative mechanism: ${ihra.mechanism}`, "  "));
  if (ihra.historicalContext) out.push(wrap(`Historical or factual context: ${ihra.historicalContext}`, "  "));
  if (ihra.omittedDifferences.length) {
    out.push("  Material differences omitted:");
    for (const d of ihra.omittedDifferences) out.push(wrap(`- ${d}`, "    "));
  }
  const a = ihra.analogy;
  if (a) {
    out.push(`Analogy: ${a.historicalReferent} ↔ ${a.contemporaryReferent}`);
    out.push(`  Mechanisms: ${a.mechanisms.map((m) => ANALOGY_MECHANISMS[m].code).join(", ")}`);
    out.push(wrap(a.mechanismExplanation, "  "));
    for (const row of a.rows) {
      out.push(`  ${COMPARISON_DIMENSIONS[row.dimension]}${cite(row.sourceIds)}`);
      out.push(wrap(`then (${row.historicalBasis}): ${row.historical}`, "    "));
      out.push(wrap(`now (${row.contemporaryBasis}): ${row.contemporary}`, "    "));
      out.push(wrap(`difference: ${row.difference}`, "    "));
    }
    out.push(`  Suppresses material differences: ${a.suppressesMaterialDifferences ? "yes" : "no"}`);
    out.push(wrap(a.conclusion, "  "));
  }
  for (const tr of ihra.tropeTransfers) {
    out.push(`Trope transfer${tr.stereotypePreserved ? " (stereotype preserved)" : ""}:`);
    out.push(wrap(`${tr.originalTrope} → ${tr.substitution} → ${tr.contemporaryTarget}`, "  "));
    out.push(wrap(tr.explanation, "  "));
  }
  for (const d of ihra.semanticDisplacements) {
    out.push("Semantic displacement:");
    out.push(wrap(`${d.historicalReferent} → ${d.operation} → ${d.newReferent} → ${d.consequence}`, "  "));
  }
  if (ihra.doubleStandard) out.push(wrap(`Double standard: comparator ${ihra.doubleStandard.comparator}; ${ihra.doubleStandard.asymmetry}`, ""));
  if (ihra.sources.length) {
    out.push("Sources:");
    for (const s of ihra.sources) out.push(`  ${s.id} [${s.verified ? "verified" : "unverified"}] ${s.title} — ${s.url}`);
  }
  if (ihra.communityNote2) {
    out.push("");
    out.push("COMMUNITY NOTE 2.0");
    out.push(wrap(ihra.communityNote2.text, "  "));
    out.push(`  Sources: ${ihra.communityNote2.sources.map((s) => s.url).join(" ") || "none"}`);
  }
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
