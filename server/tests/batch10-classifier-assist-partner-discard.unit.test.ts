import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/socket/util.js', async (orig) => ({ ...(await (orig as any)()), broadcastGame: vi.fn() }));
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { resolveAIActivatedAbilityId } from '../src/socket/ai-handlers/aiActivatedAbilityResolver.js';
import { applyAssistPaymentChoice, abandonAssistedCast, refundAssistCredit } from '../src/socket/assistPaymentFlow.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { applyDiscardToBattlefieldReplacements, matchDiscardToBattlefieldReplacement } from '../../rules-engine/src/discardToBattlefieldReplacement.js';
import { discardSpecificCardsForPlayer } from '../../rules-engine/src/oracleIRExecutorPlayerDiscardCards.js';
import { validatePartnerPair, parsePartnerAbilities } from '../../rules-engine/src/partnerDeckValidation.js';
import { validatePartners, hasPartner } from '../../rules-engine/src/casualVariants.js';

const sys = (line: string, name = 'Test Card') => String(classifyStaticCensusLine(line, name)?.system ?? '');

describe('batch 10: Batch 7 classifier entries no longer hide parser-handled lines', () => {
  it('Arrest-style lock is left for the parser', () => {
    expect(sys("Enchanted creature can't attack or block, and its activated abilities can't be activated.")).not.toMatch(/activation lock/);
  });
  it('threshold quoted grants are left for the parser', () => {
    expect(sys('Threshold \u2014 As long as there are seven or more cards in your graveyard, this creature has "When this creature enters, draw a card."')).not.toMatch(/PairedThreshold/);
  });
  it('must-attack and toughness-damage parser forms are left alone', () => {
    expect(sys('Enchanted creature gets +2/+1, has haste, and attacks each combat if able.')).not.toMatch(/must attack/);
    expect(sys('As long as enchanted creature has vigilance, it assigns combat damage equal to its toughness rather than its power.')).not.toMatch(/toughness/);
  });
  it('batch 10 families classify', () => {
    expect(sys('Partner\u2014Friends forever (You can have two commanders if both have this ability.)')).toMatch(/partner/);
    expect(sys("If a spell or ability an opponent controls causes you to discard Loxodon Smiter, put it onto the battlefield instead of putting it into your graveyard.", 'Loxodon Smiter')).toMatch(/discard-to-battlefield/);
  });
});

describe('batch 10: AI resolver sees granted abilities via battlefield', () => {
  it('resolveAIActivatedAbilityId accepts the battlefield', () => {
    const pw = { id: 'pw', controller: 'p1', card: { id: 'pwc', name: 'Test Walker', type_line: 'Legendary Planeswalker - Test', oracle_text: '+1: Scry 1.' } };
    const granter = { id: 'g', controller: 'p1', card: { id: 'gc', name: 'Granter', type_line: 'Enchantment', oracle_text: 'Planeswalkers you control have "\u22124: Draw a card."' } };
    const id = resolveAIActivatedAbilityId({ abilityText: '\u22124: Draw a card.' }, pw, [pw, granter]);
    expect(typeof id).toBe('string');
  });
});

describe('batch 10: assist refund on abandon', () => {
  it('refunds the exact colors to the helper', () => {
    const state: any = {
      turnNumber: 3,
      players: [{ id: 'p1' }, { id: 'p2' }],
      manaPool: { p2: { red: 1, colorless: 2 } },
      zones: { p1: { hand: [{ id: 'c1', name: 'Assisted', oracle_text: 'Assist', mana_cost: '{3}{R}' }] } },
      pendingSpellCasts: { e1: { cardId: 'c1', cardName: 'Assisted', manaCost: '{3}{R}', playerId: 'p1' } },
    };
    const game: any = { state };
    const step: any = { playerId: 'p2', assistCasterId: 'p1', assistCardId: 'c1', assistEffectId: 'e1', maxValue: 3 };
    expect(applyAssistPaymentChoice(game, step, 'p2', 3)).toBe(3);
    expect(state.manaPool.p2.red + state.manaPool.p2.colorless).toBe(0);
    expect(abandonAssistedCast(game, 'p2', 'e1')).toBe(0); // only the caster can abandon
    expect(abandonAssistedCast(game, 'p1', 'e1')).toBe(3);
    expect(state.manaPool.p2).toMatchObject({ red: 1, colorless: 2 });
    expect(refundAssistCredit(state, 'p1', 'c1')).toBe(0);
  });
});

describe('batch 10: P/T equal to number of COLOR permanents', () => {
  it('counts only matching-color permanents you control', () => {
    const card = { id: 'x', name: 'Counter', type_line: 'Creature', power: '*', toughness: '*', oracle_text: "Counter's power and toughness are each equal to the number of green permanents you control." };
    const battlefield = [
      { id: 'x', controller: 'p1', card },
      { id: 'a', controller: 'p1', card: { mana_cost: '{G}', type_line: 'Creature' } },
      { id: 'b', controller: 'p1', card: { colors: ['G', 'W'], type_line: 'Enchantment' } },
      { id: 'c', controller: 'p1', card: { mana_cost: '{R}', type_line: 'Creature' } },
      { id: 'd', controller: 'p2', card: { mana_cost: '{G}', type_line: 'Creature' } },
    ];
    expect(calculateVariablePT({ ...card, controller: 'p1' }, { battlefield })).toEqual({ power: 2, toughness: 2 });
  });
});

describe('batch 10: discard-to-battlefield replacement', () => {
  const smiter = { id: 's', name: 'Loxodon Smiter', type_line: 'Creature', oracle_text: 'If a spell or ability an opponent controls causes you to discard Loxodon Smiter, put it onto the battlefield instead of putting it into your graveyard.' };
  const liege = { id: 'l', name: 'Wilt-Leaf Liege', oracle_text: 'If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield with two +1/+1 counters on it instead of putting it into your graveyard.' };
  it('matches variants', () => {
    expect(matchDiscardToBattlefieldReplacement(smiter.oracle_text)).toEqual({ plusOneCounters: 0 });
    expect(matchDiscardToBattlefieldReplacement(liege.oracle_text)).toEqual({ plusOneCounters: 2 });
  });
  it('moves only for opponent-caused discards', () => {
    const state: any = { players: [{ id: 'p1', hand: [], graveyard: [smiter] }, { id: 'p2' }], battlefield: [] };
    expect(applyDiscardToBattlefieldReplacements(state, 'p1', [smiter], 'p1').redirected).toEqual([]);
    const r = applyDiscardToBattlefieldReplacements(state, 'p1', [smiter], 'p2');
    expect(r.redirected).toEqual(['s']);
    expect((r.state as any).players[0].graveyard).toEqual([]);
    expect((r.state as any).battlefield[0]).toMatchObject({ id: 's', controller: 'p1' });
  });
  it('is applied by the discard executor when an opponent controls the source', () => {
    const state: any = { players: [{ id: 'p1', hand: [liege], graveyard: [] }, { id: 'p2', hand: [], graveyard: [] }], battlefield: [], zones: {} };
    const res = discardSpecificCardsForPlayer(state, 'p1' as any, ['l'], { ctx: { controllerId: 'p2' } as any });
    expect((res.state as any).battlefield.some((p: any) => p.id === 'l' && p.counters['+1/+1'] === 2)).toBe(true);
    const own = discardSpecificCardsForPlayer(state, 'p1' as any, ['l'], { ctx: { controllerId: 'p1' } as any });
    expect((own.state as any).battlefield.length).toBe(0);
  });
});

describe('batch 10: partner deck validation', () => {
  const c = (cardName: string, oracleText: string, typeLine = 'Legendary Creature \u2014 Human') =>
    ({ cardName, oracleText, typeLine, isLegendary: true, colorIdentity: [], canBeCommander: true, timesCommanderCast: 0 });
  it('plain partner and partner with', () => {
    expect(validatePartners(c('A', 'Partner'), c('B', 'Flying\nPartner'))).toBe(true);
    expect(validatePartners(c('Pako, Arcane Retriever', 'Partner with Haldan, Avid Arcanist'), c('Haldan, Avid Arcanist', 'Partner with Pako, Arcane Retriever'))).toBe(true);
    expect(validatePartners(c('Pako, Arcane Retriever', 'Partner with Haldan, Avid Arcanist'), c('B', 'Partner'))).toBe(false);
    expect(validatePartners(c('A', 'Partner'), c('B', 'Flying'))).toBe(false);
  });
  it('friends forever, partner\u2014text, background, doctor', () => {
    expect(validatePartnerPair(c('A', 'Friends forever'), c('B', 'Friends forever'))).toBe(true);
    expect(validatePartnerPair(c('A', 'Partner\u2014Character select'), c('B', 'Partner\u2014Character select'))).toBe(true);
    expect(validatePartnerPair(c('A', 'Partner\u2014Character select'), c('B', 'Partner'))).toBe(false);
    expect(validatePartnerPair(c('A', 'Choose a Background'), c('Bg', 'Commander creatures you own have menace.', 'Legendary Enchantment \u2014 Background'))).toBe(true);
    expect(validatePartnerPair(c('A', 'Partner'), c('Bg', '', 'Legendary Enchantment \u2014 Background'))).toBe(false);
    expect(validatePartnerPair(c('Comp', "Doctor's companion"), c('Doc', '', 'Legendary Creature \u2014 Time Lord Doctor'))).toBe(true);
  });
  it('hasPartner reads the text; legacy entries without text stay permissive', () => {
    expect(hasPartner(c('A', 'Flying') as any)).toBe(false);
    expect(hasPartner(c('A', 'Friends forever') as any)).toBe(true);
    expect(hasPartner({ cardName: 'X', isLegendary: true, colorIdentity: [], canBeCommander: true, timesCommanderCast: 0 })).toBe(true);
    expect(parsePartnerAbilities('A', 'Partner (You can have two commanders if both have partner.)')).toHaveLength(1);
  });
});