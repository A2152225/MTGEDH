import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { bindEffectProgramChoiceResponse, createEffectProgramRuntime } from '../src/effectProgram';
import { buildEffectProgramsFromOracleText, runOracleEffectProgram } from '../src/effectProgramOracleRunner';
import { parseAttackProhibitedThisTurnText } from '../src/oracleIRExecutorAttackProhibitedThisTurn';

const JACE_TRIGGER = "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.";
const JACE_CTX = { controllerId: 'p1', sourceId: 'jace', sourceName: 'Jace, Multiverse Architect', targetPlayerId: 'p2' } as any;

function makeState(): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p2',
    priority: 'p2',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: 'combat',
    step: 'BEGIN_COMBAT',
    active: true,
    turnNumber: 5,
    manaPool: { p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 } },
  } as any;
}

function runJaceWithAnswer(answer: 'yes' | 'no') {
  const { programs } = buildEffectProgramsFromOracleText({
    idPrefix: 'jace-trigger',
    oracleText: JACE_TRIGGER,
    controllerId: 'p1',
    sourceId: 'jace',
    sourceName: 'Jace, Multiverse Architect',
  });
  const paused: any = runOracleEffectProgram(createEffectProgramRuntime({ program: programs[0]!, state: makeState() }), JACE_CTX, {});
  expect(paused.status).toBe('waiting_for_choice');
  const resumed = bindEffectProgramChoiceResponse<GameState>(paused.runtime, {
    eventId: 'choice-1',
    playerId: 'p2',
    selections: [answer],
    cancelled: false,
    timestamp: 2,
  } as any);
  return runOracleEffectProgram(resumed, JACE_CTX, {}) as any;
}

describe('declined "may" antecedent drives "if they don\'t" conditions', () => {
  it('declining the {2} runs the "if they don\'t" branch and stamps the this-turn attack restriction', () => {
    const result = runJaceWithAnswer('no');
    expect(result.status).toBe('completed');
    const stamps = ((result.state as any).lastingEffects || []).filter((e: any) => e.type === 'attackProhibitedThisTurn');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({
      duration: 'this_turn',
      attackerController: 'p2',
      protectedController: 'p1',
      protectsPlayer: false,
      protectedPermanentTypes: ['jace'],
      turnApplied: 5,
    });
  });

  it('paying the {2} skips the restriction', () => {
    const result = runJaceWithAnswer('yes');
    expect(result.status).toBe('completed');
    expect((result.state as any).manaPool.p2.colorless).toBe(1);
    const stamps = ((result.state as any).lastingEffects || []).filter((e: any) => e.type === 'attackProhibitedThisTurn');
    expect(stamps).toHaveLength(0);
  });
});

describe('parseAttackProhibitedThisTurnText', () => {
  it('parses permanent-type protections with a shared "you control"', () => {
    expect(parseAttackProhibitedThisTurnText("can't attack Jaces you control this turn")).toEqual({
      protectsPlayer: false,
      protectedPermanentTypes: ['jace'],
    });
    expect(parseAttackProhibitedThisTurnText("can't attack you or planeswalkers you control this turn")).toEqual({
      protectsPlayer: true,
      protectedPermanentTypes: ['planeswalker'],
    });
    expect(parseAttackProhibitedThisTurnText("can't attack you this turn")).toEqual({
      protectsPlayer: true,
      protectedPermanentTypes: [],
    });
  });

  it('leaves taxes and non-turn wording to other handlers', () => {
    expect(parseAttackProhibitedThisTurnText("can't attack you this turn unless their controller pays {2}")).toBeNull();
    expect(parseAttackProhibitedThisTurnText("can't attack Jaces you control")).toBeNull();
    expect(parseAttackProhibitedThisTurnText("can't block this turn")).toBeNull();
  });
});
