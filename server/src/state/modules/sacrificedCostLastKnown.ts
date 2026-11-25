/**
 * CR 608.2h / 117.1f: last-known information for permanents sacrificed to pay a spell's cost.
 *
 * Thud / Fling / Bone Splinters-style spells ("deals damage equal to the sacrificed creature's
 * power") resolve after the sacrificed permanent is gone. The cast commit only persists the
 * sacrificed ids, so the castSpell event snapshots each permanent right before the sacrifice and
 * stamps the snapshots on the new stack item as `lastSacrificedPermanents`; the spell's Oracle IR
 * context reads them back at resolution. The same event runs live and on replay, so both agree.
 */
import { readCurrentPowerFromHook, readCurrentToughnessFromHook } from '../../../../rules-engine/src/currentPowerToughnessHook.js';
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readLastKnownStat(state: any, permanent: any, which: 'power' | 'toughness'): number | null {
  try {
    const current = which === 'power'
      ? readCurrentPowerFromHook(state, permanent)
      : readCurrentToughnessFromHook(state, permanent);
    if (current !== null && Number.isFinite(Number(current))) return Number(current);
  } catch (err) {
    reportHookFailure('lki.sacrificedCost.currentPT', err, {
      cardName: String(permanent?.card?.name || ''),
      source: 'sacrificedCostLastKnown',
    });
  }
  const effective = finiteOrNull(which === 'power' ? permanent?.effectivePower : permanent?.effectiveToughness);
  if (effective !== null) return effective;
  const base = finiteOrNull(which === 'power' ? permanent?.basePower : permanent?.baseToughness)
    ?? finiteOrNull(permanent?.card?.[which]);
  if (base === null) return null;
  const counters = permanent?.counters || {};
  const plus = finiteOrNull(counters['+1/+1']) ?? 0;
  const minus = finiteOrNull(counters['-1/-1']) ?? 0;
  return base + plus - minus;
}

/** Snapshot of a battlefield permanent taken right before it is sacrificed as a cost. */
export function buildSacrificedCostLastKnownSnapshot(state: any, permanentId: string): Record<string, any> | null {
  const id = String(permanentId || '').trim();
  if (!id) return null;
  const battlefield = Array.isArray(state?.battlefield) ? (state.battlefield as any[]) : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '').trim() === id);
  if (!permanent) return null;
  const card = permanent.card && typeof permanent.card === 'object' ? permanent.card : {};
  const typeLine = String(card.type_line || permanent.type_line || '');
  const power = readLastKnownStat(state, permanent, 'power');
  const toughness = readLastKnownStat(state, permanent, 'toughness');
  const manaValue = finiteOrNull(card.cmc ?? card.mana_value ?? card.manaValue);
  const colors = Array.isArray(permanent.colors) ? permanent.colors : (Array.isArray(card.colors) ? card.colors : []);
  return {
    id,
    name: String(card.name || permanent.name || ''),
    controller: String(permanent.controller || '') || undefined,
    owner: String(permanent.owner || permanent.controller || '') || undefined,
    typeLine: typeLine.toLowerCase(),
    type_line: typeLine,
    power,
    toughness,
    manaValue,
    colors: [...colors],
    counters: { ...(permanent.counters || {}) },
    isToken: permanent.isToken === true,
    card: {
      name: card.name,
      type_line: card.type_line,
      power: card.power,
      toughness: card.toughness,
      cmc: card.cmc,
      mana_cost: card.mana_cost,
      colors: Array.isArray(card.colors) ? [...card.colors] : card.colors,
    },
  };
}

/** Stamp cost-sacrifice snapshots on the cast stack item (keeps any snapshots already there). */
export function stampSacrificedCostLastKnown(stackItem: any, snapshots: readonly any[]): void {
  if (!stackItem || typeof stackItem !== 'object' || snapshots.length === 0) return;
  if (Array.isArray(stackItem.lastSacrificedPermanents) && stackItem.lastSacrificedPermanents.length > 0) return;
  stackItem.lastSacrificedPermanents = snapshots.map((snapshot) => ({ ...snapshot }));
}

/**
 * IR context for a resolving activated ability whose source left the battlefield, usually sacrificed as
 * its cost (Ghitu Fire-Eater "it deals damage equal to its power", Shrine of Burning Rage "the number of
 * charge counters on it", Wall of Limbs "where X is this creature's power"). Reads the activation's
 * `sourceLastKnown`, else the cost snapshot in `lastSacrificedPermanents` with the source's id.
 */
export function activationSourceLastKnownContext(
  sourceItem: any,
  sourcePermanentId: string | undefined,
  battlefield: readonly any[],
): { sourceLastKnownPermanent?: Record<string, any> } {
  const id = String(sourcePermanentId || sourceItem?.source || '').trim();
  if (id && battlefield.some((perm: any) => perm && String(perm.id || '').trim() === id)) return {};
  const candidates: any[] = [];
  const direct = sourceItem?.sourceLastKnown;
  if (direct && typeof direct === 'object' && (!id || !direct.id || String(direct.id).trim() === id)) candidates.push(direct);
  const sacrificed = Array.isArray(sourceItem?.lastSacrificedPermanents) ? sourceItem.lastSacrificedPermanents : [];
  if (id) {
    for (const entry of sacrificed) {
      if (entry && typeof entry === 'object' && String(entry.id || '').trim() === id) candidates.push(entry);
    }
  }
  const lastKnown = candidates[0];
  if (!lastKnown) return {};
  return {
    sourceLastKnownPermanent: {
      ...lastKnown,
      ...(id && !lastKnown.id ? { id } : {}),
      counters: { ...(lastKnown.counters || {}) },
    },
  };
}

/** IR context fields for a resolving spell whose cost sacrificed permanents. */
export function sacrificedCostLastKnownContext(sourceItem: any): { lastSacrificedPermanents?: any[] } {
  const snapshots = sourceItem?.lastSacrificedPermanents;
  if (!Array.isArray(snapshots) || snapshots.length === 0) return {};
  return {
    lastSacrificedPermanents: snapshots
      .filter((entry: any) => entry && typeof entry === 'object')
      .map((entry: any) => ({ ...entry })),
  };
}
