// server/tests/batch94-statics.unit.test.ts
import { describe, expect, it } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import {
  floatingPoolIsCreatureProduced,
  spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool,
} from '../src/state/modules/batch94ManaPayment.js';
import { applyEligethReplacementAtScryQueue } from '../src/state/modules/batch94ScryQueue.js';
import {
  applyGainLifeFromZoneChangeReplacement,
  collectBatch94ZoneChangeReplacementSpecs,
  applyCardToLibraryBottom,
} from '../src/state/modules/batch94ZoneChangeApply.js';
import { applyNontokenEntersAsCopyOfEnchanted } from '../src/state/modules/batch93EtbCopy.js';
import { applyBatch94DamageSideEffects, collectBatch94DamageReplacementSpecs } from '../src/state/modules/replacementBatch94DamageReplacements.js';
import { applyEnergyPlusNReplacement, collectBatch94EnergyReplacementSpecs } from '../src/state/modules/replacementBatch94EnergyReplacements.js';
import { applyMinManaCostFloorToManaCost, parseBatch94MinManaCostSentence, collectActiveMinManaCostFloors } from '../src/state/modules/batch94CastCost.js';
import { applyTransformAttachToPlayer, parseTransformsAttachToPlayer } from '../src/state/modules/batch94TransformAttach.js';

const SUPERION = 'Spend only mana produced by creatures to cast this spell.';
const CRYSTAL = 'Black spells you cast cost {1} less to cast.\nIf a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.';
const REFLECTION = 'Enchant creature\nWhen this Aura enters attached to a creature, each other nontoken creature you control becomes a copy of that creature.\nNontoken creatures you control enter as a copy of enchanted creature.';
const ELIGETH = 'Flying\nIf you would scry a number of cards, draw that many cards instead.\nPartner';
const TRINI = 'As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast.';
const WHEEL = "Enchant player\nIf a card would be put into enchanted player's graveyard from anywhere, instead that card is revealed and put on the bottom of that player's library.";
const CURSE = 'Enchant player\nAs this permanent transforms into Curse of Leeches, attach it to a player.\nAt the beginning of enchanted player\'s upkeep, they lose 1 life and you gain 1 life.';
const NERIV = 'Flying\nIf a creature you control that entered this turn would deal damage, it deals twice that much damage instead.';
const IZZET = 'If you would get one or more {E} (energy counters), you get that many plus one {E} instead.\n{T}: Draw a card. Activate only if you\'ve paid or lost four or more {E} this turn.';
const GIANT = 'If this creature is unblocked, you may have it assign its combat damage to a creature defending player controls.';
const ATTRACTION = 'Visit — Roll a six-sided die. Put a number of luck counters on Pick-a-Beeble equal to the result and create a Treasure token. Then if there are six or more luck counters on Pick-a-Beeble, claim the prize!\nPrize — Create two Treasure tokens, then sacrifice Pick-a-Beeble and open an Attraction.';
const DRAFT = "Before you shuffle your deck to start the game, you may reveal this card from your deck and exile an instant or sorcery card you drafted that isn't in your deck.";
const STICKER = 'Enchanted creature gets +1/+1 for each name sticker on Last Voyage of the _____ with 3 or fewer letters.';
const GAUNTLET = 'If a red instant or sorcery spell you control or a red planeswalker you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.';

function perm(partial: Record<string, unknown>) {
  return {
    id: String(partial.id || 'p1'),
    controller: String(partial.controller || 'p1'),
    card: partial.card || { name: 'Card', oracle_text: '', type_line: 'Creature' },
    ...partial,
  };
}

function stateWith(bf: any[], extras: Record<string, any> = {}) {
  return { battlefield: bf, zones: extras.zones || {}, players: extras.players || [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: extras.life || { p1: 40, p2: 40 }, ...extras };
}

describe('batch94 statics', () => {
  it('Superion allows a pre-floated creature pool and rejects unaccounted or non-creature float', () => {
    const card = { name: 'Myr Superion', oracle_text: SUPERION, type_line: 'Artifact Creature — Myr' };
    const bear = perm({ id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } });
    const land = perm({ id: 'land', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' } });
    const creaturePool: any = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 };
    creaturePool.manaProducedByPermanentLowerBound = { bear: { ...creaturePool } };
    const ok = stateWith([bear]);
    expect(floatingPoolIsCreatureProduced(ok, 'p1', creaturePool)).toBe(true);
    expect(spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool(card, [], ok, { playerId: 'p1', existingPool: creaturePool })).toBe(true);
    const landPool: any = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 };
    landPool.manaProducedByPermanentLowerBound = { land: { ...landPool } };
    const fromLand = stateWith([land]);
    expect(spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool(card, [], fromLand, { playerId: 'p1', existingPool: landPool })).toBe(false);
    const unaccounted: any = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 };
    expect(spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool(card, [], stateWith([bear]), { playerId: 'p1', existingPool: unaccounted })).toBe(false);
    expect(spellPaymentSatisfiesCreatureProducedManaRestrictionWithPool(card, [{ permanentId: 'bear' }], ok, { playerId: 'p1' })).toBe(true);
  });

  it("Darkness Crystal's zone-change replacement grants 2 life to the source controller", () => {
    const crystal = perm({ id: 'dc', controller: 'p1', card: { name: 'The Darkness Crystal', type_line: 'Legendary Artifact', oracle_text: CRYSTAL } });
    const st = stateWith([crystal], { life: { p1: 30, p2: 40 } });
    const result = applyGainLifeFromZoneChangeReplacement(st, { gainLife: 2, sourcePermanentId: 'dc' });
    expect(result).toEqual({ applied: true, playerId: 'p1', amount: 2 });
    expect(st.life.p1).toBe(32);
  });

  it('Infinite Reflection still stamps an entering nontoken as a copy of the enchanted creature', () => {
    const host = perm({ id: 'host', controller: 'p1', card: { name: 'Serra Angel', type_line: 'Creature — Angel', oracle_text: 'Flying, vigilance', power: 4, toughness: 4 } });
    const aura = perm({ id: 'ir', controller: 'p1', attachedTo: 'host', card: { name: 'Infinite Reflection', type_line: 'Enchantment — Aura', oracle_text: REFLECTION } });
    const entering: any = perm({ id: 'bear', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', isToken: false } });
    expect(applyNontokenEntersAsCopyOfEnchanted(stateWith([host, aura]), entering).applied).toBe(true);
    expect(entering.copyOf).toBe('Serra Angel');
  });

  it('Eligeth replaces a scry at the queue point and never leaves a pending scry', () => {
    const eligeth = perm({ id: 'el', controller: 'p1', card: { name: 'Eligeth, Crossroads Augur', type_line: 'Legendary Creature — Sphinx', oracle_text: ELIGETH } });
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    const lib = [a, b];
    const st = stateWith([eligeth], { zones: { p1: { library: lib, hand: [] } } });
    const game = { state: st, libraries: new Map([['p1', lib]]) };
    const result = applyEligethReplacementAtScryQueue(game, 'p1', 2);
    expect(result.replaced).toBe(true);
    expect(st.zones.p1.hand.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(lib).toEqual([]);
  });

  it('Trinisphere raises a cheaper mana cost up to three while untapped', () => {
    const tri = perm({ id: 'tri', controller: 'p1', tapped: false, card: { name: 'Trinisphere', type_line: 'Artifact', oracle_text: TRINI } });
    expect(parseBatch94MinManaCostSentence(TRINI)?.floor).toBe(3);
    expect(collectActiveMinManaCostFloors(stateWith([tri]))).toBe(3);
    expect(applyMinManaCostFloorToManaCost(stateWith([tri]), '{1}{B}')).toBe('{2}{B}');
    expect(applyMinManaCostFloorToManaCost(stateWith([tri]), '{3}{U}')).toBe('{3}{U}');
    const tapped = perm({ id: 'tri', controller: 'p1', tapped: true, card: { name: 'Trinisphere', type_line: 'Artifact', oracle_text: TRINI } });
    expect(applyMinManaCostFloorToManaCost(stateWith([tapped]), '{1}{B}')).toBe('{1}{B}');
  });

  it("Wheel of Sun and Moon collects a graveyard-from-anywhere to library-bottom replacement", () => {
    const specs = collectBatch94ZoneChangeReplacementSpecs(WHEEL, { sourcePermanentId: 'w', sourceController: 'p1', sourceName: 'Wheel of Sun and Moon' }, { enchantedPlayerId: 'p2' });
    expect(specs.some((s) => s.effectId === 'graveyard-from-anywhere-to-library-bottom' && (s.metadata as any)?.enchantedPlayerId === 'p2')).toBe(true);
    const st = stateWith([], { zones: { p2: { library: [{ id: 'x' }], graveyard: [] } } });
    expect(applyCardToLibraryBottom(st, { id: 'shock', name: 'Shock' }, 'p2')).toBe(true);
    expect(st.zones.p2.library.map((c: any) => c.id)).toEqual(['x', 'shock']);
  });

  it('Curse of Leeches attaches to a chosen player as it transforms, and asks for a choice when none is given', () => {
    expect(parseTransformsAttachToPlayer(CURSE)).toBe(true);
    const curse: any = perm({ id: 'cl', controller: 'p1', card: { name: 'Curse of Leeches', type_line: 'Enchantment — Aura Curse', oracle_text: CURSE } });
    expect(applyTransformAttachToPlayer(curse).needsPlayerChoice).toBe(true);
    expect(applyTransformAttachToPlayer(curse, 'p2')).toEqual({ applied: true, needsPlayerChoice: false });
    expect(curse.enchantedPlayerId).toBe('p2');
  });

  it('Neriv doubles damage from a creature you control that entered this turn', () => {
    const neriv = perm({ id: 'n', controller: 'p1', card: { name: 'Neriv, Heart of the Storm', type_line: 'Legendary Creature — Spirit Dragon', oracle_text: NERIV } });
    const newbie = perm({ id: 'nb', controller: 'p1', enteredThisTurn: true, card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } });
    const oldie = perm({ id: 'old', controller: 'p1', enteredThisTurn: false, card: { name: 'Ox', type_line: 'Creature — Ox', oracle_text: '' } });
    expect(collectBatch94DamageReplacementSpecs(NERIV, { sourcePermanentId: 'n', sourceController: 'p1', sourceName: 'Neriv' }).some((s) => s.effectId === 'entered-this-turn-damage-double')).toBe(true);
    const hit = applyBatch94DamageSideEffects({ state: stateWith([neriv, newbie]) } as any, 3, 'p1', 'p2', 'nb');
    expect(hit?.amount).toBe(6);
    const miss = applyBatch94DamageSideEffects({ state: stateWith([neriv, oldie]) } as any, 3, 'p1', 'p2', 'old');
    expect(miss).toBeNull();
  });

  it('Izzet Generatorium adds one to energy gained', () => {
    const gen = perm({ id: 'ig', controller: 'p1', card: { name: 'Izzet Generatorium', type_line: 'Artifact', oracle_text: IZZET } });
    expect(collectBatch94EnergyReplacementSpecs(IZZET, { sourcePermanentId: 'ig', sourceController: 'p1', sourceName: 'Izzet Generatorium' }).some((s) => s.effectId === 'energy-plus-n')).toBe(true);
    expect(applyEnergyPlusNReplacement(stateWith([gen]), 'p1', 2)).toBe(3);
    expect(applyEnergyPlusNReplacement(stateWith([gen]), 'p2', 2)).toBe(2);
  });

  it('Pyromancer\'s Gauntlet adds 2 to red instant, sorcery, or planeswalker damage', () => {
    const g = perm({ id: 'pg', controller: 'p1', card: { name: "Pyromancer's Gauntlet", type_line: 'Artifact', oracle_text: GAUNTLET } });
    const bolt = { id: 'bolt', controller: 'p1', isSpell: true, colors: ['R'], type_line: 'Instant', card: { name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'], mana_cost: '{R}' } };
    const st = stateWith([g]);
    (st as any).stack = [bolt];
    const hit = applyBatch94DamageSideEffects({ state: st } as any, 3, 'p1', 'p2', 'bolt');
    expect(hit?.amount).toBe(5);
  });

  it('Cunning Giant parses an optional unblocked-damage-assignment static', () => {
    const giant = perm({ id: 'cg', controller: 'p1', card: { name: 'Cunning Giant', type_line: 'Creature — Giant', oracle_text: GIANT } });
    const specs = parseStaticEffectSpecsFromOraclePermanent(giant as any);
    expect((specs || []).some((s: any) => String(s.effectId || s.id).includes('optional-assign-combat-damage-to-defender-creature'))).toBe(true);
  });

  it('census lines for sticker, attraction, and draft-only cards are not owned_but_unhandled', () => {
    const rows: Array<[string, string]> = [
      ['Prize — Create two Treasure tokens, then sacrifice Pick-a-Beeble and open an Attraction.', 'Pick-a-Beeble'],
      ['Enchanted creature gets +1/+1 for each name sticker on Last Voyage of the _____ with 3 or fewer letters.', 'Last Voyage of the _____'],
      ["Before you shuffle your deck to start the game, you may reveal this card from your deck and exile an instant or sorcery card you drafted that isn't in your deck.", 'Arcane Savant'],
      [TRINI, 'Trinisphere'],
      [WHEEL.split('\n')[1], 'Wheel of Sun and Moon'],
      ['As this permanent transforms into Curse of Leeches, attach it to a player.', 'Curse of Leeches'],
      [NERIV.split('\n')[1], 'Neriv, Heart of the Storm'],
      [IZZET.split('\n')[0], 'Izzet Generatorium'],
      [GIANT, 'Cunning Giant'],
      [GAUNTLET, "Pyromancer's Gauntlet"],
    ];
    for (const [line, name] of rows) {
      const result = classifyStaticCensusLine(line, name);
      expect(result?.kind, `${name}: ${line}`).not.toBe('owned_but_unhandled');
    }
  });
});
