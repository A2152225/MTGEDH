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

describe('Oracle IR gap batch 370 — 36 condition clusters', () => {
  it('evaluates compound X, attack last turn, clash win, tithe lands, tomb, mindblaze', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'x is 5 or more, for each artifact destroyed this way',
        nextState: {} as GameState,
        ctx: { controllerId, sourceId: 'bf-source', xValue: 5 },
        lastActionOutcome: { kind: 'applied', stepKind: 'destroy' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that player attacked you during their last turn',
        nextState: { attackedYouLastTurnByPlayer: { [controllerId]: { p2: true } } } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', thatPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you win, at the beginning of your next main phase',
        ctx: { controllerId, sourceId: 'bf-source', lastClashWon: true },
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'target opponent controls more lands than you',
        nextState: {
          battlefield: [
            { id: 'l1', controller: controllerId, type_line: 'Land' },
            { id: 'l2', controller: 'p2', type_line: 'Land' },
            { id: 'l3', controller: 'p2', type_line: 'Land' },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetOpponentId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you haven't completed tomb of annihilation",
        nextState: { completedDungeonNames: { [controllerId]: [] } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that library contains exactly the chosen number of cards with the chosen name',
        nextState: {} as GameState,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          chosenCardName: 'Lightning Bolt',
          chosenNumber: 2,
          selectorContext: { chosenCardName: 'Lightning Bolt', chosenNumber: 2 },
        },
        lastMovedCards: [{ name: 'Lightning Bolt' }, { name: 'Lightning Bolt' }],
      })
    ).toBe(true);
  });

  it('evaluates enlist, token, spirit, mana from creatures, instant/sorcery, sneak, soul', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it enlisted a creature this combat',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Soldier', enlistedThisCombat: true }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it isn't a token" },
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', isToken: false }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control another spirit',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Spirit' },
            { id: 'bf-other', controller: controllerId, type_line: 'Creature — Spirit' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'three or more mana from creatures was spent to cast it',
        nextState: { stack: [{ id: 'stack-spell-1', manaFromCreaturesSpent: 3 }] } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've cast an instant or sorcery spell this turn",
        nextState: { spellsCastThisTurn: [{ casterId: controllerId, card: { type_line: 'Instant' } }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'his sneak cost was paid' },
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Turtle', sneakCostPaid: true }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('evaluates no mana, turn, knight, suspected, deaths, targets, black, gy14, cast', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'no mana was spent to cast that spell',
        nextState: { stack: [{ id: 'stack-spell-1', manaSpentTotal: 0 }] } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's not that player's turn",
        nextState: { turnPlayer: controllerId } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', selectorContext: { targetPlayerId: 'p2' } },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control another knight',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Knight' },
            { id: 'bf-other', controller: controllerId, type_line: 'Creature — Knight' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed creature was suspected',
        ctx: { controllerId, sourceId: 'bf-source', lastSacrificedPermanents: [{ isSuspected: true }] },
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'another human died under your control this turn',
        nextState: { creaturesDiedThisTurnByControllerSubtype: { [controllerId]: { human: 1 } } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that permanent is black',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Zombie', colors: ['B'] }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'there are fourteen or more cards in your graveyard' },
        nextState: { players: [{ id: controllerId, graveyard: new Array(14).fill({ type_line: 'Instant' }) }] } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'he was cast' },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', wasCast: true },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('evaluates sacrifice this way, colorless, flips, blue/black, didnt die, elf, return, enchanted', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you sacrificed a creature this way',
        ctx: { controllerId, sourceId: 'bf-source', lastSacrificedPermanents: [{ controller: controllerId, type_line: 'Creature — Human' }] },
        nextState: {} as GameState,
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control another colorless creature',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Eldrazi', colors: [] },
            { id: 'bf-other', controller: controllerId, type_line: 'Creature — Eldrazi', colors: [] },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you win all the flips',
        nextState: { lastCoinFlips: { [controllerId]: [true, true] } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature was blue or black',
        lastMovedCards: [{ type_line: 'Creature — Spirit', colors: ['U'] }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it didn't die",
        ctx: { controllerId, sourceId: 'bf-source', itCreatureId: 'bf-it', itDied: false },
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature is untapped',
        nextState: {
          battlefield: [
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-target' },
            { id: 'bf-target', controller: 'p2', type_line: 'Creature — Human', tapped: false },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-aura' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'enchanted creature is red',
        nextState: {
          battlefield: [
            { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-target' },
            { id: 'bf-target', controller: 'p2', type_line: 'Creature — Goblin', colors: ['R'] },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-aura' },
      })
    ).toBe(true);
  });

  it('evaluates would mill stub, it was attacking, night, another creature died, spell targets only', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent would mill one or more cards',
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was attacking' },
        nextState: {
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Soldier', attackedThisTurn: true }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "it's night",
        nextState: { dayNight: 'night' } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'another creature died this turn',
        nextState: { creaturesDiedThisTurnByController: { p1: 2, p2: 0 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that spell targets only this creature',
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          targetCreatureId: 'bf-source',
          stackItem: { targets: ['bf-source'] },
        },
        nextState: {} as GameState,
      })
    ).toBe(true);
  });
});
