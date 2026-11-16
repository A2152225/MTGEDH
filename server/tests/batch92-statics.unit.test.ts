// server/tests/batch92-statics.unit.test.ts
import { describe, expect, it } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  applyEnduringRenewalDraw,
  applyOutOfTheTombsEmptyLibraryDraw,
  collectBatch92DrawReplacementSpecs,
} from '../src/state/modules/replacementBatch92DrawReplacements.js';
import {
  applyBatch92DamageSideEffects,
  creaturesShareAColor,
} from '../src/state/modules/replacementBatch92DamageReplacements.js';
import {
  collectBatch92DiesReplacementSpecs,
  creatureDamagedThisTurnByControllerSource,
} from '../src/state/modules/replacementBatch92DiesReplacements.js';
import { collectBatch92CounterReplacementSpecs } from '../src/state/modules/replacementBatch92CounterReplacements.js';
import { collectBatch92AssembleReplacementSpecs } from '../src/state/modules/replacementBatch92AssembleReplacements.js';
import {
  isCardAllowedByCommanderDeckExceptions,
  parseCommanderDeckConstructionException,
} from '../src/state/modules/batch92DeckConstruction.js';
import {
  mayActivateExhaustAsThoughNotActivated,
  markExhaustActivatedThisTurn,
  markExhaustActivatedThisGame,
  hasExhaustBeenActivatedThisGame,
  parseBatch92ExhaustReuseSentence,
} from '../src/state/modules/batch92ExhaustReuse.js';
import { manaPaymentSatisfiesCreatureProductionRestriction } from '../src/state/modules/batch92ManaRestrictions.js';
import { applySerumPowderHandRestart } from '../src/state/modules/batch92SerumPowder.js';
import { parseBatch92AttacksMostLifeUnlessNamed, parseBatch92QuotedAbilityGrant } from '../src/state/modules/staticEffectSpec-handlers/batch92LongTailStatics.js';

const RENEWAL = "Play with your hand revealed.\nIf you would draw a card, reveal the top card of your library instead. If it's a creature card, put it into your graveyard. Otherwise, draw a card.\nWhenever a creature is put into your graveyard from the battlefield, return it to your hand.";
const TOMBS = "If you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. If you can't, you lose the game.";
const PLANS = 'Prevent all damage that would be dealt to a creature by another creature if they share a color.';
const ZABAZ = 'Modular 1\nIf a modular triggered ability would put one or more +1/+1 counters on a creature you control, that many plus one +1/+1 counters are put on it instead.';
const PHOENIX = "If this creature would die, return it to its owner's hand instead. Until that player's next turn, that player plays with that card revealed in their hand and can't play it.";
const ETCHING = 'Haste\nIf a creature dealt damage this turn by a source you controlled would die, exile it instead.';
const REFUELER = "During your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been activated.";
const KOSEI = 'As long as Kosei is enchanted, equipped, and has a counter on it, Kosei has "Whenever Kosei deals combat damage to an opponent, you draw that many cards and Kosei deals that much damage to each other opponent."';
const WHISPERS = 'Each creature has "When this creature dies, choose target opponent. That player puts this card from its owner\'s graveyard onto the battlefield under their control at the beginning of the next end step."';
const AETHERSPARK = "As long as The Aetherspark is attached to a creature, The Aetherspark can't be attacked and has \"Whenever equipped creature deals combat damage during your turn, put that many loyalty counters on The Aetherspark.\"";
const GALACTUS = "Flying, trample, indestructible\nInsatiable Hunger — Galactus attacks an opponent with the most life among your opponents each combat if able unless you control a creature named Silver Surfer, Galactus's Herald.";
const SUPERION = 'Spend only mana produced by creatures to cast this spell.';
const GRIZZLEGOM = 'Rulebreaker — A deck with this commander can have any land cards.';
const MAULAR = 'Rulebreaker — A deck with this commander can have creature cards with mana value 7 or greater of any color identity and any basic land cards.';
const STEAMFLOGGER = 'Other Riggers you control get +1/+0 and have haste.\nIf a Rigger you control would assemble a Contraption, it assembles two Contraptions instead.';
const SERUM = 'Any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards. (You can do this in addition to taking mulligans.)';

function perm(partial: Record<string, unknown>) {
  return {
    id: String(partial.id || 'p1'),
    controller: String(partial.controller || 'p1'),
    card: partial.card || { name: 'Card', oracle_text: '', type_line: 'Creature' },
    colors: partial.colors,
    ...partial,
  };
}

function stateWith(bf: any[], zones: Record<string, any> = {}) {
  return { battlefield: bf, zones, players: [{ id: 'p1', life: 40 }], life: { p1: 40 } };
}

describe('batch92 statics', () => {
  it('Enduring Renewal puts a revealed creature into the graveyard and draws a noncreature', () => {
    const renewal = perm({ id: 'er', controller: 'p1', card: { name: 'Enduring Renewal', oracle_text: RENEWAL, type_line: 'Enchantment' } });
    const specs = collectBatch92DrawReplacementSpecs(RENEWAL, { sourcePermanentId: 'er', sourceController: 'p1', sourceName: 'Enduring Renewal' });
    expect(specs.some((s) => s.effectId === 'draw-reveal-creature-to-graveyard-else-draw')).toBe(true);
    const bear = { id: 'bear', type_line: 'Creature — Bear', name: 'Bear' };
    const shock = { id: 'shock', type_line: 'Instant', name: 'Shock' };
    const st = stateWith([renewal], { p1: { library: [bear, shock], graveyard: [], hand: [] } });
    const first = applyEnduringRenewalDraw(st, 'p1');
    expect(first.applied).toBe(true);
    expect(first.movedTo).toBe('graveyard');
    expect(st.zones.p1.graveyard.map((c: any) => c.id)).toEqual(['bear']);
    expect(st.zones.p1.hand).toEqual([]);
    const second = applyEnduringRenewalDraw(st, 'p1');
    expect(second.movedTo).toBe('hand');
    expect(st.zones.p1.hand.map((c: any) => c.id)).toEqual(['shock']);
  });

  it('Out of the Tombs returns the only creature, asks for a choice with two, and loses with none', () => {
    const tombs = perm({ id: 'oot', controller: 'p1', card: { name: 'Out of the Tombs', oracle_text: TOMBS, type_line: 'Enchantment' } });
    const a = { id: 'a', type_line: 'Creature — Zombie', name: 'A' };
    const b = { id: 'b', type_line: 'Creature — Zombie', name: 'B' };
    const choice = applyOutOfTheTombsEmptyLibraryDraw(stateWith([tombs], { p1: { library: [], graveyard: [a, b], hand: [] } }), 'p1', 0);
    expect(choice.needsChoice).toBe(true);
    expect(choice.applied).toBe(false);
    expect(choice.candidates).toHaveLength(2);
    const auto = applyOutOfTheTombsEmptyLibraryDraw(stateWith([tombs], { p1: { library: [], graveyard: [a], hand: [] } }), 'p1', 0);
    expect(auto.applied).toBe(true);
    expect(auto.returned?.id).toBe('a');
    const loseSt: any = stateWith([tombs], { p1: { library: [], graveyard: [], hand: [] } });
    const lost = applyOutOfTheTombsEmptyLibraryDraw(loseSt, 'p1', 0);
    expect(lost.lost).toBe(true);
    expect(loseSt.players[0].hasLost).toBe(true);
  });

  it('Well-Laid Plans prevents damage between creatures that share a color', () => {
    const plans = perm({ id: 'wlp', controller: 'p1', card: { name: 'Well-Laid Plans', oracle_text: PLANS, type_line: 'Enchantment' } });
    const redA = perm({ id: 'ra', controller: 'p1', card: { name: 'Goblin', oracle_text: '', type_line: 'Creature — Goblin', colors: ['R'], mana_cost: '{R}' }, colors: ['R'] });
    const redB = perm({ id: 'rb', controller: 'p2', card: { name: 'Ogre', oracle_text: '', type_line: 'Creature — Ogre', colors: ['R'], mana_cost: '{R}' }, colors: ['R'] });
    const blue = perm({ id: 'bu', controller: 'p2', card: { name: 'Merfolk', oracle_text: '', type_line: 'Creature — Merfolk', colors: ['U'], mana_cost: '{U}' }, colors: ['U'] });
    expect(creaturesShareAColor(redA, redB)).toBe(true);
    expect(creaturesShareAColor(redA, blue)).toBe(false);
    const st = stateWith([plans, redA, redB, blue]);
    const prevented = applyBatch92DamageSideEffects({ state: st } as any, 3, 'p1', 'p2', 'ra', 'rb', true);
    expect(prevented?.amount).toBe(0);
    const unprevented = applyBatch92DamageSideEffects({ state: st } as any, 3, 'p1', 'p2', 'ra', 'bu', true);
    expect(unprevented).toBeNull();
  });

  it('Zabaz adds one +1/+1 counter when a modular trigger would put one or more', () => {
    const specs = collectBatch92CounterReplacementSpecs(ZABAZ, { sourcePermanentId: 'zab', sourceController: 'p1', sourceName: 'Zabaz, the Glimmerwasp' });
    expect(specs).toHaveLength(1);
    expect(specs[0].instead).toMatchObject({ modify: 'add_flat', value: 1 });
    expect(specs[0].metadata).toMatchObject({ modularOnly: true, plus: 1 });
  });

  it('Firestorm Phoenix dies to hand with a cannot-play-until-next-turn flag, and Etching of Kumano exiles damaged-by-you creatures', () => {
    const phoenix = collectBatch92DiesReplacementSpecs(PHOENIX, { sourcePermanentId: 'fp', sourceController: 'p1', sourceName: 'Firestorm Phoenix' });
    expect(phoenix[0].instead).toMatchObject({ redirectZone: 'hand' });
    expect(phoenix[0].metadata).toMatchObject({ cantPlayUntilOwnersNextTurn: true, playRevealedInHand: true });
    const etching = collectBatch92DiesReplacementSpecs(ETCHING, { sourcePermanentId: 'ek', sourceController: 'p1', sourceName: 'Etching of Kumano' });
    expect(etching[0].instead).toMatchObject({ redirectZone: 'exile' });
    expect(etching[0].metadata).toMatchObject({ requiresDamagedThisTurnByControllerSource: true });
    const st = {
      battlefield: [perm({ id: 'src', controller: 'p1' }), perm({ id: 'victim', controller: 'p2' })],
      creaturesDamagedByThisCreatureThisTurn: { src: { victim: true } },
    };
    expect(creatureDamagedThisTurnByControllerSource(st, 'victim', 'p1')).toBe(true);
    expect(creatureDamagedThisTurnByControllerSource(st, 'victim', 'p2')).toBe(false);
  });

  it('Elvish Refueler lets you reuse exhaust only during your turn before you activate one this turn', () => {
    expect(parseBatch92ExhaustReuseSentence(REFUELER)).toBe(true);
    const st: any = stateWith([
      perm({ id: 'ref', controller: 'p1', card: { name: 'Elvish Refueler', oracle_text: REFUELER, type_line: 'Creature — Elf' } }),
    ]);
    st.turnPlayerId = 'p1';
    expect(mayActivateExhaustAsThoughNotActivated(st, 'p1')).toBe(true);
    markExhaustActivatedThisTurn(st, 'p1');
    expect(mayActivateExhaustAsThoughNotActivated(st, 'p1')).toBe(false);
    markExhaustActivatedThisGame(st, 'exh-1', 'Exhaust — {1}{G}');
    expect(hasExhaustBeenActivatedThisGame(st, 'exh-1')).toBe(true);
  });

  it('Kosei, Endless Whispers, and The Aetherspark parse quoted ability grants', () => {
    const kosei = parseBatch92QuotedAbilityGrant(KOSEI);
    expect(kosei[0]?.quoted).toMatch(/deals combat damage to an opponent/);
    const whispers = parseBatch92QuotedAbilityGrant(WHISPERS);
    expect(whispers[0]?.filterKind).toBe('each_creature');
    const spark = parseStaticEffectSpecsFromOraclePermanent({
      id: 'aes', controller: 'p1', card: { name: 'The Aetherspark', oracle_text: AETHERSPARK, type_line: 'Legendary Artifact Planeswalker — Equipment' },
    } as any);
    const ids = (spark || []).map((s: any) => String(s.effectId || s.id || ''));
    expect(ids.some((id: string) => /quoted|cant-be-attacked|attached/i.test(id))).toBe(true);
  });

  it('Galactus must attack a most-life opponent unless you control Silver Surfer, Galactus\'s Herald', () => {
    const parsed = parseBatch92AttacksMostLifeUnlessNamed(GALACTUS);
    expect(parsed).toMatchObject({ mostLife: true, named: "silver surfer, galactus's herald" });
    const specs = parseStaticEffectSpecsFromOraclePermanent({
      id: 'gal', controller: 'p1', card: { name: 'Galactus, Devourer of Worlds', oracle_text: GALACTUS, type_line: 'Legendary Creature' },
    } as any) || [];
    expect(specs.some((s: any) => String(s.effectId || s.id || '').includes('attacks-most-life-unless-named'))).toBe(true);
  });

  it('Myr Superion accepts only creature-produced mana', () => {
    const card = { name: 'Myr Superion', oracle_text: SUPERION, type_line: 'Artifact Creature — Myr' };
    expect(manaPaymentSatisfiesCreatureProductionRestriction(card, [{ producedByCreature: true }])).toBe(true);
    expect(manaPaymentSatisfiesCreatureProductionRestriction(card, [{ producedByCreature: false }])).toBe(false);
    expect(manaPaymentSatisfiesCreatureProductionRestriction(card, [])).toBe(false);
  });

  it('Grizzlegom and Maular allow the listed commander deck-construction exceptions', () => {
    expect(parseCommanderDeckConstructionException(GRIZZLEGOM)).toEqual([{ kind: 'any-land-cards' }]);
    const grizz = [{ name: 'Grizzlegom', oracle_text: GRIZZLEGOM }];
    expect(isCardAllowedByCommanderDeckExceptions({ name: 'Breeding Pool', type_line: 'Land — Forest Island', color_identity: ['G', 'U'] }, grizz)).toBe(true);
    expect(isCardAllowedByCommanderDeckExceptions({ name: 'Shock', type_line: 'Instant', color_identity: ['R'] }, grizz)).toBe(false);
    const maul = [{ name: 'Maular', oracle_text: MAULAR }];
    expect(isCardAllowedByCommanderDeckExceptions({ name: 'Blightsteel Colossus', type_line: 'Artifact Creature — Phyrexian Golem', cmc: 12, color_identity: [] }, maul)).toBe(true);
    expect(isCardAllowedByCommanderDeckExceptions({ name: 'Grizzly Bears', type_line: 'Creature — Bear', cmc: 2, color_identity: ['G'] }, maul)).toBe(false);
    expect(isCardAllowedByCommanderDeckExceptions({ name: 'Island', type_line: 'Basic Land — Island', color_identity: ['U'] }, maul)).toBe(true);
  });

  it('Steamflogger Boss parses assemble-two Contraptions, and Serum Powder exiles the hand then draws that many', () => {
    const specs = collectBatch92AssembleReplacementSpecs(STEAMFLOGGER, { sourcePermanentId: 'sfb', sourceController: 'p1', sourceName: 'Steamflogger Boss' });
    expect(specs[0]).toMatchObject({ metadata: { times: 2, assembledType: 'contraption', assemblerType: 'rigger' } });
    const st: any = stateWith([], {
      p1: {
        hand: [
          { id: 'sp', name: 'Serum Powder', oracle_text: SERUM },
          { id: 'a', name: 'A', oracle_text: '' },
          { id: 'b', name: 'B', oracle_text: '' },
        ],
        library: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }],
        exile: [],
      },
    });
    const result = applySerumPowderHandRestart(st, 'p1');
    expect(result.applied).toBe(true);
    expect(result.exiled).toHaveLength(3);
    expect(st.zones.p1.exile).toHaveLength(3);
    expect(st.zones.p1.hand.map((c: any) => c.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('census classifiers do not leave the new B92 lines owned_but_unhandled', () => {
    const lines = [
      { name: 'Enduring Renewal', text: RENEWAL },
      { name: 'Out of the Tombs', text: TOMBS },
      { name: 'Well-Laid Plans', text: PLANS },
      { name: 'Zabaz, the Glimmerwasp', text: ZABAZ },
      { name: 'Firestorm Phoenix', text: PHOENIX },
      { name: 'Etching of Kumano', text: ETCHING },
      { name: 'Elvish Refueler', text: REFUELER },
      { name: 'Kosei, the Rejuvenated', text: KOSEI },
      { name: 'Endless Whispers', text: WHISPERS },
      { name: 'The Aetherspark', text: AETHERSPARK },
      { name: 'Galactus, Devourer of Worlds', text: GALACTUS },
      { name: 'Myr Superion', text: SUPERION },
      { name: 'Grizzlegom, Primal Hunter', text: GRIZZLEGOM },
      { name: 'Maular', text: MAULAR },
      { name: 'Steamflogger Boss', text: STEAMFLOGGER },
      { name: 'Serum Powder', text: SERUM },
    ];
    for (const line of lines) {
      const result = classifyStaticCensusLine(line.text, line.name);
      expect(result?.kind, line.name).not.toBe('owned_but_unhandled');
    }
  });
});
