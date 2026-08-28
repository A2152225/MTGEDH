/**
 * cascadeCastGrants.ts
 *
 * Native vs granted cascade when a spell is put on the stack.
 * Wild-Magic Sorcerer grants cascade to the first spell you cast from exile
 * each turn; the sorcerer itself does not have cascade.
 *
 * Public entry symbols: getGrantedCascadeCountForCast, getCascadeInstancesForCast.
 */
import { getNativeCascadeCount } from '../../../../rules-engine/src/cards/castTriggers.js';

const FIRST_EXILE_SPELL_HAS_CASCADE =
  /the first spell you cast from exile each turn has cascade/i;

function normalizeOracle(cardOrPerm: any): string {
  return String(
    cardOrPerm?.oracle_text
    || cardOrPerm?.oracleText
    || cardOrPerm?.card?.oracle_text
    || cardOrPerm?.card?.oracleText
    || '',
  );
}

export function getGrantedCascadeCountForCast(
  state: any,
  playerId: string,
  _card: any,
  options: {
    castSourceZone?: string;
    isFirstSpellCastFromExileThisTurn?: boolean;
  } = {},
): number {
  if (String(options.castSourceZone || '').toLowerCase() !== 'exile') return 0;
  if (!options.isFirstSpellCastFromExileThisTurn) return 0;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm) continue;
    if (String(perm.controller || '') !== String(playerId || '')) continue;
    if (FIRST_EXILE_SPELL_HAS_CASCADE.test(normalizeOracle(perm))) {
      count += 1;
    }
  }
  return count;
}

export function getCascadeInstancesForCast(
  state: any,
  playerId: string,
  card: any,
  options: {
    castSourceZone?: string;
    isFirstSpellCastFromExileThisTurn?: boolean;
  } = {},
): number {
  const native = getNativeCascadeCount(String(card?.oracle_text || card?.oracleText || ''));
  const granted = getGrantedCascadeCountForCast(state, playerId, card, options);
  return native + granted;
}
