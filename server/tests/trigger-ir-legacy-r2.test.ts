import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function ctxOf(battlefield: any[]) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1' }, { id: 'p2' }], commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'combat', step: 'declare_attackers',
    zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } },
  };
  return { state, gameId: 'r60', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');

describe('legacy-r2: delayed_rider IR shapes', () => {
  it('when you/they do parse as reflexive_do and never match permanently', () => {
    const you = cond("When you do, target creature can't block this turn.");
    expect(you?.event).toBe('reflexive_do');
    expect(you?.reflexiveActor).toBe('you');
    expect(you?.delayedRider).toBe(true);
    expect(you?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(you, { id: 'a', controllerId: 'p1', typeLine: 'Creature' } as any, src(), {} as any)).toBe(false);

    const they = cond('When they do, exile the top card of their library.');
    expect(they?.event).toBe('reflexive_do');
    expect(they?.reflexiveActor).toBe('they');
    expect(triggerConditionMatches(they, { id: 'a', controllerId: 'p1', typeLine: 'Creature' } as any, src(), {} as any)).toBe(false);
  });

  it('next / that / your end step and that combat / next EOC are delayed IR', () => {
    const nextEnd = cond('At the beginning of the next end step, sacrifice it.');
    expect(nextEnd?.event).toBe('beginning_of_end_step');
    expect(nextEnd?.delayedNextTurn || nextEnd?.delayedRider).toBeTruthy();
    expect(nextEnd?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(nextEnd, { id: 'a', controllerId: 'p1', typeLine: 'Creature' } as any, src(), { inCombat: false } as any)).toBe(false);

    const thatEnd = cond("At the beginning of that turn's end step, you lose the game.");
    expect(thatEnd?.event).toBe('beginning_of_end_step');
    expect(thatEnd?.delayedRider || thatEnd?.delayedNextTurn).toBeTruthy();
    expect(thatEnd?.legacyRuntimeOnly).toBeFalsy();

    const yourEnd = cond('At the beginning of your next end step, sacrifice those tokens.');
    expect(yourEnd?.delayedNextTurn).toBe(true);
    expect(yourEnd?.legacyRuntimeOnly).toBeFalsy();

    const thatCombat = cond('At the beginning of that combat, untap all creatures that attacked this turn.');
    expect(thatCombat?.event).toBe('beginning_of_combat');
    expect(thatCombat?.delayedRider || thatCombat?.delayedNextTurn).toBeTruthy();
    expect(thatCombat?.legacyRuntimeOnly).toBeFalsy();

    const eoc = cond("At this turn's next end of combat, destroy all creatures that blocked or were blocked by it this turn.");
    expect(eoc?.event).toBe('end_of_combat');
    expect(eoc?.delayedRider || eoc?.delayedNextTurn).toBeTruthy();
  });

  it('that-creature dies/leaves this turn and next-cast / that-spell are delayed IR', () => {
    const dies = cond('When that creature dies this turn, you draw a card.');
    expect(dies?.event).toBe('dies');
    expect(dies?.thisTurn).toBe(true);
    expect(dies?.delayedRider).toBe(true);
    expect(dies?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(dies, { id: 'd', controllerId: 'p1', typeLine: 'Creature' } as any, src(), {} as any)).toBe(false);

    const leaves = cond('When that creature leaves the battlefield this turn, sacrifice this creature.');
    expect(leaves?.event).toBe('leaves_battlefield');
    expect(leaves?.delayedRider).toBe(true);

    const nextCast = cond('When you next cast an instant or sorcery spell this turn, copy that spell.');
    expect(nextCast?.event).toBe('spell_cast');
    expect(nextCast?.nextSpellThisTurn).toBe(true);
    expect(triggerConditionMatches(nextCast, { id: 'sp', controllerId: 'p1', typeLine: 'Instant' } as any, src(), {} as any)).toBe(false);

    const thatSpell = cond("When you cast that spell, this creature gets +X/+0 until end of turn, where X is that spell's mana value.");
    expect(thatSpell?.thatSpell).toBe(true);
    expect(thatSpell?.legacyRuntimeOnly).toBeFalsy();
  });
});

describe('legacy-r2: etb + attack promotions', () => {
  it('enters-and-upkeep / declare-attackers / from-graveyard / regenerates this way', () => {
    const upkeep = cond('When this creature enters and at the beginning of your upkeep, each Horror you control gets +1/+1.');
    expect(upkeep?.event).toBe('enters');
    expect(upkeep?.pairedEvent).toBe('beginning_of_upkeep');
    expect(upkeep?.legacyRuntimeOnly).toBeFalsy();

    const declareAtk = cond('When this creature enters during the declare attackers step, you may reselect which player or planeswalker it is attacking.');
    expect(declareAtk?.event).toBe('enters');
    expect(declareAtk?.duringCombat).toBe(true);
    expect(declareAtk?.legacyRuntimeOnly).toBeFalsy();

    const fromGy = cond('When this creature enters from a graveyard, exile up to one target nonland permanent.');
    expect(fromGy?.event).toBe('enters');
    expect(fromGy?.fromZone).toBe('graveyard');
    expect(fromGy?.legacyRuntimeOnly).toBeFalsy();

    const regen = cond('When it regenerates this way, put a -1/-1 counter on it.');
    expect(regen?.event).toBe('reflexive_do');
    expect(regen?.delayedRider).toBe(true);
  });

  it('attacks this turn / enchanted-or-equipped / attacks enchanted player batch', () => {
    const thisTurn = cond('Whenever a creature attacks this turn, it gains lifelink until end of turn.');
    expect(thisTurn?.event).toBe('attacks');
    expect(thisTurn?.thisTurn).toBe(true);
    expect(thisTurn?.delayedRider).toBe(true);
    expect(thisTurn?.legacyRuntimeOnly).toBeFalsy();
    expect(triggerConditionMatches(thisTurn, { id: 'a', controllerId: 'p1', typeLine: 'Creature' } as any, src(), {} as any)).toBe(false);

    const enchEq = cond("Whenever a creature you control that's enchanted or equipped attacks, create a Junk token.");
    expect(enchEq?.event).toBe('attacks');
    expect(enchEq?.requireEquippedAttacker).toBe(true);
    expect(enchEq?.legacyRuntimeOnly).toBeFalsy();

    const batch = cond('Whenever a player attacks enchanted player with one or more creatures, that attacking player loses 2 life.');
    expect(batch?.event).toBe('attacks');
    expect(batch?.attackedPlayer).toBe('enchanted');
    expect(batch?.quantity).toBe('one_or_more');
    expect(batch?.legacyRuntimeOnly).toBeFalsy();
  });

  it('fires once: enchanted-player attack batch (no double fire)', () => {
    const text = 'Whenever a player attacks enchanted player with one or more creatures, that attacking player loses 2 life.';
    const attacker = perm('a1', 'p2', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p1' });
    const watcher = perm('w', 'p1', { name: 'Curse', type_line: 'Enchantment — Aura Curse', oracle_text: text }, { attachedTo: 'p1', enchanting: 'p1' });
    // enchanted player is p1; attacker from p2 attacks p1
    const n = fromW(getAttackTriggersForCreatures(ctxOf([watcher, attacker]), [attacker], 'p2', 'p1') as any[]).length;
    expect(n).toBe(1);
  });
});

describe('legacy-r2 census', () => {
  it('delayed and etb/attack samples are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string]> = [
      ["When you do, draw a card.", 'reflexive_do'],
      ['At the beginning of the next end step, sacrifice it.', 'beginning_of_end_step'],
      ["At the beginning of that turn's end step, you lose the game.", 'beginning_of_end_step'],
      ['At the beginning of that combat, untap all creatures you control.', 'beginning_of_combat'],
      ["At this turn's next end of combat, destroy all creatures that blocked it.", 'end_of_combat'],
      ['When that creature dies this turn, you draw a card.', 'dies'],
      ['When you next cast an instant or sorcery spell this turn, copy that spell.', 'spell_cast'],
      ['When this creature enters and at the beginning of your upkeep, scry 1.', 'enters'],
      ['When this creature enters from a graveyard, draw a card.', 'enters'],
      ['Whenever a creature attacks this turn, it gains lifelink until end of turn.', 'attacks'],
      ["Whenever a creature you control that's enchanted or equipped attacks, create a Junk token.", 'attacks'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
