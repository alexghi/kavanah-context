import { FixtureSchema, legacyCategoriesFor, type AnalysisMeta, type Fixture, type IhraPattern, type Manipulation, type PostContext, type Source, type StageReport } from "@kavannah/shared";
import { WARNINGS } from "../lib/analysis/analyzePost.js";

/**
 * Twelve SYNTHETIC demo posts (invented handles, no real people) with complete analyses.
 * Sources are real, stable pages that were checked with curl while writing this file
 * (all returned HTTP 200 on 2026-09-29 or 2026-09-30); `verified` reflects that check.
 * The facts the IHRA demos state were read from the cited pages on 2026-09-30.
 */

const ANALYZED_AT = "2026-09-29T09:00:00.000Z";
const FIXTURE_MODEL = "fixture";

function post(handle: string, displayName: string, id: string, text: string, extra: Partial<PostContext> = {}): PostContext {
  return {
    platform: "x",
    url: `https://x.com/${handle}/status/${id}`,
    id,
    text,
    author: { handle: `@${handle}`, displayName },
    language: "en",
    postedAt: "2026-09-28T14:30:00.000Z",
    ...extra,
  };
}

function source(id: string, url: string, title: string, whyItMatters: string): Source {
  return { id, title, url, publisher: new URL(url).hostname.replace(/^www\./, ""), whyItMatters, retrievedVia: "fixture", verified: true };
}

type StagePlan = "full" | "no_claims" | "no_checkworthy" | "no_sources";

function stagesFor(plan: StagePlan, detail: { claims: number; checkworthy: number; sources: number; verdicts: string }): StageReport[] {
  const claimsNote = `${detail.claims} claim${detail.claims === 1 ? "" : "s"}, ${detail.checkworthy} check-worthy`;
  const head: StageReport[] = [
    { name: "extractClaims", ms: 1420, ok: true, note: claimsNote },
    { name: "classifyContent", ms: 2110, ok: true },
  ];
  const tail: StageReport[] = [
    { name: "recommendEngagement", ms: 1480, ok: true },
    { name: "recommendCommunityNote", ms: 1530, ok: true },
  ];
  switch (plan) {
    case "no_claims":
      return [...head, { name: "retrieveEvidence", ms: 0, ok: true, note: "skipped: no claims" }, ...tail];
    case "no_checkworthy":
      return [...head, { name: "retrieveEvidence", ms: 0, ok: true, note: "skipped: no check-worthy claims" }, ...tail];
    case "no_sources":
      return [
        ...head,
        { name: "retrieveEvidence", ms: 8460, ok: true, note: "3 searches, 0 candidate sources" },
        { name: "assessEvidence", ms: 0, ok: true, note: "skipped: no candidate sources" },
        ...tail,
      ];
    case "full":
      return [
        ...head,
        { name: "retrieveEvidence", ms: 9870, ok: true, note: `${Math.max(1, detail.checkworthy)} searches, ${detail.sources} candidate sources` },
        { name: "verifySources", ms: 640, ok: true, note: `${detail.sources}/${detail.sources} URLs verified` },
        { name: "assessEvidence", ms: 3260, ok: true, note: detail.verdicts },
        ...tail,
      ];
  }
}

/** The IHRA review's stages (research, URL checks, assessment), inserted before the recommendations. */
function withIhraStages(stages: StageReport[], ihra: { sources: number; note: string } | undefined): StageReport[] {
  if (!ihra) return stages;
  const at = stages.findIndex((s) => s.name === "recommendEngagement");
  const review: StageReport[] = [
    { name: "researchIhra", ms: 38400, ok: true, note: `4 searches, ${ihra.sources} candidate sources` },
    { name: "verifyIhraSources", ms: 910, ok: true, note: `${ihra.sources}/${ihra.sources} URLs verified` },
    { name: "assessIhra", ms: 44100, ok: true, note: ihra.note },
  ];
  return [...stages.slice(0, at), ...review, ...stages.slice(at)];
}

function meta(
  fixtureId: string,
  plan: StagePlan,
  detail: { claims: number; checkworthy: number; sources: number; verdicts: string },
  warnings: string[] = [],
  ihra?: { sources: number; note: string },
): AnalysisMeta {
  const stages = withIhraStages(stagesFor(plan, detail), ihra);
  return {
    version: 1,
    mode: "mock",
    model: FIXTURE_MODEL,
    fixtureId,
    analyzedAt: ANALYZED_AT,
    durationMs: stages.reduce((sum, s) => sum + s.ms, 0),
    stages,
    warnings,
  };
}

const NOT_ANTISEMITIC_NO_REFERENCE = "No reference to Jews, Israel or antisemitic tropes.";

// ---------------------------------------------------------------------------
// Sources (checked with curl on 2026-09-29, all HTTP 200)
// ---------------------------------------------------------------------------

const SRC = {
  nhsMmr: (id: string) => source(id, "https://www.nhs.uk/vaccinations/mmr-vaccine/", "MMR (measles, mumps and rubella) vaccine - NHS", "Official health-service page on the MMR vaccine, including its safety record."),
  wikiMmrAutism: (id: string) => source(id, "https://en.wikipedia.org/wiki/MMR_vaccine_and_autism", "MMR vaccine and autism - Wikipedia", "Summarises the retracted 1998 paper and the large studies that found no link."),
  adlMedia: (id: string) => source(id, "https://antisemitism.adl.org/media/", "Myth: Jews control the media - ADL Antisemitism Uncovered", "Explains the origin and falsity of the 'Jewish control of the media' myth."),
  wikiCanard: (id: string) => source(id, "https://en.wikipedia.org/wiki/Antisemitic_canard", "Antisemitic canard - Wikipedia", "Overview of antisemitic conspiracy myths, including control of media and finance."),
  wikiMediaOwnership: (id: string) => source(id, "https://en.wikipedia.org/wiki/Concentration_of_media_ownership", "Concentration of media ownership - Wikipedia", "Background on media-ownership concentration and the origin of the '90%' figure."),
  wikiIhra: (id: string) => source(id, "https://en.wikipedia.org/wiki/Working_definition_of_antisemitism", "Working definition of antisemitism - Wikipedia", "History of the IHRA working definition: adoption in 2016 and later endorsements."),
  ajcIhra: (id: string) => source(id, "https://www.ajc.org/the-working-definition-of-antisemitism", "The Working Definition of Antisemitism - AJC", "Explainer on the IHRA working definition and who has adopted it."),
  fedFaq: (id: string) => source(id, "https://www.federalreserve.gov/faqs/about_14986.htm", "Who owns the Federal Reserve? - Board of Governors of the Federal Reserve System", "The Federal Reserve's own official answer on who owns it."),
  ajcRothschild: (id: string) => source(id, "https://www.ajc.org/translatehate/rothschild", "Rothschild - AJC Translate Hate", "Explains the origin and antisemitic nature of the Rothschild control myth."),
  ushmmPropaganda: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/nazi-propaganda", "Nazi Propaganda - Holocaust Encyclopedia (USHMM)", "How Nazi propaganda portrayed Jews and prepared the ground for persecution."),
  ushmmProtocols: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/protocols-of-the-elders-of-zion", "Protocols of the Elders of Zion - Holocaust Encyclopedia (USHMM)", "Documents the fabricated conspiracy myth of Jewish control exploited by Nazi propaganda."),
  nasaTemp: (id: string) => source(id, "https://climate.nasa.gov/vital-signs/global-temperature/", "Global Temperature - NASA Climate", "NASA's global surface temperature record with annual values."),
  climateGov: (id: string) => source(id, "https://www.climate.gov/news-features/understanding-climate/climate-change-global-temperature", "Climate Change: Global Temperature - NOAA Climate.gov", "NOAA explainer on the long-term temperature trend and year-to-year variability."),
  // IHRA review sources (checked 2026-09-30, HTTP 200; the stated facts were read on the pages)
  stateIhra: (id: string) => source(id, "https://www.state.gov/defining-antisemitism", "Defining Antisemitism - U.S. Department of State", "Reproduces the IHRA working definition and its examples, including Nazi comparisons and classic tropes applied to Israel."),
  ajcEcho: (id: string) => source(id, "https://www.ajc.org/translatehate/echo", "Echo - AJC Translate Hate", "Explains how triple parentheses are used online to identify, mock and harass Jews."),
  ushmmAuschwitz: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/auschwitz", "Auschwitz - Holocaust Encyclopedia (USHMM)", "The Germans killed about 1.1 million people at Auschwitz, including approximately 1,000,000 Jews, most in gas chambers using Zyklon B."),
  ushmmNumbers: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/documenting-numbers-of-victims-of-the-holocaust-and-nazi-persecution", "Documenting Numbers of Victims of the Holocaust and Nazi Persecution - Holocaust Encyclopedia (USHMM)", "Six million Jewish men, women and children were murdered by the Nazi German regime and its collaborators."),
  ushmmWannsee: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/wannsee-conference-and-the-final-solution", "Wannsee Conference and the “Final Solution” - Holocaust Encyclopedia (USHMM)", "The “Final Solution” was the code name for the systematic, deliberate, physical annihilation of the European Jews; officials coordinated it at Wannsee on 20 January 1942."),
  wikiGazaCasualties: (id: string) => source(id, "https://en.wikipedia.org/wiki/Casualties_of_the_Gaza_war", "Casualties of the Gaza war - Wikipedia", "Tracks reported deaths: more than 75,000 Palestinians by late September 2026 according to the Gaza Health Ministry."),
  icjGaza: (id: string) => source(id, "https://www.icj-cij.org/case/192", "Application of the Genocide Convention in the Gaza Strip (South Africa v. Israel) - International Court of Justice", "The genocide case South Africa brought against Israel at the International Court of Justice."),
  ushmmEarlyChurch: (id: string) => source(id, "https://encyclopedia.ushmm.org/content/en/article/antisemitism-in-history-from-the-early-church-to-1400", "Antisemitism in History: From the Early Church to 1400 - Holocaust Encyclopedia (USHMM)", "How early Christian teaching blamed Jews for the crucifixion and cast their dispersion as punishment."),
  nostraAetate: (id: string) => source(id, "https://www.vatican.va/archive/hist_councils/ii_vatican_council/documents/vat-ii_decl_19651028_nostra-aetate_en.html", "Nostra Aetate - Declaration of the Second Vatican Council (1965)", "States that Jesus's death “cannot be charged against all the Jews, without distinction, then alive, nor against the Jews of today”."),
  wikiZionism: (id: string) => source(id, "https://en.wikipedia.org/wiki/Zionism", "Zionism - Wikipedia", "Modern Zionism emerged as a secular nationalist movement in the late 19th century."),
};

/** The antisemitism block of a classification, with the first-release categories derived from the patterns. */
function antisemitismOf(assessment: "not_detected" | "possible" | "likely", patterns: IhraPattern[], explanation: string) {
  return { assessment, patterns, categories: legacyCategoriesFor(patterns), explanation };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const F1_POST = post(
  "healthtruth_now",
  "Health Truth Now",
  "1840000000000000001",
  "A new peer-reviewed study just CONFIRMED the MMR vaccine causes autism. The mainstream media won't touch it. Protect your kids. 🧵",
);

const misleadingClaim: Fixture = {
  id: "misleading-claim",
  title: "Misleading health claim (not antisemitic)",
  scenario: "Clearly misleading factual claim, not antisemitic: high score, note recommended, engage.",
  post: F1_POST,
  analysis: {
    post: F1_POST,
    classification: {
      headline: "Likely misleading",
      labels: ["misinformation", "factual_claim"],
      explanation:
        "The post asserts as settled fact that a new study confirms the MMR vaccine causes autism. Large studies covering hundreds of thousands of children have found no link, and the 1998 paper that started the claim was retracted; no study has 'confirmed' such a link. The post names no study, so the specific 'new study' claim cannot be checked, but the underlying causal claim is contradicted by the available evidence.",
      confidence: "high",
      disinformationScore: 88,
      manipulationSignals: ["source_distortion"],
      antisemitism: { assessment: "not_detected", categories: [], explanation: NOT_ANTISEMITIC_NO_REFERENCE },
    },
    claims: [
      { id: "c1", text: "A new peer-reviewed study confirmed that the MMR vaccine causes autism.", type: "factual", checkworthy: true, reason: "Specific causal health claim with major public consequences; checkable against the scientific record." },
      { id: "c2", text: "The mainstream media are refusing to cover the study.", type: "unverifiable", checkworthy: false, reason: "Vague claim about media motives with no identified study; not checkable." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "A new peer-reviewed study confirmed that the MMR vaccine causes autism.",
        verdict: "contradicted",
        summary:
          "Multiple large cohort studies and systematic reviews have found no association between the MMR vaccine and autism, and the 1998 paper that popularised the claim was retracted in 2010. The post does not identify the study it refers to, so no new evidence could be assessed.",
        sources: [SRC.nhsMmr("s1"), SRC.wikiMmrAutism("s2")],
      },
    ],
    engagement: {
      recommendation: "engage",
      rationale:
        "A short factual reply pointing to the scientific record could help readers of the thread: the post makes a checkable health claim, is not personal or abusive, and a calm correction is unlikely to backfire. Evidence status: the causal claim is contradicted by well-documented sources.",
    },
    communityNote: {
      recommendation: "recommended",
      rationale:
        "The post contains a specific factual claim (MMR causes autism) that is contradicted by high-quality sources; a neutral note citing them would give readers important context. Evidence status: strong and sourced.",
    },
    meta: meta("misleading-claim", "full", { claims: 2, checkworthy: 1, sources: 2, verdicts: "c1=contradicted" }),
  },
  drafts: {
    reply:
      "Large studies covering hundreds of thousands of children have found no link between the MMR vaccine and autism, and the 1998 paper behind the claim was retracted. Which study are you referring to? https://www.nhs.uk/vaccinations/mmr-vaccine/",
    community_note:
      "Extensive research, including cohort studies of hundreds of thousands of children, has found no association between the MMR vaccine and autism. The 1998 paper that originated the claim was retracted by the journal in 2010. The post does not identify the study it refers to. https://www.nhs.uk/vaccinations/mmr-vaccine/ https://en.wikipedia.org/wiki/MMR_vaccine_and_autism",
  },
};

const F2_POST = post(
  "redpill_ledger",
  "The Ledger",
  "1840000000000000002",
  "Fact: 6 companies control 90% of American media and every single one is run by Jewish executives. That's why you never hear the truth. Not a conspiracy, just ownership records.",
);

const antisemiticClaim: Fixture = {
  id: "antisemitic-claim",
  title: "Antisemitic conspiracy with a checkable claim",
  scenario: "Potentially antisemitic claim with a checkable factual component: potentially_antisemitic + misinformation, note recommended, engage uncertain.",
  post: F2_POST,
  analysis: {
    post: F2_POST,
    classification: {
      headline: "Antisemitic conspiracy theory presented as fact",
      labels: ["potentially_antisemitic", "misinformation", "factual_claim"],
      explanation:
        "The post presents the 'Jewish control of the media' conspiracy myth as an ownership fact. The checkable part is false: the largest US media companies are publicly traded corporations owned by many institutional and individual shareholders, with executives of many backgrounds. Attributing collective control of the media to Jews in order to explain why 'the truth' is hidden matches the IHRA working definition's example of the myth of a Jewish conspiracy controlling the media.",
      confidence: "high",
      disinformationScore: 82,
      manipulationSignals: ["narrative_distortion"],
      antisemitism: antisemitismOf(
        "likely",
        ["conspiracy_or_control"],
        "The post presents Jewish executives as collectively controlling American media and hiding “the truth”, the conspiracy-of-control stereotype named in the IHRA examples.",
      ),
    },
    claims: [
      { id: "c1", text: "Six companies control 90% of American media.", type: "factual", checkworthy: true, reason: "A widely circulated statistic that can be checked against media-ownership data." },
      { id: "c2", text: "Every one of those companies is run by Jewish executives.", type: "factual", checkworthy: true, reason: "A specific claim about who runs these companies; checkable, and central to the post's conspiracy framing." },
      { id: "c3", text: "Because of this ownership, the public never hears the truth.", type: "unverifiable", checkworthy: false, reason: "A sweeping, unfalsifiable inference about motives." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "Six companies control 90% of American media.",
        verdict: "partially_supported",
        summary:
          "The figure comes from a 2012 infographic about six conglomerates; US media ownership is concentrated, but the number is dated and depends on what counts as 'media'. It is an oversimplification rather than an ownership record.",
        sources: [SRC.wikiMediaOwnership("s1")],
      },
      {
        claimId: "c2",
        claim: "Every one of those companies is run by Jewish executives.",
        verdict: "contradicted",
        summary:
          "The major US media companies are publicly traded corporations owned by many shareholders and led by executives of a range of backgrounds; the claim that Jews collectively control the media is a long-standing antisemitic canard with no basis in ownership records.",
        sources: [SRC.adlMedia("s2"), SRC.wikiCanard("s3")],
      },
    ],
    engagement: {
      recommendation: "uncertain",
      rationale:
        "The factual component can be corrected with sources, but the post's core is an antisemitic conspiracy framing: a public reply risks an argumentative thread and harassment, and the account's reach is unknown. If you do engage, keep it strictly factual and brief. Evidence status: the ownership claim is contradicted by sourced information.",
    },
    communityNote: {
      recommendation: "recommended",
      rationale:
        "The post asserts specific, checkable ownership 'facts' that are false or misleading; a neutral note with ownership and background sources would give readers important context without amplifying the post. Evidence status: sourced.",
    },
    ihra: {
      assessment: "likely",
      confidence: "high",
      summary:
        "The post presents Jewish executives as collectively controlling American media and hiding “the truth”, the conspiracy-of-control stereotype named in the IHRA examples. The checkable figures are dated or false, as the evidence shows, but the antisemitic element is the step from media concentration to a hidden, coordinated Jewish power.",
      findings: [
        {
          pattern: "conspiracy_or_control",
          trigger: "every single one is run by Jewish executives. That's why you never hear the truth.",
          ihraExample:
            "Making mendacious, dehumanizing, demonizing, or stereotypical allegations about Jews as such or the power of Jews as collective, such as the myth of Jews controlling the media, economy, government or other societal institutions.",
          whyItApplies: "It explains what the public hears by the supposed Jewish identity of media executives, presenting Jews as a coordinated power over information.",
          strengthens: [
            "“That's why you never hear the truth” turns an ownership claim into a hidden-power explanation.",
            "“Not a conspiracy, just ownership records” pre-empts the charge while restating the myth.",
          ],
          weakens: ["Media concentration is a legitimate subject; criticising media ownership without reference to Jews is not antisemitic."],
          facts: [
            "The largest US media companies are publicly traded and owned by many shareholders.",
            "The “90%” figure comes from a 2012 infographic and is dated.",
          ],
          interpretations: ["The post uses a real concern, media concentration, as a vehicle for the control myth."],
          confidence: "high",
        },
      ],
      mechanism:
        "A plausible-sounding statistic about media concentration is fused with a claim about the executives' Jewish identity, so that concentration reads as Jewish control and explains what the public is not told.",
      historicalContext:
        "The myth that Jews secretly control media and finance was spread by the forged “Protocols of the Elders of Zion”, which Nazi propaganda exploited. US media ownership is concentrated, but the companies are publicly traded and led by executives of many backgrounds.",
      omittedDifferences: [
        "Ownership by many shareholders, versus control by an ethnic or religious group",
        "The backgrounds of individual executives, versus a coordinated group agenda",
      ],
      tropeTransfers: [],
      semanticDisplacements: [],
      communityNote2: {
        text:
          "The largest US media companies are publicly traded and owned by many institutional and individual shareholders, and their executives come from a range of backgrounds. The “90%” figure comes from a dated 2012 infographic. The post turns media concentration into a claim that Jews collectively decide what the public hears, echoing the conspiracy myth spread by the forged “Protocols of the Elders of Zion”. That shift matters because it moves from criticising corporate power to blaming a people. The IHRA working definition lists the myth of Jews controlling the media as an example of antisemitism.",
        sources: [SRC.adlMedia("s2"), SRC.wikiMediaOwnership("s1"), SRC.ushmmProtocols("h1"), SRC.stateIhra("h2")],
      },
      sources: [SRC.adlMedia("s2"), SRC.wikiMediaOwnership("s1"), SRC.ushmmProtocols("h1"), SRC.stateIhra("h2")],
    },
    meta: meta("antisemitic-claim", "full", { claims: 3, checkworthy: 2, sources: 3, verdicts: "c1=partially_supported, c2=contradicted" }, [], { sources: 2, note: "likely; conspiracy_or_control" }),
  },
  drafts: {
    reply:
      "The largest US media companies are publicly traded and owned by thousands of shareholders, with executives of many backgrounds. 'Jewish control of the media' is a century-old conspiracy theory, not an ownership record. https://antisemitism.adl.org/media/",
    community_note:
      "The major US media companies are publicly traded corporations owned by many institutional and individual shareholders; their executives come from a range of backgrounds and no single group controls them. The '90% of media' figure comes from a 2012 infographic and is dated. The claim that Jews collectively control the media is a long-standing antisemitic conspiracy theory. https://antisemitism.adl.org/media/ https://en.wikipedia.org/wiki/Concentration_of_media_ownership",
  },
};

const F3_POST = post("grimm_reaper88", "grimm", "1840000000000000003", "jews are rats. always were, always will be. they don't belong here.");

const antisemiticNoClaim: Fixture = {
  id: "antisemitic-no-claim",
  title: "Dehumanising slur, no factual claim",
  scenario: "Antisemitic content without any factual claim: potentially_antisemitic, low score, no claims, note not recommended, do not engage.",
  post: F3_POST,
  analysis: {
    post: F3_POST,
    classification: {
      headline: "Dehumanising antisemitic content, no factual claim",
      labels: ["potentially_antisemitic"],
      explanation:
        "The post dehumanises Jews as a group by comparing them to vermin and says they 'don't belong here'. It contains no factual claim to check; it is an expression of hatred. This is antisemitic under the IHRA working definition (dehumanising characterisations of Jews as such), but it is not misinformation because it asserts nothing checkable.",
      confidence: "high",
      disinformationScore: 4,
      antisemitism: antisemitismOf(
        "likely",
        ["demonization_or_dehumanization"],
        "The post calls Jews rats and says they don't belong, a dehumanizing statement about Jews as such, presented as a permanent trait.",
      ),
    },
    claims: [],
    evidence: [],
    engagement: {
      recommendation: "do_not_engage",
      rationale:
        "There is no factual claim to correct; the post is a slur. A public reply would mainly amplify it and expose you to harassment, and cannot add context. Consider reporting the post to X for hateful conduct instead. Evidence status: not applicable (no claim).",
    },
    communityNote: {
      recommendation: "not_recommended",
      rationale:
        "Community Notes add factual context to specific claims; this post makes no factual claim, so a note would be rated 'not needed'. Reporting the post for hateful conduct is the relevant action.",
    },
    ihra: {
      assessment: "likely",
      confidence: "high",
      summary:
        "The post calls Jews rats and says they don't belong, a dehumanizing statement about Jews as such, presented as a permanent trait. It makes no factual claim, so it is not misinformation, but it matches the IHRA example of dehumanizing allegations about Jews.",
      findings: [
        {
          pattern: "demonization_or_dehumanization",
          trigger: "jews are rats. always were, always will be.",
          ihraExample: "Making mendacious, dehumanizing, demonizing, or stereotypical allegations about Jews as such or the power of Jews as collective.",
          whyItApplies: "It compares Jews collectively to vermin and presents this as an unchangeable trait of the group.",
          strengthens: ["“always were, always will be” makes it an essential, permanent trait.", "“they don't belong here” adds a call for exclusion."],
          weakens: ["Nothing in the post suggests quotation, irony or condemnation."],
          facts: ["Nazi propaganda portrayed Jews as parasites, for example in the 1940 film “The Eternal Jew”."],
          interpretations: ["The vermin comparison places the post in the tradition of dehumanizing propaganda that preceded persecution."],
          confidence: "high",
        },
      ],
      mechanism: "Dehumanization by animal metaphor: comparing a group to vermin presents its members as a threat to be removed rather than as people.",
      historicalContext:
        "Nazi propaganda systematically portrayed Jews as parasites and vermin, including in “The Eternal Jew” (1940), to prepare public opinion for their exclusion and persecution.",
      omittedDifferences: [],
      tropeTransfers: [],
      semanticDisplacements: [],
      communityNote2: {
        text:
          "Comparing Jews to vermin repeats a staple of Nazi propaganda, which portrayed Jews as parasites, for example in the 1940 film “The Eternal Jew”, to prepare the public for their exclusion and persecution. The post makes no factual claim that a note could correct: it presents hatred as a permanent truth (“always were, always will be”) and calls for exclusion. The IHRA working definition lists dehumanizing allegations about Jews as such as an example of antisemitism.",
        sources: [SRC.ushmmPropaganda("h1"), SRC.stateIhra("h2")],
      },
      sources: [SRC.ushmmPropaganda("h1"), SRC.stateIhra("h2")],
    },
    meta: meta("antisemitic-no-claim", "no_claims", { claims: 0, checkworthy: 0, sources: 0, verdicts: "" }, [], { sources: 2, note: "likely; demonization_or_dehumanization" }),
  },
  drafts: {
    reply: "Comparing people to vermin is dehumanising language with a long and violent history. It has no place here; I'm reporting this post.",
  },
};

const F4_POST = post(
  "east_med_watch",
  "Eastern Med Watch",
  "1840000000000000004",
  "The Israeli government's settlement expansion policy is a strategic mistake. It makes a negotiated peace harder every year and isolates the country diplomatically. Allies should say so plainly.",
);

const politicalOpinion: Fixture = {
  id: "political-opinion",
  title: "Political opinion about a government's policy",
  scenario: "Ordinary political opinion (criticism of Israel's policy phrased like criticism of any country): opinion, not antisemitic, both not recommended, low score.",
  post: F4_POST,
  analysis: {
    post: F4_POST,
    classification: {
      headline: "Political opinion, no clear factual issue",
      labels: ["opinion", "political_or_historical_argument"],
      explanation:
        "The post criticises a specific policy of the Israeli government and argues it is strategically harmful. This is political opinion of the kind directed at any government's policy: it makes no claims about Jews, uses no antisemitic tropes and does not hold Jews collectively responsible. There is no specific factual claim to check.",
      confidence: "high",
      disinformationScore: 6,
      antisemitism: {
        assessment: "not_detected",
        categories: [],
        explanation: "Criticism of a government's policy, comparable to criticism levelled at any other country, is not antisemitic under the IHRA working definition.",
      },
    },
    claims: [
      { id: "c1", text: "Israel's settlement expansion policy is a strategic mistake that makes peace harder and isolates the country diplomatically.", type: "political_or_historical_argument", checkworthy: false, reason: "An evaluative political argument, not a single checkable fact." },
    ],
    evidence: [],
    engagement: {
      recommendation: "do_not_engage",
      rationale:
        "This is a political opinion rather than a factual claim; a reply could only offer a counter-opinion, which adds no verifiable context. Disagreeing with it is normal political debate, not a case for fact-based intervention. Evidence status: not applicable (no checkable claim).",
    },
    communityNote: {
      recommendation: "not_recommended",
      rationale: "Community Notes are for factual claims that need context; opinions about policy, however contested, are not suitable for a note and would be rated 'not needed'.",
    },
    meta: meta("political-opinion", "no_checkworthy", { claims: 1, checkworthy: 0, sources: 0, verdicts: "" }),
  },
  drafts: {},
};

const F5_POST = post(
  "civic_notes_eu",
  "Civic Notes",
  "1840000000000000005",
  "Reminder: the IHRA working definition of antisemitism was adopted in 2016 and has since been adopted or endorsed by dozens of countries. It is non-legally binding and comes with illustrative examples. Worth reading the actual text before arguing about it.",
);

const benignFactual: Fixture = {
  id: "benign-factual",
  title: "Benign, accurate factual post",
  scenario: "Benign, accurate factual post: benign + factual_claim, supported, both not recommended, score near 0.",
  post: F5_POST,
  analysis: {
    post: F5_POST,
    classification: {
      headline: "No clear factual issue identified",
      labels: ["benign", "factual_claim"],
      explanation:
        "The post states accurate, checkable facts about the IHRA working definition (adopted in 2016, non-legally binding, adopted or endorsed by dozens of countries, accompanied by illustrative examples) and encourages readers to consult the text. Nothing misleading or antisemitic was identified.",
      confidence: "high",
      disinformationScore: 2,
      antisemitism: { assessment: "not_detected", categories: [], explanation: "The post discusses the definition of antisemitism neutrally; no antisemitic content." },
    },
    claims: [
      { id: "c1", text: "The IHRA working definition of antisemitism was adopted in 2016.", type: "factual", checkworthy: true, reason: "Specific, checkable historical fact." },
      { id: "c2", text: "Dozens of countries have adopted or endorsed the IHRA working definition.", type: "factual", checkworthy: true, reason: "Checkable count of adopting countries." },
      { id: "c3", text: "The definition is non-legally binding and includes illustrative examples.", type: "factual", checkworthy: false, reason: "Accurate description of the document's nature; low stakes." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "The IHRA working definition of antisemitism was adopted in 2016.",
        verdict: "supported",
        summary: "The IHRA plenary adopted the non-legally binding working definition of antisemitism on 26 May 2016 in Bucharest.",
        sources: [SRC.wikiIhra("s1"), SRC.ajcIhra("s2")],
      },
      {
        claimId: "c2",
        claim: "Dozens of countries have adopted or endorsed the IHRA working definition.",
        verdict: "supported",
        summary: "The definition has been adopted or endorsed by more than 40 countries, as well as many regional governments, universities and organisations.",
        sources: [SRC.wikiIhra("s1"), SRC.ajcIhra("s2")],
      },
    ],
    engagement: {
      recommendation: "do_not_engage",
      rationale: "The post is accurate and already provides context; a factual reply would add nothing. Evidence status: supported by sources.",
    },
    communityNote: {
      recommendation: "not_recommended",
      rationale: "The post's factual claims are accurate and supported by sources; a note is not needed.",
    },
    meta: meta("benign-factual", "full", { claims: 3, checkworthy: 2, sources: 2, verdicts: "c1=supported, c2=supported" }),
  },
  drafts: {},
};

const F6_POST = post(
  "rural_dispatch",
  "Rural Dispatch",
  "1840000000000000006",
  "A friend inside the ministry told me they're quietly planning to close 40 rural post offices next spring. No announcement yet, but it's happening. Screenshot this.",
);

const insufficientEvidence: Fixture = {
  id: "insufficient-evidence",
  title: "Unverifiable insider claim",
  scenario: "Specific claim that cannot be verified (unnamed source): unverifiable_claim, insufficient_evidence, both uncertain.",
  post: F6_POST,
  analysis: {
    post: F6_POST,
    classification: {
      headline: "Unverifiable claim",
      labels: ["unverifiable_claim", "factual_claim"],
      explanation:
        "The post makes a specific claim (40 rural post offices to close next spring) attributed to an unnamed insider. No public announcement, document or report could be found that confirms or contradicts it, so it cannot be assessed either way. The claim may be true, exaggerated or false; readers should treat it as unverified.",
      confidence: "medium",
      disinformationScore: 30,
      antisemitism: { assessment: "not_detected", categories: [], explanation: NOT_ANTISEMITIC_NO_REFERENCE },
    },
    claims: [
      { id: "c1", text: "The ministry is planning to close 40 rural post offices next spring.", type: "factual", checkworthy: true, reason: "Specific, consequential claim; checkable in principle against official announcements or reporting." },
      { id: "c2", text: "The information comes from a friend inside the ministry.", type: "unverifiable", checkworthy: false, reason: "Anonymous personal source; cannot be checked." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "The ministry is planning to close 40 rural post offices next spring.",
        verdict: "insufficient_evidence",
        summary:
          "No official announcement, budget document or news report confirming or contradicting a plan to close 40 rural post offices could be found; the only cited source is an unnamed acquaintance. The claim is unverified, not disproven.",
        sources: [],
      },
    ],
    engagement: {
      recommendation: "uncertain",
      rationale:
        "There is no source with which to confirm or correct the claim, so a reply could only ask for evidence. The post is not abusive, but engaging without evidence adds little. Evidence status: insufficient.",
    },
    communityNote: {
      recommendation: "uncertain",
      rationale:
        "A helpful note needs high-quality sources that address the claim, and none could be found; without a source a note would be rated unhelpful. Revisit if an official announcement or reporting appears. Evidence status: insufficient.",
    },
    meta: meta("insufficient-evidence", "no_sources", { claims: 2, checkworthy: 1, sources: 0, verdicts: "" }, [WARNINGS.noSourcesRetrieved]),
  },
  drafts: {
    reply: "Is there a public source for this? I couldn't find any announcement or reporting about 40 rural post-office closures, so I'd treat it as unconfirmed for now.",
    community_note:
      "No public announcement or official document confirming a plan to close 40 rural post offices next spring could be found; the post cites only an unnamed source. Readers should treat the claim as unverified.",
  },
};

const F7_POST = post(
  "awake_finance_x",
  "Awake Finance",
  "1840000000000000007",
  "The Rothschild family owns the Federal Reserve and every central bank on earth. That's why your rent doubled and your savings are worthless. They print, you pay. Wake up. 🔁 if you're done being a slave to (((them))).",
  { context: { hasMedia: true } },
);

const noEngageNoteRecommended: Fixture = {
  id: "no-engage-note-recommended",
  title: "Viral conspiracy post: don't engage, but add a note",
  scenario: "KEY DEMO: viral post with a false checkable claim wrapped in antisemitic conspiracy framing: do not engage (amplification/harassment risk) but a Community Note is recommended.",
  post: F7_POST,
  analysis: {
    post: F7_POST,
    classification: {
      headline: "False claim in an antisemitic conspiracy frame",
      labels: ["potentially_antisemitic", "misinformation", "factual_claim"],
      explanation:
        "The post's central factual claim, that the Rothschild family owns the Federal Reserve and all central banks, is false: the Federal Reserve's Board of Governors is a US federal agency and the regional Reserve Banks are owned by member banks under statutory rules, not by any family, and most central banks are state institutions. The claim is embedded in the Rothschild conspiracy myth and the triple-parentheses marker '(((them)))', which attribute control of world finance to Jews and blame them for economic hardship, a trope listed in the IHRA working definition. The economic grievances (rent, savings) are real concerns attached to a fabricated cause.",
      confidence: "high",
      disinformationScore: 90,
      manipulationSignals: ["narrative_distortion"],
      antisemitism: antisemitismOf(
        "likely",
        ["conspiracy_or_control", "collective_blame"],
        "The post uses the Rothschild family as a stand-in for Jewish financial power and the “(((them)))” marker to name Jews as the hidden owners of the world's money and the cause of readers' hardship.",
      ),
    },
    claims: [
      { id: "c1", text: "The Rothschild family owns the Federal Reserve.", type: "factual", checkworthy: true, reason: "Specific ownership claim about a public institution; checkable against official sources." },
      { id: "c2", text: "The Rothschild family owns every central bank on earth.", type: "factual", checkworthy: true, reason: "Sweeping but checkable ownership claim about public institutions." },
      { id: "c3", text: "Central-bank money printing is why rents doubled and savings are worthless.", type: "political_or_historical_argument", checkworthy: false, reason: "A causal economic argument mixing real grievances with a hidden-owner explanation; not a single checkable fact." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "The Rothschild family owns the Federal Reserve.",
        verdict: "contradicted",
        summary:
          "According to the Federal Reserve's own FAQ, the Federal Reserve is not owned by anyone: the Board of Governors is an independent agency of the federal government, and the regional Reserve Banks are owned by their member commercial banks, which hold non-transferable stock and do not control policy. No family has an ownership stake.",
        sources: [SRC.fedFaq("s1"), SRC.ajcRothschild("s2")],
      },
      {
        claimId: "c2",
        claim: "The Rothschild family owns every central bank on earth.",
        verdict: "contradicted",
        summary:
          "Central banks are overwhelmingly state institutions established by national law. The idea that a single family owns them all is a long-running antisemitic conspiracy theory with no basis in ownership records.",
        sources: [SRC.ajcRothschild("s2")],
      },
    ],
    engagement: {
      recommendation: "do_not_engage",
      rationale:
        "The post is engagement bait built on a conspiracy myth: it invites reposts and uses an antisemitic dog whistle. A public reply would boost its reach, would not persuade the author, and is likely to draw a pile-on. The factual correction is better delivered where readers see it without amplifying the post. Evidence status: the ownership claim is contradicted by an official source.",
    },
    communityNote: {
      recommendation: "recommended",
      rationale:
        "The post makes a specific, false, checkable claim about who owns the Federal Reserve, and an official source directly addresses it. A neutral note citing the Federal Reserve's own explanation plus background on the Rothschild myth gives readers important context, exactly where X's guidance says a note is helpful. Evidence status: contradicted by an official source.",
    },
    ihra: {
      assessment: "likely",
      confidence: "high",
      summary:
        "The post uses the Rothschild family as a stand-in for Jewish financial power and the “(((them)))” marker to name Jews as the hidden owners of the world's money and the cause of readers' hardship. That matches the IHRA examples of the myth of Jews controlling the economy and of blaming Jews collectively. The ownership claim itself is false.",
      findings: [
        {
          pattern: "conspiracy_or_control",
          trigger: "The Rothschild family owns the Federal Reserve and every central bank on earth.",
          ihraExample:
            "Making mendacious, dehumanizing, demonizing, or stereotypical allegations about Jews as such or the power of Jews as collective, such as the myth of Jews controlling the media, economy, government or other societal institutions.",
          whyItApplies: "It presents a Jewish family as secretly owning the world's monetary system, the core of the Rothschild conspiracy myth.",
          strengthens: [
            "“every central bank on earth” claims global, hidden control.",
            "The claim is paired with “(((them)))”, a marker used online to single out Jews.",
          ],
          weakens: ["Criticism of central banks and inflation is legitimate economic debate when it does not assign control to Jews."],
          facts: ["The Federal Reserve is not owned by any family: its Board is a federal agency and the regional banks are owned by member banks."],
          interpretations: ["The family name works as a coded reference to Jews in general."],
          confidence: "high",
        },
        {
          pattern: "collective_blame",
          trigger: "if you're done being a slave to (((them)))",
          ihraExample:
            "Accusing Jews as a people of being responsible for real or imagined wrongdoing committed by a single Jewish person or group, or even for acts committed by non-Jews.",
          whyItApplies: "Readers' real economic grievances, rent and savings, are blamed on Jews as a group, marked with triple parentheses.",
          strengthens: ["The triple-parentheses “echo” is documented as a way antisemites single out Jews online."],
          weakens: ["Without the marker, “them” could be read as bankers in general."],
          facts: ["Rising rents and inflation have many documented economic causes; none involves ownership of central banks by a family."],
          interpretations: ["“A slave to them” casts Jews as masters over everyone else."],
          confidence: "high",
        },
      ],
      mechanism:
        "Scapegoating through a coded conspiracy: real economic pain is explained by a named Jewish family and an anonymous “(((them)))”, turning monetary policy into the hidden will of Jews.",
      historicalContext:
        "The Rothschilds, a Jewish banking family whose business dates back to the 18th century, have long been accused of secretly controlling the economy and profiting from wars; Nazi Germany used the myth in propaganda, including a 1940 film produced under Goebbels. The Federal Reserve's own FAQ states that no one owns it in the ordinary sense.",
      omittedDifferences: [
        "Public institutions established by law, versus private family ownership",
        "Many economic causes of rising rents, versus a single hidden culprit",
      ],
      tropeTransfers: [],
      semanticDisplacements: [],
      communityNote2: {
        text:
          "The Federal Reserve is not owned by the Rothschilds or by any family: its Board of Governors is a federal agency and the regional Reserve Banks are owned by member banks under law. The post links real economic hardship to a Jewish family and to “(((them)))”, a typographic marker antisemites use online to single out Jews, turning monetary policy into a story of hidden Jewish control. Nazi propaganda used the same Rothschild myth. The IHRA working definition lists the myth of Jews controlling the economy as an example of antisemitism.",
        sources: [SRC.fedFaq("s1"), SRC.ajcRothschild("s2"), SRC.ajcEcho("h1"), SRC.stateIhra("h2")],
      },
      sources: [SRC.fedFaq("s1"), SRC.ajcRothschild("s2"), SRC.ajcEcho("h1"), SRC.stateIhra("h2")],
    },
    meta: meta("no-engage-note-recommended", "full", { claims: 3, checkworthy: 2, sources: 2, verdicts: "c1=contradicted, c2=contradicted" }, [], { sources: 2, note: "likely; conspiracy_or_control, collective_blame" }),
  },
  drafts: {
    reply:
      "The Federal Reserve isn't owned by any family. The Board of Governors is a federal agency and the regional banks are owned by member banks holding non-transferable stock; they don't set policy. Source: https://www.federalreserve.gov/faqs/about_14986.htm",
    community_note:
      "The Federal Reserve is not owned by the Rothschild family or any private family. Its Board of Governors is an independent agency of the US federal government, and the 12 regional Reserve Banks are owned by member commercial banks that hold non-transferable stock and have no say over monetary policy. The claim that the Rothschilds control central banks is a long-running antisemitic conspiracy theory. https://www.federalreserve.gov/faqs/about_14986.htm https://www.ajc.org/translatehate/rothschild",
  },
};

const F8_POST = post(
  "the_daily_lampoon",
  "The Daily Lampoon",
  "1840000000000000008",
  "SATIRE: Ministry of Common Sense announces every citizen must pass a 10-question quiz before posting online. 'Most of you will be fine,' says spokesperson, before failing the quiz live on air.",
);

const bothNotRecommended: Fixture = {
  id: "both-not-recommended",
  title: "Clearly labelled satire",
  scenario: "Post where neither action makes sense (clearly labelled satire): both not recommended.",
  post: F8_POST,
  analysis: {
    post: F8_POST,
    classification: {
      headline: "Labelled satire, no factual issue",
      labels: ["benign"],
      explanation:
        "The post is explicitly labelled satire and describes an obviously fictional government announcement. It makes no genuine factual claim, contains nothing antisemitic and is not attempting to mislead.",
      confidence: "high",
      disinformationScore: 3,
      antisemitism: { assessment: "not_detected", categories: [], explanation: NOT_ANTISEMITIC_NO_REFERENCE },
    },
    claims: [],
    evidence: [],
    engagement: {
      recommendation: "do_not_engage",
      rationale: "The post is clearly labelled satire with no factual claim; a reply would add no context. Evidence status: not applicable.",
    },
    communityNote: {
      recommendation: "not_recommended",
      rationale: "X's guidance rates notes on clearly labelled satire as 'not needed'; there is no factual claim for a note to address.",
    },
    meta: meta("both-not-recommended", "no_claims", { claims: 0, checkworthy: 0, sources: 0, verdicts: "" }),
  },
  drafts: {},
};

const F9_POST = post(
  "history_teacher_mk",
  "M. K., history teacher",
  "1840000000000000009",
  "Just saw a post claiming 'the Jews control the banks'. That exact line was Nazi propaganda in the 1930s, used to justify stripping Jews of their rights before the Holocaust. It isn't analysis, it's a hundred-year-old trope. Please report posts like that.",
);

const mentionNotUse: Fixture = {
  id: "mention-not-use",
  title: "Quoting a trope in order to condemn it",
  scenario: "A post quoting an antisemitic trope in order to condemn it: not antisemitic (mention, not use), benign, both not recommended.",
  post: F9_POST,
  analysis: {
    post: F9_POST,
    classification: {
      headline: "Quotes an antisemitic trope in order to condemn it",
      labels: ["benign", "factual_claim", "political_or_historical_argument"],
      explanation:
        "The post quotes the 'Jews control the banks' trope only to identify and condemn it, and explains its use in Nazi propaganda. Mentioning an antisemitic trope in order to counter it is not antisemitic. Its historical claim, that Nazi propaganda spread the myth of Jewish financial control and used it to justify persecution, is accurate.",
      confidence: "high",
      disinformationScore: 3,
      antisemitism: { assessment: "not_detected", categories: [], explanation: "The trope is quoted in order to condemn it (mention, not use); the post opposes antisemitism." },
    },
    claims: [
      { id: "c1", text: "Nazi propaganda in the 1930s promoted the claim that Jews control the banks and used it to justify stripping Jews of their rights.", type: "factual", checkworthy: true, reason: "Specific historical claim; checkable against historical scholarship." },
      { id: "c2", text: "Posts making that claim should be reported.", type: "opinion", checkworthy: false, reason: "A recommendation, not a fact." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "Nazi propaganda in the 1930s promoted the claim that Jews control the banks and used it to justify stripping Jews of their rights.",
        verdict: "supported",
        summary:
          "Nazi propaganda repeatedly portrayed Jews as controlling finance and the economy, drawing on older conspiracy myths such as the Protocols of the Elders of Zion, and used these claims to justify anti-Jewish laws and persecution.",
        sources: [SRC.ushmmPropaganda("s1"), SRC.ushmmProtocols("s2")],
      },
    ],
    engagement: {
      recommendation: "do_not_engage",
      rationale: "The post is accurate and already provides the historical context; a factual reply would add nothing beyond agreement. Evidence status: supported by sources.",
    },
    communityNote: {
      recommendation: "not_recommended",
      rationale: "The post's factual claim is accurate and well supported, so a note is not needed. Notes are also not meant for posts that merely quote a claim in order to rebut it.",
    },
    meta: meta("mention-not-use", "full", { claims: 2, checkworthy: 1, sources: 2, verdicts: "c1=supported" }),
  },
  drafts: {},
};

const F10_POST = post(
  "cooling_facts",
  "Cooling Facts",
  "1840000000000000010",
  "Global average temperature was LOWER in 2018 than in 2016. Two years of cooling. Still want to talk about 'global warming'? The data says otherwise. 📉",
);

const misleadingFraming: Fixture = {
  id: "misleading-framing",
  title: "True numbers, cherry-picked comparison",
  scenario: "True numbers with misleading framing (cherry-picked comparison): misleading_framing, partially_supported, note recommended, engage.",
  post: F10_POST,
  analysis: {
    post: F10_POST,
    classification: {
      headline: "Accurate numbers, misleading framing",
      labels: ["misleading_framing", "factual_claim"],
      explanation:
        "The specific comparison is accurate: 2016, boosted by a strong El Niño, was warmer than 2018 in the NASA and NOAA records. But presenting a two-year dip as evidence against global warming is cherry-picking: the long-term trend is strongly upward, 2018 was itself among the warmest years on record, and year-to-year variation from El Niño and La Niña is expected. The numbers are right; the conclusion drawn from them is misleading.",
      confidence: "high",
      disinformationScore: 62,
      manipulationSignals: ["selective_framing", "material_omission"],
      antisemitism: { assessment: "not_detected", categories: [], explanation: NOT_ANTISEMITIC_NO_REFERENCE },
    },
    claims: [
      { id: "c1", text: "Global average temperature was lower in 2018 than in 2016, which the post presents as two years of cooling that contradict global warming.", type: "factual", checkworthy: true, reason: "A specific statistical comparison plus the conclusion drawn from it; checkable against the temperature record." },
    ],
    evidence: [
      {
        claimId: "c1",
        claim: "Global average temperature was lower in 2018 than in 2016, which the post presents as two years of cooling that contradict global warming.",
        verdict: "partially_supported",
        summary:
          "NASA and NOAA records show 2016 was the warmest year on record at the time and 2018 was slightly cooler, so the comparison is accurate. However, 2018 was still one of the warmest years ever recorded and the long-term trend since the late 1800s is strongly upward; short-term dips after El Niño years are expected and do not indicate that warming has stopped.",
        sources: [SRC.nasaTemp("s1"), SRC.climateGov("s2")],
      },
    ],
    engagement: {
      recommendation: "engage",
      rationale:
        "The post makes a checkable statistical claim and draws a misleading conclusion; a short, factual reply that acknowledges the correct numbers and adds the long-term trend could genuinely inform readers and is unlikely to backfire. Evidence status: partially supported by authoritative sources.",
    },
    communityNote: {
      recommendation: "recommended",
      rationale:
        "The post uses accurate figures to draw a misleading conclusion; a neutral note providing the long-term context with authoritative sources directly addresses the claim and would help readers. Evidence status: partially supported, well sourced.",
    },
    meta: meta("misleading-framing", "full", { claims: 1, checkworthy: 1, sources: 2, verdicts: "c1=partially_supported" }),
  },
  drafts: {
    reply:
      "2018 was indeed slightly cooler than 2016, which was boosted by a strong El Niño. But 2018 was still one of the warmest years on record and the long-term trend is clearly upward. Two-year dips don't reverse it. https://climate.nasa.gov/vital-signs/global-temperature/",
    community_note:
      "2016 was warmer than 2018 in the NASA and NOAA records, largely because of a strong El Niño in 2016. However, 2018 was still among the warmest years since records began in 1880, and the long-term trend is strongly upward; short-term year-to-year dips are expected and do not indicate that warming has stopped. https://climate.nasa.gov/vital-signs/global-temperature/ https://www.climate.gov/news-features/understanding-climate/climate-change-global-temperature",
  },
};

const RAW_FIXTURES: Fixture[] = [
  misleadingClaim,
  antisemiticClaim,
  antisemiticNoClaim,
  politicalOpinion,
  benignFactual,
  insufficientEvidence,
  noEngageNoteRecommended,
  bothNotRecommended,
  mentionNotUse,
  misleadingFraming,
];

// ---------------------------------------------------------------------------
// Manipulation analysis per demo post (triggers are the posts' own words)
// ---------------------------------------------------------------------------

const NO_MANIPULATION: Manipulation = { level: "none", summary: "", findings: [] };

const MANIPULATION: Record<string, Manipulation> = {
  "misleading-claim": {
    level: "central",
    summary: "An unnamed study is asserted as settled science, the missing coverage is explained away, and fear for children closes the argument.",
    findings: [
      { technique: "false_authority", trigger: "A new peer-reviewed study just CONFIRMED", explanation: "The study is never named or linked; its authority is asserted, not shown, and no such study exists in the literature.", confidence: "high" },
      { technique: "conspiracy_framing", trigger: "The mainstream media won't touch it.", explanation: "The absence of coverage is explained as suppression, which turns the lack of evidence into proof.", confidence: "high" },
      { technique: "emotional_appeal", trigger: "Protect your kids.", explanation: "Fear for children stands in for the evidence the claim would need.", confidence: "high" },
    ],
  },
  "antisemitic-claim": {
    level: "central",
    summary: "A dated statistic is stacked onto an ethnic control myth, then relabelled as neutral ownership data.",
    findings: [
      { technique: "scapegoating", trigger: "every single one is run by Jewish executives. That's why you never hear the truth.", explanation: "What the public is not told is blamed on the ethnicity of executives, a culprit in place of an explanation of media ownership.", confidence: "high" },
      { technique: "conspiracy_framing", trigger: "Not a conspiracy, just ownership records.", explanation: "Presents a hidden, coordinated control of information and pre-empts the objection by relabelling the conspiracy as records.", confidence: "high" },
      { technique: "misleading_statistics", trigger: "6 companies control 90% of American media", explanation: "A dated figure from a 2012 infographic is stated as a current fact and used as the base for a far bigger claim.", confidence: "medium" },
    ],
  },
  "antisemitic-no-claim": {
    level: "central",
    summary: "Dehumanising wording does all the work; there is no claim to assess.",
    findings: [
      { technique: "loaded_language", trigger: "jews are rats.", explanation: "A dehumanising label presented as description, with a long history in propaganda that prepared persecution.", confidence: "high" },
    ],
  },
  "insufficient-evidence": {
    level: "present",
    summary: "An unverifiable insider and a nudge to spread the news, around a claim that may or may not turn out true.",
    findings: [
      { technique: "false_authority", trigger: "A friend inside the ministry told me", explanation: "An anonymous insider is the only source; nothing about it can be checked.", confidence: "medium" },
      { technique: "urgency_or_call_to_action", trigger: "Screenshot this.", explanation: "Invites readers to spread the claim before it can be checked, treating a prediction as a scoop.", confidence: "medium" },
    ],
  },
  "no-engage-note-recommended": {
    level: "central",
    summary: "Economic anger is aimed at a hidden Jewish owner of the world's money, marked with a coded signal and turned into a call to repost.",
    findings: [
      { technique: "scapegoating", trigger: "That's why your rent doubled and your savings are worthless.", explanation: "Real hardship is pinned on one family, a culprit in place of the many causes of rents and inflation.", confidence: "high" },
      { technique: "conspiracy_framing", trigger: "The Rothschild family owns the Federal Reserve and every central bank on earth.", explanation: "A hidden owner of the world's money explains everything and can never be checked; the ownership claim itself is false.", confidence: "high" },
      { technique: "bait_or_dog_whistle", trigger: "(((them)))", explanation: "The triple parentheses are a coded marker that names Jews to those who know it, with deniability for everyone else.", confidence: "high" },
      { technique: "urgency_or_call_to_action", trigger: "Wake up. 🔁 if you're done being a slave to (((them))).", explanation: "Reposting is framed as an act of liberation, pressure to share rather than to check.", confidence: "high" },
    ],
  },
  "misleading-framing": {
    level: "central",
    summary: "A cherry-picked two-year dip stands in for the trend, and the science is misstated as a promise that every year gets warmer.",
    findings: [
      { technique: "cherry_picking", trigger: "Global average temperature was LOWER in 2018 than in 2016. Two years of cooling.", explanation: "Two years are picked from a rising record; 2016 was an El Niño peak, so almost any later year looks like cooling.", confidence: "high" },
      { technique: "misleading_statistics", trigger: "The data says otherwise.", explanation: "Year-to-year noise is presented as the trend; the same data put 2018 among the warmest years on record.", confidence: "high" },
      { technique: "strawman", trigger: "Still want to talk about 'global warming'?", explanation: "Treats the science as a promise that every year is warmer than the last, then knocks that promise down.", confidence: "medium" },
    ],
  },
};

/** Validated at module load: an invalid fixture is a bug and must fail loudly. */
export const FIXTURES: Fixture[] = RAW_FIXTURES.map((raw) => {
  const fixture: Fixture = {
    ...raw,
    analysis: { ...raw.analysis, classification: { ...raw.analysis.classification, manipulation: MANIPULATION[raw.id] ?? NO_MANIPULATION } },
  };
  const parsed = FixtureSchema.safeParse(fixture);
  if (!parsed.success) {
    throw new Error(`Invalid fixture "${fixture.id}": ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
});

const ids = new Set(FIXTURES.map((f) => f.id));
if (ids.size !== FIXTURES.length) throw new Error("Fixture ids must be unique");

export function findFixture(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}
