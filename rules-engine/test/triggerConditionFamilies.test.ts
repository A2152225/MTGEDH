import { describe, expect, it } from 'vitest';
import {
  parseAttacksSubjectClause,
  parseBecomesTappedSubjectClause,
  parseBlocksSubjectClause,
  parseEntersSubjectClause,
  parsePhaseTriggerClause,
  parseSpellCastClause,
  parseTriggerClause,
  parseTriggerEventSentence,
  printedKeywordDeathAbilities,
  splitTriggerEffectRiders,
  triggerConditionMatches,
} from '../src/triggerCondition/index.js';
import type { TriggerMatchPermanent, TriggerMatchSource } from '../src/triggerCondition/index.js';

const source: TriggerMatchSource = { id: 'watcher', controllerId: 'p1', attachedToId: 'host' };

function object(overrides: Partial<TriggerMatchPermanent> = {}): TriggerMatchPermanent {
  return {
    id: 'subject',
    typeLine: 'Creature — Goblin',
    controllerId: 'p1',
    ...overrides,
  };
}

describe('enters, attacks, and blocks subjects', () => {
  it('parses under your control as controller you', () => {
    const parsed = parseEntersSubjectClause('a land under your control');
    expect(parsed?.event).toBe('enters');
    expect(parsed?.alternatives[0].controller).toBe('you');
    expect(triggerConditionMatches(parsed!, object({ typeLine: 'Land — Forest', controllerId: 'p1' }), source)).toBe(true);
    expect(triggerConditionMatches(parsed!, object({ typeLine: 'Land — Forest', controllerId: 'p2' }), source)).toBe(false);
  });

  it('matches another nontoken attacker you control', () => {
    const parsed = parseAttacksSubjectClause('another nontoken creature you control');
    expect(triggerConditionMatches(parsed!, object({ id: 'attacker' }), source)).toBe(true);
    expect(triggerConditionMatches(parsed!, object({ id: 'watcher' }), source)).toBe(false);
    expect(triggerConditionMatches(parsed!, object({ isToken: true }), source)).toBe(false);
  });

  it('matches an opponent blocker and an enchanted creature', () => {
    const opponent = parseBlocksSubjectClause('a creature an opponent controls');
    expect(triggerConditionMatches(opponent!, object({ controllerId: 'p2' }), source)).toBe(true);
    expect(triggerConditionMatches(opponent!, object({ controllerId: 'p1' }), source)).toBe(false);

    const enchanted = parseBecomesTappedSubjectClause('enchanted creature');
    expect(enchanted?.alternatives[0].source).toBe('enchanted');
    expect(triggerConditionMatches(enchanted!, object({ id: 'host' }), source)).toBe(true);
    expect(triggerConditionMatches(enchanted!, object({ id: 'other' }), source)).toBe(false);
    expect(triggerConditionMatches(enchanted!, object({ id: 'host', typeLine: 'Land — Forest' }), source)).toBe(false);
  });
});

describe('spell cast', () => {
  it('matches creature, noncreature, instant or sorcery, and artifact or creature', () => {
    const creature = parseSpellCastClause('an opponent casts a creature spell');
    const noncreature = parseSpellCastClause('you cast a noncreature spell');
    const instant = parseSpellCastClause('a player casts an instant or sorcery spell');
    const either = parseSpellCastClause('you cast an artifact or creature spell');
    const goblin = object({ typeLine: 'Creature — Goblin', controllerId: 'p2' });
    const sorcery = object({ typeLine: 'Sorcery', controllerId: 'p1' });
    const artifact = object({ typeLine: 'Artifact', controllerId: 'p1' });

    expect(triggerConditionMatches(creature!, goblin, source)).toBe(true);
    expect(triggerConditionMatches(creature!, goblin, { ...source, controllerId: 'p2' })).toBe(false);
    expect(triggerConditionMatches(noncreature!, sorcery, source)).toBe(true);
    expect(triggerConditionMatches(noncreature!, goblin, { ...source, controllerId: 'p2' })).toBe(false);
    expect(triggerConditionMatches(instant!, sorcery, source)).toBe(true);
    expect(triggerConditionMatches(instant!, artifact, source)).toBe(false);
    expect(triggerConditionMatches(either!, artifact, source)).toBe(true);
    expect(triggerConditionMatches(either!, sorcery, source)).toBe(false);
  });

  it('records cast zone, first spell, and targets you', () => {
    const parsed = parseSpellCastClause('you cast your first spell each turn from exile that targets you');
    expect(parsed).toMatchObject({
      event: 'spell_cast',
      castFromZone: 'exile',
      ordinal: 'first',
      targets: 'you',
    });
    const spell = object({ typeLine: 'Instant', controllerId: 'p1' });
    expect(triggerConditionMatches(parsed!, spell, source, {
      castFromZone: 'exile',
      spellOrdinal: 1,
      targetControllerId: 'p1',
    })).toBe(true);
    expect(triggerConditionMatches(parsed!, spell, source, {
      castFromZone: 'hand',
      spellOrdinal: 1,
      targetControllerId: 'p1',
    })).toBe(false);
    expect(triggerConditionMatches(parsed!, spell, source, {
      castFromZone: 'exile',
      spellOrdinal: 2,
      targetControllerId: 'p1',
    })).toBe(false);
    expect(triggerConditionMatches(parsed!, spell, source, {
      castFromZone: 'exile',
      spellOrdinal: 1,
      targetControllerId: 'p2',
    })).toBe(false);
  });
});

describe('phase steps', () => {
  it('matches your upkeep, each player, and each opponent', () => {
    const yours = parsePhaseTriggerClause('at the beginning of your upkeep');
    const each = parsePhaseTriggerClause("at the beginning of each player's draw step");
    const opponents = parsePhaseTriggerClause("at the beginning of each opponent's end step");
    expect(yours).toMatchObject({ event: 'beginning_of_upkeep', whoseTurn: 'you', alternatives: [] });
    expect(each?.event).toBe('beginning_of_draw_step');
    expect(opponents?.event).toBe('beginning_of_end_step');
    expect(triggerConditionMatches(yours!, object(), source, { activePlayerId: 'p1' })).toBe(true);
    expect(triggerConditionMatches(yours!, object(), source, { activePlayerId: 'p2' })).toBe(false);
    expect(triggerConditionMatches(each!, object(), source, { activePlayerId: 'p2' })).toBe(true);
    expect(triggerConditionMatches(opponents!, object(), source, { activePlayerId: 'p2' })).toBe(true);
    expect(triggerConditionMatches(opponents!, object(), source, { activePlayerId: 'p1' })).toBe(false);
    const enchanted = parsePhaseTriggerClause("at the beginning of enchanted player's upkeep");
    expect(enchanted?.whoseTurn).toBe('enchanted_player');
    expect(triggerConditionMatches(enchanted!, object(), source, {
      activePlayerId: 'p2',
      enchantedPlayerId: 'p2',
    })).toBe(true);
    expect(parsePhaseTriggerClause("at the beginning of the monarch's end step")?.whoseTurn).toBe('monarch');
    expect(parsePhaseTriggerClause("at the beginning of the chosen player's upkeep")?.whoseTurn).toBe('chosen_player');
  });
});

describe('parseTriggerEventSentence', () => {
  it('splits a dies sentence the family regex may have missed', () => {
    const parsed = parseTriggerEventSentence('Whenever another Goblin you control dies, you gain 1 life.');
    expect(parsed?.condition.event).toBe('dies');
    expect(parseTriggerEventSentence('Whenever another Goblin you control dies, you gain 1 life.')?.effect).toBe('you gain 1 life');
  });

  it('splits intervening-if, when you do, and the next end step off the effect', () => {
    const parsed = parseTriggerClause(
      'Whenever a creature you control dies, if you control a Swamp, you may pay {1}. When you do, draw a card at the beginning of the next end step, you gain 1 life.',
    );
    expect(parsed?.interveningIf).toBe('you control a swamp');
    expect(parsed?.effect).toBe('you may pay {1}');
    expect(parsed?.reflexive).toEqual({
      actor: 'you',
      effect: 'draw a card',
      delayed: { timing: 'next_end_step', effect: 'you gain 1 life' },
    });
    expect(parsed?.delayed).toBeUndefined();
  });

  it('splits a delayed end step that is the effect tail', () => {
    const split = splitTriggerEffectRiders('destroy that creature at the beginning of the next end step, exile it');
    expect(split.effect).toBe('destroy that creature');
    expect(split.delayed).toEqual({ timing: 'next_end_step', effect: 'exile it' });
    expect(printedKeywordDeathAbilities('(When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner\'s control. This is undying.)')).toEqual([]);
    expect(printedKeywordDeathAbilities('Undying\nPersist')).toEqual(['undying', 'persist']);
  });

  it('parses becomes-tapped and beginning-of-end-step sentences', () => {
    const tapped = parseTriggerEventSentence('Whenever enchanted creature becomes tapped, you gain 1 life.');
    expect(tapped?.condition.event).toBe('becomes_tapped');
    expect(tapped?.condition.alternatives[0].source).toBe('enchanted');
    const endStep = parseTriggerEventSentence('At the beginning of your end step, draw a card.');
    expect(endStep?.condition.event).toBe('beginning_of_end_step');
    expect(endStep?.condition.whoseTurn).toBe('you');
    expect(endStep?.effect).toBe('draw a card');
    const cast = parseTriggerEventSentence('Whenever you cast a spell, draw a card.');
    expect(cast?.condition.event).toBe('spell_cast');
    expect(cast?.effect).toBe('draw a card');
    const upkeep = parseTriggerEventSentence("At the beginning of your upkeep, you gain 1 life.");
    expect(upkeep?.condition.event).toBe('beginning_of_upkeep');
    const draw = parseTriggerEventSentence("At the beginning of your draw step, you gain 1 life.");
    expect(draw?.condition.event).toBe('beginning_of_draw_step');
    const combat = parseTriggerEventSentence('At the beginning of combat on your turn, you gain 1 life.');
    expect(combat?.condition.event).toBe('beginning_of_combat');
    expect(combat?.condition.whoseTurn).toBe('you');
    expect(parseTriggerEventSentence('At the beginning of your first main phase, draw a card.')?.condition.event).toBe('beginning_of_precombat_main');
    expect(parseTriggerEventSentence('At the beginning of your postcombat main phase, draw a card.')?.condition.event).toBe('beginning_of_postcombat_main');
    expect(parseTriggerEventSentence('At end of combat on your turn, draw a card.')?.condition.whoseTurn).toBe('you');
    expect(parseTriggerEventSentence('Whenever you gain life, draw a card.')?.condition.event).toBe('gains_life');
    expect(parseTriggerEventSentence('Whenever an opponent loses life, draw a card.')?.condition.alternatives[0].controller).toBe('not_you');
    expect(parseTriggerEventSentence('Whenever you sacrifice a creature, draw a card.')?.condition.event).toBe('sacrifices');
    expect(parseTriggerEventSentence('Whenever an opponent draws a card, you gain 1 life.')?.condition.event).toBe('draws_card');
    expect(parseTriggerEventSentence('Whenever you discard a creature card, draw a card.')?.condition.event).toBe('discards');
    expect(parseTriggerEventSentence('Whenever you mill a card, draw a card.')?.condition.event).toBe('mills');
    expect(parseTriggerEventSentence('Whenever this creature deals combat damage to a player, draw a card.')?.condition.event).toBe('deals_combat_damage_to_player');
    expect(parseTriggerEventSentence('Whenever a +1/+1 counter is put on a creature you control, draw a card.')?.condition.placedCounter).toBe('+1/+1');
  });

  it('parses search, shuffle, pay life, tokens, counters removed, exile, and graveyard sentences', () => {
    const search = parseTriggerEventSentence('Whenever an opponent searches a library, you gain 1 life.');
    expect(search?.condition.event).toBe('searches_library');
    expect(search?.condition.libraryOwner).toBe('any');
    expect(search?.condition.alternatives[0].controller).toBe('not_you');
    expect(parseTriggerEventSentence('Whenever you search your library, draw a card.')?.condition.libraryOwner).toBe('source');
    expect(parseTriggerEventSentence('Whenever a player shuffles their library, draw a card.')?.condition.event).toBe('shuffles_library');
    expect(parseTriggerEventSentence('Whenever you pay life, draw a card.')?.condition.event).toBe('pays_life');
    const token = parseTriggerEventSentence('Whenever you create a creature token, draw a card.');
    expect(token?.condition.event).toBe('creates_token');
    expect(token?.condition.alternatives[0].subject.token).toBe('token');
    expect(token?.condition.alternatives[0].subject.typeGroups).toEqual([['creature']]);
    expect(parseTriggerEventSentence('Whenever one or more tokens are created under your control, draw a card.')?.condition.quantity).toBe('one_or_more');
    expect(parseTriggerEventSentence('Whenever a +1/+1 counter is removed from a creature you control, draw a card.')?.condition.event).toBe('counter_removed');
    expect(parseTriggerEventSentence('Whenever a creature is exiled from the battlefield, draw a card.')?.condition.fromZone).toBe('battlefield');
    const graveyard = parseTriggerEventSentence('Whenever a creature card is put into your graveyard from anywhere, draw a card.');
    expect(graveyard?.condition.event).toBe('put_into_graveyard');
    expect(graveyard?.condition.zoneOwner).toBe('you');
    expect(graveyard?.condition.fromZone).toBe('anywhere');
    expect(graveyard?.condition.alternatives[0].subject.typeGroups).toEqual([['creature']]);
    expect(parseTriggerEventSentence('Whenever a creature card leaves your graveyard, draw a card.')?.condition.event).toBe('left_graveyard');
    expect(parseTriggerEventSentence('Whenever a land card is put into your graveyard from your library, draw a card.')).toBeNull();
    expect(parseTriggerEventSentence('Whenever a creature is exiled from your graveyard, draw a card.')).toBeNull();
  });
});
