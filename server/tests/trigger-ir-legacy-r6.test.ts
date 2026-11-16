import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { queueFreshDieRollTriggers } from '../src/state/modules/triggers/playLandSaddleDieRollHooks.js';
import { recordDilemmaFaced } from '../src/state/modules/triggers/trekPlayerEventTriggers.js';
import {
  queueCreatureExploresTriggers,
  queueSelfDiscardTriggers,
  queueCrewVehicleTriggers,
} from '../src/state/modules/triggers/eventSpecificLegacyTriggers.js';
import { queueCreatureConnivesTriggers } from '../src/state/modules/triggers/irEventWatchers.js';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const sourceId = (x: any) => String(x?.permanentId || x?.source?.permanentId || x?.sourceId || x?.source || '');
const fromW = (list: any[]) => list.filter((x) => sourceId(x) === 'w');
const perm = (id: string, controller: string, card: any, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: id + '_c', ...card }, ...extra,
});

function ctxOf(battlefield: any[], extra: Record<string, unknown> = {}) {
  const state: any = {
    seq: 1, stack: [], battlefield,
    players: [{ id: 'p1', life: 30 }, { id: 'p2', life: 20 }, { id: 'p3', life: 15 }],
    commandZone: {},
    turnPlayer: 'p1', activePlayer: 'p1', turnNumber: 3, phase: 'main1', step: 'main',
    zones: {
      p1: { hand: [], graveyard: [], exile: [], library: [] },
      p2: { hand: [], graveyard: [], exile: [], library: [] },
    },
    spellsCastThisTurn: [],
    ...extra,
  };
  return { state, gameId: 'r6', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}

describe('legacy-r6: parse promotions', () => {
  it('rolls, dilemmas, explores, connives, and opponent-caused discard', () => {
    const one = cond('Whenever you roll a 1, create a token.');
    expect(one?.event).toBe('performs');
    expect(one?.action).toBe('roll_die');
    expect(one?.naturalRoll).toBe(1);
    expect(one?.legacyRuntimeOnly).toBeFalsy();

    const higher = cond('Whenever you roll a 4 or higher, create a Robot token.');
    expect(higher?.minRoll).toBe(4);
    expect(higher?.legacyRuntimeOnly).toBeFalsy();

    const either = cond('Whenever you roll a 1 or 2, put that many counters on this creature.');
    expect(either?.rollValues).toEqual([1, 2]);

    const dilemma = cond('Whenever you face a dilemma, draw a card.');
    expect(dilemma?.event).toBe('performs');
    expect(dilemma?.action).toBe('face_dilemma');
    expect(dilemma?.legacyRuntimeOnly).toBeFalsy();

    const explore = cond('Whenever a creature you control explores, you gain 3 life.');
    expect(explore?.action).toBe('explore');
    expect(explore?.legacyRuntimeOnly).toBeFalsy();

    const land = cond('Whenever a creature you control explores a land card, you may put a land card from your hand onto the battlefield tapped.');
    expect(land?.action).toBe('explore');
    expect(land?.exploredIsLand).toBe(true);

    const connive = cond('Whenever a creature you control connives, put a +1/+1 counter on that creature.');
    expect(connive?.action).toBe('connive');
    expect(connive?.legacyRuntimeOnly).toBeFalsy();

    const discard = cond('When a spell or ability an opponent controls causes you to discard this card, it deals 4 damage to any target.');
    expect(discard?.event).toBe('discards');
    expect(discard?.causedByOpponent).toBe(true);
    expect(discard?.legacyRuntimeOnly).toBeFalsy();

    const crew = cond('Whenever this creature crews a Vehicle, that Vehicle gains first strike until end of turn.');
    expect(crew?.action).toBe('crew');
    expect(crew?.legacyRuntimeOnly).toBeFalsy();

    const pay = cond('When you pay this cost one or more times, put that many +1/+1 counters on this creature.');
    expect(pay?.action).toBe('pay_cost');
    expect(pay?.delayedRider).toBe(true);
  });

  it('death combiners, attack-with, most-life, and damage-to-subtype', () => {
    const ultron = cond('Whenever another artifact is put into your graveyard from the battlefield or an artifact card is put into your graveyard from anywhere other than the battlefield, each opponent loses 1 life.');
    expect(ultron?.event).toBe('put_into_graveyard');
    expect(ultron?.pairedEvent || ultron?.fromZone).toBeTruthy();
    expect(ultron?.legacyRuntimeOnly).toBeFalsy();

    const shard = cond('Whenever an artifact is put into a graveyard from the battlefield or is put into exile from the battlefield, put two +1/+1 counters on this creature.');
    expect(['put_into_graveyard', 'dies', 'exiled']).toContain(shard?.event);
    expect(shard?.pairedEvent).toBeTruthy();

    const dread = cond('Whenever a creature dies or a creature card is put into a graveyard from a library, each opponent loses 1 life.');
    expect(dread?.event).toBe('dies');
    expect(dread?.pairedEvent).toBe('put_into_graveyard');

    const akiri = cond('Whenever you attack a player with one or more equipped creatures, draw a card.');
    expect(akiri?.event).toBe('attacks');
    expect(akiri?.attackedPlayer).toBe('any');
    expect(akiri?.quantity).toBe('one_or_more');

    const preacher = cond('Whenever this creature attacks while you have the most life or are tied for most life, you draw a card and you lose 1 life.');
    expect(preacher?.sourceMostLife).toBe(true);

    const slayer = cond('Whenever this creature deals damage to a Vampire, destroy that creature.');
    expect(slayer?.damageRecipientSubtypes).toEqual(['vampire']);

    const hunter = cond('Whenever this creature deals damage to a Goblin or Orc, destroy that creature.');
    expect(hunter?.damageRecipientSubtypes).toEqual(['goblin', 'orc']);

    const park = cond('Whenever this creature deals combat damage to a player or dies, proliferate.');
    expect(park?.event).toBe('deals_combat_damage_to_player');
    expect(park?.pairedEvent).toBe('dies');

    const kindred = cond('Whenever a creature you control of the chosen type enters or attacks, draw a card.');
    expect(kindred?.event).toBe('enters');
    expect(kindred?.pairedEvent).toBe('attacks');

    const noOther = cond('When you control no other artifacts, sacrifice this creature.');
    expect(noOther?.event).toBe('controls_none');
    expect(noOther?.excludeSource).toBe(true);

    const runic = cond('Whenever an opponent activates an ability of a creature or land that isn\'t a mana ability, you may draw a card.');
    expect(runic?.action).toBe('activate_ability');
    expect(runic?.notManaAbility).toBe(true);
    expect(runic?.legacyRuntimeOnly).toBeFalsy();
  });
});

describe('legacy-r6: fires exactly once', () => {
  it('roll a 1 and roll 4 or higher each fire once on a match only', () => {
    const watcher = perm('w', 'p1', { name: 'Complaints Clerk', type_line: 'Creature - Clown Advisor', oracle_text: 'Whenever you roll a 1, create a 1/1 white Clown Robot artifact creature token.' });
    const miss = ctxOf([watcher], { lastDieRollByPlayer: { p1: { results: [6], sides: 6 } } });
    expect(fromW(queueFreshDieRollTriggers(miss, 'p1') as any[]).length).toBe(0);
    const hit = ctxOf([watcher], { lastDieRollByPlayer: { p1: { results: [1], sides: 6 } } });
    expect(fromW(queueFreshDieRollTriggers(hit, 'p1') as any[]).length).toBe(1);

    const house = perm('w', 'p1', { name: 'Mr. House, President and CEO', type_line: 'Legendary Artifact Creature', oracle_text: 'Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token.' });
    const low = ctxOf([house], { lastDieRollByPlayer: { p1: { results: [3], sides: 6 } } });
    expect(fromW(queueFreshDieRollTriggers(low, 'p1') as any[]).length).toBe(0);
    const high = ctxOf([house], { lastDieRollByPlayer: { p1: { results: [4], sides: 6 } } });
    expect(fromW(queueFreshDieRollTriggers(high, 'p1') as any[]).length).toBe(1);
  });

  it('facing a dilemma fires the watcher once', () => {
    const seven = perm('w', 'p1', { name: 'Seven of Nine', type_line: 'Legendary Creature', oracle_text: 'Whenever you face a dilemma, draw a card.' });
    const g = ctxOf([seven]);
    recordDilemmaFaced(g, 'p1', 1);
    expect(fromW(g.state.stack as any[]).length).toBe(1);
    recordDilemmaFaced(g, 'p1', 1);
    expect(fromW(g.state.stack as any[]).length).toBe(2);
  });

  it('explores and land-card explores fire once on a match only', () => {
    const walker = perm('w', 'p1', { name: 'Wildgrowth Walker', type_line: 'Creature - Elemental', oracle_text: 'Whenever a creature you control explores, put a +1/+1 counter on this creature and you gain 3 life.' });
    const explorer = perm('e1', 'p1', { name: 'Scout', type_line: 'Creature - Merfolk', oracle_text: '' });
    const g = ctxOf([walker, explorer]);
    expect(fromW(queueCreatureExploresTriggers(g, 'p1', 'e1', false) as any[]).length).toBe(1);

    const nican = perm('w', 'p1', { name: 'Nicanzil, Current Conductor', type_line: 'Legendary Creature - Merfolk Scout', oracle_text: 'Whenever a creature you control explores a land card, you may put a land card from your hand onto the battlefield tapped.' });
    const g2 = ctxOf([nican, explorer]);
    expect(fromW(queueCreatureExploresTriggers(g2, 'p1', 'e1', false) as any[]).length).toBe(0);
    expect(fromW(queueCreatureExploresTriggers(g2, 'p1', 'e1', true) as any[]).length).toBe(1);
  });

  it('opponent-caused self-discard fires once, and self-caused does not', () => {
    const tactics = { id: 'w', name: 'Guerrilla Tactics', type_line: 'Instant', oracle_text: 'When a spell or ability an opponent controls causes you to discard this card, it deals 4 damage to any target.', owner: 'p1' };
    const self = ctxOf([], { zones: { p1: { hand: [], graveyard: [tactics], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } } });
    expect(fromW(queueSelfDiscardTriggers(self, 'p1', [tactics], { causeControllerId: 'p1' }) as any[]).length).toBe(0);
    const opp = ctxOf([], { zones: { p1: { hand: [], graveyard: [tactics], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } } });
    expect(fromW(queueSelfDiscardTriggers(opp, 'p1', [tactics], { causeControllerId: 'p2' }) as any[]).length).toBe(1);
  });

  it('crew and connive each fire once, and delayed pay-cost is fail-closed', () => {
    const ace = perm('w', 'p1', { name: 'Gearshift Ace', type_line: 'Creature - Dwarf Pilot', oracle_text: 'Whenever this creature crews a Vehicle, that Vehicle gains first strike until end of turn.' });
    const vehicle = perm('v1', 'p1', { name: 'Smuggler\'s Copter', type_line: 'Artifact - Vehicle', oracle_text: '' });
    expect(fromW(queueCrewVehicleTriggers(ctxOf([ace, vehicle]), ['w'], 'v1') as any[]).length).toBe(1);

    const purpose = perm('w', 'p1', { name: 'Glorious Purpose', type_line: 'Enchantment', oracle_text: 'Whenever a creature you control connives, put a +1/+1 counter on that creature and a plan counter on this enchantment.' });
    const rogue = perm('c1', 'p1', { name: 'Rogue', type_line: 'Creature - Human Rogue', oracle_text: '' });
    expect(fromW(queueCreatureConnivesTriggers(ctxOf([purpose, rogue]), 'c1') as any[]).length).toBe(1);

    const pay = cond('When you pay this cost one or more times, put that many +1/+1 counters on this creature.');
    expect(pay?.delayedRider).toBe(true);
    expect(triggerConditionMatches(pay, { id: 'w', controllerId: 'p1', typeLine: 'Creature' } as any, { id: 'w', controllerId: 'p1' } as any, {} as any)).toBe(false);
  });

  it('opponent non-mana activation fires the watcher once', () => {
    const runic = perm('w', 'p1', { name: 'Runic Armasaur', type_line: 'Creature - Dinosaur', oracle_text: 'Whenever an opponent activates an ability of a creature or land that isn\'t a mana ability, you may draw a card.' });
    const src = perm('src', 'p2', { name: 'Llanowar Elves', type_line: 'Creature - Elf Druid', oracle_text: '{T}: Add {G}.' });
    const mana = triggerAbilityActivatedTriggers(ctxOf([runic, src]), { activatedBy: 'p2', sourcePermanentId: 'src', isManaAbility: true });
    expect(fromW(mana as any[]).length).toBe(0);
    const hit = triggerAbilityActivatedTriggers(ctxOf([runic, src]), { activatedBy: 'p2', sourcePermanentId: 'src', isManaAbility: false });
    expect(fromW(hit as any[]).length).toBe(1);
  });

  it('you attack a player with equipped creatures fires once', () => {
    const text = 'Whenever you attack a player with one or more equipped creatures, draw a card.';
    const watcher = perm('w', 'p1', { name: 'Akiri, Fearless Voyager', type_line: 'Legendary Creature - Kor Warrior', oracle_text: text });
    const eq = perm('a1', 'p1', { name: 'Soldier', type_line: 'Creature - Soldier', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2', isEquipped: true });
    const bare = perm('a2', 'p1', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2' });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, bare]), [bare], 'p1', 'p2') as any[]).length).toBe(0);
    expect(fromW(getAttackTriggersForCreatures(ctxOf([watcher, eq]), [eq], 'p1', 'p2') as any[]).length).toBe(1);
  });
});

describe('legacy-r6 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string]> = [
      ['Whenever you roll a 1, create a token.', 'performs'],
      ['Whenever you roll a 4 or higher, create a Robot token.', 'performs'],
      ['Whenever you face a dilemma, draw a card.', 'performs'],
      ['Whenever a creature you control explores, you gain 3 life.', 'performs'],
      ['Whenever a creature you control connives, put a counter on that creature.', 'performs'],
      ['When a spell or ability an opponent controls causes you to discard this card, it deals 4 damage to any target.', 'discards'],
      ['Whenever this creature crews a Vehicle, that Vehicle gains first strike.', 'performs'],
      ['Whenever you attack a player with one or more equipped creatures, draw a card.', 'attacks'],
      ['Whenever a creature dies or a creature card is put into a graveyard from a library, each opponent loses 1 life.', 'dies'],
      ['Whenever a creature you control of the chosen type enters or attacks, draw a card.', 'enters'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
