/**
 * Round 62 / legacy-r5: generic promotions for leftover attack, combat-damage,
 * spell-cast, death, and ETB families.
 * Origin parent: parseRound61Events.ts parseRound61TriggerSentence.
 * Public: parseRound62TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';
import { parseRound63TriggerSentence } from './parseRound63Events.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const WORD_N: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const COLOR: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };

function num(word: string): number {
  return WORD_N[word] ?? Number(word);
}

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function withController(base: Parsed | null, controller: 'you' | 'not_you' | 'any'): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({ ...a, controller }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

function stampSubject(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...fields },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

function combineDual(left: Parsed | null, right: Parsed | null): Parsed | null {
  if (!left || !right) return null;
  if (left.condition.event === right.condition.event) {
    return withFields(left, {
      alternatives: [...(left.condition.alternatives || []), ...(right.condition.alternatives || [])],
    });
  }
  return withFields(left, {
    pairedEvent: right.condition.event,
    pairedCondition: right.condition,
  } as any);
}

export function parseRound62TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // "When/whenever you/a player/an opponent attacks with (exactly) N (or more) creatures (with flying)"
  const whoAttacksWith = /^(whenever|when) (you|a player|an opponent|another player) attacks? with (exactly )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?: or more)? creatures(?: with ([a-z]+))?,\s*(.+)$/.exec(text);
  if (whoAttacksWith) {
    const who = whoAttacksWith[2];
    const exact = Boolean(whoAttacksWith[3]);
    const n = num(whoAttacksWith[4]);
    const keyword = whoAttacksWith[5];
    const effect = whoAttacksWith[6];
    if (Number.isFinite(n)) {
      let base = who === 'you'
        ? reparse('whenever one or more creatures you control attack, ' + effect)
        : reparse('whenever a creature attacks, ' + effect);
      if (who === 'an opponent' || who === 'another player') base = withController(base, 'not_you');
      const fields: Record<string, unknown> = { quantity: 'one_or_more' };
      if (who === 'you' && !exact) fields.minOtherAttackers = Math.max(0, n - 1);
      else fields.minAttackers = n;
      if (exact) fields.exactAttackers = n;
      base = withFields(base, fields as any);
      if (keyword) base = stampSubject(base, { keywordsWith: [keyword] });
      if (base) return base;
    }
  }

  // "Whenever two or more creatures (you control / your opponents control) (with flying) attack (a player)"
  const nCreaturesAttack = /^(whenever|when) (\d+|two|three|four|five|six|seven|eight|nine|ten) or more (nontoken )?(creatures(?: you control| your opponents control| an opponent controls)?)(?: with ([a-z]+))? attack(?: a player)?,\s*(.+)$/.exec(text);
  if (nCreaturesAttack) {
    const n = num(nCreaturesAttack[2]);
    const who = nCreaturesAttack[4];
    const keyword = nCreaturesAttack[5];
    const effect = nCreaturesAttack[6];
    const toPlayer = / attack a player,/.test(text);
    let phrase = 'a creature';
    if (who && /you control/.test(who) && !/opponent/.test(who)) phrase = 'a creature you control';
    else if (who && /opponents control|opponent controls/.test(who)) phrase = 'a creature an opponent controls';
    if (nCreaturesAttack[3]) phrase = phrase.replace('a creature', 'a nontoken creature');
    let base = reparse((toPlayer ? 'whenever ' + phrase + ' attacks a player, ' : 'whenever ' + phrase + ' attacks, ') + effect);
    if (/opponent/.test(String(who || ''))) base = withController(base, 'not_you');
    if (keyword) base = stampSubject(base, { keywordsWith: [keyword] });
    if (base && Number.isFinite(n)) return withFields(base, { minAttackers: n, quantity: 'one_or_more' } as any);
  }

  const mostLife = /^(whenever|when) (.+?) attacks the player with the most life or tied for most life,\s*(.+)$/.exec(text);
  if (mostLife) {
    return withFields(reparse(mostLife[1] + ' ' + mostLife[2] + ' attacks a player, ' + mostLife[3]) || reparse(mostLife[1] + ' ' + mostLife[2] + ' attacks, ' + mostLife[3]), { attackedPlayer: 'most_life' } as any);
  }

  const moreLife = /^(whenever|when) (.+?) attacks a player who has more life than you,\s*(.+)$/.exec(text);
  if (moreLife) {
    return withFields(reparse(moreLife[1] + ' ' + moreLife[2] + ' attacks a player, ' + moreLife[3]) || reparse(moreLife[1] + ' ' + moreLife[2] + ' attacks, ' + moreLife[3]), { attackedPlayer: 'more_life_than_you' } as any);
  }

  const monarch = /^(whenever|when) (.+?) attacks the monarch,\s*(.+)$/.exec(text);
  if (monarch && !/while you're the monarch/.test(text)) {
    return withFields(reparse(monarch[1] + ' ' + monarch[2] + ' attacks a player, ' + monarch[3]) || reparse(monarch[1] + ' ' + monarch[2] + ' attacks, ' + monarch[3]), { attackedPlayer: 'monarch' } as any);
  }

  const battle = /^(whenever|when) (.+?) attacks a battle,\s*(.+)$/.exec(text);
  if (battle) {
    return withFields(reparse(battle[1] + ' ' + battle[2] + ' attacks, ' + battle[3]), { attackedTargetType: 'battle' } as any);
  }

  const playerAlone = /^(whenever|when) (.+?) attacks a player alone,\s*(.+)$/.exec(text);
  if (playerAlone) {
    return withFields(reparse(playerAlone[1] + ' ' + playerAlone[2] + ' attacks a player, ' + playerAlone[3]) || reparse(playerAlone[1] + ' ' + playerAlone[2] + ' attacks, ' + playerAlone[3]), { attacksPlayerAlone: true } as any);
  }

  const aloneThisTurn = /^(whenever|when) (.+?) attacks alone this turn,\s*(.+)$/.exec(text);
  if (aloneThisTurn) {
    return withFields(reparse(aloneThisTurn[1] + ' ' + aloneThisTurn[2] + ' attacks, ' + aloneThisTurn[3]), {
      attacksAlone: true,
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  const oppOrPw = /^(whenever|when) (.+?) attacks one of your opponents or a planeswalker (?:an opponent controls|they control),\s*(.+)$/.exec(text);
  if (oppOrPw) {
    return withFields(reparse(oppOrPw[1] + ' ' + oppOrPw[2] + ' attacks, ' + oppOrPw[3]), { attackedPlayer: 'opponent' } as any);
  }

  const oppYouOrPw = /^(whenever|when) an opponent attacks you and\/or one or more planeswalkers you control,\s*(.+)$/.exec(text);
  if (oppYouOrPw) {
    return withFields(withController(reparse('whenever a creature attacks, ' + oppYouOrPw[2]), 'not_you'), {
      attackedPlayer: 'you',
      quantity: 'one_or_more',
    } as any);
  }

  const oppPw = /^(whenever|when) an opponent attacks a planeswalker you control(?: with one or more creatures)?,\s*(.+)$/.exec(text);
  if (oppPw) {
    return withFields(withController(reparse('whenever a creature attacks, ' + oppPw[2]), 'not_you'), {
      attackedPlayer: 'you',
      attackedTargetType: 'planeswalker',
      quantity: 'one_or_more',
    } as any);
  }

  const thatAttacks = /^(whenever|when) that creature attacks(?: one of your opponents| the monarch| a player)? this turn,\s*(.+)$/.exec(text);
  if (thatAttacks) {
    const target = /monarch/.test(text) ? { attackedPlayer: 'monarch' as const }
      : /opponents/.test(text) ? { attackedPlayer: 'opponent' as const, attackedTargetType: 'player' as const }
        : /a player/.test(text) ? { attackedPlayer: 'any' as const, attackedTargetType: 'player' as const }
          : {};
    return withFields(reparse('whenever a creature attacks, ' + thatAttacks[2]), {
      thisTurn: true,
      delayedRider: true,
      ...target,
    } as any);
  }

  // Instant/sorcery / a spell you control deals damage (optionally to a player/opponent).
  const spellDmg = /^(whenever|when) (an instant or sorcery spell you control|a spell you control) deals damage(?: to (an opponent|a player|another player))?(?: or battle)?,\s*(.+)$/.exec(text);
  if (spellDmg) {
    const dest = spellDmg[3] ? ' to ' + (spellDmg[3] === 'a player' ? 'a player' : 'an opponent') : '';
    let base = reparse('whenever a source you control deals damage' + dest + ', ' + spellDmg[4]);
    if (spellDmg[2].startsWith('an instant')) {
      base = stampSubject(base, {
        typeGroups: [['instant'], ['sorcery']],
        groups: [{ types: ['instant'], subtypes: [] }, { types: ['sorcery'], subtypes: [] }],
      } as any);
    }
    if (base) return base;
  }

  const anotherPlayer = /^(whenever|when) a source you control deals damage to another player,\s*(.+)$/.exec(text);
  if (anotherPlayer) {
    return reparse('whenever a source you control deals damage to an opponent, ' + anotherPlayer[2]);
  }

  const defPlayer = /^(whenever|when) (.+?) deals combat damage to defending player,\s*(.+)$/.exec(text);
  if (defPlayer) return reparse(defPlayer[1] + ' ' + defPlayer[2] + ' deals combat damage to a player, ' + defPlayer[3]);

  const pirateDmg = /^(whenever|when) one or more ([a-z]+)s you control deal(?:s)? (combat )?damage to (a player|your opponents),\s*(.+)$/.exec(text);
  if (pirateDmg) {
    const dest = pirateDmg[4] === 'your opponents' ? 'an opponent' : 'a player';
    // Keep "combat": dropping it shadows the older deals_combat_damage_to_player parse.
    return withFields(
      reparse('whenever a ' + pirateDmg[2] + ' you control deals ' + (pirateDmg[3] ? 'combat ' : '') + 'damage to ' + dest + ', ' + pirateDmg[5]),
      { quantity: 'one_or_more' } as any,
    );
  }

  const bothColors = /^(whenever|when) you cast a spell that's both (white|blue|black|red|green) and (white|blue|black|red|green),\s*(.+)$/.exec(text);
  if (bothColors) {
    const letters = [COLOR[bothColors[2]], COLOR[bothColors[3]]].filter(Boolean);
    return stampSubject(reparse('whenever you cast a spell, ' + bothColors[4]), { colorsAll: letters } as any);
  }

  const bolas = /^(whenever|when) you cast a bolas planeswalker spell,\s*(.+)$/.exec(text);
  if (bolas) {
    return stampSubject(reparse('whenever you cast a planeswalker spell, ' + bolas[2]), {
      subtypeGroups: [['bolas']],
      groups: [{ types: ['planeswalker'], subtypes: ['bolas'] }],
    } as any);
  }

  const yourCmd = /^(whenever|when) you cast your commander,\s*(.+)$/.exec(text);
  if (yourCmd) return stampSubject(reparse('whenever you cast a spell, ' + yourCmd[2]), { commander: true } as any);

  const castThisTurn = /^(whenever|when) you (cast a(?:n? [a-z ]+)? spell|cast it) this turn,\s*(.+)$/.exec(text);
  if (castThisTurn && !/other than your first|during your turn other than/.test(text)) {
    const kind = castThisTurn[2] === 'cast it' ? 'cast a spell' : castThisTurn[2];
    return withFields(reparse('whenever you ' + kind + ', ' + castThisTurn[3]), { thisTurn: true, delayedRider: true } as any);
  }

  const exileOrLand = /^(whenever|when) you cast a spell from exile or a land you control enters from exile,\s*(.+)$/.exec(text);
  if (exileOrLand) {
    const combined = combineDual(
      withFields(reparse('whenever you cast a spell, ' + exileOrLand[2]), { castFromZone: 'exile' } as any),
      withFields(reparse('whenever a land you control enters, ' + exileOrLand[2]), { fromZone: 'exile' } as any),
    );
    if (combined) return combined;
  }

  const playerPlayOrCast = /^(whenever|when) a player plays a land or casts a spell,\s*(.+)$/.exec(text);
  if (playerPlayOrCast) {
    const combined = combineDual(
      reparse('whenever a player plays a land, ' + playerPlayOrCast[2]),
      reparse('whenever a player casts a spell, ' + playerPlayOrCast[2]),
    );
    if (combined) return combined;
  }

  const notHandPlay = /^(whenever|when) you play a land or cast a spell from anywhere other than your hand,\s*(.+)$/.exec(text);
  if (notHandPlay) {
    const combined = combineDual(
      withFields(reparse('whenever you play a land, ' + notHandPlay[2]), { fromZone: 'not_hand' } as any),
      withFields(reparse('whenever you cast a spell, ' + notHandPlay[2]), { castFromZone: 'not_hand' } as any),
    );
    if (combined) return combined;
  }

  const diesExileWhile = /^(whenever|when) (.+?) dies or is put into exile(?: from the battlefield)? while its power is (\d+) or greater,\s*(.+)$/.exec(text);
  if (diesExileWhile) {
    const left = stampSubject(reparse(diesExileWhile[1] + ' ' + diesExileWhile[2] + ' dies, ' + diesExileWhile[4]), {
      stats: [{ stat: 'power', op: 'gte', value: Number(diesExileWhile[3]) }],
    } as any);
    const right = stampSubject(reparse(diesExileWhile[1] + ' ' + diesExileWhile[2] + ' is exiled, ' + diesExileWhile[4]), {
      stats: [{ stat: 'power', op: 'gte', value: Number(diesExileWhile[3]) }],
    } as any);
    const combined = combineDual(left, right);
    if (combined) return combined;
  }

  const selfOrOtherFaceUp = /^(whenever|when) (this (?:creature|enchantment|permanent)|~) or another (.+?) is turned face up,\s*(.+)$/.exec(text);
  if (selfOrOtherFaceUp) {
    const combined = combineDual(
      reparse(selfOrOtherFaceUp[1] + ' ' + selfOrOtherFaceUp[2] + ' is turned face up, ' + selfOrOtherFaceUp[4]),
      reparse(selfOrOtherFaceUp[1] + ' another ' + selfOrOtherFaceUp[3] + ' is turned face up, ' + selfOrOtherFaceUp[4]),
    );
    if (combined) return combined;
  }

  const etbWhileCounter = /^(whenever|when) (.+?) enters(?: the battlefield)? while (this (?:creature|permanent)|~) has an? ((?:[+-]?\d+\/[+-]?\d+|[\w-]+)) counter on it,\s*(.+)$/.exec(text);
  if (etbWhileCounter) {
    return withFields(reparse(etbWhileCounter[1] + ' ' + etbWhileCounter[2] + ' enters, ' + etbWhileCounter[5]), {
      interveningIf: etbWhileCounter[3] + ' has a ' + etbWhileCounter[4] + ' counter on it',
    } as any);
  }

  const putThisWay = /^(whenever|when) (?:a |an )?(.+?) is put onto the battlefield this way,\s*(.+)$/.exec(text);
  if (putThisWay) {
    return withFields(reparse('whenever a ' + putThisWay[2] + ' enters, ' + putThisWay[3]), { thisWay: true, delayedRider: true } as any);
  }

  return parseRound63TriggerSentence(text, reparse);
}
