// Extracted from oracleIRExecutorBattlefieldDestroyStep.ts.
// Cluster: CR 702.12 indestructible checks for destroy effects.
// Public entry: executorPermanentHasIndestructible.

import type { BattlefieldPermanent } from '../../shared/src';
import { permanentHasAttachmentGrantedKeyword } from '../../shared/src/attachmentKeywordGrants';
import { battlefieldPermanentHasFlying } from './oracleIRExecutorBattlefieldPermanentMatchers';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';

function abilityListHasIndestructible(values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  return values.some((value) => String(value || '').toLowerCase().includes('indestructible'));
}

function nativeOracleGrantsIndestructible(oracleTextRaw: string): boolean {
  const cleaned = String(oracleTextRaw || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\n+/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);

  for (const line of cleaned) {
    if (!line.includes('indestructible')) continue;
    if (/\bcreate\b/i.test(line) && /\btoken\b/i.test(line)) continue;
    if (/\b(?:enchanted|equipped|fortified)\s+(?:creature|permanent|land)\b/.test(line)) continue;
    if (/^(?:[a-z ,'-]+,\s*)*indestructible(?:\s*,\s*[a-z ,'-]+)*$/i.test(line)) return true;
    if (
      (/\bis indestructible\b/.test(line) || /\bhas indestructible\b/.test(line))
      && !/\bas long as\b/.test(line)
      && !/\buntil end of turn\b/.test(line)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Rule 702.12: a permanent with indestructible can't be destroyed.
 * Covers native keywords, until-EOT grants (And They Shall Know No Fear),
 * counters, and Equipment/Aura grants. Does not scan unrelated oracle mentions
 * such as "Equipped creature has indestructible" on the equipment itself.
 */
function abilitySetGrantsIndestructible(values: unknown): boolean {
  if (!values) return false;
  if (values instanceof Set) {
    for (const value of values) {
      if (String(value || '').toLowerCase().includes('indestructible')) return true;
    }
    return false;
  }
  return abilityListHasIndestructible(values);
}

/** Static lords already computed onto the live game (Sephara, Avacyn). */
function derivedContinuousGrantsIndestructible(permanent: any, state: unknown): boolean {
  const derived = (state as { _derivedContinuousEffects?: any } | null)?._derivedContinuousEffects;
  if (!derived || !permanent) return false;
  const permanentId = String(permanent?.id || '').trim();
  if (!permanentId) return false;
  const creatureEffects = derived.perPermanent?.get?.(permanentId);
  if (abilitySetGrantsIndestructible(creatureEffects?.abilities)) return true;
  const permanentLevel = derived.permanentAbilities?.get?.(permanentId);
  return abilitySetGrantsIndestructible(permanentLevel);
}

/**
 * Printed static grants that the destroy step must honor even when the derived
 * continuous-effect cache has not been refreshed yet.
 * "Other creatures you control with flying have indestructible." (Sephara)
 * "Creatures you control have indestructible." / "Other creatures you control have indestructible."
 */
function printedStaticGrantsIndestructible(
  permanent: any,
  battlefield: readonly BattlefieldPermanent[],
): boolean {
  if (!permanent || battlefield.length === 0) return false;
  if (!hasExecutorClass(permanent, 'creature')) return false;
  const selfId = String(permanent?.id || '').trim();
  const controllerId = String(permanent?.controller || '').trim();
  if (!controllerId) return false;

  for (const source of battlefield) {
    if (String((source as any)?.controller || '').trim() !== controllerId) continue;
    const oracle = String((source as any)?.card?.oracle_text || '')
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase();
    if (!oracle.includes('indestructible')) continue;
    const sourceId = String((source as any)?.id || '').trim();
    if (
      /other creatures you control with flying have indestructible/.test(oracle)
      && sourceId !== selfId
      && battlefieldPermanentHasFlying(permanent)
    ) {
      return true;
    }
    if (
      /(?:^|[.\n])\s*other creatures you control have indestructible/.test(oracle)
      && sourceId !== selfId
    ) {
      return true;
    }
    if (/(?:^|[.\n])\s*creatures you control have indestructible/.test(oracle)) {
      return true;
    }
  }
  return false;
}

export function executorPermanentHasIndestructible(
  permanent: BattlefieldPermanent | any,
  battlefield: readonly BattlefieldPermanent[] = [],
  state?: unknown,
): boolean {
  if (!permanent) return false;

  if (abilityListHasIndestructible((permanent as any).grantedAbilities)) return true;
  if (abilityListHasIndestructible((permanent as any).grantedKeywords)) return true;
  if (abilityListHasIndestructible((permanent as any).keywords)) return true;
  if (abilityListHasIndestructible((permanent as any)?.card?.keywords)) return true;
  if (abilityListHasIndestructible((permanent as any).tempAbilities)) return true;

  const counters = ((permanent as any)?.counters || {}) as Record<string, number>;
  for (const [counterName, counterValue] of Object.entries(counters)) {
    if (String(counterName).toLowerCase() === 'indestructible' && Number(counterValue || 0) > 0) {
      return true;
    }
  }

  const temporaryAbilities = Array.isArray((permanent as any)?.temporaryAbilities)
    ? (permanent as any).temporaryAbilities
    : [];
  for (const entry of temporaryAbilities) {
    const text = typeof entry === 'string' ? entry : entry?.ability;
    if (/\bindestructible\b/i.test(String(text || ''))) return true;
  }

  const temporaryEffects = Array.isArray((permanent as any)?.temporaryEffects)
    ? (permanent as any).temporaryEffects
    : [];
  for (const effect of temporaryEffects) {
    if (abilityListHasIndestructible((effect as any)?.grantedAbilities)) return true;
    if (/\bindestructible\b/i.test(String((effect as any)?.description || ''))) return true;
  }

  const modifiers = Array.isArray((permanent as any)?.modifiers) ? (permanent as any).modifiers : [];
  for (const modifier of modifiers) {
    if (abilityListHasIndestructible((modifier as any)?.keywords)) return true;
  }

  if (nativeOracleGrantsIndestructible(String((permanent as any)?.card?.oracle_text || ''))) {
    return true;
  }

  if (battlefield.length > 0 && permanentHasAttachmentGrantedKeyword(permanent, [...battlefield], 'indestructible')) {
    return true;
  }

  if (derivedContinuousGrantsIndestructible(permanent, state)) return true;
  if (printedStaticGrantsIndestructible(permanent, battlefield)) return true;

  return false;
}
