import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';
import { getTapTriggers } from '../src/state/modules/triggers/tap-untap.js';
import { queueLibraryShuffleTriggers } from '../src/state/modules/triggers/shuffle.js';
import { queueParsedKeywordAction } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated.js';
import { getPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { getBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';

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
  return { state, gameId: 'r7', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}

describe('legacy-r7: parse promotions', () => {
  it('promotes phase, boast, clash, shuffle, and you-attack leftovers', () => {
    const time = cond("Whenever a time counter is removed from this card while it's exiled, draw a card.");
    expect(time?.event).toBe('counter_removed');
    expect(time?.whileExiled).toBe(true);
    expect(time?.legacyRuntimeOnly).toBeFalsy();

    const main = cond("At the beginning of each player's first main phase, that player adds {G}{G}.");
    expect(main?.event).toBe('beginning_of_precombat_main');
    expect(main?.whoseTurn).toBe('each_player');
    expect(main?.legacyRuntimeOnly).toBeFalsy();

    const combat = cond("At the beginning of combat on each opponent's turn, if you're the monarch, draw a card.");
    expect(combat?.event).toBe('beginning_of_combat');
    expect(combat?.whoseTurn).toBe('each_opponent');
    expect(combat?.legacyRuntimeOnly).toBeFalsy();

    const boast = cond('Whenever you activate a boast ability, put a +1/+1 counter on this creature.');
    expect(boast?.event).toBe('performs');
    expect(boast?.action).toBe('boast');
    expect(boast?.legacyRuntimeOnly).toBeFalsy();

    const clash = cond('Whenever you clash and win, you may draw a card.');
    expect(clash?.action).toBe('win_clash');
    expect(clash?.legacyRuntimeOnly).toBeFalsy();

    const shuffle = cond('Whenever a spell or ability causes its controller to shuffle their library, that player puts a card from their hand on top of their library.');
    expect(shuffle?.event).toBe('shuffles_library');
    expect(shuffle?.legacyRuntimeOnly).toBeFalsy();

    const initiative = cond('Whenever you attack the player who has the initiative, create a Treasure token.');
    expect(initiative?.event).toBe('attacks');
    expect(initiative?.attackedPlayer).toBe('initiative');
    expect(initiative?.quantity).toBe('one_or_more');

    const saddled = cond('Whenever a saddled creature you control attacks, it gets +2/+2 until end of turn.');
    expect(saddled?.event).toBe('attacks');
    expect(saddled?.requiresSubjectSaddled).toBe(true);
  });

  it('promotes spell-cast, death, etb, block, and mana-tap leftovers', () => {
    const even = cond('Whenever you cast a spell with an even mana value, convert Soundwave.');
    expect(even?.event).toBe('spell_cast');
    expect(even?.manaValueParity).toBe('even');
    expect(even?.legacyRuntimeOnly).toBeFalsy();

    const first = cond('Whenever you cast your first spell during each of your turns, create a Treasure token.');
    expect(first?.spellOrdinal).toBe(1);

    const targets = cond('Whenever you cast a spell with one or more targets, draw that many cards.');
    expect(targets?.minSpellTargets).toBe(1);

    const dies = cond('When this creature dies during your turn, draw a card.');
    expect(dies?.event).toBe('dies');
    expect(dies?.whoseTurn).toBe('you');
    expect(dies?.legacyRuntimeOnly).toBeFalsy();

    const chosen = cond('Whenever another creature you control of the chosen type enters, put a +1/+1 counter on this creature.');
    expect(chosen?.event).toBe('enters');
    expect(chosen?.legacyRuntimeOnly).toBeFalsy();

    const eq = cond('Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures.');
    expect(['blocks', 'becomes_blocked']).toContain(eq?.event);
    expect(eq?.pairedEvent).toBeTruthy();

    const forest = cond("Whenever a Forest is tapped for mana, its controller adds an additional {G}.");
    expect(forest?.event).toBe('tapped_for_mana');
    expect(forest?.legacyRuntimeOnly).toBeFalsy();

    const tapOpp = cond('Whenever you tap an untapped creature an opponent controls, you may pay {1}.');
    expect(tapOpp?.event).toBe('becomes_tapped');
    expect(tapOpp?.causedByYou).toBe(true);
  });
});

describe('legacy-r7: fires exactly once', () => {
  it('saddled attacker and initiative attack each fire once on a match only', () => {
    const jandor = perm('w', 'p1', { name: 'Jandor, Fortuned Traveler', type_line: 'Legendary Creature - Human Wizard', oracle_text: 'Whenever a saddled creature you control attacks, draw a card.' });
    const bare = perm('a1', 'p1', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2' });
    const saddled = perm('a2', 'p1', { name: 'Horse', type_line: 'Creature - Horse Mount', oracle_text: '', power: '3', toughness: '3' }, { attacking: 'p2', saddled: true });
    expect(fromW(getAttackTriggersForCreatures(ctxOf([jandor, bare]), [bare], 'p1', 'p2') as any[]).length).toBe(0);
    expect(fromW(getAttackTriggersForCreatures(ctxOf([jandor, saddled]), [saddled], 'p1', 'p2') as any[]).length).toBe(1);

    const loot = perm('w', 'p1', { name: 'Loot Dispute', type_line: 'Enchantment', oracle_text: 'Whenever you attack the player who has the initiative, create a Treasure token.' });
    const atk = perm('a1', 'p1', { name: 'Soldier', type_line: 'Creature - Soldier', oracle_text: '', power: '2', toughness: '2' }, { attacking: 'p2' });
    const miss = ctxOf([loot, atk]);
    expect(fromW(getAttackTriggersForCreatures(miss, [atk], 'p1', 'p2') as any[]).length).toBe(0);
    const hit = ctxOf([loot, atk], { initiativePlayerId: 'p2', initiative: 'p2' });
    expect(fromW(getAttackTriggersForCreatures(hit, [atk], 'p1', 'p2') as any[]).length).toBe(1);
  });

  it('even mana-value spells and first-spell-of-turn each fire once on a match only', () => {
    const wave = perm('w', 'p1', { name: 'Soundwave, Superior Captain', type_line: 'Legendary Artifact Creature', oracle_text: 'Whenever you cast a spell with an even mana value, convert Soundwave.' });
    const odd = { name: 'Bolt', type_line: 'Instant', cmc: 1, mana_value: 1, controller: 'p1', owner: 'p1' };
    const even = { name: 'Wrath', type_line: 'Sorcery', cmc: 4, mana_value: 4, controller: 'p1', owner: 'p1' };
    expect(fromW(getSpellCastTriggers(ctxOf([wave]), 'p1', odd) as any[]).length).toBe(0);
    expect(fromW(getSpellCastTriggers(ctxOf([wave]), 'p1', even) as any[]).length).toBe(1);

    const rashmi = perm('w', 'p1', { name: 'Rashmi and Ragavan', type_line: 'Legendary Creature', oracle_text: 'Whenever you cast your first spell during each of your turns, create a Treasure token.' });
    const spell = { name: 'Cantrip', type_line: 'Instant', cmc: 1, mana_value: 1, controller: 'p1', owner: 'p1' };
    const first = ctxOf([rashmi], { spellsCastThisTurn: [] });
    expect(fromW(getSpellCastTriggers(first, 'p1', spell) as any[]).length).toBe(1);
    const later = ctxOf([rashmi], { spellsCastThisTurn: [{ controller: 'p1' }] });
    expect(fromW(getSpellCastTriggers(later, 'p1', spell) as any[]).length).toBe(0);
  });

  it('clash-and-win, shuffle, and boast each fire once', () => {
    const echoes = perm('w', 'p1', { name: 'Sylvan Echoes', type_line: 'Enchantment', oracle_text: 'Whenever you clash and win, you may draw a card.' });
    expect(fromW(queueParsedKeywordAction(ctxOf([echoes]), 'p1', 'win_clash') as any[]).length).toBe(1);

    const panic = perm('w', 'p1', { name: 'Widespread Panic', type_line: 'Enchantment', oracle_text: 'Whenever a spell or ability causes its controller to shuffle their library, that player puts a card from their hand on top of their library.' });
    expect(fromW(queueLibraryShuffleTriggers(ctxOf([panic]), 'p1') as any[]).length).toBe(1);

    const raider = perm('w', 'p1', { name: 'Frenzied Raider', type_line: 'Creature - Human Berserker', oracle_text: 'Whenever you activate a boast ability, put a +1/+1 counter on this creature.' });
    const src = perm('src', 'p1', { name: 'Warrior', type_line: 'Creature - Human Warrior', oracle_text: 'Boast — {1}: Draw a card.' });
    const miss = triggerAbilityActivatedTriggers(ctxOf([raider, src]), { activatedBy: 'p1', sourcePermanentId: 'src', isManaAbility: false, abilityText: '{T}: Add {R}.' });
    expect(fromW(miss as any[]).length).toBe(0);
    const hit = triggerAbilityActivatedTriggers(ctxOf([raider, src]), { activatedBy: 'p1', sourcePermanentId: 'src', isManaAbility: false, abilityText: 'Boast — {1}: Draw a card.' });
    expect(fromW(hit as any[]).length).toBe(1);
  });

  it('first main on each player and opponent-combat beginning fire once on a match only', () => {
    const vineyard = perm('w', 'p1', { name: "Eladamri's Vineyard", type_line: 'Enchantment', oracle_text: "At the beginning of each player's first main phase, that player adds {G}{G}." });
    expect(fromW(getPrecombatMainTriggers(ctxOf([vineyard], { turnPlayer: 'p2' }), 'p2') as any[]).length).toBe(1);

    const fight = perm('w', 'p1', { name: 'Fight or Flight', type_line: 'Enchantment', oracle_text: "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles." });
    expect(fromW(getBeginningOfCombatTriggers(ctxOf([fight], { turnPlayer: 'p1' }), 'p1') as any[]).length).toBe(0);
    expect(fromW(getBeginningOfCombatTriggers(ctxOf([fight], { turnPlayer: 'p2' }), 'p2') as any[]).length).toBe(1);
  });

  it('you tap an untapped opponent creature fires once, and delayed pay-cost stays fail-closed is not needed here', () => {
    const sentry = perm('w', 'p1', { name: 'Icewrought Sentry', type_line: 'Creature - Elemental Soldier', oracle_text: 'Whenever you tap an untapped creature an opponent controls, this creature gets +2/+1 until end of turn.' });
    const theirs = perm('c1', 'p2', { name: 'Bear', type_line: 'Creature - Bear', oracle_text: '' }, { tapped: true });
    expect(fromW(getTapTriggers(ctxOf([sentry, theirs]), theirs, 'p1') as any[]).length).toBe(1);
  });
});

describe('legacy-r7 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples: Array<[string, string]> = [
      ["Whenever a time counter is removed from this card while it's exiled, draw a card.", 'counter_removed'],
      ["At the beginning of each player's first main phase, that player adds {G}{G}.", 'beginning_of_precombat_main'],
      ["At the beginning of combat on each opponent's turn, draw a card.", 'beginning_of_combat'],
      ['Whenever you activate a boast ability, put a counter on this creature.', 'performs'],
      ['Whenever you clash and win, you may draw a card.', 'performs'],
      ['Whenever a spell or ability causes its controller to shuffle their library, that player puts a card from their hand on top of their library.', 'shuffles_library'],
      ['Whenever you attack the player who has the initiative, create a Treasure token.', 'attacks'],
      ['Whenever you cast a spell with an even mana value, convert Soundwave.', 'spell_cast'],
      ['When this creature dies during your turn, draw a card.', 'dies'],
      ['Whenever another creature you control of the chosen type enters, put a counter on this creature.', 'enters'],
      ['Whenever a Forest is tapped for mana, its controller adds {G}.', 'tapped_for_mana'],
    ];
    for (const [text, event] of samples) {
      const c = cond(text);
      expect(c?.event, text).toBe(event);
      expect(c?.legacyRuntimeOnly, text).toBeFalsy();
    }
  });
});
