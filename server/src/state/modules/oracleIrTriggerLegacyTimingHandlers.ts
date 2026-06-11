import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { queueBecomesUntappedTriggers } from './triggers/tap-untap.js';
import { debug } from '../../utils/debug.js';
import { scheduleDelayedDrawAtNextUpkeep } from './triggerDelayedEffectUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

const IRREGULAR_PLURALS: Record<string, string> = {
  elves: 'elf',
  wolves: 'wolf',
  dwarves: 'dwarf',
  halves: 'half',
  leaves: 'leaf',
  knives: 'knife',
  lives: 'life',
  selves: 'self',
  calves: 'calf',
};

const SMALL_NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseSmallNumberWord(value: string, fallback = 1): number {
  const normalized = String(value || '').toLowerCase().trim();
  if (SMALL_NUMBER_WORDS[normalized] !== undefined) return SMALL_NUMBER_WORDS[normalized];
  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripActivatedAbilityCostPrefix(text: string): string {
  const normalized = String(text || '').replace(/[’]/g, "'").trim();
  const colonIndex = normalized.indexOf(':');
  return colonIndex >= 0 ? normalized.slice(colonIndex + 1).trim() : normalized;
}

function parseDelayedDrawAtNextUpkeep(text: string): { count: number; remainingText: string } | null {
  const normalized = stripActivatedAbilityCostPrefix(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const delayedDrawPattern = /\bdraw\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+at\s+the\s+beginning\s+of\s+the\s+next\s+turn's\s+upkeep\.?/i;
  const match = normalized.match(delayedDrawPattern);
  if (!match) return null;

  const remainingText = normalized
    .replace(delayedDrawPattern, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/^\s*[.;,]\s*/, '')
    .replace(/\s*[.;,]\s*$/, '')
    .trim();

  return {
    count: parseSmallNumberWord(match[1], 1),
    remainingText,
  };
}

function remainingTextIsOnlyLibraryLook(text: string): boolean {
  const remaining = stripActivatedAbilityCostPrefix(text)
    .replace(/\s+/g, ' ')
    .replace(/\blook at the top card of target player's library\.?/gi, '')
    .replace(/\blook at the top card of (?:your|each opponent's|that player's) library\.?/gi, '')
    .replace(/[\s.;,]+/g, '')
    .trim();
  return remaining.length === 0;
}

function singularizeCreatureTypeName(typeName: string): string {
  const lower = String(typeName || '').trim().toLowerCase();
  if (!lower) return lower;
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];
  if (lower.endsWith('s') && lower.length > 1) return lower.slice(0, -1);
  return lower;
}

export interface DelayedDrawAtNextUpkeepResult {
  readonly matched: boolean;
  readonly stopProcessing?: boolean;
  readonly updatedDesc?: string;
  readonly updatedDescriptionForOracleFallback?: string;
}

export interface TriggerLegacyTimingParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly descriptionForOracleFallback: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep(
  params: TriggerLegacyTimingParams,
): DelayedDrawAtNextUpkeepResult {
  const delayedDrawSourceText = String(params.description || '').trim()
    || String(params.triggerItem?.activatedAbilityText || '').trim();
  const delayedDrawAtNextUpkeep = parseDelayedDrawAtNextUpkeep(delayedDrawSourceText);
  if (!delayedDrawAtNextUpkeep) {
    return { matched: false };
  }

  if (skipRetiredTriggerLegacyHandler(delayedDrawSourceText, params.sourceName)) {
    return { matched: false };
  }

  scheduleDelayedDrawAtNextUpkeep(params.ctx, {
    playerId: String(params.controller || '').trim(),
    sourceName: params.sourceName,
    sourceId: String(
      params.triggerItem?.source || params.triggerItem?.sourceId || params.triggerItem?.permanentId || '',
    ).trim() || undefined,
    count: delayedDrawAtNextUpkeep.count,
  });

  const updatedDesc = delayedDrawAtNextUpkeep.remainingText.replace(/[’]/g, "'").toLowerCase();
  const updatedDescriptionForOracleFallback = delayedDrawAtNextUpkeep.remainingText;
  if (!updatedDesc || remainingTextIsOnlyLibraryLook(delayedDrawAtNextUpkeep.remainingText)) {
    return {
      matched: true,
      stopProcessing: true,
      updatedDesc,
      updatedDescriptionForOracleFallback,
    };
  }

  return {
    matched: true,
    stopProcessing: false,
    updatedDesc,
    updatedDescriptionForOracleFallback,
  };
}

export function applyRetiredTriggerLegacyUntapAllCreatureType(
  params: TriggerLegacyTimingParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const untapAllCreatureTypeMatch = params.desc.match(/untap all (\w+(?:\s+\w+)*) you control/i);
  if (!untapAllCreatureTypeMatch) {
    return false;
  }

  const rawType = untapAllCreatureTypeMatch[1].toLowerCase().trim();
  const standardBulkTypes = new Set([
    'land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts',
    'enchantment', 'enchantments', 'permanent', 'permanents',
    'other creature', 'other creatures',
  ]);
  if (standardBulkTypes.has(rawType) || rawType.startsWith('other ')) {
    return false;
  }

  const creatureType = singularizeCreatureTypeName(rawType);
  const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  let untappedCount = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== params.controller || !perm.tapped) continue;
    if (!permanentHasCreatureTypeNow(perm, creatureType)) continue;
    perm.tapped = false;
    queueBecomesUntappedTriggers(params.ctx, perm);
    untappedCount++;
  }

  if (untappedCount > 0 && typeof (params.ctx as any).bumpSeq === 'function') {
    (params.ctx as any).bumpSeq();
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName}: untapped ${untappedCount} ${rawType} for ${params.controller}`);
  return true;
}
