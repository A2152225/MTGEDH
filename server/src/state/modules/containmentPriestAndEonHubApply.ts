// server/src/state/modules/containmentPriestAndEonHubApply.ts
// Live apply for two B97 census-only replacements:
//   Containment Priest — if a nontoken creature would enter the battlefield
//     and it wasn't cast, exile it instead.
//   Eon Hub — players skip their upkeep steps.
// Public: wouldContainmentPriestExileEntry, applyContainmentPriestExileIfNeeded,
//   eonHubIsInPlay, shouldSkipUpkeepForEonHub.
// Collects existing ReplacementEffectSpecs (already gathered by B97 census);
// does not edit replacementBatch97Collect.ts.

import { applyPrimevalSpawnExileIfNeeded } from './batch100PrimevalSpawnApply.js';

export const CONTAINMENT_PRIEST_EFFECT_ID = 'nontoken-uncast-enter-exile';
export const EON_HUB_EFFECT_ID = 'players-skip-upkeep';

function typeLineOf(cardOrPerm: any): string {
  return String(
    cardOrPerm?.type_line
    || cardOrPerm?.typeLine
    || cardOrPerm?.card?.type_line
    || cardOrPerm?.card?.typeLine
    || '',
  ).toLowerCase();
}

function isTokenPermanent(cardOrPerm: any): boolean {
  if (!cardOrPerm) return false;
  if (cardOrPerm.isToken === true || cardOrPerm.token === true) return true;
  if (cardOrPerm.card?.isToken === true || cardOrPerm.card?.token === true) return true;
  return typeLineOf(cardOrPerm).includes('token');
}

function isCreature(cardOrPerm: any): boolean {
  return typeLineOf(cardOrPerm).includes('creature');
}

function wasCastEntry(cardOrPerm: any, extra?: { wasCast?: boolean; enteredFromCast?: boolean; enteredFromZone?: string }): boolean {
  if (extra?.wasCast === true || extra?.enteredFromCast === true) return true;
  if (cardOrPerm?.enteredFromCast === true || cardOrPerm?.wasCast === true) return true;
  if (cardOrPerm?.card?.enteredFromCast === true || cardOrPerm?.card?.wasCast === true) return true;
  const fromZone = String(
    extra?.enteredFromZone
    || cardOrPerm?.enteredFromZone
    || cardOrPerm?.card?.enteredFromZone
    || '',
  ).toLowerCase();
  // A spell resolving from the stack is a cast entry; flicker/reanimate/put
  // onto the battlefield from another zone is not.
  if (fromZone === 'stack') return true;
  return false;
}

export function containmentPriestSpecsFromState(state: any): any[] {
  const specs = Array.isArray(state?._replacementEffectSpecs)
    ? state._replacementEffectSpecs
    : [];
  const fromCache = specs.filter((spec: any) => String(spec?.effectId || '') === CONTAINMENT_PRIEST_EFFECT_ID);
  if (fromCache.length > 0) return fromCache;

  // Fallback: scan the battlefield for a Containment Priest-like replacement
  // when the census cache has not been attached (unit tests, late hooks).
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const found: any[] = [];
  for (const perm of battlefield) {
    const name = String(perm?.card?.name || perm?.name || '');
    const oracle = String(perm?.card?.oracle_text || perm?.card?.oracleText || '');
    const matchesName = /^containment priest$/i.test(name);
    const matchesText = /if a nontoken creature would enter the battlefield and it wasn.t cast.*exile it instead/i.test(oracle)
      || /nontoken creature would enter the battlefield and it wasn't cast/i.test(oracle);
    if (matchesName || matchesText) {
      found.push({
        effectId: CONTAINMENT_PRIEST_EFFECT_ID,
        sourcePermanentId: perm.id,
        sourceName: name || 'Containment Priest',
        event: 'zone-change',
      });
    }
  }
  return found;
}

export function wouldContainmentPriestExileEntry(args: {
  state: any;
  card?: any;
  permanent?: any;
  wasCast?: boolean;
  enteredFromCast?: boolean;
  enteredFromZone?: string;
  isToken?: boolean;
}): boolean {
  const subject = args.permanent || args.card;
  if (!subject || !args.state) return false;
  if (containmentPriestSpecsFromState(args.state).length === 0) return false;
  const token = args.isToken === true || isTokenPermanent(subject) || isTokenPermanent(args.card);
  if (token) return false;
  if (!isCreature(subject) && !isCreature(args.card)) return false;
  if (wasCastEntry(subject, args) || wasCastEntry(args.card, args)) return false;
  return true;
}

/**
 * If Containment Priest would replace this entry, move the permanent from the
 * battlefield into exile (or mark the evaluation result so the caller never
 * puts it onto the battlefield). Returns true when the entry was exiled.
 */
export function applyContainmentPriestExileIfNeeded(args: {
  state: any;
  card?: any;
  permanent?: any;
  wasCast?: boolean;
  enteredFromCast?: boolean;
  enteredFromZone?: string;
  isToken?: boolean;
}): { applied: boolean; redirectedTo?: 'exile'; permanentId?: string } {
  const primeval = applyPrimevalSpawnExileIfNeeded(args);
  if (primeval.applied) return primeval;
  if (!wouldContainmentPriestExileEntry(args)) return { applied: false };
  const state = args.state;
  const permanent = args.permanent || args.card;
  const permanentId = String(permanent?.id || args.card?.id || '').trim();
  const ownerId = String(
    permanent?.owner
    || permanent?.ownerId
    || args.card?.owner
    || args.card?.ownerId
    || permanent?.controller
    || '',
  ).trim();

  if (Array.isArray(state.battlefield) && permanentId) {
    const idx = state.battlefield.findIndex((entry: any) => String(entry?.id || '') === permanentId);
    if (idx >= 0) state.battlefield.splice(idx, 1);
  }

  if (ownerId) {
    state.zones = state.zones || {};
    const zones = state.zones[ownerId] || (state.zones[ownerId] = { exile: [], exileCount: 0 });
    const exile: any[] = Array.isArray(zones.exile) ? zones.exile : (zones.exile = []);
    const card = { ...(args.card || permanent?.card || permanent || {}), zone: 'exile' };
    if (permanentId && !card.id) card.id = permanentId;
    exile.push(card);
    zones.exileCount = exile.length;
  }

  if (permanent && typeof permanent === 'object') {
    (permanent as any).zone = 'exile';
    (permanent as any).redirectedByContainmentPriest = true;
  }

  return { applied: true, redirectedTo: 'exile', permanentId: permanentId || undefined };
}

export function eonHubIsInPlay(state: any): boolean {
  const specs = Array.isArray(state?._replacementEffectSpecs) ? state._replacementEffectSpecs : [];
  if (specs.some((spec: any) => String(spec?.effectId || '') === EON_HUB_EFFECT_ID)) return true;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    const name = String(perm?.card?.name || perm?.name || '');
    const oracle = String(perm?.card?.oracle_text || perm?.card?.oracleText || '');
    return /^eon hub$/i.test(name) || /players skip their upkeep steps/i.test(oracle);
  });
}

export function shouldSkipUpkeepForEonHub(state: any, step: unknown): boolean {
  const normalized = String(step || '').trim().toLowerCase();
  if (normalized !== 'upkeep') return false;
  return eonHubIsInPlay(state);
}
