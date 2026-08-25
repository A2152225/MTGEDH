import type { GameContext } from '../context.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../../rules-engine/targeting.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';
import { persistBattlefieldPermanentPatchAfterMutation } from '../effects/battlefieldPermanentReplayPersistence.js';
import { updateCounters } from './counters_tokens.js';

const WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseNumberWord(word: string | undefined, defaultValue: number = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export function splitGrantedTemporaryAbilities(rawAbilityText: string): string[] {
  const text = String(rawAbilityText || '').trim();
  if (!text) return [];

  const quotedAbilities = [...text.matchAll(/"([^"]+)"/g)]
    .map((match) => String(match[1] || '').trim().toLowerCase())
    .filter(Boolean);
  if (quotedAbilities.length > 0) {
    return quotedAbilities;
  }

  const normalized = text.replace(/^"+|"+$/g, '').trim();
  if (!normalized) return [];

  const normalizedList = normalized.replace(/,\s+and\s+/gi, ', ').replace(/,\s+or\s+/gi, ', ');

  if (normalizedList.includes('would deal combat damage') || /^if\b/i.test(normalizedList)) {
    return [normalizedList.toLowerCase()];
  }

  return normalizedList
    .split(/\s*,\s*|\s+and\s+/i)
    .map((ability) => ability.trim().toLowerCase())
    .filter(Boolean);
}

export function applySimpleTargetedTemporarySpellEffects(
  ctx: GameContext,
  oracleText: string,
  targets: readonly any[],
  sourceName: string,
): number {
  const text = String(oracleText || '').replace(/\u2019/g, "'").trim();
  if (skipRetiredSpellLegacyHandler(text, sourceName)) {
    return 0;
  }
  // IR-primary: do not consult the categorize opcode table. Counter-put text is
  // owned by IR; this leftover only still categorizes on IR-off.
  if (!isOracleIrSpellPrimaryEnabled()) {
    const categorizeOp = categorizeSpellWithoutPrimaryRetirement(sourceName, text)?.op;
    if (categorizeOp === 'ADD_COUNTERS_TARGET' || categorizeOp === 'ADD_COUNTERS_EACH') {
      return 0;
    }
  }
  if (!text || !Array.isArray(targets) || targets.length === 0) return 0;

  const targetCounterMatch = text.match(
    /(?:^|\.\s*)put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on (?:another\s+)?(?:up to (?:one|two|three|four|five|\d+)\s+)?target creatures?(?: you control)?/i,
  );

  const targetBuffMatch = text.match(
    /(?:^|\.\s*)(?:until end of turn,?\s*)?(?:another\s+)?(?:up to (?:one|two|three|four|five|\d+)\s+)?target creatures?(?: you control)? gets? ([+-]\d+)\/([+-]\d+)(?: and gains? (.+?))?(?: until end of turn)?\.?$/i,
  );
  const targetAbilityMatch =
    text.match(
      /(?:^|\.\s*)(?:another\s+)?(?:up to (?:one|two|three|four|five|\d+)\s+)?target creatures?(?: you control)? gains? (.+?) until end of turn\.?/i,
    ) ||
    text.match(
      /(?:^|\.\s*)until end of turn,?\s*(?:another\s+)?(?:up to (?:one|two|three|four|five|\d+)\s+)?target creatures?(?: you control)? gains? (.+?)\.?$/i,
    );

  const targetCounterAbilityMatch = targetCounterMatch
    ? text.match(/(?:^|\.\s*)(?:it|they) gains? (.+?) until end of turn\.?/i)
    : null;

  if (!targetCounterMatch && !targetBuffMatch && !targetAbilityMatch) return 0;

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const counterCount = targetCounterMatch ? parseNumberWord(targetCounterMatch[1], 1) : 0;
  const powerMod = targetBuffMatch ? parseInt(targetBuffMatch[1], 10) : null;
  const toughnessMod = targetBuffMatch ? parseInt(targetBuffMatch[2], 10) : null;
  const rawAbilityText = (targetBuffMatch?.[3] || targetAbilityMatch?.[1] || targetCounterAbilityMatch?.[1] || '').trim();
  const gainedAbilities = splitGrantedTemporaryAbilities(rawAbilityText);

  let applied = 0;
  for (const targetRef of targets) {
    const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
    if (!targetId) continue;

    const targetCreature = battlefield.find((permanent: any) => permanent?.id === targetId);
    if (!targetCreature) continue;

    let modified = false;

    let patchNeeded = false;

    if (counterCount > 0) {
      // Route through updateCounters so undo/replay gets a persisted event
      // (Doubling Season / Vorinclex etc. also apply on this path).
      updateCounters(ctx as any, String(targetId), { '+1/+1': counterCount }, {
        ...(Boolean((ctx as any)?.isReplaying) ? { skipEventPersistence: true } : {}),
      });
      modified = true;
    }

    if (powerMod !== null && toughnessMod !== null) {
      targetCreature.temporaryPTMods = Array.isArray(targetCreature.temporaryPTMods) ? targetCreature.temporaryPTMods : [];
      targetCreature.temporaryPTMods.push({
        power: powerMod,
        toughness: toughnessMod,
        source: sourceName,
        expiresAt: 'end_of_turn',
        turnApplied: state?.turnNumber || 0,
      });
      modified = true;
      patchNeeded = true;
    }

    if (gainedAbilities.length > 0) {
      targetCreature.temporaryAbilities = Array.isArray(targetCreature.temporaryAbilities) ? targetCreature.temporaryAbilities : [];
      for (const ability of gainedAbilities) {
        targetCreature.temporaryAbilities.push({
          ability,
          source: sourceName,
          expiresAt: 'end_of_turn',
          turnApplied: state?.turnNumber || 0,
        });
      }
      modified = true;
      patchNeeded = true;
    }

    if (patchNeeded) {
      persistBattlefieldPermanentPatchAfterMutation(ctx as any, targetCreature, {
        sourceName,
        fields: ['temporaryPTMods', 'temporaryAbilities', 'grantedAbilities'],
      });
    }
    if (modified) {
      applied += 1;
    }
  }

  return applied;
}
