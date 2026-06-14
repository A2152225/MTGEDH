import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
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

describe('Oracle IR gap batch 374 — 36 condition clusters', () => {
  it('evaluates unnerving assault stub, draft, deathbringer, tablet, invasion, guildsworn, satoru, dega', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'creatures your opponents control get -1/-0 until end of turn if {u} was spent to cast this spell, and creatures you control get +1/+0 until end of turn if {r} was spent to cast this spell. (do both if {u}{r} was spent.)',
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you removed a creature card with flying from the draft with cards named this permanent',
        nextState: {} as GameState,
        ctx: { controllerId, draftRemovedFlyingCreatureWithSameName: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'you cast it from your hand and there are five or more other creatures on the battlefield',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Dragon' },
            ...new Array(5).fill(null).map((_, i) => ({
              id: `c-${i}`,
              controller: 'p2',
              type_line: 'Creature — Human',
            })),
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', castFromHand: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's at least one of the chosen colors",
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Artifact', colors: ['W'] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target', chosenColors: ['W', 'U'] },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you haven't been dealt combat damage since your last turn",
        nextState: { combatDamageTakenSinceLastTurn: { p1: false } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it wasn't blocking",
        lastMovedCards: [{ wasBlocking: false }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'none of them were cast or no mana was spent to cast them',
        nextState: {} as GameState,
        ctx: { controllerId, noneWereCast: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a black or red permanent',
        nextState: {
          battlefield: [{ id: 'bf-b', controller: controllerId, type_line: 'Creature — Vampire', colors: ['B'] }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates fiery gambit flips, angel, mana riders, commander sacrifice, rhystic, happily ever after', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you win three or more flips',
        nextState: {} as GameState,
        ctx: { controllerId, coinFlipsWonThisResolution: 3 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature is an angel',
        nextState: {
          battlefield: [{ id: 'bf-angel', controller: controllerId, type_line: 'Creature — Angel Spirit' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-angel' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that mana is spent to cast a non-human creature spell',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentOnNonHumanCreatureSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this mana is spent to cast a creature spell',
        nextState: {} as GameState,
        ctx: { controllerId, manaSpentOnCreatureSpell: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          "the amount of mana spent to cast that spell is greater than this permanent's power",
        nextState: {
          battlefield: [{ id: 'bf-thopter', controller: controllerId, type_line: 'Artifact Creature — Thopter', power: 2 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-thopter', manaSpentToCastTargetSpell: 6 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed permanent was a commander',
        nextState: {} as GameState,
        ctx: { controllerId, sacrificedPermanentWasCommander: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'any player pays {2}',
        nextState: {} as GameState,
        ctx: { controllerId, anyPlayerPaidTwo: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are five colors among permanents you control',
        nextState: {
          battlefield: [
            { id: 'c-w', controller: controllerId, colors: ['W'], type_line: 'Creature — Human' },
            { id: 'c-u', controller: controllerId, colors: ['U'], type_line: 'Creature — Merfolk' },
            { id: 'c-b', controller: controllerId, colors: ['B'], type_line: 'Creature — Zombie' },
            { id: 'c-r', controller: controllerId, colors: ['R'], type_line: 'Creature — Goblin' },
            { id: 'c-g', controller: controllerId, colors: ['G'], type_line: 'Creature — Elf' },
          ],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates kami, puppeteer, dart, die roll, historian, lesson gy, kicked, shadowborn, exile chain', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an enchantment was put into your graveyard from the battlefield this turn',
        nextState: { enchantmentPutIntoGraveyardFromBattlefieldThisTurn: { p1: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you attacked with exactly one other creature this combat',
        nextState: {
          battlefield: [
            { id: 'bf-puppeteer', controller: controllerId, type_line: 'Creature — Human', attacking: 'p2' },
            { id: 'bf-other', controller: controllerId, type_line: 'Creature — Human', attacking: 'p2' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-puppeteer' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature is white or blue',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Merfolk', colors: ['U'] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you roll a 6',
        nextState: {} as GameState,
        ctx: { controllerId, lastDieRollResult: 6 },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'enchanted permanent is a creature with the greatest power among creatures on the battlefield',
        nextState: {
          battlefield: [
            { id: 'bf-enchanted', controller: controllerId, type_line: 'Creature — Human', power: 5, toughness: 5 },
            { id: 'bf-weak', controller: 'p2', type_line: 'Creature — Elf', power: 2, toughness: 2 },
          ],
        } as GameState,
        ctx: { controllerId, enchantedPermanentId: 'bf-enchanted' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "there's a creature or lesson card in your graveyard",
        nextState: {
          players: [{ id: 'p1', graveyard: [{ id: 'gy-1', type_line: 'Lesson' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this permanent was kicked',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Legendary Planeswalker — Jace', wasKicked: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are fewer than six creature cards in your graveyard',
        nextState: {
          players: [{ id: 'p1', graveyard: [{ id: 'gy-1', type_line: 'Creature — Zombie' }] }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a creature card is exiled this way',
        lastMovedCards: [{ type_line: 'Creature — Human' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it shares a card type with the card exiled this way',
        lastMovedCards: [{ type_line: 'Instant' }],
        nextState: {
          players: [{ id: 'p1', graveyard: [{ id: 'gy-1', type_line: 'Instant' }] }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'gy-1' },
      })
    ).toBe(true);
  });

  it('evaluates quest stone, bane, vehicle, firkraag, heads, land discard, judgment, inferno, luminarch, and misc', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'that player has no cards in hand and this enchantment has two or more quest counters on it',
        nextState: {
          players: [{ id: 'p1' }, { id: 'p2', hand: [] }],
          battlefield: [{ id: 'bf-quest', controller: controllerId, type_line: 'Enchantment', counters: { quest: 2 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-quest', selectorContext: { targetPlayerId: 'p2' } },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that spell targets a commander you control',
        nextState: {} as GameState,
        ctx: { controllerId, spellTargetsCommanderYouControl: true },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's not a vehicle",
        nextState: {
          battlefield: [{ id: 'bf-artifact', controller: controllerId, type_line: 'Artifact' }],
        } as GameState,
        ctx: { controllerId, targetPermanentId: 'bf-artifact' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature had to attack this combat',
        lastMovedCards: [{ mustAttackThisCombat: true }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it comes up heads',
        nextState: {} as GameState,
        ctx: { controllerId, lastCoinFlipResult: 'heads' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the discarded card was a land card',
        lastDiscardedCards: [{ type_line: 'Basic Land — Mountain' }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature has two or fewer judgment counters on it',
        nextState: {
          battlefield: [{ id: 'bf-judge', controller: controllerId, type_line: 'Creature — Human', counters: { judgment: 1 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-judge' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've been dealt damage by two or more creatures this turn",
        nextState: { creaturesThatDealtDamageToYouThisTurn: { p1: 2 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you didn't lose life this turn",
        nextState: { lifeLostThisTurn: { p1: 0 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you don't put it onto the battlefield" },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, didNotPutExiledCardOntoBattlefield: true },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });
});
