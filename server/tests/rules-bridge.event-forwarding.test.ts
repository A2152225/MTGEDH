import { beforeEach, describe, expect, it, vi } from 'vitest';

const listenerMap = new Map<string, Set<(event: any) => void>>();
const onMock = vi.fn((eventType: string, callback: (event: any) => void) => {
  if (!listenerMap.has(eventType)) {
    listenerMap.set(eventType, new Set());
  }
  listenerMap.get(eventType)!.add(callback);
});
const offMock = vi.fn((eventType: string, callback: (event: any) => void) => {
  listenerMap.get(eventType)?.delete(callback);
});
const initializeGameMock = vi.fn();
const validateActionMock = vi.fn(() => ({ legal: true }));
const executeActionMock = vi.fn(() => ({}));
const addStepFromChoiceEventMock = vi.fn();

const RulesEngineEvent = {
  SPELL_CAST: 'spellCast',
  SPELL_RESOLVED: 'spellResolved',
  ATTACKERS_DECLARED: 'attackersDeclared',
  BLOCKERS_DECLARED: 'blockersDeclared',
  DAMAGE_DEALT: 'damageDealt',
  PRIORITY_PASSED: 'priorityPassed',
  STATE_BASED_ACTIONS: 'stateBasedActions',
  CHOICE_REQUIRED: 'choiceRequired',
  ORACLE_AUTOMATION_GAP_RECORDED: 'oracleAutomationGapRecorded',
  CARD_DRAWN: 'cardDrawn',
  PERMANENT_DESTROYED: 'permanentDestroyed',
  PHASE_STARTED: 'phaseStarted',
  STEP_STARTED: 'stepStarted',
  TURN_STARTED: 'turnStarted',
  MULLIGAN_DECISION: 'mulliganDecision',
  MULLIGAN_COMPLETED: 'mulliganCompleted',
  PERMANENT_SACRIFICED: 'permanentSacrificed',
  LIBRARY_SEARCHED: 'librarySearched',
  LIBRARY_SHUFFLED: 'libraryShuffled',
} as const;

vi.mock('../../rules-engine/src/RulesEngineAdapter.js', () => ({
  rulesEngine: {
    on: onMock,
    off: offMock,
    initializeGame: initializeGameMock,
    validateAction: validateActionMock,
    executeAction: executeActionMock,
  },
  RulesEngineEvent,
}));

vi.mock('../src/state/resolution/index.js', () => ({
  ResolutionQueueManager: {
    addStepFromChoiceEvent: addStepFromChoiceEventMock,
  },
}));

function emitRulesEvent(eventType: string, event: any) {
  const listeners = Array.from(listenerMap.get(eventType) || []);
  for (const listener of listeners) {
    listener(event);
  }
}

describe('RulesBridge event forwarding', () => {
  beforeEach(() => {
    listenerMap.clear();
    onMock.mockClear();
    offMock.mockClear();
    initializeGameMock.mockClear();
    validateActionMock.mockClear();
    executeActionMock.mockClear();
    addStepFromChoiceEventMock.mockClear();
  });

  it('forwards only same-game rules events', async () => {
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
      }),
    } as any;

    const { createRulesBridge } = await import('../src/rules-bridge.js');
    createRulesBridge('game_A', io);

    emitRulesEvent(RulesEngineEvent.SPELL_CAST, {
      type: RulesEngineEvent.SPELL_CAST,
      gameId: 'game_B',
      timestamp: 10,
      data: { spell: { id: 'spell_b' }, caster: 'player_b' },
    });
    expect(emitted).toEqual([]);

    emitRulesEvent(RulesEngineEvent.SPELL_CAST, {
      type: RulesEngineEvent.SPELL_CAST,
      gameId: 'game_A',
      timestamp: 11,
      data: { spell: { id: 'spell_a' }, caster: 'player_a' },
    });
    expect(emitted).toEqual([]);

    emitRulesEvent(RulesEngineEvent.CHOICE_REQUIRED, {
      type: RulesEngineEvent.CHOICE_REQUIRED,
      gameId: 'game_B',
      timestamp: 12,
      data: {
        stackObjectId: 'stack_b',
        sourceId: 'source_b',
        choiceEvents: [{ id: 'choice_b' }],
      },
    });
    expect(addStepFromChoiceEventMock).not.toHaveBeenCalled();

    emitRulesEvent(RulesEngineEvent.CHOICE_REQUIRED, {
      type: RulesEngineEvent.CHOICE_REQUIRED,
      gameId: 'game_A',
      timestamp: 13,
      data: {
        stackObjectId: 'stack_a',
        sourceId: 'source_a',
        sourceName: 'Source A',
        effectText: 'Choose a target',
        controllerId: 'player_a',
        triggerEventData: { reason: 'test' },
        choiceEvents: [{ id: 'choice_a' }],
      },
    });

    expect(addStepFromChoiceEventMock).toHaveBeenCalledTimes(1);
    expect(addStepFromChoiceEventMock).toHaveBeenCalledWith(
      'game_A',
      { id: 'choice_a' },
      expect.objectContaining({
        rulesChoiceGroupId: 'stack_a',
        rulesTriggerSourceId: 'source_a',
        rulesTriggerSourceName: 'Source A',
      }),
    );
    expect(emitted.some((entry) => entry.event === 'rulesChoiceRequired')).toBe(false);

    emitRulesEvent(RulesEngineEvent.CARD_DRAWN, {
      type: RulesEngineEvent.CARD_DRAWN,
      gameId: 'game_A',
      timestamp: 14,
      data: { playerId: 'player_a' },
    });

    expect(emitted).toEqual([]);
  });

  it('removes all shared rules-engine listeners on dispose', async () => {
    const io = {
      to: () => ({
        emit: () => undefined,
      }),
    } as any;

    const { createRulesBridge } = await import('../src/rules-bridge.js');
    const bridge = createRulesBridge('game_dispose', io);

    const registeredCount = Array.from(listenerMap.values()).reduce((count, listeners) => count + listeners.size, 0);
    expect(registeredCount).toBeGreaterThan(0);

    bridge.dispose();

    const remainingCount = Array.from(listenerMap.values()).reduce((count, listeners) => count + listeners.size, 0);
    expect(remainingCount).toBe(0);
    expect(offMock).toHaveBeenCalled();
  });
});
