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
const COMMANDER_SPELLS_HAVE_CASCADE =
  /commander spells you cast have cascade/i;
// B69: Quandrix, the Proof
const INSTANT_SORCERY_FROM_HAND_HAVE_CASCADE =
  /instant and sorcery spells you cast from your hand have cascade/i;
// B69: Bloodbraid Marauder — conditional self-cascade (not counted by getNativeCascadeCount).
const SPELL_HAS_CASCADE_IF_GY_CARD_TYPES =
  /this spell has cascade as long as there (?:is|are) (\w+) or more card types among cards in your graveyard/i;

const CARD_TYPES = [
  'artifact', 'battle', 'creature', 'enchantment', 'instant',
  'kindred', 'land', 'planeswalker', 'sorcery', 'tribal',
] as const;

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCountWord(raw: string): number | undefined {
  const t = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return COUNT_WORDS[t];
}

function distinctGraveyardCardTypes(state: any, playerId: string): number {
  const graveyard = state?.zones?.[playerId]?.graveyard;
  const seen = new Set<string>();
  for (const card of Array.isArray(graveyard) ? graveyard : []) {
    const line = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    for (const type of CARD_TYPES) {
      if (new RegExp(`\\b${type}\\b`).test(line)) seen.add(type === 'tribal' ? 'kindred' : type);
    }
  }
  return seen.size;
}

function normalizeOracle(cardOrPerm: any): string {
  return String(
    cardOrPerm?.oracle_text
    || cardOrPerm?.oracleText
    || cardOrPerm?.card?.oracle_text
    || cardOrPerm?.card?.oracleText
    || '',
  );
}

function isInstantOrSorcery(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || card?.card?.type_line || '').toLowerCase();
  return /\binstant\b/.test(tl) || /\bsorcery\b/.test(tl);
}

export function getGrantedCascadeCountForCast(
  state: any,
  playerId: string,
  card: any,
  options: {
    castSourceZone?: string;
    isFirstSpellCastFromExileThisTurn?: boolean;
    isCommander?: boolean;
  } = {},
): number {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let count = 0;
  const isCommander = options.isCommander === true
    || card?.isCommander === true
    || card?.card?.isCommander === true;
  const fromHand = String(options.castSourceZone || '').toLowerCase() === 'hand';
  for (const perm of battlefield) {
    if (!perm) continue;
    if (String(perm.controller || '') !== String(playerId || '')) continue;
    const oracle = normalizeOracle(perm);
    if (isCommander && COMMANDER_SPELLS_HAVE_CASCADE.test(oracle)) count += 1;
    if (fromHand && isInstantOrSorcery(card) && INSTANT_SORCERY_FROM_HAND_HAVE_CASCADE.test(oracle)) count += 1;
  }
  if (String(options.castSourceZone || '').toLowerCase() === 'exile' && options.isFirstSpellCastFromExileThisTurn) {
    for (const perm of battlefield) {
      if (!perm) continue;
      if (String(perm.controller || '') !== String(playerId || '')) continue;
      if (FIRST_EXILE_SPELL_HAS_CASCADE.test(normalizeOracle(perm))) count += 1;
    }
  }
  return count;
}

/** Self conditional cascade grants that native keyword counting skips ("has cascade"). */
function getConditionalSelfCascadeCount(state: any, playerId: string, card: any): number {
  const oracle = String(card?.oracle_text || card?.oracleText || card?.card?.oracle_text || '');
  const m = oracle.match(SPELL_HAS_CASCADE_IF_GY_CARD_TYPES);
  if (!m) return 0;
  const need = parseCountWord(m[1]);
  if (need === undefined) return 0;
  return distinctGraveyardCardTypes(state, playerId) >= need ? 1 : 0;
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
  const conditional = getConditionalSelfCascadeCount(state, playerId, card);
  return native + granted + conditional;
}
