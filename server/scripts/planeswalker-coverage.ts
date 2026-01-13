/*
  Planeswalker Loyalty Coverage Report

  Scans local oracle-cards.json and prints:
  - total planeswalker loyalty lines
  - how many match a known template
  - counts by template id

  Run:
    npm run planeswalker:coverage --workspace=server
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseLoyaltyLinesFromOracleText } from "../src/state/planeswalker/oracle.js";
import { getPlaneswalkerTemplateMatch } from "../src/state/planeswalker/templates.js";

type OracleCard = {
  oracle_id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
};

function pct(n: number, d: number): string {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const oracleCardsPath = path.join(repoRoot, "oracle-cards.json");
const logsDir = path.join(repoRoot, "logs");

const WRITE_FILES = String(process.env.PW_COVERAGE_WRITE_FILES ?? "1").trim() !== "0";
const ALLOW_FALLBACK = String(process.env.PW_COVERAGE_ALLOW_FALLBACK ?? "0").trim() !== "0";

const raw = fs.readFileSync(oracleCardsPath, "utf8");
const cards = JSON.parse(raw) as OracleCard[];

const isPlaneswalker = (c: OracleCard) => /\bplaneswalker\b/i.test(c.type_line || "");

let totalLines = 0;
let matchedLines = 0;
let engineMatchedLines = 0;

const byTemplate = new Map<string, number>();
const byEnginePattern = new Map<string, number>();
const samplesUnmatched: Array<{ name: string; oracleId: string; effect: string }> = [];
const unmatchedFirstWord = new Map<string, number>();
const unmatchedByEffect = new Map<string, number>();
const unmatchedLines: Array<{
  name: string;
  oracleId: string;
  effect: string;
  normalizedEffect: string;
  firstWord: string;
  bucket: string;
}> = [];

const SAMPLE_UNMATCHED_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.PW_COVERAGE_SAMPLE_LIMIT || "30", 10) || 30
);

function firstWord(effect: string): string {
  return String(effect || "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/g, "")
    .split(/\s+/)[0];
}

function normalizeEffect(effect: string): string {
  return String(effect || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[’]/g, "'");
}

type BucketDef = {
  id: string;
  label: string;
  regex: RegExp;
};

const BUCKET_DEFS: BucketDef[] = [
  { id: "UNTIL_YOUR_NEXT_TURN", label: "Until your next turn, …", regex: /^until your next turn,/i },
  { id: "UNTIL_END_OF_TURN", label: "Until end of turn, …", regex: /^until end of turn,/i },

  { id: "LOOK_AT_TOP_N", label: "Look at the top N …", regex: /^look at the top (?:\w+|\d+) cards? of your library\./i },
  { id: "LOOK_AT_TOP_CARD_TARGET_PLAYER", label: "Look at top card of target player's library", regex: /^look at the top card of target player's library\./i },

  { id: "EXILE_TOP_N", label: "Exile top N cards", regex: /^exile the top (?:\w+|\d+) cards? of your library\b/i },
  { id: "EXILE_TOP_CARD", label: "Exile the top card", regex: /^exile the top card of your library\b/i },
  { id: "EXILE_TARGET", label: "Exile target …", regex: /^exile (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+ )?target\b/i },

  { id: "RETURN_TARGET", label: "Return target …", regex: /^return (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+ )?target\b/i },

  { id: "TARGET_PLAYER_DRAWS", label: "Target player draws", regex: /^target player draws\b/i },
  { id: "DRAW_THEN", label: "Draw … then …", regex: /^draw\b[\s\S]*\bthen\b/i },

  { id: "DESTROY_TARGET", label: "Destroy target …", regex: /^destroy (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+ )?target\b/i },
  { id: "PUT_COUNTERS", label: "Put counters", regex: /^put\b[\s\S]*\bcounter\b/i },
  { id: "CREATE_TOKEN", label: "Create token(s)", regex: /^create\b/i },
  { id: "ADD_MANA", label: "Add mana", regex: /^add\b/i },
  { id: "TAP", label: "Tap …", regex: /^tap\b/i },
  { id: "UNTAP", label: "Untap …", regex: /^untap\b/i },
  { id: "EACH_PLAYER", label: "Each player …", regex: /^each player\b/i },
  { id: "EACH_OPPONENT", label: "Each opponent …", regex: /^each opponent\b/i },
  { id: "CHOOSE", label: "Choose …", regex: /^choose\b/i },
];

function getUnmatchedBucket(effect: string): string {
  const normalized = normalizeEffect(effect).toLowerCase();
  for (const def of BUCKET_DEFS) {
    if (def.regex.test(normalized)) return def.id;
  }

  const w = firstWord(effect);
  return w ? `FIRSTWORD_${w.toUpperCase()}` : "FIRSTWORD_UNKNOWN";
}

/**
 * Lightweight matcher for engine-supported patterns that live outside the
 * planeswalker template registry (mostly implemented in stack.ts).
 *
 * This exists so the coverage report reflects actual gameplay behavior.
 */
function getEnginePatternId(effect: string): string | null {
  const text = normalizeEffect(effect).toLowerCase();

  // Previously added shared patterns (most common unmatched list)
  if (
    /^you may sacrifice a vampire\. when you do, [^\.]+ deals 3 damage to any target and you gain 3 life\.?$/i.test(text)
  ) {
    return "ENGINE_MAY_SAC_VAMPIRE_WHEN_YOU_DO_DAMAGE_GAIN";
  }
  if (
    /^create a 1\/1 white kor warrior creature token\. you may attach an equipment you control to it\.?$/i.test(text)
  ) {
    return "ENGINE_CREATE_KOR_WARRIOR_ATTACH_EQUIPMENT";
  }
  if (
    /^search your library for any number of dragon creature cards, put them onto the battlefield, then shuffle\.?$/i.test(text)
  ) {
    return "ENGINE_SEARCH_ANY_NUMBER_DRAGONS_TO_BATTLEFIELD";
  }
  if (
    /^when you next cast an instant or sorcery spell this turn, copy that spell\. you may choose new targets for the copy\.?$/i.test(text)
  ) {
    return "ENGINE_NEXT_INSTANT_SORCERY_COPY_RETARGET";
  }
  if (/^copy that spell\. you may choose new targets for the copy\.?$/i.test(text)) {
    return "ENGINE_COPY_THAT_SPELL_RETARGET";
  }
  if (/^venture into the dungeon\.(?: \([^\)]*\))?$/i.test(text)) {
    return "ENGINE_VENTURE_INTO_DUNGEON";
  }
  if (
    /^look at the top six cards of your library\. you may reveal a creature card from among them and put it into your hand\. if it's legendary, you gain 3 life\. put the rest on the bottom of your library in a random order\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_LOOK_TOP_SIX_REVEAL_CREATURE_LEGENDARY_GAIN_LIFE";
  }

  // Newly generalized patterns (formerly name-gated planeswalkers)
  if (
    /^(?:you )?draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\. then if your library has no cards in it, you win the game\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_DRAW_THEN_WIN_IF_LIBRARY_EMPTY";
  }
  if (
    /^put a \+1\/\+1 counter on each creature you control\. those creatures gain flying until your next turn\.?$/i.test(text)
  ) {
    return "ENGINE_COUNTERS_ON_EACH_CREATURE_GAIN_FLYING_UNTIL_NEXT_TURN";
  }
  if (
    /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_DRAW_THEN_DISCARD";
  }
  if (
    /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\. you get an emblem with "[\s\S]+"\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_DRAW_THEN_EMBLEM";
  }
  if (/^draw a card for each green creature you control\.?$/i.test(text)) {
    return "ENGINE_DRAW_FOR_EACH_GREEN_CREATURE";
  }
  if (
    /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target noncreature land you control\. untap it\. it becomes a 0\/0 elemental creature with vigilance and haste that's still a land\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_ANIMATE_NONCREATURE_LAND_WITH_COUNTERS";
  }
  if (
    /^you get an emblem with "[\s\S]+"\.\s*search your library for any number of forest cards, put them onto the battlefield tapped, then shuffle\.?$/i.test(
      text
    )
  ) {
    return "ENGINE_EMBLEM_THEN_SEARCH_ANY_NUMBER_FORESTS";
  }

  // Other engine patterns (implemented in stack.ts)
  if (
    /^put a \+1\/\+1 counter on each creature you control and a loyalty counter on each other planeswalker you control\.?$/i.test(text)
  ) {
    return "ENGINE_COUNTERS_ON_CREATURES_AND_LOYALTY_ON_OTHER_PLANESWALKERS";
  }
  if (
    /^gain control of all creatures until end of turn\. untap them\. they gain haste until end of turn\.?$/i.test(text)
  ) {
    return "ENGINE_GAIN_CONTROL_ALL_CREATURES_UNTIL_EOT_UNTAP_HASTE";
  }

  return null;
}

for (const card of cards) {
  if (!isPlaneswalker(card)) continue;

  const loyaltyLines = parseLoyaltyLinesFromOracleText(card.oracle_text || "");
  for (const line of loyaltyLines) {
    totalLines++;

    const effect = line.effect || "";
    const m = getPlaneswalkerTemplateMatch(effect, { allowFallback: ALLOW_FALLBACK });
    if (m) {
      matchedLines++;
      byTemplate.set(m.id, (byTemplate.get(m.id) || 0) + 1);
    } else {
      const engineId = getEnginePatternId(effect);
      if (engineId) {
        engineMatchedLines++;
        byEnginePattern.set(engineId, (byEnginePattern.get(engineId) || 0) + 1);
      } else {
        const w = firstWord(effect);
        if (w) unmatchedFirstWord.set(w, (unmatchedFirstWord.get(w) || 0) + 1);
        const normalized = normalizeEffect(effect);
        unmatchedByEffect.set(normalized, (unmatchedByEffect.get(normalized) || 0) + 1);
        const bucket = getUnmatchedBucket(normalized);
        unmatchedLines.push({
          name: card.name,
          oracleId: card.oracle_id,
          effect,
          normalizedEffect: normalized,
          firstWord: w || "",
          bucket,
        });
        if (samplesUnmatched.length < SAMPLE_UNMATCHED_LIMIT) {
          samplesUnmatched.push({ name: card.name, oracleId: card.oracle_id, effect });
        }
      }
    }
  }
}

const sorted = [...byTemplate.entries()].sort((a, b) => b[1] - a[1]);
const engineSorted = [...byEnginePattern.entries()].sort((a, b) => b[1] - a[1]);
const unmatchedFirstWordSorted = [...unmatchedFirstWord.entries()].sort((a, b) => b[1] - a[1]);
const unmatchedEffectSorted = [...unmatchedByEffect.entries()].sort((a, b) => b[1] - a[1]);

console.log("\nPlaneswalker Loyalty Coverage Report");
console.log("===================================");
console.log(`Total loyalty lines: ${totalLines}`);
console.log(`Matched by template: ${matchedLines} (${pct(matchedLines, totalLines)})`);
console.log(`Matched by engine patterns: ${engineMatchedLines} (${pct(engineMatchedLines, totalLines)})`);
console.log(`Covered total: ${matchedLines + engineMatchedLines} (${pct(matchedLines + engineMatchedLines, totalLines)})`);
console.log(
  `Unmatched: ${totalLines - matchedLines - engineMatchedLines} (${pct(
    totalLines - matchedLines - engineMatchedLines,
    totalLines
  )})`
);
for (const [id, count] of sorted) {
  console.log(`- ${id}: ${count}`);
}

if (engineSorted.length) {
  console.log("\nBy engine pattern:");
  for (const [id, count] of engineSorted) {
    console.log(`- ${id}: ${count}`);
  }
}

console.log(`\nSample unmatched (first ${SAMPLE_UNMATCHED_LIMIT}):`);
for (const s of samplesUnmatched) {
  console.log(`- ${s.name} [${s.oracleId}]: ${s.effect}`);
}

console.log("\nUnmatched first-word frequency (ALL unmatched):");
for (const [w, c] of unmatchedFirstWordSorted.slice(0, 25)) {
  console.log(`- ${w}: ${c}`);
}

console.log("\nMost common unmatched effects (ALL unmatched):");
for (const [effect, count] of unmatchedEffectSorted.slice(0, 25)) {
  console.log(`- (${count}) ${effect}`);
}

if (WRITE_FILES) {
  fs.mkdirSync(logsDir, { recursive: true });

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(
    now.getHours()
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

  const unmatchedJsonlPath = path.join(logsDir, `planeswalker-unmatched-${stamp}.jsonl`);
  const unmatchedLatestJsonlPath = path.join(logsDir, `planeswalker-unmatched.jsonl`);

  const summaryPath = path.join(logsDir, `planeswalker-unmatched-summary-${stamp}.json`);
  const summaryLatestPath = path.join(logsDir, `planeswalker-unmatched-summary.json`);

  const bucketsPath = path.join(logsDir, `planeswalker-unmatched-buckets-${stamp}.json`);
  const bucketsLatestPath = path.join(logsDir, `planeswalker-unmatched-buckets.json`);

  const jsonl = unmatchedLines
    .map((r) =>
      JSON.stringify({
        name: r.name,
        oracleId: r.oracleId,
        effect: r.effect,
        normalizedEffect: r.normalizedEffect,
        firstWord: r.firstWord,
        bucket: r.bucket,
      })
    )
    .join("\n");

  fs.writeFileSync(unmatchedJsonlPath, jsonl + (jsonl ? "\n" : ""), "utf8");
  fs.writeFileSync(unmatchedLatestJsonlPath, jsonl + (jsonl ? "\n" : ""), "utf8");

  const summary = {
    generatedAt: now.toISOString(),
    totals: {
      totalLoyaltyLines: totalLines,
      matchedByTemplate: matchedLines,
      matchedByEnginePatterns: engineMatchedLines,
      unmatched: totalLines - matchedLines - engineMatchedLines,
    },
    topUnmatchedFirstWord: unmatchedFirstWordSorted.slice(0, 50).map(([word, count]) => ({ word, count })),
    topUnmatchedEffects: unmatchedEffectSorted.slice(0, 200).map(([effect, count]) => ({ effect, count })),
  };

  const byBucket = new Map<
    string,
    {
      count: number;
      sampleCards: Array<{ name: string; oracleId: string }>;
      sampleEffects: string[];
    }
  >();

  for (const r of unmatchedLines) {
    const cur = byBucket.get(r.bucket) ?? { count: 0, sampleCards: [], sampleEffects: [] };
    cur.count++;
    if (cur.sampleCards.length < 5) cur.sampleCards.push({ name: r.name, oracleId: r.oracleId });
    if (cur.sampleEffects.length < 5) cur.sampleEffects.push(r.normalizedEffect);
    byBucket.set(r.bucket, cur);
  }

  const bucketsSorted = [...byBucket.entries()].sort((a, b) => b[1].count - a[1].count);
  const bucketLabels = new Map(BUCKET_DEFS.map((d) => [d.id, d.label] as const));

  const bucketsReport = {
    generatedAt: now.toISOString(),
    totals: {
      unmatched: totalLines - matchedLines - engineMatchedLines,
      buckets: bucketsSorted.length,
    },
    topBuckets: bucketsSorted.slice(0, 50).map(([bucket, info]) => ({
      bucket,
      label: bucketLabels.get(bucket) ?? bucket,
      count: info.count,
      sampleCards: info.sampleCards,
      sampleEffects: info.sampleEffects,
    })),
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(summaryLatestPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  fs.writeFileSync(bucketsPath, JSON.stringify(bucketsReport, null, 2) + "\n", "utf8");
  fs.writeFileSync(bucketsLatestPath, JSON.stringify(bucketsReport, null, 2) + "\n", "utf8");

  console.log(`\nWrote unmatched dump: ${path.relative(repoRoot, unmatchedLatestJsonlPath)}`);
  console.log(`Wrote unmatched summary: ${path.relative(repoRoot, summaryLatestPath)}`);
  console.log(`Wrote unmatched buckets: ${path.relative(repoRoot, bucketsLatestPath)}`);
}

console.log("\nDone.");
