import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
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

describe('Oracle IR gap batch 368 — 36 condition clusters', () => {
  it('evaluates token aura, mythos mana, graveyard count, padeem, mining, artifacts ETB', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the token is an aura',
        nextState: {
          battlefield: [{ id: 'bf-token', controller: controllerId, isToken: true, type_line: 'Token Enchantment — Aura' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-token', targetPermanentId: 'bf-token' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: '{w}{u} was spent to cast this spell',
        nextState: {
          stack: [{ id: 'stack-spell-1', manaSpentBreakdown: { white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'eight or more cards are in your graveyard' },
        nextState: { players: [{ id: controllerId, graveyard: new Array(8).fill({ type_line: 'Instant' }) }] } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control the artifact with the greatest mana value or tied for the greatest mana value',
        nextState: {
          battlefield: [
            { id: 'bf-art', controller: controllerId, type_line: 'Artifact', manaValue: 5 },
            { id: 'bf-other', controller: 'p2', type_line: 'Artifact', manaValue: 3 },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'there are no mining counters on this land',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Land', counters: { mining: 0 } }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'three or more artifacts entered the battlefield under your control this turn',
        nextState: { artifactsEnteredBattlefieldThisTurnByController: { [controllerId]: 3 } } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates life, sacrifice color, demon negation, team life, meld, islands', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'your life total is less than your starting life total',
        nextState: { startingLife: 40, players: [{ id: controllerId, life: 35 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'the sacrificed creature was black' },
        nextState: {} as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          lastSacrificedPermanents: [{ type_line: 'Creature — Zombie', colors: ['B'] }],
        },
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it wasn't a Demon" },
        nextState: {} as GameState,
        controllerId,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          lastSacrificedPermanents: [{ type_line: 'Creature — Human' }],
        },
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'your team gained life this turn',
        nextState: {
          teams: [{ playerIds: [controllerId, 'p2'] }],
          lifeGainedThisTurn: { p1: 0, p2: 3 },
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you both own and control this land and a creature named hanweir garrison',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, owner: controllerId, type_line: 'Land' },
            { id: 'bf-garrison', name: 'Hanweir Garrison', controller: controllerId, owner: controllerId, type_line: 'Creature — Human' },
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'all lands on the battlefield are islands',
        nextState: {
          battlefield: [{ type_line: 'Land — Island' }, { type_line: 'Land — Island' }],
        } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates combat, snow, exact creatures, grim reminder, distant memories, counters', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this permanent attacked this combat',
        nextState: {
          attackersDeclaredThisCombatByPlayer: { [controllerId]: [{ id: 'bf-source' }] },
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Wolf' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'that card is snow' },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
        lastMovedCards: [{ type_line: 'Snow Land — Island' }],
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control exactly one creature',
        nextState: {
          battlefield: [{ id: 'bf-only', controller: controllerId, type_line: 'Creature — Human' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'each opponent who cast a spell this turn with the same name as that card',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2' }],
          spellsCastThisTurn: [{ casterId: 'p2', name: 'Lightning Bolt' }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', referencedCardName: 'Lightning Bolt' },
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'no player does' },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: { kind: 'impossible', stepKind: 'choice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it had a counter on it',
        nextState: {} as GameState,
        lastMovedCards: [{ counters: { '+1/+1': 1 } }],
      })
    ).toBe(true);
  });

  it('evaluates mythos UB, underpay, assassin, legendary sacrifice, entered, token created', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: '{u}{b} was spent to cast this spell',
        nextState: {
          stack: [{ id: 'stack-spell-1', manaSpentBreakdown: { white: 0, blue: 1, black: 1, red: 0, green: 0 } }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the amount of mana spent to cast that spell was less than its mana value',
        nextState: {
          stack: [{ id: 'stack-spell-1', manaValue: 5, manaSpentTotal: 2 }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'they were attacked this turn by an assassin you controlled',
        nextState: { attackedByAssassinThisTurnByPlayer: { [controllerId]: { p2: true } } } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', thatPlayerId: 'p2' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the sacrificed artifact was legendary',
        nextState: {} as GameState,
        ctx: {
          controllerId,
          sourceId: 'bf-source',
          lastSacrificedPermanents: [{ type_line: 'Legendary Artifact' }],
        },
        lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature entered this turn',
        nextState: {
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', enteredThisTurn: true }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetCreatureId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you created a token this turn',
        nextState: { tokensCreatedThisTurn: { [controllerId]: 1 } } as GameState,
      })
    ).toBe(true);
  });

  it('evaluates god/demigod, opponent life, only gy creature, non-hand cast, discard, snow mana', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a god, a demigod, or a legendary enchantment',
        nextState: {
          battlefield: [{ id: 'bf-god', controller: controllerId, type_line: 'Legendary Enchantment Creature — God' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent has 0 or less life',
        nextState: { players: [{ id: controllerId, life: 20 }, { id: 'p2', life: 0 }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this card is the only creature card in your graveyard',
        nextState: {
          players: [{ id: controllerId, graveyard: [{ id: 'bf-source', type_line: 'Creature — Spirit' }] }],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you've played a land or cast a spell this turn from anywhere other than your hand",
        nextState: { castFromGraveyardThisTurn: { [controllerId]: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a player discarded a card this turn',
        nextState: { discardedCardThisTurn: { p1: false, p2: true } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "{s} of any of that spell's colors was spent to cast it",
        nextState: {
          stack: [
            {
              id: 'stack-spell-1',
              colors: ['G'],
              snowManaOfSpellColorsSpentKnown: true,
              snowManaOfSpellColorsSpent: true,
            },
          ],
        } as GameState,
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);
  });

  it('evaluates landfall had, quest vs attackers, nonred damage, mountains, defender, white attacker', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you had a land enter the battlefield under your control this turn',
        nextState: { landsEnteredBattlefieldThisTurn: { [controllerId]: 1 } } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'the number of attacking creatures is greater than the number of quest counters on this permanent',
        nextState: {
          attackersDeclaredThisCombatByPlayer: { [controllerId]: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Artifact', counters: { quest: 1 } }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a nonred permanent is dealt damage this way',
        nextState: {} as GameState,
        lastMovedCards: [{ type_line: 'Artifact', colors: ['U'] }],
        lastActionOutcome: { kind: 'applied', stepKind: 'deal_damage' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control at least five other mountains',
        nextState: {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Land — Mountain' },
            ...new Array(5).fill(null).map((_, i) => ({
              id: `bf-m-${i}`,
              controller: controllerId,
              type_line: 'Land — Mountain',
            })),
          ],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'this creature has defender',
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Golem', oracle_text: 'Defender' }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a white creature is attacking',
        nextState: {
          battlefield: [
            { id: 'bf-white', controller: 'p2', type_line: 'Creature — Soldier', colors: ['W'], attacking: true, defendingPlayerId: controllerId },
          ],
        } as GameState,
      })
    ).toBe(true);
  });

  it('executes Resolute Archangel and Gemstone Mine without condition gaps', () => {
    const resolute = parseOracleTextToIR(
      'Flying\nWhen Resolute Archangel enters, if your life total is less than your starting life total, your life total becomes equal to your starting life total.',
      'Resolute Archangel'
    );
    const resoluteStep = resolute.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        { startingLife: 40, players: [{ id: controllerId, life: 30 }] } as GameState,
        [resoluteStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const mine = parseOracleTextToIR(
      '{T}: Add one mana of any color. If there are no mining counters on this land, sacrifice it.',
      'Gemstone Mine'
    );
    const mineStep = mine.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        { battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Land', counters: { mining: 0 } }] } as GameState,
        [mineStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);
  });
});
