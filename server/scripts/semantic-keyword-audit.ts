/*
  Semantic keyword IR audit — identifies keyword grants, generic metadata fallbacks,
  annihilator trigger metadata gaps, and full-card unknown keyword fragments.

  Run:
    cd server
    npx tsx scripts/semantic-keyword-audit.ts

  Output:
    server/scripts/out/semantic-keyword-audit.json
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText } from './executor-coverage-audit.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outPath = path.join(__dirname, 'out', 'semantic-keyword-audit.json');

const GENERIC_METADATA_TARGETS = new Set([
  'keyword ability',
  'keyword action',
  'keyword',
  'reminder text',
  'reminder text residual',
  'pass19 residual',
  'pass30 residual',
  'pass32 residual',
  'pass21 residual',
  'pass29 residual',
  'pass34 residual',
  'pass44 residual',
]);

const STATIC_COMBAT_KEYWORDS = new Set([
  'flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'menace', 'reach',
  'first strike', 'double strike', 'hexproof', 'indestructible', 'flash', 'defender',
  'hexproof from instants and sorceries', 'hexproof from creatures',
]);

const ANNIHILATOR_TRIGGER_PATTERN = /^annihilator\s+\d+$/;

const KEYWORDISH_TEXT =
  /\b(?:flying|trample|haste|vigilance|lifelink|deathtouch|menace|reach|first strike|double strike|hexproof|indestructible|annihilator\s+\d+|ward\s+\{?\d|prowess|myriad|exalted|afterlife\s+\d+|mobilize\s+\d+|bloodthirst\s+\d+|bushido\s+\d+|soulshift\s+\d+|dredge\s+\d+|miracle\s+\{|firebending\s+\d+|earthbend|airbend|waterbend)\b/i;

const COMPOUND_KEYWORD_UNKNOWN =
  /^(?:trample|flying|haste|vigilance|lifelink|deathtouch|menace|reach|first strike|double strike|hexproof|indestructible),?\s+(?:trample|flying|haste|vigilance|lifelink|deathtouch|menace|reach|first strike|double strike|hexproof|indestructible|ward\s+\{|firebending\s+\d+)/i;

function isExternallyHandledKeywordStaticLine(text: string, steps: readonly { kind?: string }[]): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (/^max speed\s+[—-]/i.test(normalized)) return true;
  if (/^bloodthirst\s+\d+\s*\(/i.test(normalized) && steps.length === 0) return true;
  if (/^enchant creature without flying$/i.test(normalized)) return true;
  if (/^x can't be 0\. activate only during your turn\b/i.test(normalized)) return true;
  if (/^station\s+\(/i.test(normalized) && steps.length === 0) return true;
  return false;
}

type Cluster = {
  key: string;
  category: string;
  count: number;
  exampleCards: string[];
  exampleRaw: string[];
};

function bump(map: Map<string, Cluster>, category: string, key: string, card: string, raw: string): void {
  const fullKey = `${category}|${key}`;
  const existing = map.get(fullKey);
  if (existing) {
    existing.count += 1;
    if (existing.exampleCards.length < 5 && !existing.exampleCards.includes(card)) {
      existing.exampleCards.push(card);
    }
    if (existing.exampleRaw.length < 3 && !existing.exampleRaw.includes(raw)) {
      existing.exampleRaw.push(raw.slice(0, 160));
    }
    return;
  }
  map.set(fullKey, {
    key,
    category,
    count: 1,
    exampleCards: [card],
    exampleRaw: [raw.slice(0, 160)],
  });
}

function targetText(step: Record<string, unknown>): string {
  const target = step.target as { text?: string; kind?: string } | undefined;
  return String(target?.text || target?.kind || '').trim().toLowerCase();
}

function walkSteps(steps: readonly unknown[], visit: (step: Record<string, unknown>) => void): void {
  for (const entry of steps) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    visit(step);
    if (Array.isArray(step.steps)) walkSteps(step.steps, visit);
    if (Array.isArray(step.modes)) {
      for (const mode of step.modes) {
        if (mode && typeof mode === 'object' && Array.isArray((mode as any).steps)) {
          walkSteps((mode as any).steps, visit);
        }
      }
    }
    if (Array.isArray(step.results)) {
      for (const result of step.results) {
        if (result && typeof result === 'object' && Array.isArray((result as any).steps)) {
          walkSteps((result as any).steps, visit);
        }
      }
    }
  }
}

function hasSacrificeMetadata(step: Record<string, unknown>): boolean {
  if (!Array.isArray(step.steps)) return false;
  return step.steps.some((s) => s && typeof s === 'object' && String((s as any).kind || '') === 'sacrifice');
}

function hasAttackTriggerEffectText(step: Record<string, unknown>): boolean {
  const lines = Array.isArray(step.effectText) ? step.effectText : [];
  return lines.some((line) => /whenever this creature attacks/i.test(String(line || '')));
}

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const clusters = new Map<string, Cluster>();

let triggerEffectsScanned = 0;
let commanderCardsScanned = 0;
let triggerIrGapKeywordish = 0;
let fullCardUnknownKeywordish = 0;

const properGrantCounts = new Map<string, number>();

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  commanderCardsScanned += 1;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  // --- Trigger-effect scope (executor audit path) ---
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    triggerEffectsScanned += 1;

    for (const gap of hasUnknownIRSteps(effect, card.name)) {
      if (KEYWORDISH_TEXT.test(gap)) {
        triggerIrGapKeywordish += 1;
        bump(clusters, 'trigger_ir_gap', gap.slice(0, 100), card.name, gap);
      }
    }

    const steps = collectStepsFromIrText(effect, card.name);
    walkSteps(steps, (step) => {
      const kind = String(step.kind || '');
      if (kind !== 'grant_static_ability' && kind !== 'grant_temporary_ability') return;

      const target = targetText(step);
      const abilities = Array.isArray(step.abilities)
        ? (step.abilities as string[]).map((a) => String(a).toLowerCase())
        : [];
      const raw = String(step.raw || '');

      if (GENERIC_METADATA_TARGETS.has(target)) {
        const label = String((step.effectText as string[] | undefined)?.[0] || raw).slice(0, 90);
        bump(clusters, 'trigger_generic_metadata', `${kind}|${target}|${label}`, card.name, raw);
        return;
      }

      for (const ability of abilities) {
        properGrantCounts.set(`${kind}|${ability}`, (properGrantCounts.get(`${kind}|${ability}`) || 0) + 1);

        if (ANNIHILATOR_TRIGGER_PATTERN.test(ability)) {
          const hasMeta = hasSacrificeMetadata(step) || hasAttackTriggerEffectText(step);
          if (!hasMeta) {
            bump(
              clusters,
              'annihilator_missing_trigger_meta',
              `${kind}|${ability}|target:${target || 'unknown'}`,
              card.name,
              raw
            );
          } else {
            bump(clusters, 'annihilator_with_trigger_meta', `${kind}|${ability}`, card.name, raw);
          }
        }
      }

      // Ward in effectText only (not in abilities array)
      if (/\bward\s+\{/i.test(raw) && !abilities.some((a) => a.startsWith('ward'))) {
        bump(clusters, 'ward_not_in_abilities_array', kind, card.name, raw);
      }
    });
  }

  // --- Full-card IR scope ---
  const ir = parseOracleTextToIR(oracle, card.name);
  for (const ability of ir.abilities || []) {
    walkSteps(ability.steps || [], (step) => {
      if (String(step.kind || '') !== 'unknown') return;
      const raw = String(step.raw || '').trim();
      if (!KEYWORDISH_TEXT.test(raw)) return;

      fullCardUnknownKeywordish += 1;
      if (COMPOUND_KEYWORD_UNKNOWN.test(raw)) {
        bump(clusters, 'full_card_compound_keyword_unknown', raw.slice(0, 90), card.name, raw);
      } else if (/^\(?a creature with indestructible/i.test(raw)) {
        bump(clusters, 'full_card_indestructible_reminder_unknown', raw.slice(0, 90), card.name, raw);
      } else if (/^enchant creature without flying/i.test(raw)) {
        bump(clusters, 'full_card_restriction_not_keyword', raw.slice(0, 90), card.name, raw);
      } else {
        bump(clusters, 'full_card_keyword_unknown', raw.slice(0, 90), card.name, raw);
      }
    });

    // Full-card static lines that are keyword-only abilities (type line bleed)
    const text = String(ability.text || ability.effectText || '').trim();
    const steps = ability.steps || [];
    if (
      ability.type === 'static' &&
      KEYWORDISH_TEXT.test(text) &&
      !/\b(?:when|whenever|at the beginning|choose|destroy|create|draw|exile|sacrifice)\b/i.test(text) &&
      !isExternallyHandledKeywordStaticLine(text, steps) &&
      steps.length > 0 &&
      steps.every((s) => s.kind === 'unknown')
    ) {
      bump(clusters, 'full_card_static_keyword_line_unparsed', text.slice(0, 90), card.name, text);
    }
  }
}

function topClusters(category: string, limit = 25): Cluster[] {
  return [...clusters.values()]
    .filter((c) => c.category === category)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function topProperGrants(limit = 20): { key: string; count: number }[] {
  return [...properGrantCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    commanderCardsScanned: commanderCardsScanned,
    triggerEffectsScanned: triggerEffectsScanned,
    scopeNotes: [
      'trigger_* categories use collectStepsFromIrText (executor trigger-effect path)',
      'full_card_* categories use parseOracleTextToIR on full combined oracle text',
      'ir_gap for triggers is separate; see executor:coverage for ir_gap count',
    ],
  },
  summary: {
    triggerIrGapKeywordish,
    triggerGenericMetadataHits: topClusters('trigger_generic_metadata').reduce((s, c) => s + c.count, 0),
    triggerGenericMetadataPatterns: topClusters('trigger_generic_metadata').length,
    annihilatorMissingTriggerMeta: topClusters('annihilator_missing_trigger_meta').reduce((s, c) => s + c.count, 0),
    annihilatorWithTriggerMeta: topClusters('annihilator_with_trigger_meta').reduce((s, c) => s + c.count, 0),
    fullCardUnknownKeywordish,
    fullCardCompoundKeywordUnknown: topClusters('full_card_compound_keyword_unknown').reduce((s, c) => s + c.count, 0),
    wardNotInAbilitiesArray: topClusters('ward_not_in_abilities_array').reduce((s, c) => s + c.count, 0),
  },
  topProperKeywordGrants: topProperGrants(25),
  clusters: {
    trigger_ir_gap: topClusters('trigger_ir_gap'),
    trigger_generic_metadata: topClusters('trigger_generic_metadata'),
    annihilator_missing_trigger_meta: topClusters('annihilator_missing_trigger_meta'),
    annihilator_with_trigger_meta: topClusters('annihilator_with_trigger_meta'),
    ward_not_in_abilities_array: topClusters('ward_not_in_abilities_array'),
    full_card_compound_keyword_unknown: topClusters('full_card_compound_keyword_unknown'),
    full_card_keyword_unknown: topClusters('full_card_keyword_unknown'),
    full_card_static_keyword_line_unparsed: topClusters('full_card_static_keyword_line_unparsed'),
    full_card_indestructible_reminder_unknown: topClusters('full_card_indestructible_reminder_unknown'),
    full_card_restriction_not_keyword: topClusters('full_card_restriction_not_keyword'),
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('Semantic Keyword IR Audit');
console.log('========================');
console.log(`Commander-legal cards: ${commanderCardsScanned}`);
console.log(`Trigger effects scanned: ${triggerEffectsScanned}`);
console.log(`Trigger keyword-ish ir_gaps: ${triggerIrGapKeywordish}`);
console.log(`Trigger generic metadata hits: ${report.summary.triggerGenericMetadataHits} (${report.summary.triggerGenericMetadataPatterns} patterns)`);
console.log(`Annihilator missing attack-trigger metadata: ${report.summary.annihilatorMissingTriggerMeta}`);
console.log(`Annihilator with attack-trigger metadata: ${report.summary.annihilatorWithTriggerMeta}`);
console.log(`Full-card keyword-ish unknown steps: ${fullCardUnknownKeywordish}`);
console.log(`Full-card compound keyword unknowns: ${report.summary.fullCardCompoundKeywordUnknown}`);
console.log(`Ward in raw but not abilities[]: ${report.summary.wardNotInAbilitiesArray}`);
console.log(`\nWrote report: ${outPath}`);
