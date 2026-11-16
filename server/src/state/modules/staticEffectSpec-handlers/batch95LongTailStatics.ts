// server/src/state/modules/staticEffectSpec-handlers/batch95LongTailStatics.ts
// B95 long-tail statics + keyword-grant declarations (census handled).
// Tamiyo can't-discard/sacrifice, Uba Mask play-from-exile, Fblthp plot,
// Combat Celebrant exert-as-attacks, Bell Borca noted-MV CDA, Whtz no-max-deck.
// Public: pushBatch95LongTailStaticSpecs, parseBatch95LongTailStaticKind,
// playerHasOpponentCantForceDiscardOrSacrifice, commanderHasNoMaximumDeckSize.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { parseSpellOrHandKeywordGrants } from '../batch95SpellAndHandKeywordGrants.js';

const TAMIYO_RE = /spells and abilities your opponents control can't cause you to discard cards or sacrifice permanents/i;
const UBA_PLAY_RE = /each player may play lands and cast spells from among cards they exiled with (?:this artifact|this permanent|~) this turn/i;
const CELEBRANT_RE = /if (?:this creature|~) hasn't been exerted this turn, you may exert it as it attacks/i;
const BORCA_NOTE_RE = /note the mana value of each card as it's put into exile/i;
const BORCA_POWER_RE = /(?:this creature|~|[^\\n]+?)'s power is equal to the greatest number noted for (?:it|this creature|~) this turn/i;
const WHTZ_RE = /a deck with this commander has no maximum deck size/i;

export function parseBatch95LongTailStaticKind(oracle: string): string[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const kinds: string[] = [];
  if (TAMIYO_RE.test(text)) kinds.push('opponent-cant-force-discard-or-sacrifice');
  if (UBA_PLAY_RE.test(text)) kinds.push('may-play-cards-exiled-with-this-this-turn');
  if (CELEBRANT_RE.test(text)) kinds.push('may-exert-as-it-attacks-if-not-exerted-this-turn');
  if (BORCA_NOTE_RE.test(text)) kinds.push('note-mana-value-as-exiled');
  if (BORCA_POWER_RE.test(text)) kinds.push('power-equals-greatest-noted-this-turn');
  if (WHTZ_RE.test(text)) kinds.push('commander-no-maximum-deck-size');
  for (const grant of parseSpellOrHandKeywordGrants(oracle)) {
    kinds.push(`grant-${grant.keyword}-${grant.filter.zone}`);
  }
  return kinds;
}

export function pushBatch95LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch95LongTailStaticKind(oracle)) {
    const scope = kind === 'opponent-cant-force-discard-or-sacrifice' || kind === 'commander-no-maximum-deck-size'
      ? { kind: 'player_you' as const }
      : kind.startsWith('grant-')
        ? { kind: 'player_you' as const }
        : { kind: 'self' as const };
    specs.push(buildSpec(source, kind, scope, { abilities: [kind.replace(/-/g, '_')] }));
  }
}

export function playerHasOpponentCantForceDiscardOrSacrifice(state: any, playerId: string): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) return false;
    return TAMIYO_RE.test(normalizeOraclePatternText(String(perm.card?.oracle_text || perm.oracle_text || '')));
  });
}

export function commanderHasNoMaximumDeckSize(commanderCard: any): boolean {
  const text = String(commanderCard?.oracle_text || commanderCard?.oracleText || '');
  return WHTZ_RE.test(normalizeOraclePatternText(text));
}

export function mayPlayCardsExiledWithSourceThisTurn(state: any, playerId: string, card: any): boolean {
  if (!card) return false;
  const exiledBy = String(card.exiledByPermanentId || card.exiledWithId || card.ubaMaskSourceId || '').trim();
  const turn = Number(state?.turnNumber ?? state?.turn ?? 0);
  const markedTurn = Number(card.exiledThisTurnNumber ?? card.ubaMaskExileTurn ?? turn);
  if (exiledBy && markedTurn === turn) {
    const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const src = battlefield.find((p: any) => String(p?.id || '') === exiledBy);
    if (src && !src.phasedOut && UBA_PLAY_RE.test(normalizeOraclePatternText(String(src.card?.oracle_text || '')))) {
      return true;
    }
  }
  return false;
}
