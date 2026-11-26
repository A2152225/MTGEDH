import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';
import { asGameState } from './helpers/gameStateFixture';

const controllerId = 'p1' as PlayerID;
const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 371 — 36 condition clusters', () => {
  it('evaluates attacking, power threshold, counter, damage, cactuar, white permanents', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: 'it was attacking' },
        nextState: {} as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
        lastMovedCards: [{ attackedThisTurn: true }],
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "that creature's power is 4 or greater",
        nextState: asGameState({
          battlefield: [{ id: 'bf-atk', controller: controllerId, type_line: 'Creature — Soldier', power: 5 }],
        }),
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-atk' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'a +1/+1 counter was put on a permanent under your control this turn',
        nextState: asGameState({ putPlusOneCounterOnPermanentThisTurn: { [controllerId]: true } }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you were dealt 4 or more damage this turn',
        nextState: asGameState({ damageTakenThisTurnByPlayer: { [controllerId]: 4 } }),
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "this creature didn't enter the battlefield this turn" },
        nextState: asGameState({
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Human', enteredThisTurn: false }],
        }),
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'all nonland permanents you control are white',
        nextState: asGameState({
          battlefield: [{ id: 'bf-white', controller: controllerId, type_line: 'Creature — Soldier', colors: ['W'] }],
        }),
      })
    ).toBe(true);
  });

  it('evaluates opponent ETB, exile flash, edgar, lands, discard, codespell, risona', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "a creature entered the battlefield under an opponent's control this turn",
        nextState: asGameState({ creaturesEnteredBattlefieldUnderOpponentControlThisTurn: { p2: true } }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an instant card or a card with flash is exiled this way',
        lastMovedCards: [{ type_line: 'Instant' }],
        lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'edgar is in the command zone or on the battlefield',
        nextState: asGameState({
          commandZone: [{ name: 'Edgar Markov', controller: controllerId, type_line: 'Legendary Creature — Vampire' }],
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control four or fewer lands',
        nextState: asGameState({
          battlefield: [{ id: 'l1', controller: controllerId, type_line: 'Land' }],
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you discarded an instant or sorcery card this way',
        lastDiscardedCards: [{ type_line: 'Instant' }],
        lastActionOutcome: { kind: 'applied', stepKind: 'discard' },
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was the second spell you cast this turn',
        nextState: asGameState({ spellsCastThisTurnByPlayer: { [controllerId]: 2 } }),
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it doesn't have an indestructible counter on it" },
        nextState: asGameState({
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', counters: {} }],
        }),
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('evaluates ceta, tovolar, hand count, deathknell, dimir, anticognition, malamet', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a red or green permanent',
        nextState: asGameState({
          battlefield: [{ id: 'bf-red', controller: controllerId, type_line: 'Creature — Goblin', colors: ['R'] }],
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control three or more wolves and/or werewolves',
        nextState: asGameState({
          battlefield: [
            { id: 'w1', controller: controllerId, type_line: 'Creature — Wolf' },
            { id: 'w2', controller: controllerId, type_line: 'Creature — Wolf' },
            { id: 'w3', controller: controllerId, type_line: 'Creature — Werewolf' },
          ],
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you have one or fewer cards in hand',
        nextState: { players: [{ id: controllerId, hand: [{}] }] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'its power was 3 or greater',
        lastMovedCards: [{ power: 4 }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw:
          'three or more cards were put into your graveyard from anywhere other than the battlefield this turn',
        nextState: asGameState({ cardsPutIntoGraveyardFromNonBattlefieldThisTurn: { [controllerId]: 3 } }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent has eight or more cards in their graveyard',
        nextState: {
          players: [{ id: controllerId }, { id: 'p2', graveyard: new Array(8).fill({ type_line: 'Instant' }) }],
        } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'the creature you control entered this turn',
        nextState: asGameState({
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', enteredThisTurn: true }],
        }),
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
      })
    ).toBe(true);
  });

  it('evaluates avatar lands, tapped, not suspected, nightpack, madness, surge, advice', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent controls seven or more lands',
        nextState: asGameState({
          players: [{ id: controllerId }, { id: 'p2' }],
          battlefield: new Array(7).fill(null).map((_, i) => ({ id: `l${i}`, controller: 'p2', type_line: 'Land' })),
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it was tapped',
        lastMovedCards: [{ tapped: true }],
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "it's not suspected" },
        nextState: asGameState({
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature — Human', isSuspected: false }],
        }),
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "you didn't cast a spell this turn",
        nextState: { spellsCastThisTurn: [] } as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'it has madness',
        nextState: asGameState({
          battlefield: [{ id: 'bf-target', controller: controllerId, type_line: 'Creature', oracle_text: 'Madness {1}{R}' }],
        }),
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: "this spell's surge cost was paid",
        nextState: asGameState({ stack: [{ id: 'stack-spell-1', alternateCostId: 'surge' }] }),
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control more creatures than each other player',
        nextState: asGameState({
          players: [{ id: controllerId }, { id: 'p2' }],
          battlefield: [
            { id: 'c1', controller: controllerId, type_line: 'Creature — Human' },
            { id: 'c2', controller: controllerId, type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p2', type_line: 'Creature — Human' },
          ],
        }),
      })
    ).toBe(true);
  });

  it('evaluates would lose life, blue/black, black or red, opponent would lose life', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'an opponent would lose life during your turn',
        nextState: {} as GameState,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'you control a blue or black permanent',
        nextState: asGameState({
          battlefield: [{ id: 'bf-blue', controller: controllerId, type_line: 'Creature — Merfolk', colors: ['U'] }],
        }),
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        normalizedRaw: 'that creature is black or red',
        nextState: asGameState({
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Goblin', colors: ['R'] }],
        }),
        ctx: { controllerId, sourceId: 'bf-source', targetPermanentId: 'bf-target' },
      })
    ).toBe(true);
  });
});
