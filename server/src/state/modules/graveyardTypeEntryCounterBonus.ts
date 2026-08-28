// GY-source ETB extra counters: "As long as this creature is in your graveyard,
// each Human creature you control enters with an additional +1/+1 counter on it."
// (Dearly Departed). Not a battlefield lord — only functions from the graveyard.
// Public: applyGraveyardTypeEntryCounterGrants.

import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { debug } from '../../utils/debug.js';

const GY_TYPE_ENTRY_COUNTER_RE =
  /as long as (?:this card|this creature) is in your graveyard,?\s*each ([a-z]+) creatures? you control enters? with an additional \+1\/\+1 counter/i;

function readGraveyardCards(state: unknown, controller: string): readonly unknown[] {
  const zones = (state as { zones?: Record<string, { graveyard?: readonly unknown[] }> } | undefined)?.zones;
  const graveyard = zones?.[controller]?.graveyard;
  return Array.isArray(graveyard) ? graveyard : [];
}

function readCardRecord(entry: unknown): { oracle: string; name: string } | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as { oracle_text?: unknown; name?: unknown; card?: { oracle_text?: unknown; name?: unknown } };
  const nested = record.card && typeof record.card === 'object' ? record.card : record;
  const oracle = String(nested.oracle_text || record.oracle_text || '').trim();
  if (!oracle) return null;
  return { oracle, name: String(nested.name || record.name || 'Unknown') };
}

function parseGraveyardTypeEntryCounterGrant(oracle: string): string | null {
  const match = String(oracle || '').match(GY_TYPE_ENTRY_COUNTER_RE);
  const creatureType = String(match?.[1] || '').trim();
  return creatureType ? creatureType : null;
}

/** Extra +1/+1 counters from GY statics that care about the entering creature's type. */
export function applyGraveyardTypeEntryCounterGrants(
  state: unknown,
  enteringPermanent: any,
  controller: string,
): void {
  if (!enteringPermanent || !isCreatureNow(enteringPermanent)) return;
  const ownerId = String(controller || enteringPermanent.controller || '').trim();
  if (!ownerId) return;

  for (const card of readGraveyardCards(state, ownerId)) {
    const record = readCardRecord(card);
    if (!record) continue;
    const creatureType = parseGraveyardTypeEntryCounterGrant(record.oracle);
    if (!creatureType) continue;
    if (!permanentHasCreatureTypeNow(enteringPermanent, creatureType)) continue;

    enteringPermanent.counters = enteringPermanent.counters || {};
    enteringPermanent.counters['+1/+1'] = Number(enteringPermanent.counters['+1/+1'] || 0) + 1;
    debug(
      2,
      `[applyGraveyardTypeEntryCounterGrants] ${enteringPermanent.card?.name || 'Creature'} enters with +1/+1 from ${record.name} (${creatureType}) in graveyard`,
    );
  }
}
