/**
 * Round 60: newly uncovered mbc/legal triggers plus leftover delayed / dual-event
 * promotions for legacy-r3. Spend-this-mana "this turn" is fixed in parseRound16.
 * Origin parent: parseRound58Events.ts parseRound58TriggerSentence.
 * Public: parseRound60TriggerSentence.
 */

import type { TriggerConditionEvent, TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;
type OrEvent = { event: TriggerConditionEvent; action?: string };

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function emptyAlts(controller: 'you' | 'not_you' | 'any'): TriggerConditionIR['alternatives'] {
  return [{
    controller,
    source: 'any',
    subject: {
      anyObject: true,
      typeGroups: [],
      subtypeGroups: [],
      excludedWords: [],
      supertypes: [],
      keywordsWith: [],
      keywordsWithout: [],
      token: 'any',
    },
  }];
}

const RANDOM_ITEM = '(?:you discard one or more cards at random|select one or more targets at random|choose one or more modes at random|flip one or more coins|roll one or more dice)';

function randomItemToOrEvent(item: string): OrEvent {
  const t = item.replace(/^you\s+/, '').trim();
  if (t.startsWith('discard')) return { event: 'discards' };
  if (t.startsWith('select')) return { event: 'performs', action: 'select_targets_random' };
  if (t.startsWith('choose')) return { event: 'performs', action: 'choose_modes_random' };
  if (t.startsWith('flip')) return { event: 'performs', action: 'coin_flip' };
  return { event: 'performs', action: 'roll_die' };
}

export function parseRound60TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // Madcap Jester: a spell or ability you control causes cards to be exiled from a library.
  const causedExile = /^(?:whenever|when)\s+a spell or ability you control causes one or more cards to be exiled from (an opponent'?s library|your library|a library),\s*(.+)$/.exec(text);
  if (causedExile) {
    const zoneOwner = /opponent/.test(causedExile[1]) ? 'not_you' : /your library/.test(causedExile[1]) ? 'you' : 'any';
    const base = reparse('whenever one or more cards are exiled from your library, ' + causedExile[2]);
    if (base) {
      return withFields(base, { causedByYou: true, fromZone: 'library', zoneOwner, quantity: 'one_or_more' } as any);
    }
    return {
      condition: {
        event: 'exiled',
        quantity: 'one_or_more',
        fromZone: 'library',
        zoneOwner,
        causedByYou: true,
        alternatives: emptyAlts('any'),
      } as TriggerConditionIR,
      effect: causedExile[2].trim(),
    };
  }

  // Sahir / Auntie Blyte: a source (you control) deals (exactly N) damage to you
  // and optionally "a spell or ability you control causes you to lose exactly N life".
  const sourceDmgYou = /^(?:whenever|when)\s+a source(?: (you control|an opponent controls))? deals(?: exactly (\d+))? damage to you(?: and whenever a spell or ability you control causes you to lose exactly (\d+) life)?,\s*(.+)$/.exec(text);
  if (sourceDmgYou) {
    const who = sourceDmgYou[1];
    const exactDmg = sourceDmgYou[2] ? Number(sourceDmgYou[2]) : undefined;
    const exactLife = sourceDmgYou[3] ? Number(sourceDmgYou[3]) : undefined;
    const effect = sourceDmgYou[4].trim();
    const controller = who === 'an opponent controls' ? 'not_you' : who === 'you control' ? 'you' : 'any';
    const base = reparse('whenever a permanent deals damage to a player, ' + effect);
    const fields: Record<string, unknown> = {
      damagedPlayer: 'you',
      damageRecipient: 'any',
      ...(controller === 'you' ? { causedByYou: true } : controller === 'not_you' ? { causedByOpponent: true } : {}),
      ...(exactDmg != null ? { minDamageAmount: exactDmg, exactDamage: true } : {}),
      ...(exactLife != null ? { lifeAmount: exactLife, exactLife: true, pairedEvent: 'loses_life' } : {}),
    };
    if (base) {
      const stamped = withFields(base, fields);
      if (stamped && controller !== 'any') {
        const alts = (stamped.condition.alternatives || []).map((a) => ({ ...a, controller }));
        return { ...stamped, condition: { ...stamped.condition, alternatives: alts } as TriggerConditionIR };
      }
      return stamped;
    }
    return {
      condition: {
        event: 'deals_damage',
        quantity: 'one',
        alternatives: emptyAlts(controller),
        ...fields,
      } as TriggerConditionIR,
      effect,
    };
  }

  // Chira and "discard at random": optional comma/or list of other random actions.
  const randomList = new RegExp(
    '^(?:whenever|when)\\s+(' + RANDOM_ITEM + '(?:, ' + RANDOM_ITEM + ')*(?:,? or ' + RANDOM_ITEM + ')?),\\s*(.+)$',
  ).exec(text);
  if (randomList && /\bat random\b|\bcoins?\b|\bdice\b/.test(randomList[1])) {
    const items = randomList[1]
      .split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const effect = randomList[2].trim();
    const orEvents = items.map(randomItemToOrEvent);
    const hasDiscard = orEvents.some((e) => e.event === 'discards');
    const extras = orEvents.filter((e) => e.event !== 'discards');
    if (hasDiscard) {
      const base = reparse('whenever you discard one or more cards, ' + effect);
      return withFields(base || {
        condition: {
          event: 'discards',
          quantity: 'one_or_more',
          alternatives: emptyAlts('you'),
        } as TriggerConditionIR,
        effect,
      }, {
        atRandom: true,
        quantity: 'one_or_more',
        ...(extras.length ? { orEvents: extras } : {}),
      } as any);
    }
    const first = orEvents[0];
    if (first) {
      return {
        condition: {
          event: first.event,
          quantity: 'one_or_more',
          alternatives: emptyAlts('you'),
          ...(first.action ? { action: first.action } : {}),
          atRandom: true,
          ...(orEvents.length > 1 ? { orEvents: orEvents.slice(1) } : {}),
        } as TriggerConditionIR,
        effect,
      };
    }
  }

  // "When you cast this spell from / while ...": on-cast self with extra gates.
  const castSelfFrom = /^when you cast this spell from (your hand|anywhere other than exile),\s*(.+)$/.exec(text);
  if (castSelfFrom) {
    const base = reparse('when you cast this spell, ' + castSelfFrom[2]);
    const fromZone = castSelfFrom[1] === 'your hand' ? 'hand' : 'not_exile';
    return withFields(base, { castFromZone: fromZone } as any);
  }
  const castSelfWhile = /^when you cast this spell while you control (a creature|your commander),\s*(.+)$/.exec(text);
  if (castSelfWhile) {
    const base = reparse('when you cast this spell, ' + castSelfWhile[2]);
    return withFields(base, {
      interveningIf: castSelfWhile[1] === 'your commander' ? 'you control your commander' : 'you control a creature',
    } as any);
  }
  const castSelfAndAttack = /^when you cast this spell and whenever this creature attacks,\s*(.+)$/.exec(text);
  if (castSelfAndAttack) {
    return withFields(reparse('when you cast this spell, ' + castSelfAndAttack[1]), {
      pairedEvent: 'attacks',
    } as any);
  }

  // "Whenever ~ enters or deals combat damage to a player"
  const entersOrCombat = /^(?:whenever|when)\s+(.+?)\s+enters(?: the battlefield)? or deals combat damage to a player,\s*(.+)$/.exec(text);
  if (entersOrCombat) {
    return withFields(reparse('whenever ' + entersOrCombat[1] + ' enters, ' + entersOrCombat[2]), {
      pairedEvent: 'deals_combat_damage_to_player',
    } as any);
  }
  const entersAndCombat = /^(?:whenever|when)\s+(.+?)\s+enters(?: the battlefield)? and whenever (?:it|he|she|they) deals combat damage to a player,\s*(.+)$/.exec(text);
  if (entersAndCombat) {
    return withFields(reparse('whenever ' + entersAndCombat[1] + ' enters, ' + entersAndCombat[2]), {
      pairedEvent: 'deals_combat_damage_to_player',
    } as any);
  }

  // "When this artifact/enchantment/~ enters and when you sacrifice it"
  const entersAndSac = /^when (.+?) enters(?: the battlefield)? and when you sacrifice it,\s*(.+)$/.exec(text);
  if (entersAndSac) {
    return withFields(reparse('when ' + entersAndSac[1] + ' enters, ' + entersAndSac[2]), {
      pairedEvent: 'sacrifices',
    } as any);
  }

  // "Whenever a creature you control enters this turn" (delayed, not legacy self-ETB)
  const entersThisTurn = /^(?:whenever|when)\s+(.+?)\s+enters(?: the battlefield)? this turn,\s*(.+)$/.exec(text);
  if (entersThisTurn) {
    return withFields(reparse('whenever ' + entersThisTurn[1] + ' enters, ' + entersThisTurn[2]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  // "Whenever a creature / that creature / it / target creature dies this turn"
  const diesThisTurn = /^(?:whenever|when)\s+(.+?)\s+dies this turn,\s*(.+)$/.exec(text);
  if (diesThisTurn) {
    return withFields(reparse('whenever ' + diesThisTurn[1] + ' dies, ' + diesThisTurn[2]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  return null;
}
