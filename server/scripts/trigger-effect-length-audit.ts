/*
  Trigger Effect Length Audit

  Compares lengths of triggered-ability effect text across extraction paths to
  surface accidental first-period / first-sentence truncation:

  - referenceChars: rules-engine parseTriggeredAbilitiesFromText (gameplay-normalized effect)
  - registryChars:  analyzeCardTriggers registration path
  - naiveChars:     legacy ([^.]+) first-sentence capture after trigger condition
  - irRawChars:     sum of Oracle IR step.raw for the reference effect text
  - irStepCount:    parsed step count

  Run:
    npm run trigger:effect-length-audit --workspace=server

  Optional env:
    EFFECT_LENGTH_TOP=40
    EFFECT_LENGTH_MIN_GAP=24        (min reference - other chars to report)
    EFFECT_LENGTH_ONLY_GAPS=1
    EFFECT_LENGTH_EVENT=END_STEP,ENTERS_BATTLEFIELD
    EFFECT_LENGTH_COMMANDER_ONLY=1  (default 1)
*/

import fs from 'node:fs';
import path from 'node:path';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import type { TriggeredAbility } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import { extractTriggeredEffectFromTimingMatch } from '../../rules-engine/src/triggerEffectTextExtraction.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { parseBareTriggerEffectFragmentSteps } from '../../rules-engine/src/oracleIRParserPostprocess.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import { readOracleCardsSync, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';

type OracleCard = {
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  games?: string[];
  digital?: boolean;
  oversized?: boolean;
  set_type?: string;
  border_color?: string;
  set?: string;
  legalities?: Record<string, string>;
};

const UN_SETS_FOR_IR_GAP_AUDIT = new Set([
  'ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd', 'acr', 'sunf',
]);

function isCommanderLegalCard(card: OracleCard): boolean {
  return String(card.legalities?.commander || '').toLowerCase() === 'legal';
}

function isIgnorableCardForIrGap(card: OracleCard): boolean {
  const border = String(card.border_color || '').toLowerCase();
  if (border === 'silver' || border === 'gold') return true;
  if (/\(minigame\)/i.test(card.name)) return true;
  if (isCommanderLegalCard(card)) return false;
  if (String(card.set_type || '').toLowerCase() === 'funny') return true;
  if (UN_SETS_FOR_IR_GAP_AUDIT.has(String(card.set || '').toLowerCase())) return true;
  return false;
}

function getCombinedOracleText(card: OracleCard): string {
  const faces = card.card_faces;
  if (Array.isArray(faces) && faces.length > 0) {
    const parts = faces
      .map((face) => String(face?.oracle_text || '').trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  return String(card.oracle_text || '');
}

function isEligible(card: OracleCard): boolean {
  const oracle = getCombinedOracleText(card).trim();
  if (!oracle) return false;
  if (Array.isArray(card.games) && !card.games.includes('paper')) return false;
  if (card.digital === true || card.oversized === true) return false;
  const setType = String(card.set_type || '').toLowerCase();
  if (setType === 'token' || setType === 'memorabilia' || setType === 'minigame') return false;
  const border = String(card.border_color || '').toLowerCase();
  if (border === 'silver' || border === 'gold') return false;
  if (/\bOBJECTIVE:\b/i.test(oracle) || /\|\s*\d+\s*pack/i.test(oracle) || /\(minigame\)/i.test(card.name)) {
    return false;
  }
  return true;
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const oraclePath = resolveOracleCardsPath(repoRoot);
const outDir = path.join(import.meta.dirname, 'out');
const outPath = path.join(outDir, 'trigger-effect-length-audit.json');

const TOP = Math.max(1, Number.parseInt(String(process.env.EFFECT_LENGTH_TOP || '40'), 10) || 40);
const MIN_GAP = Math.max(1, Number.parseInt(String(process.env.EFFECT_LENGTH_MIN_GAP || '24'), 10) || 24);
const ONLY_GAPS = String(process.env.EFFECT_LENGTH_ONLY_GAPS || '1') !== '0';
const COMMANDER_ONLY = String(process.env.EFFECT_LENGTH_COMMANDER_ONLY || '1') !== '0';
const EVENT_FILTER = String(process.env.EFFECT_LENGTH_EVENT || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function charLen(text: string): number {
  return normalizeText(text).length;
}

const CONTINUATION_MARKERS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'each_player', pattern: /\beach player\b/i },
  { id: 'each_opponent', pattern: /\beach opponent\b/i },
  { id: 'then_clause', pattern: /\bthen\b/i },
  { id: 'if_you_do', pattern: /\bif you do\b/i },
  { id: 'otherwise', pattern: /\botherwise\b/i },
  { id: 'you_may_put_land', pattern: /\byou may put a land\b/i },
  { id: 'draws_a_card', pattern: /\bdraws? (?:a card|\d+ cards?)\b/i },
];

function missingContinuationMarkers(reference: string, candidate: string): string[] {
  const missing: string[] = [];
  for (const marker of CONTINUATION_MARKERS) {
    if (marker.pattern.test(reference) && !marker.pattern.test(candidate)) {
      missing.push(marker.id);
    }
  }
  return missing;
}

function triggerConditionText(trigger: TriggeredAbility): string {
  return normalizeText(
    trigger.condition
    || trigger.triggerFilter
    || trigger.interveningIfClause
    || '',
  );
}

/**
 * Simulates legacy `([^.]+)` capture: first sentence only after the trigger condition.
 */
function naiveFirstSentenceEffect(oracleText: string, trigger: TriggeredAbility): string {
  const oracle = String(oracleText || '');
  const condition = triggerConditionText(trigger);
  if (!condition) return '';

  const lowerOracle = oracle.toLowerCase();
  const lowerCondition = condition.toLowerCase();
  const idx = lowerOracle.indexOf(lowerCondition);
  if (idx < 0) return '';

  const afterCondition = oracle.slice(idx + condition.length);
  const commaMatch = afterCondition.match(/^[,\s]*([^.]+)/);
  return commaMatch ? String(commaMatch[1] || '').trim() : '';
}

type RegistryPattern = {
  readonly id: string;
  readonly regex: RegExp;
  readonly effectGroup?: number;
};

/** Mirrors triggers/registry.ts patterns (without importing server modules). */
const REGISTRY_PATTERNS: readonly RegistryPattern[] = [
  { id: 'upkeep', regex: /at the beginning of (?:your )?upkeep,?\s*([^.]+)/ },
  { id: 'postcombat_main', regex: /at the beginning of (?:(?:each of )?your )?(?:post-?combat|second) main phases?,?\s*([^.]+(?:\.\s*if you do,?\s*[^.]+)?)/i },
  { id: 'end_step', regex: /at the beginning of (?:your |each )?end step,?\s*([^.]+)/ },
  { id: 'etb_self', regex: /when (?:~|this creature|this permanent|this enchantment) enters(?: the battlefield)?,?\s*([^.]+)/ },
  { id: 'etb_creature', regex: /whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/ },
  { id: 'etb_artifact', regex: /whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/ },
  { id: 'etb_enchantment', regex: /whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/ },
  { id: 'etb_permanent', regex: /whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/ },
  { id: 'attack', regex: /whenever (?:~|this creature) attacks,?\s*([^.]+)/ },
  { id: 'combat_damage', regex: /whenever (?:~|this creature) deals combat damage to (?:a player|an opponent),?\s*([^.]+)/ },
  { id: 'dies_self', regex: /when (?:~|this creature) dies,?\s*([^.]+)/ },
  { id: 'dies_creature', regex: /whenever (?:a|another) creature you control dies,?\s*([^.]+)/ },
  { id: 'tap', regex: /whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/ },
  { id: 'draw', regex: /whenever (?:you|a player|an opponent) draws? (?:a card|cards),?\s*([^.]+)/ },
  { id: 'cast', regex: /whenever you cast (?:a |an )?(\w+)?\s*spell,?\s*([^.]+)/, effectGroup: 2 },
];

function collectRegistryEffects(oracleText: string, mode: 'extracted' | 'capture_only'): string[] {
  const lowerOracle = String(oracleText || '').toLowerCase();
  const effects: string[] = [];
  for (const pattern of REGISTRY_PATTERNS) {
    const match = lowerOracle.match(pattern.regex);
    if (!match) continue;
    const group = pattern.effectGroup ?? 1;
    if (mode === 'capture_only') {
      effects.push(String(match[group] || '').trim());
      continue;
    }
    effects.push(extractTriggeredEffectFromTimingMatch(lowerOracle, match, group));
  }
  return effects.filter(Boolean);
}

function collectIrStepsForEffect(effectText: string, cardName: string): readonly OracleEffectStep[] {
  const text = normalizeText(effectText);
  if (!text) return [];
  const bare = parseBareTriggerEffectFragmentSteps(text);
  if (bare && bare.length > 0) return bare;
  const ir = parseOracleTextToIR(text, cardName);
  const fromAbilities = (ir.abilities || []).flatMap((ability) => ability.steps || []);
  return fromAbilities as OracleEffectStep[];
}

function bestMatchingEffect(referenceEffect: string, candidates: readonly string[]): string {
  const refNorm = normalizeText(referenceEffect).toLowerCase();
  if (!refNorm) return '';
  let best = '';
  for (const candidate of candidates) {
    const effect = normalizeText(candidate);
    if (!effect) continue;
    const effNorm = effect.toLowerCase();
    const overlaps = refNorm.startsWith(effNorm) || effNorm.startsWith(refNorm.slice(0, Math.min(24, refNorm.length)));
    if (overlaps && effect.length > best.length) {
      best = effect;
    }
  }
  return best;
}

function sumIrStepRawChars(steps: readonly { raw?: string }[]): number {
  return steps.reduce((sum, step) => sum + String(step.raw || '').trim().length, 0);
}

type GapKind =
  | 'registry_truncated'
  | 'registry_capture_only_truncated'
  | 'registry_matches_naive'
  | 'detector_truncated'
  | 'detector_matches_naive'
  | 'naive_would_truncate'
  | 'ir_low_step_coverage'
  | 'missing_continuation_markers';

type EffectLengthRow = {
  card: string;
  event: string;
  triggerCondition: string;
  referenceChars: number;
  registryExtractedChars: number;
  registryCaptureOnlyChars: number;
  detectorExtractedChars: number;
  naiveChars: number;
  irRawChars: number;
  irStepCount: number;
  registryGap: number;
  registryCaptureGap: number;
  detectorGap: number;
  naiveGap: number;
  irRawGap: number;
  gapKinds: GapKind[];
  missingMarkers: string[];
  referenceSnippet: string;
  registrySnippet: string;
  registryCaptureSnippet: string;
  detectorSnippet: string;
  naiveSnippet: string;
};

function classifyRow(row: Omit<EffectLengthRow, 'gapKinds' | 'registryGap' | 'registryCaptureGap' | 'detectorGap' | 'naiveGap' | 'irRawGap'>): EffectLengthRow {
  const registryGap = row.referenceChars - row.registryExtractedChars;
  const registryCaptureGap = row.referenceChars - row.registryCaptureOnlyChars;
  const detectorGap = row.referenceChars - row.detectorExtractedChars;
  const naiveGap = row.referenceChars - row.naiveChars;
  const irRawGap = row.referenceChars - row.irRawChars;
  const gapKinds: GapKind[] = [];

  if (row.registryExtractedChars > 0 && registryGap >= MIN_GAP && row.registryExtractedChars / row.referenceChars < 0.85) {
    gapKinds.push('registry_truncated');
  }
  if (row.registryCaptureOnlyChars > 0 && registryCaptureGap >= MIN_GAP && row.registryCaptureOnlyChars / row.referenceChars < 0.85) {
    gapKinds.push('registry_capture_only_truncated');
  }
  if (row.detectorExtractedChars > 0 && detectorGap >= MIN_GAP && row.detectorExtractedChars / row.referenceChars < 0.85) {
    gapKinds.push('detector_truncated');
  }
  if (naiveGap >= MIN_GAP && row.naiveChars / row.referenceChars < 0.85) {
    gapKinds.push('naive_would_truncate');
  }
  if (
    row.registryExtractedChars > 0
    && Math.abs(row.registryExtractedChars - row.naiveChars) <= 4
    && registryGap >= MIN_GAP
  ) {
    gapKinds.push('registry_matches_naive');
  }
  if (
    row.detectorExtractedChars > 0
    && Math.abs(row.detectorExtractedChars - row.naiveChars) <= 4
    && detectorGap >= MIN_GAP
  ) {
    gapKinds.push('detector_matches_naive');
  }
  if (row.irStepCount > 0 && irRawGap >= MIN_GAP && row.irRawChars / row.referenceChars < 0.55) {
    gapKinds.push('ir_low_step_coverage');
  }
  if (row.missingMarkers.length > 0 && Math.max(registryGap, registryCaptureGap, detectorGap) >= MIN_GAP) {
    gapKinds.push('missing_continuation_markers');
  }

  return {
    ...row,
    registryGap,
    registryCaptureGap,
    detectorGap,
    naiveGap,
    irRawGap,
    gapKinds,
  };
}

function snippet(text: string, max = 110): string {
  const normalized = normalizeText(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

type DetectorCollector = {
  collectEffects(card: OracleCard): string[];
};

const FAKE_PERMANENT = {
  id: 'AUDIT_SRC',
  controller: 'P1',
  owner: 'P1',
  zone: 'battlefield',
};

async function loadDetectorCollector(): Promise<DetectorCollector | null> {
  try {
    const registry = await import('../src/state/modules/triggers/registry.js');
    const turnPhases = await import('../src/state/modules/triggers/turn-phases.js');
    const landfall = await import('../src/state/modules/triggers/landfall.js');
    const cardDraw = await import('../src/state/modules/triggers/card-draw.js');
    const combat = await import('../src/state/modules/triggers/combat.js');
    const zoneChanges = await import('../src/state/modules/triggers/zone-changes.js');
    const spellCast = await import('../src/state/modules/triggers/spell-cast.js');
    const tapUntap = await import('../src/state/modules/triggers/tap-untap.js');
    const discard = await import('../src/state/modules/triggers/discard.js');
    const sacrifice = await import('../src/state/modules/triggers/sacrifice.js');
    const tokens = await import('../src/state/modules/triggers/tokens.js');
    const mill = await import('../src/state/modules/triggers/mill.js');
    const counters = await import('../src/state/modules/triggers/counters.js');
    const zoneChange = await import('../src/state/modules/triggers/zone-change.js');
    const lifegain = await import('../src/state/modules/triggers/lifegain.js');
    const lifeLoss = await import('../src/state/modules/triggers/life-loss.js');

    const pushEffects = (
      bucket: string[],
      items: Array<{ effect?: string; description?: string }> | undefined,
    ) => {
      for (const item of items || []) {
        const effect = normalizeText(String(item.effect || item.description || ''));
        if (effect) bucket.push(effect);
      }
    };

    const safeDetect = <T extends { effect?: string; description?: string }>(
      fn: () => T[],
    ): T[] => {
      try {
        return fn();
      } catch {
        return [];
      }
    };

    return {
      collectEffects(card) {
        const cardObj = {
          name: card.name,
          oracle_text: getCombinedOracleText(card),
          type_line: card.type_line,
        };
        const effects: string[] = [];
        pushEffects(effects, safeDetect(() => registry.analyzeCardTriggers(cardObj, 'AUDIT_SRC', 'P1')));
        pushEffects(effects, safeDetect(() => zoneChanges.detectETBTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => zoneChanges.detectDeathTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => combat.detectAttackTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => combat.detectCombatDamageTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => combat.detectBlockTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => combat.detectBeginningOfCombatTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => combat.detectEndOfCombatTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => spellCast.detectSpellCastTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => tapUntap.detectTapTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => tapUntap.detectUntapTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => discard.detectDiscardTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => turnPhases.detectEndStepTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => turnPhases.detectDrawStepTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => landfall.detectLandfallTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => cardDraw.detectCardDrawTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => sacrifice.detectSacrificeTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => tokens.detectTokenCreatedTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => mill.detectMillTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => counters.detectCounterPlacedTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => counters.detectCounterRemovedTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => zoneChange.detectLeftGraveyardTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => zoneChange.detectPutIntoGraveyardTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => zoneChange.detectExiledFromBattlefieldTriggers(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => lifegain.detectGainedLifeTriggersFromOracle(cardObj, FAKE_PERMANENT)));
        pushEffects(effects, safeDetect(() => lifeLoss.detectLifeLossTriggers(cardObj, FAKE_PERMANENT)));
        return effects;
      },
    };
  } catch (error) {
    console.warn('Detector probing disabled:', (error as Error)?.message || error);
    return null;
  }
}

const detectorCollector = await loadDetectorCollector();
const detectorEffectsByCard = new Map<string, string[]>();

function getDetectorEffects(card: OracleCard): string[] {
  const key = card.name;
  if (detectorEffectsByCard.has(key)) return detectorEffectsByCard.get(key)!;
  const effects = detectorCollector?.collectEffects(card) || [];
  detectorEffectsByCard.set(key, effects);
  return effects;
}

if (!fs.existsSync(oraclePath)) {
  console.error(`Oracle cards file not found at ${oraclePath}`);
  process.exit(1);
}
const cards = readOracleCardsSync(repoRoot) as OracleCard[];

const rows: EffectLengthRow[] = [];
const byEvent = new Map<string, {
  triggers: number;
  registryTruncated: number;
  detectorTruncated: number;
  registryMatchesNaive: number;
  detectorMatchesNaive: number;
  naiveWouldTruncate: number;
}>();

let triggersScanned = 0;

for (const card of cards) {
  if (!isEligible(card)) continue;
  if (COMMANDER_ONLY && !isCommanderLegalCard(card)) continue;
  if (isIgnorableCardForIrGap(card)) continue;

  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  const triggers = parseTriggeredAbilitiesFromText(oracle, 'AUDIT_SRC', 'P1', card.name);
  if (triggers.length === 0) continue;

  for (const trigger of triggers) {
    const event = String(trigger.event || 'unknown');
    if (EVENT_FILTER.length > 0 && !EVENT_FILTER.includes(event)) continue;

    const referenceEffect = normalizeText(trigger.effect || '');
    if (!referenceEffect) continue;

    triggersScanned += 1;
    const referenceChars = referenceEffect.length;
    const registryExtracted = bestMatchingEffect(
      referenceEffect,
      collectRegistryEffects(oracle, 'extracted'),
    );
    const registryCaptureOnly = bestMatchingEffect(
      referenceEffect,
      collectRegistryEffects(oracle, 'capture_only'),
    );
    const naiveEffect = naiveFirstSentenceEffect(oracle, trigger);
    const detectorExtracted = bestMatchingEffect(referenceEffect, getDetectorEffects(card));
    const irSteps = collectIrStepsForEffect(referenceEffect, card.name);

    const baseRow = {
      card: card.name,
      event,
      triggerCondition: triggerConditionText(trigger),
      referenceChars,
      registryExtractedChars: charLen(registryExtracted),
      registryCaptureOnlyChars: charLen(registryCaptureOnly),
      detectorExtractedChars: charLen(detectorExtracted),
      naiveChars: charLen(naiveEffect),
      irRawChars: sumIrStepRawChars(irSteps),
      irStepCount: irSteps.length,
      missingMarkers: missingContinuationMarkers(
        referenceEffect,
        detectorExtracted || registryExtracted || registryCaptureOnly || naiveEffect,
      ),
      referenceSnippet: snippet(referenceEffect),
      registrySnippet: snippet(registryExtracted),
      registryCaptureSnippet: snippet(registryCaptureOnly),
      detectorSnippet: snippet(detectorExtracted),
      naiveSnippet: snippet(naiveEffect),
    };

    const row = classifyRow(baseRow);
    if (ONLY_GAPS && row.gapKinds.length === 0) continue;
    rows.push(row);

    const bucket = byEvent.get(event) || {
      triggers: 0,
      registryTruncated: 0,
      detectorTruncated: 0,
      registryMatchesNaive: 0,
      detectorMatchesNaive: 0,
      naiveWouldTruncate: 0,
    };
    bucket.triggers += 1;
    if (row.gapKinds.includes('registry_truncated')) bucket.registryTruncated += 1;
    if (row.gapKinds.includes('detector_truncated')) bucket.detectorTruncated += 1;
    if (row.gapKinds.includes('registry_matches_naive')) bucket.registryMatchesNaive += 1;
    if (row.gapKinds.includes('detector_matches_naive')) bucket.detectorMatchesNaive += 1;
    if (row.gapKinds.includes('naive_would_truncate')) bucket.naiveWouldTruncate += 1;
    byEvent.set(event, bucket);
  }
}

rows.sort((a, b) => {
  const gapDelta = b.detectorGap - a.detectorGap;
  if (gapDelta !== 0) return gapDelta;
  return b.referenceChars - a.referenceChars;
});

const topRows = rows.slice(0, TOP);
const samplesByGapKind: Record<string, EffectLengthRow[]> = {};
for (const row of rows) {
  for (const kind of row.gapKinds) {
    const bucket = samplesByGapKind[kind] || [];
    if (bucket.length < 12) bucket.push(row);
    samplesByGapKind[kind] = bucket;
  }
}
const summary = {
  triggersScanned,
  gapRows: rows.length,
  registryTruncated: rows.filter((row) => row.gapKinds.includes('registry_truncated')).length,
  registryCaptureOnlyTruncated: rows.filter((row) => row.gapKinds.includes('registry_capture_only_truncated')).length,
  detectorTruncated: rows.filter((row) => row.gapKinds.includes('detector_truncated')).length,
  registryMatchesNaive: rows.filter((row) => row.gapKinds.includes('registry_matches_naive')).length,
  detectorMatchesNaive: rows.filter((row) => row.gapKinds.includes('detector_matches_naive')).length,
  naiveWouldTruncate: rows.filter((row) => row.gapKinds.includes('naive_would_truncate')).length,
  irLowStepCoverage: rows.filter((row) => row.gapKinds.includes('ir_low_step_coverage')).length,
  byEvent: Object.fromEntries(
    [...byEvent.entries()]
      .sort((a, b) => b[1].detectorTruncated - a[1].detectorTruncated)
      .map(([event, stats]) => [event, stats]),
  ),
  detectorProbingEnabled: detectorCollector != null,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ summary, topRows, samplesByGapKind, generatedAt: new Date().toISOString() }, null, 2));

console.log('Trigger effect length audit');
console.log(`  triggers scanned: ${summary.triggersScanned}`);
console.log(`  gap rows:         ${summary.gapRows}`);
console.log(`  detector probing:       ${summary.detectorProbingEnabled ? 'enabled' : 'disabled'}`);
console.log(`  registry truncated (>=${MIN_GAP} chars vs reference): ${summary.registryTruncated}`);
console.log(`  registry capture-only truncated (no extract helper):  ${summary.registryCaptureOnlyTruncated}`);
console.log(`  detector truncated (runtime detect* paths):           ${summary.detectorTruncated}`);
console.log(`  registry ≈ naive first sentence:                      ${summary.registryMatchesNaive}`);
console.log(`  detector ≈ naive first sentence:                      ${summary.detectorMatchesNaive}`);
console.log(`  naive would truncate (reference longer):              ${summary.naiveWouldTruncate}`);
console.log(`  IR step.raw under-coverage:                         ${summary.irLowStepCoverage}`);
console.log('');
console.log('Top events by detector truncation count:');
for (const [event, stats] of Object.entries(summary.byEvent).slice(0, 12)) {
  console.log(
    `  ${event}: ${stats.detectorTruncated}/${stats.triggers} detector-truncated, ${stats.registryTruncated} registry-truncated`,
  );
}
console.log('');
console.log(`Top ${topRows.length} gaps (reference → detector / registry / naive / IR raw):`);
for (const row of topRows) {
  console.log(
    `  [${row.gapKinds.join(', ')}] ${row.card} (${row.event}) ` +
      `ref=${row.referenceChars} det=${row.detectorExtractedChars} reg=${row.registryExtractedChars} ` +
      `naive=${row.naiveChars} irRaw=${row.irRawChars}/${row.irStepCount} steps`,
  );
  if (row.missingMarkers.length > 0) {
    console.log(`    missing markers: ${row.missingMarkers.join(', ')}`);
  }
  console.log(`    ref: ${row.referenceSnippet}`);
  if (row.detectorExtractedChars > 0) console.log(`    det: ${row.detectorSnippet}`);
  if (row.registryExtractedChars > 0) console.log(`    reg: ${row.registrySnippet}`);
  if (row.naiveChars > 0) console.log(`    naive: ${row.naiveSnippet}`);
}
console.log('');
console.log(`Wrote report: ${outPath}`);

process.exit(0);
