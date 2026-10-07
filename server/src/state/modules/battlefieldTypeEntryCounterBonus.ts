// BF-source ETB extra counters (lord replacement effects), e.g.:
// "Each other Angel you control enters with an additional +1/+1 counter on it
// for each Angel you already control." (Giada, Font of Hope)
// Also: "Each other TYPE you control enters with an additional +1/+1 counter on it."
// (fixed +1, no "for each"). Metallic Mimic (chosen type) stays in triggerChosenTypeSpellUtils.
// Public: applyBattlefieldTypeEntryCounterGrants, parseBattlefieldTypeEntryCounterGrant.

import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { debug } from '../../utils/debug.js';

export type BattlefieldTypeEntryCounterGrant =
  | { creatureType: string; mode: 'for_each_already_controlled' }
  | { creatureType: string; mode: 'fixed'; amount: number };

/** Giada-style: extra counters equal to how many of that type you already control. */
const FOR_EACH_ALREADY_RE =
  /each other ([a-z][a-z'-]*)s? you control enters? with an additional \+1\/\+1 counters? on (?:it|them) for each \1s? you already control/i;

/** Fixed +1 (or N) on other creatures of a printed type — not "of the chosen type". */
const FIXED_ADDITIONAL_RE =
  /each other ([a-z][a-z'-]*)s? you control enters? with an additional (?:(a|an|one|\d+)\s+)?\+1\/\+1 counters? on (?:it|them)(?!\s+for each)/i;

function wordOrNumberToCount(raw: string | undefined): number {
  const s = String(raw || '1').trim().toLowerCase();
  const words: Record<string, number> = { a: 1, an: 1, one: 1 };
  if (words[s] != null) return words[s];
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseBattlefieldTypeEntryCounterGrant(oracle: string): BattlefieldTypeEntryCounterGrant | null {
  const text = String(oracle || '');
  // Skip Metallic Mimic / chosen-type wording — handled elsewhere.
  if (/of the chosen type/i.test(text) && /enters with an additional/i.test(text)) return null;

  const forEach = text.match(FOR_EACH_ALREADY_RE);
  if (forEach) {
    const creatureType = String(forEach[1] || '').trim();
    if (creatureType) return { creatureType, mode: 'for_each_already_controlled' };
  }

  const fixed = text.match(FIXED_ADDITIONAL_RE);
  if (fixed) {
    const creatureType = String(fixed[1] || '').trim();
    if (!creatureType) return null;
    return { creatureType, mode: 'fixed', amount: wordOrNumberToCount(fixed[2]) };
  }

  return null;
}

function countAlreadyControlledOfType(
  battlefield: readonly any[],
  controller: string,
  creatureType: string,
  enteringPermanentId: string,
): number {
  let count = 0;
  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (String(permanent.id || '') === enteringPermanentId) continue;
    if (String(permanent.controller || '') !== controller) continue;
    if (!isCreatureNow(permanent)) continue;
    if (!permanentHasCreatureTypeNow(permanent, creatureType)) continue;
    count += 1;
  }
  return count;
}

/** Extra +1/+1 counters from battlefield statics that care about the entering creature's type. */
export function applyBattlefieldTypeEntryCounterGrants(
  state: unknown,
  enteringPermanent: any,
  controller: string,
): void {
  if (!enteringPermanent || !isCreatureNow(enteringPermanent)) return;
  const ownerId = String(controller || enteringPermanent.controller || '').trim();
  if (!ownerId) return;
  if (!String(enteringPermanent.id || '').trim()) return;

  const battlefield: any[] = Array.isArray((state as any)?.battlefield)
    ? (state as any).battlefield
    : [];
  const enteringId = String(enteringPermanent.id || '');

  for (const source of battlefield) {
    if (!source) continue;
    if (String(source.id || '') === enteringId) continue;
    if (String(source.controller || '') !== ownerId) continue;

    const oracle = String(source?.card?.oracle_text || '');
    const grant = parseBattlefieldTypeEntryCounterGrant(oracle);
    if (!grant) continue;
    if (!permanentHasCreatureTypeNow(enteringPermanent, grant.creatureType)) continue;

    let amount = 0;
    if (grant.mode === 'for_each_already_controlled') {
      amount = countAlreadyControlledOfType(battlefield, ownerId, grant.creatureType, enteringId);
    } else {
      amount = Math.max(0, Number(grant.amount || 0));
    }
    if (amount <= 0) continue;

    enteringPermanent.counters = enteringPermanent.counters || {};
    enteringPermanent.counters['+1/+1'] = Number(enteringPermanent.counters['+1/+1'] || 0) + amount;
    debug(
      2,
      `[applyBattlefieldTypeEntryCounterGrants] ${enteringPermanent.card?.name || 'Creature'} enters with +${amount} +1/+1 from ${source.card?.name || 'source'} (${grant.creatureType}, ${grant.mode})`,
    );
  }
}
