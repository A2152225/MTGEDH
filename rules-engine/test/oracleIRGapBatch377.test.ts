import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';
import { evaluateOracleStepUnlessCondition } from '../src/oracleIRExecutorConditionalStepSupport';

const controllerId = 'p1' as PlayerID;
const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 377 — 36 condition clusters', () => {
  it('evaluates desperate plea, peer pressure, barrin, razor, azor, escort, wumpus, paragon, darigaaz, outlaw', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "its power is less than or equal to the sacrificed creature's power",
        nextState: {
          players: [{ id: 'p1', graveyard: [{ id: 'gy-target', type_line: 'Creature — Human', power: 3 }] }],
        } as GameState,
        ctx: {
          controllerId,
          targetPermanentId: 'gy-target',
          lastSacrificedPermanents: [{ type_line: 'Creature — Giant', power: 5 }],
        },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control more creatures of that type than each other player',
        nextState: {
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'g1', controller: 'p1', type_line: 'Creature — Goblin' },
            { id: 'g2', controller: 'p1', type_line: 'Creature — Goblin' },
            { id: 'g3', controller: 'p2', type_line: 'Creature — Goblin' },
          ],
        } as GameState,
        ctx: { controllerId, chosenCreatureType: 'goblin' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'that permanent shares a color with the most common color among all permanents or a color tied for most common',
        nextState: {
          battlefield: [
            { id: 'target', controller: 'p2', type_line: 'Creature — Human', colors: ['U'] },
            { id: 'b1', controller: 'p1', type_line: 'Creature — Merfolk', colors: ['U'] },
            { id: 'b2', controller: 'p2', type_line: 'Creature — Spirit', colors: ['U'] },
          ],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player has 5 or less life',
        nextState: { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 5 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'cards with five or more different mana values are exiled with this permanent',
        nextState: {
          battlefield: [{
            id: 'bf-azor',
            controller: controllerId,
            type_line: 'Artifact',
            exiledDistinctManaValueCount: 5,
          }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-azor' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's not a spirit",
        lastMovedCards: [{ type_line: 'Creature — Human Detective' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "{c} wasn't spent to cast it",
        nextState: {} as GameState,
        ctx: { controllerId, colorlessManaWasNotSpentToCast: true, colorlessManaSpentToCast: 0 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'exactly three colors of mana were spent to activate this ability',
        nextState: {} as GameState,
        ctx: { controllerId, colorsOfManaSpentToActivate: ['W', 'U', 'B'] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this card is exiled with an egg counter on it',
        lastMovedCards: [{ type_line: 'Legendary Creature — Dragon', counters: { egg: 1 } }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an outlaw was sacrificed this way',
        nextState: {} as GameState,
        ctx: { controllerId, lastSacrificedPermanents: [{ type_line: 'Creature — Rogue' }] },
      })
    ).toBe(true);
  });

  it('evaluates guiding spirit, airbender, balance, ever-watching, riders, septic, naktamun, trolls, needlebite, scrying, portent', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "the top card of target player's graveyard is a creature card",
        nextState: {
          players: [{ id: 'p2', graveyard: [{ id: 'gy-top', type_line: 'Creature — Spirit' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this enchantment has four or more quest counters on it',
        nextState: {
          battlefield: [{ id: 'bf-quest', controller: controllerId, type_line: 'Enchantment', counters: { quest: 4 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-quest' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'target opponent has more cards in hand than you',
        nextState: {
          players: [
            { id: 'p1', hand: [{ id: 'h1' }] },
            { id: 'p2', hand: [{ id: 'h2' }, { id: 'h3' }] },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they attacked you and/or a planeswalker you control',
        nextState: { theyAttackedYouOrYourPlaneswalkerThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature attacked this turn',
        nextState: {
          battlefield: [{ id: 'bf-riders', controller: controllerId, type_line: 'Creature — Human', attackedThisTurn: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-riders' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'defending player is poisoned',
        nextState: { poisonCounters: { p2: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a player has one or fewer cards in hand',
        nextState: { players: [{ id: 'p1', hand: [] }, { id: 'p2', hand: [{ id: 'h1' }] }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they control fewer lands than you',
        nextState: {
          battlefield: [
            { id: 'l1', controller: 'p1', type_line: 'Basic Land — Forest' },
            { id: 'l2', controller: 'p1', type_line: 'Basic Land — Plains' },
            { id: 'l3', controller: 'p2', type_line: 'Basic Land — Island' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent gained life this turn',
        nextState: { opponentGainedLifeThisTurn: true } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that opponent reveals exactly the chosen number of cards of the chosen color',
        nextState: {} as GameState,
        ctx: { controllerId, opponentRevealedExactChosenColorCount: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent protects it',
        nextState: {} as GameState,
        ctx: { controllerId, opponentProtectsIt: true },
      })
    ).toBe(true);
  });

  it('evaluates kodama, fractal, security, lunar, beseech, lux, wave, massacre, sygg, master, impending, glitch', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it wasn't put onto the battlefield with this ability",
        nextState: {} as GameState,
        ctx: { controllerId, wasNotPutOntoBattlefieldWithThisAbility: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you put a counter on this creature this turn',
        nextState: { countersPutOnThisCreatureThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they discarded a nonland card',
        nextState: {} as GameState,
        lastDiscardedCards: [{ type_line: 'Instant' }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you gained and lost life this turn',
        nextState: { lifeGainedThisTurn: { p1: 2 }, lifeLostThisTurn: { p1: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it wasn't cast this way",
        nextState: {} as GameState,
        ctx: { controllerId, wasNotCastThisWay: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are thirty or more counters among artifacts and creatures you control',
        nextState: {
          battlefield: [{ id: 'bf-lux', controller: controllerId, type_line: 'Artifact Creature — Construct', counters: { '+1/+1': 30 } }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it dealt combat damage to a player this turn',
        nextState: {
          battlefield: [{ id: 'bf-wave', controller: controllerId, type_line: 'Creature — Rat', dealtCombatDamageToPlayerThisTurn: true }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-wave' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its toughness was less than 1',
        lastMovedCards: [{ type_line: 'Creature — Human', toughness: 0 }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent lost 3 or more life this turn',
        nextState: { lifeLostThisTurn: { p2: 3 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'at least two creatures named wolves of the hunt you control',
        nextState: {
          battlefield: [
            { id: 'w1', controller: controllerId, name: 'Wolves of the Hunt', type_line: 'Creature — Wolf' },
            { id: 'w2', controller: controllerId, name: 'Wolves of the Hunt', type_line: 'Creature — Wolf' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are seven or more lands on the battlefield',
        nextState: {
          battlefield: Array.from({ length: 7 }, (_, i) => ({
            id: `land-${i}`,
            controller: 'p1',
            type_line: 'Basic Land — Forest',
          })),
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control no face-down permanents',
        nextState: {
          battlefield: [{ id: 'bf-up', controller: controllerId, type_line: 'Creature — Human', faceDown: false }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates rush unless energy and compound parser stubs', () => {
    expect(
      evaluateOracleStepUnlessCondition(
        { kind: 'if', raw: 'you pay {E}{E} (two energy counters)' },
        {} as GameState,
        { controllerId, unlessPaysEnergyChoice: 'pay' } as any,
        controllerId,
      )
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          "Target creature you control gets +1/+0 until end of turn if you've cast another instant or sorcery spell this turn. Then it deals damage equal to its power to up to one target creature an opponent controls.",
        nextState: {} as GameState,
        ctx: { controllerId, castAnotherInstantOrSorceryThisTurn: true },
      })
    ).toBe(true);
  });
});
