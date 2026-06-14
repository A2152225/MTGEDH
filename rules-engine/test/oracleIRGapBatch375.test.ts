import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;
const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 375 — 36 condition clusters', () => {
  it('evaluates meld, tyrannic war, squall, lifecraft, dual-sun, luck, feast, tunnel, galadriel, turf war', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you both own and control this creature and a creature named midnight scavengers',
        nextState: {
          battlefield: [
            { id: 'bf-graf-rats', controller: controllerId, owner: controllerId, name: 'Graf Rats', type_line: 'Creature — Rat' },
            { id: 'bf-midnight', controller: controllerId, owner: controllerId, name: 'Midnight Scavengers', type_line: 'Creature — Human' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-graf-rats' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its mana cost contains {x}',
        lastMovedCards: [{ mana_cost: '{X}{G}', type_line: 'Creature — Tyranid' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'any of those creatures have power or toughness equal to the chosen number',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Human', power: 3, toughness: 2 }],
        } as GameState,
        ctx: { controllerId, chosenNumber: 3, selectorContext: { chosenNumber: 3 } },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it isn't a creature or vehicle",
        nextState: { battlefield: [{ id: 'bf-art', controller: controllerId, type_line: 'Artifact' }] } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-art' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has a +1/+1 counter on it',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this enchantment has ten or more luck counters on it',
        nextState: {
          battlefield: [{ id: 'bf-chance', controller: controllerId, type_line: 'Enchantment', counters: { luck: 10 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-chance' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent lost life last turn',
        nextState: { opponentLostLifeLastTurn: { p2: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a face-down creature entered the battlefield under your control this turn',
        nextState: { faceDownCreaturesEnteredUnderControlThisTurn: { p1: true } } as GameState,
        ctx: { controllerId, faceDownPermanentEnteredThisTurnUnderYourControl: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you chose a creature other than galadriel as your ring-bearer',
        nextState: {
          battlefield: [{ id: 'bf-bearer', controller: controllerId, name: 'Legolas', type_line: 'Legendary Creature — Elf' }],
        } as GameState,
        ctx: { controllerId, chosenRingBearerId: 'bf-bearer' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player controls one or more lands with contested counters on them',
        nextState: {
          battlefield: [{ id: 'bf-land', controller: 'p2', type_line: 'Land', counters: { contested: 1 } }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates ventifact, witch oven, mask, wonderscape, breakout, rhino, discard transform, clowning, galvanize, battle of wits', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this artifact has a charge counter on it',
        nextState: {
          battlefield: [{ id: 'bf-art', controller: controllerId, type_line: 'Artifact', counters: { charge: 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-art' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "the sacrificed creature's toughness was 4 or greater",
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Creature — Giant', toughness: 5 }] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are four or more basic land types among lands that player controls',
        nextState: {
          battlefield: [
            { id: 'plains', controller: 'p2', type_line: 'Basic Land — Plains' },
            { id: 'island', controller: 'p2', type_line: 'Basic Land — Island' },
            { id: 'swamp', controller: 'p2', type_line: 'Basic Land — Swamp' },
            { id: 'mountain', controller: 'p2', type_line: 'Basic Land — Mountain' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that land had a nonbasic land type',
        lastMovedCards: [{ type_line: 'Land — Gate' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you didn't put the revealed card onto the battlefield this way",
        nextState: {} as GameState,
        ctx: { controllerId, didNotPutRevealedCardOntoBattlefieldThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've cast a spell with mana value 4 or greater this turn",
        nextState: { spellsCastWithManaValueFourOrGreaterThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you discarded a card this turn',
        nextState: { cardsDiscardedThisTurn: { p1: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the result is equal to or less than the number of robots you control',
        nextState: {
          battlefield: [
            { id: 'r1', controller: controllerId, type_line: 'Artifact Creature — Robot' },
            { id: 'r2', controller: controllerId, type_line: 'Artifact Creature — Robot' },
            { id: 'r3', controller: controllerId, type_line: 'Artifact Creature — Robot' },
          ],
        } as GameState,
        ctx: { controllerId, lastDieRollResult: 2 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've drawn two or more cards this turn",
        nextState: { cardsDrawnThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have 200 or more cards in your library',
        nextState: {
          players: [{ id: 'p1', library: new Array(200).fill({ id: 'c', type_line: 'Instant' }) }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates sundering stroke, agadeem, monarch, shadowbane, devotion, consuming ashes, candles, grab prize, mother lode, profane', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'at least seven red mana was spent to cast this spell',
        nextState: {} as GameState,
        ctx: { controllerId, atLeastSevenRedManaSpentToCast: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its mana value is less than or equal to the number of allies you control',
        nextState: {
          players: [{ id: 'p2', graveyard: [{ id: 'gy-target', type_line: 'Creature — Ally', cmc: 1 }] }],
          battlefield: [
            { id: 'a1', controller: controllerId, type_line: 'Creature — Ally' },
            { id: 'a2', controller: controllerId, type_line: 'Creature — Ally' },
          ],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'gy-target' },
        lastMovedCards: [{ type_line: 'Creature — Ally', cmc: 1 }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you were the monarch as the turn began',
        nextState: { wasMonarchAsTurnBegan: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'damage from a black source is prevented this way',
        nextState: {} as GameState,
        ctx: { controllerId, blackDamagePreventedThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'your devotion to white and black is seven or greater',
        nextState: { devotionToWhiteAndBlack: { p1: 7 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it had mana value 3 or less',
        lastMovedCards: [{ cmc: 2, type_line: 'Instant' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has the same name as a card in your graveyard',
        lastMovedCards: [{ name: 'Lightning Bolt', type_line: 'Instant' }],
        nextState: {
          players: [{ id: 'p1', graveyard: [{ name: 'Lightning Bolt', type_line: 'Instant' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "the discarded card wasn't a land card",
        lastDiscardedCards: [{ type_line: 'Instant' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "the discovered card's mana value is less than 10",
        nextState: {} as GameState,
        ctx: { controllerId, lastDiscoveredCardManaValue: 5 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are three or more cards exiled with this permanent',
        nextState: {
          battlefield: [{ id: 'bf-profane', controller: controllerId, type_line: 'Enchantment', exiledCardCount: 3 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-profane' },
      })
    ).toBe(true);
  });

  it('evaluates adaptive post, ob nixilis, brimaz, raggadragga, arclight, spellpyre, sarulf counters', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this artifact has fewer than three charge counters on it',
        nextState: {
          battlefield: [{ id: 'bf-post', controller: controllerId, type_line: 'Artifact', counters: { charge: 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-post' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a demon or devil',
        nextState: { battlefield: [{ id: 'bf-demon', controller: controllerId, type_line: 'Creature — Demon' }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a phyrexian died under your control this turn',
        nextState: { phyrexiansDiedUnderControlThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'at least seven mana was spent to cast it',
        nextState: {} as GameState,
        ctx: { controllerId, atLeastSevenManaSpentToCast: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've cast three or more instant and sorcery spells this turn",
        nextState: { instantAndSorcerySpellsCastThisTurn: { p1: 3 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you cycled two or more cards this turn',
        nextState: { cardsCycledThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this permanent has one or more +1/+1 counters on it',
        nextState: {
          battlefield: [{ id: 'bf-sarulf', controller: controllerId, type_line: 'Legendary Creature — Wolf', counters: { '+1/+1': 2 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-sarulf' },
      })
    ).toBe(true);
  });
});
