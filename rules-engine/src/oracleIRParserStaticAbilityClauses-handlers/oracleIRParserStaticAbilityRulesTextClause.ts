/**
 * Origin parent: oracleIRParserStaticAbilityClauses.ts
 * Cluster moved: tryParseRulesTextClause
 * Public: tryParseRulesTextClause
 */

import type { OracleEffectStep } from '../oracleIR';
import { normalizeClauseForParse, normalizeOracleText, parseObjectSelector } from '../oracleIRParserUtils';
import type { WithMeta } from './oracleIRParserStaticAbilityGrantParseUtils';
import { parseKeywordAbilityList } from './oracleIRParserStaticAbilityGrantParseUtils';

export function tryParseRulesTextClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(normalizeOracleText(args.clause)).clause.trim();
  const { withMeta, rawClause } = args;

  if (/^this creature enters prepared$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['enters prepared'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const standaloneKeywordAbilities = parseKeywordAbilityList(normalized);
  if (
    standaloneKeywordAbilities.length > 0 &&
    standaloneKeywordAbilities.join(', ') === normalized.toLowerCase()
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      abilities: standaloneKeywordAbilities,
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^all damage that would be dealt this turn to you and permanents you control is dealt to the chosen permanent instead/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'this_turn',
      raw: rawClause,
    });
  }

  if (/^all damage dealt by this creature to an opponent counts as commander damage/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^give this creature and the tokens unique names\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^powers and toughnesses are reversed\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('all permanents'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^firstest strike\s*\(this creature deals combat damage to creatures before creatures with first strike\.?\)$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['firstest strike'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^instant and sorcery spells you cast with mana value \d+ or greater cost \{x\} less to cast, where x is this permanent's power\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^power-up abilities of other creatures you control cost \{3\} less to activate\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('other creatures you control'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^until end of turn, whenever you cast an instant or sorcery spell, copy it\. you may choose new targets for the copy\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  if (
    /^that creature is 1\/1 until end of turn and can't be anything other than 1\/1 until end of turn\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('that creature'),
      effectText: [normalized],
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  if (/^using a mobile device, take a picture of target creature\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target creature'),
      effectText: [normalized],
      duration: 'during_resolution',
      raw: rawClause,
    });
  }

  if (/^the chosen player's maximum commander size is one\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('the chosen player'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^the name this permanent can't be chosen\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^the plane effects of the unknown event don't apply to this game for as long as it remains on the battlefield\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this game'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^the stack is now first in, first out instead of last in, first out\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('the stack'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^the top card of your library is a food token\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('the top card of your library'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^their disguise cost is equal to their mana cost\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^their spectacle cost is equal to their mana cost minus \{2\}\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^\+1\/\+1 counters give -1\/-1 and -1\/-1 counters give \+1\/\+1\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('all permanents'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^each player who didn(?:'|')t get a nonland puts the card back or into their graveyard\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('each player who did not get a nonland'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^reveal the chosen numbers\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^you and target creature(?:'|')s controller each secretly choose a number 0 or greater\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you and target creature\'s controller'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^starting with you, each player assigns their creatures to the left or right of the volcano\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('each player'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^that player guesses which creature it is\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('that player'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^there is an additional combat phase after this one\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this game'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^there(?:'|')s mana burn and combat damage uses the stack for the rest of the game\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this game'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^these are also \+1\/\+1 counters\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('those counters'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^they(?:'|')re an ability word and a keyword action respectively\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('keyword action'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^they(?:'|')re zombies in addition to their other types\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this card has the color identity of the college chosen this way\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this card'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this card(?:'|')s mana cost is that faction(?:'|')s mana symbols\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this card'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^this contraption assembles a number of contraptions equal to the difference between those results\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this Contraption'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^this damage can(?:'|')t be prevented, redirected, cause damage to be dealt to a player \(sorry, stuffy doll\), or be compared to damage dealt by sources on the east coast\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this damage'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this effect doesn(?:'|')t remove auras\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this effect'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^this effect doesn(?:'|')t remove auras and equipment you control that are already attached to it\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this effect'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this match is now worth 6 base points instead of 3\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this match'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^untap convoke \(each tapped creature that you untap while casting this spell pays for \{1\} or one mana of that creature(?:'|')s color\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this spell'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^reveal the chosen numbers\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^you and target creature(?:'|')s controller each secretly choose a number 0 or greater\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector("you and target creature's controller"),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^starting with you, each player assigns their creatures to the left or right of the volcano\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('each player'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^that player guesses which creature it is\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('that player'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this turn, you may play basic lands from outside the game\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'this_turn',
      raw: rawClause,
    });
  }

  if (
    /^your starting deck can(?:'|')t have basic land cards and your starting hand size is five\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^these are also \+1\/\+1 counters\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('those counters'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^they(?:'|')re an ability word and a keyword action respectively\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('keyword action'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^they(?:'|')re zombies in addition to their other types\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^treat your effects that scale off of "players" or "opponents" as though there were one more\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^treat this permanent(?:'|')s mana value as 10 while it(?:'|')s in your graveyard\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^thrusters \[6\]\s*(?:→|->)\s*flying\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('Thrusters'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^turn target permanent you control to its other face\.?$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('target permanent you control'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^this permanent$/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: ['manifest dread'],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^to behold an elemental, choose an elemental you control or reveal an elemental card from your hand\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('keyword action'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^to manifest a card, put the top card of your library onto the battlefield face down as a 2\/2 creature\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('keyword action'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^to proliferate, you choose any number of permanents and\/or players\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('keyword action'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^this effect doesn(?:'|')t remove auras and equipment you control that are already attached to it\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this effect'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^vanishing \(at the beginning of your upkeep, remove a time counter from this (?:creature|enchantment|artifact|permanent)/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (/^upgrade \(this creature enters covering another artifact you control/i.test(normalized)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  if (
    /^use a unique item that completely fits on this creature for each knickknack counter\.?$/i.test(
      normalized,
    )
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  return null;
}
