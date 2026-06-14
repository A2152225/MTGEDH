import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

function auditState(overrides?: Partial<GameState>): GameState {
  return {
    players: [
      { id: 'p1', life: 40 },
      { id: 'p2', life: 40 },
      { id: 'p3', life: 30 },
      { id: 'p4', life: 25 },
    ],
    battlefield: [
      {
        id: 'bf-source',
        controller: 'p1',
        type_line: 'Creature — Human',
        power: 2,
        toughness: 2,
      },
      {
        id: 'bf-creature-1',
        controller: 'p2',
        type_line: 'Creature — Bear',
        power: 4,
        toughness: 5,
      },
    ],
    spellsCastLastTurnCount: 2,
    spellsCastLastTurnByPlayerCounts: { p1: 2, p2: 0, p3: 0, p4: 0 },
    lifeLostThisTurn: { p1: 0, p2: 3, p3: 0, p4: 0 },
    descendedThisTurn: { p1: true, p2: false, p3: false, p4: false },
    creaturesEnteredThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
  } as GameState;
}

const baseParams = {
  raw: '',
  controllerId,
  ctx: {
    controllerId,
    sourceId: 'bf-source',
    targetCreatureId: 'bf-creature-1',
    selectorContext: { targetOpponentId: 'p2' as PlayerID },
  } as any,
  lastActionOutcome: null,
};

describe('Oracle IR gap batch 281 — full-card conditional riders', () => {
  it('evaluates werewolf last-turn spell history', () => {
    const state = auditState();
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'a player cast two or more spells last turn',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: { ...state, spellsCastLastTurnCount: 0, spellsCastLastTurnByPlayerCounts: { p1: 0, p2: 0 } },
        normalizedRaw: 'no spells were cast last turn',
      })
    ).toBe(true);
  });

  it('evaluates cast/descend/opponent-life/tribute riders', () => {
    const state = auditState();
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you cast it',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'you descended this turn',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'an opponent lost life this turn',
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: "tribute wasn't paid",
      })
    ).toBe(true);
  });

  it('evaluates adaptive power/toughness and defending-player life checks', () => {
    const state = auditState();
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw:
          "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness",
      })
    ).toBe(true);
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: state,
        normalizedRaw: 'defending player has the most life or is tied for the most life',
      })
    ).toBe(true);
  });
});
