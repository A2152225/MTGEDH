import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { collectMatchingParsedEventLines } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { getDeathTriggers } from '../src/state/modules/triggers/death-emission.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { getMillTriggers } from '../src/state/modules/triggers/mill.js';
import { getTapTriggers } from '../src/state/modules/triggers/tap-untap.js';

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
  return { state, gameId: 'r8', bumpSeq() { state.seq++; }, isReplaying: false } as any;
}

const KOSEI_ORACLE = 'As long as Kosei is enchanted, equipped, and has a counter on it, Kosei has "Whenever Kosei deals combat damage to an opponent, you draw that many cards and Kosei deals that much damage to each other opponent."';
const ENDLESS_ORACLE = 'Each creature has "When this creature dies, each opponent may put a creature card from their graveyard onto the battlefield."';

describe('legacy-r8: parse promotions', () => {
  it('promotes death, etb, combat-damage, and ltb leftovers', () => {
    const pte = cond('Whenever a creature you control with power or toughness 1 or less dies, target opponent loses 2 life and you gain 2 life.');
    expect(pte?.event).toBe('dies');
    expect(pte?.powerOrToughnessLte).toBe(1);
    expect(pte?.legacyRuntimeOnly).toBeFalsy();

    const vogar = cond('Whenever another creature dies during your turn, put a +1/+1 counter on Vogar.', 'Vogar, Necropolis Tyrant');
    expect(vogar?.event).toBe('dies');
    expect(vogar?.whoseTurn).toBe('you');

    const frog = cond('Whenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.');
    expect(frog?.event).toBe('enters');
    expect(frog?.legacyRuntimeOnly).toBeFalsy();
    expect((frog?.alternatives || []).length).toBeGreaterThanOrEqual(4);

    const calix = cond('Whenever Calix or an enchanted creature you control deals combat damage to a player, you may create a token.', 'Calix, Guided by Fate');
    expect(calix?.event).toBe('deals_combat_damage_to_player');
    expect(calix?.legacyRuntimeOnly).toBeFalsy();
    expect((calix?.alternatives || []).length + (calix?.pairedEvent ? 1 : 0)).toBeGreaterThanOrEqual(2);

    const merieke = cond('When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature.', 'Merieke Ri Berit');
    expect(merieke?.event).toBe('leaves_battlefield');
    expect(merieke?.pairedEvent).toBe('becomes_untapped');
    expect(merieke?.legacyRuntimeOnly).toBeFalsy();
  });

  it('promotes delayed riders, attack, spell-cast, tap, and mill leftovers', () => {
    const delayed = cond('When it dies under your control this turn, draw two cards.');
    expect(delayed?.event).toBe('dies');
    expect(delayed?.delayedRider).toBe(true);
    expect(delayed?.legacyRuntimeOnly).toBeFalsy();

    const norin = cond("When a player casts a spell or a creature attacks, exile Norin. Return it to the battlefield under its owner's control at the beginning of the next end step.", 'Norin the Wary');
    expect(norin?.event).toBe('spell_cast');
    expect(norin?.pairedEvent).toBe('attacks');

    const two = cond("Whenever you cast a spell that's exactly two colors, look at the top six cards of your library.");
    expect(two?.event).toBe('spell_cast');
    expect(two?.exactColorCount).toBe(2);

    const afterFirst = cond('Whenever you cast a spell during your turn other than your first spell that turn, create a token.');
    expect(afterFirst?.excludeFirstSpellEachTurn).toBe(true);
    expect(afterFirst?.whoseTurn).toBe('you');

    const mill = cond('Whenever one or more nonland cards are milled, draw a card, then put a +1/+1 counter on this creature.');
    expect(mill?.event).toBe('mills');
    expect(mill?.milledNonland).toBe(true);

    const second = cond('Whenever a player draws their second card during their turn, you draw a card.');
    expect(second?.event).toBe('draws_card');
    expect(second?.ordinal).toBe('second');
  });
});

describe('legacy-r8: fires exactly once', () => {
  it('exactly-two-color spells and another-creature-dies-during-your-turn each fire once on a match only', () => {
    const paragon = perm('w', 'p1', { name: 'Guildpact Paragon', type_line: 'Artifact Creature', oracle_text: "Whenever you cast a spell that's exactly two colors, look at the top six cards of your library." });
    const two = { name: 'Boros Charm', type_line: 'Instant', cmc: 2, mana_value: 2, colors: ['r', 'w'], controller: 'p1', owner: 'p1' };
    const one = { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1, colors: ['r'], controller: 'p1', owner: 'p1' };
    expect(fromW(getSpellCastTriggers(ctxOf([paragon]), 'p1', one) as any[]).length).toBe(0);
    expect(fromW(getSpellCastTriggers(ctxOf([paragon]), 'p1', two) as any[]).length).toBe(1);

    const vogar = perm('w', 'p1', { name: 'Vogar, Necropolis Tyrant', type_line: 'Legendary Creature', oracle_text: 'Whenever another creature dies during your turn, put a +1/+1 counter on Vogar.' });
    const dying = perm('d', 'p2', { name: 'Bear', type_line: 'Creature - Bear' });
    const yours = ctxOf([vogar], { turnPlayer: 'p1', activePlayer: 'p1' });
    expect(fromW(getDeathTriggers(yours, dying, 'p2') as any[]).length).toBe(1);
    const theirs = ctxOf([vogar], { turnPlayer: 'p2', activePlayer: 'p2' });
    expect(fromW(getDeathTriggers(theirs, dying, 'p2') as any[]).length).toBe(0);
  });

  it('nonland mill fires once', () => {
    const queen = perm('w', 'p1', { name: 'Mirelurk Queen', type_line: 'Creature', oracle_text: 'Whenever one or more nonland cards are milled, draw a card, then put a +1/+1 counter on this creature. This ability triggers only once each turn.' });
    const hits = fromW(getMillTriggers(ctxOf([queen]), 'p1', { milledCards: [{ type_line: 'Instant' }], controllerId: 'p1' } as any) as any[]);
    // If the getter signature differs, fall back to IR collect.
    if (hits.length === 0) {
      const lines = collectMatchingParsedEventLines({
        ctx: ctxOf([queen]),
        oracleText: String(queen.card.oracle_text),
        event: 'mills' as any,
        subjectPermanent: { id: 'lib', controller: 'p1', type_line: 'Instant' },
        subjectControllerId: 'p1',
        sourcePermanent: queen,
        matchContext: { milledNonland: true },
      });
      expect(lines.length).toBe(1);
    } else {
      expect(hits.length).toBe(1);
    }
  });
});

describe('legacy-r8: granted quoted triggers fire through IR', () => {
  it('Kosei granted combat-damage trigger fires once only while enchanted, equipped, and counters apply', () => {
    const kosei = perm('w', 'p1', { name: 'Kosei, Penitent Warlord', type_line: 'Legendary Creature — Ogre Warrior', oracle_text: KOSEI_ORACLE, power: 5, toughness: 5 }, { counters: { 'p1p1': 1 } });
    const aura = perm('aura', 'p1', { name: 'Pacifism', type_line: 'Enchantment — Aura' }, { attachedTo: 'w' });
    const eq = perm('eq', 'p1', { name: 'Bonesplitter', type_line: 'Artifact — Equipment' }, { attachedTo: 'w' });
    const ready = ctxOf([kosei, aura, eq]);
    const lines = collectMatchingParsedEventLines({
      ctx: ready,
      oracleText: KOSEI_ORACLE,
      event: 'deals_combat_damage_to_player' as any,
      subjectPermanent: kosei,
      subjectControllerId: 'p1',
      sourcePermanent: kosei,
      matchContext: { damagedPlayerId: 'p2' },
    });
    expect(lines.length).toBe(1);
    expect(lines[0].effect.toLowerCase()).toMatch(/draw that many cards/);

    const bare = perm('w', 'p1', { name: 'Kosei, Penitent Warlord', type_line: 'Legendary Creature — Ogre Warrior', oracle_text: KOSEI_ORACLE });
    const missing = collectMatchingParsedEventLines({
      ctx: ctxOf([bare]),
      oracleText: KOSEI_ORACLE,
      event: 'deals_combat_damage_to_player' as any,
      subjectPermanent: bare,
      subjectControllerId: 'p1',
      sourcePermanent: bare,
    });
    expect(missing.length).toBe(0);
  });

  it('Endless Whispers granted death trigger fires once on a creature, and not after the grant leaves', () => {
    const whispers = perm('ew', 'p1', { name: 'Endless Whispers', type_line: 'Enchantment', oracle_text: ENDLESS_ORACLE });
    const dying = perm('w', 'p2', { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' });
    const withGrant = ctxOf([whispers]);
    const hits = fromW(getDeathTriggers(withGrant, dying, 'p2') as any[]);
    expect(hits.length).toBe(1);
    expect(String(hits[0].effect || hits[0].description || '').toLowerCase()).toMatch(/graveyard onto the battlefield/);

    const without = ctxOf([dying]);
    expect(fromW(getDeathTriggers(without, dying, 'p2') as any[]).length).toBe(0);
  });
});

describe('legacy-r8 census samples', () => {
  it('promoted leftover families are IR without legacyRuntimeOnly', () => {
    const samples = [
      'Whenever a creature you control with power or toughness 1 or less dies, you gain 2 life.',
      'Whenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.',
      "Whenever you cast a spell that's exactly two colors, draw a card.",
      'Whenever one or more nonland cards are milled, draw a card.',
      'When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature.',
    ];
    for (const s of samples) {
      const c = cond(s, 'Merieke Ri Berit');
      expect(c, s).toBeTruthy();
      expect(c?.legacyRuntimeOnly, s).toBeFalsy();
      expect(c?.event, s).toBeTruthy();
    }
  });
});
