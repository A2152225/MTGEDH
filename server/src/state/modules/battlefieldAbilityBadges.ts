import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import {
  KEYWORD_COUNTER_NAMES,
  permanentHasKeywordAbility,
} from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { persistedGrantedAbilitiesSurvivingLoss } from './persistedGrantedAbilityLoss.js';

/** Keywords shown as compact battlefield badges (IND, Dth, etc.). */
export const BATTLEFIELD_KEYWORD_BADGES = new Set([
  'flying',
  'indestructible',
  'vigilance',
  'trample',
  'hexproof',
  'shroud',
  'deathtouch',
  'lifelink',
  'haste',
  'menace',
  'reach',
  'first strike',
  'double strike',
  'protection',
  'ward',
  'wither',
  'infect',
  'defender',
  'flash',
]);

/** Backgrounds that grant a quoted triggered ability to commanders — not static self-keywords. */
export function isCommanderGrantBackgroundOracle(oracleText: string): boolean {
  return /commander\s+creatures?\s+you\s+own\s+have\s+"/i.test(String(oracleText || ''));
}

function normalizeAbilityBadge(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function keywordFromCounterKey(key: string): string | null {
  const name = String(key || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*counters?$/, '')
    .trim();
  if (!name || !KEYWORD_COUNTER_NAMES.includes(name)) return null;
  if (!BATTLEFIELD_KEYWORD_BADGES.has(name)) return null;
  return name;
}

function readTemporaryAbilityBadge(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const normalized = normalizeAbilityBadge(entry);
    return normalized || null;
  }
  if (entry && typeof entry === 'object') {
    const normalized = normalizeAbilityBadge((entry as { ability?: unknown }).ability);
    return normalized || null;
  }
  return null;
}

/**
 * Build client-facing ability badges for a battlefield permanent.
 * Merges persisted grants, derived continuous effects, and active until-EOT temporary abilities.
 * Backgrounds with commander-grant oracle never show keyword badges from their reminder text.
 */
export function collectBattlefieldAbilityBadgesForView(
  perm: BattlefieldPermanent,
  continuousAbilities: readonly string[],
  battlefield?: readonly any[],
): string[] {
  const typeLine = String((perm.card as any)?.type_line || '').toLowerCase();
  const isCreature = /\bcreature\b/.test(typeLine);
  const isBackground = typeLine.includes('background');
  const oracleText = String((perm.card as any)?.oracle_text || '');

  const abilities = new Set<string>();

  // With a battlefield, persisted quoted grants obey ability loss in timestamp order.
  const persisted = battlefield ? persistedGrantedAbilitiesSurvivingLoss(perm, battlefield) : (perm as any).grantedAbilities || [];
  for (const ability of [...persisted, ...continuousAbilities]) {
    const normalized = normalizeAbilityBadge(ability);
    if (normalized) abilities.add(normalized);
  }

  if (isCreature) {
    for (const entry of (perm as any).temporaryAbilities || []) {
      if (entry && typeof entry === 'object' && entry.expiresAt && entry.expiresAt !== 'end_of_turn') {
        continue;
      }
      const normalized = readTemporaryAbilityBadge(entry);
      if (normalized && BATTLEFIELD_KEYWORD_BADGES.has(normalized)) {
        abilities.add(normalized);
      }
    }
  }

  const counters = (perm as { counters?: Record<string, unknown> }).counters;
  if (counters && typeof counters === 'object') {
    for (const [key, value] of Object.entries(counters)) {
      if (!(Number(value) > 0)) continue;
      const keyword = keywordFromCounterKey(key);
      if (!keyword) continue;
      if (!permanentHasKeywordAbility(perm, keyword, battlefield)) continue;
      abilities.add(keyword);
    }
  }

  if (isBackground && isCommanderGrantBackgroundOracle(oracleText)) {
    for (const keyword of [...abilities]) {
      if (BATTLEFIELD_KEYWORD_BADGES.has(keyword)) {
        abilities.delete(keyword);
      }
    }
  }

  return [...abilities];
}
