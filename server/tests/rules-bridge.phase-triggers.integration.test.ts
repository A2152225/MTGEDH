import { beforeEach, describe, expect, it } from 'vitest';
import { createRulesBridge } from '../src/rules-bridge.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { rulesEngine } from '../../rules-engine/src/RulesEngineAdapter.js';
import { makeMerfolkIterationState } from '../../rules-engine/test/helpers/merfolkIterationFixture.js';
import { GamePhase, GameStep } from '../../shared/src';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

describe('RulesBridge phase-trigger integration', () => {
  const choiceGameId = 'test_rules_bridge_phase_trigger_choice';
  const helmGameId = 'test_rules_bridge_phase_trigger_helm';
  const eachCombatGameId = 'test_rules_bridge_phase_trigger_each_combat';
  const upkeepGameId = 'test_rules_bridge_phase_trigger_upkeep';
  const endStepGameId = 'test_rules_bridge_phase_trigger_end_step';
  const eachUpkeepGameId = 'test_rules_bridge_phase_trigger_each_upkeep';
  const eachEndStepGameId = 'test_rules_bridge_phase_trigger_each_end_step';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(choiceGameId);
    ResolutionQueueManager.removeQueue(helmGameId);
    ResolutionQueueManager.removeQueue(eachCombatGameId);
    ResolutionQueueManager.removeQueue(upkeepGameId);
    ResolutionQueueManager.removeQueue(endStepGameId);
    ResolutionQueueManager.removeQueue(eachUpkeepGameId);
    ResolutionQueueManager.removeQueue(eachEndStepGameId);
  });

  it('enqueues beginning-of-combat triggered choices after advanceGame enters BEGIN_COMBAT', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(choiceGameId, io);
    const fixture = makeMerfolkIterationState();
    const nykthos = fixture.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;

    const state = makeMerfolkIterationState({
      id: choiceGameId,
      phase: GamePhase.PRECOMBAT_MAIN as any,
      step: GameStep.MAIN1 as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'combat-mentor',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Creature — Merfolk Wizard',
          type_line: 'Creature — Merfolk Wizard',
          name: 'Combat Mentor',
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'combat-mentor-card',
            name: 'Combat Mentor',
            type_line: 'Creature — Merfolk Wizard',
            oracle_text: 'At the beginning of combat on your turn, you may tap or untap target permanent.',
            power: '2',
            toughness: '2',
          },
        },
        nykthos,
      ],
    } as any);

    bridge.initialize(state as any);

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const advancedState = gameStates.get(choiceGameId);
    expect(advancedState?.step).toBe(GameStep.BEGIN_COMBAT);
    expect(advancedState?.stack).toHaveLength(1);
    expect(advancedState?.stack[0]?.spellId).toBe('combat-mentor');

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    const queue = ResolutionQueueManager.getQueue(choiceGameId);
    expect(queue.steps.map((step: any) => step.type)).toEqual([
      'option_choice',
      'target_selection',
      'option_choice',
    ]);

    const rulesChoiceEvents = emitted.filter((entry) => entry.event === 'rulesChoiceRequired');
    expect(rulesChoiceEvents).toHaveLength(1);
    expect(rulesChoiceEvents[0]?.payload).toMatchObject({
      gameId: choiceGameId,
      sourceName: 'Combat Mentor',
      effectText: 'you may tap or untap target permanent.',
      controllerId: 'p1',
      choiceCount: 3,
    });
  });

  it('resolves Helm of the Host beginning-of-combat trigger through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(helmGameId, io);
    const fixture = makeMerfolkIterationState();

    const state = makeMerfolkIterationState({
      id: helmGameId,
      phase: GamePhase.PRECOMBAT_MAIN as any,
      step: GameStep.MAIN1 as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: fixture.battlefield.map((perm: any) => {
        if (perm.id === 'helm-of-the-host') {
          return {
            ...perm,
            attachedTo: 'judge-of-currents',
          };
        }
        if (perm.id === 'judge-of-currents') {
          return {
            ...perm,
            attachedEquipment: ['helm-of-the-host'],
            isEquipped: true,
          };
        }
        return perm;
      }),
    } as any);

    bridge.initialize(state as any);

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const advancedState = gameStates.get(helmGameId);
    expect(advancedState?.step).toBe(GameStep.BEGIN_COMBAT);
    expect(advancedState?.stack).toHaveLength(1);
    expect(advancedState?.stack[0]?.spellId).toBe('helm-of-the-host');

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    const resolvedState = gameStates.get(helmGameId);
    const tokenCopies = (resolvedState?.battlefield || []).filter(
      (perm: any) => perm?.isToken && perm?.card?.name === 'Judge of Currents'
    );

    expect(tokenCopies).toHaveLength(1);
    expect(String(tokenCopies[0]?.card?.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(String(tokenCopies[0]?.card?.oracle_text || '').toLowerCase()).toContain('haste');
    expect(tokenCopies[0]?.summoningSickness).toBe(false);
  });

  it('queues and resolves each-combat triggers for all controllers through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(eachCombatGameId, io);

    const state = makeMerfolkIterationState({
      id: eachCombatGameId,
      phase: GamePhase.PRECOMBAT_MAIN as any,
      step: GameStep.MAIN1 as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'each-combat-source-p1',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each Combat Source P1',
          card: {
            id: 'each-combat-source-p1-card',
            name: 'Each Combat Source P1',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each combat, draw a card.',
          },
        },
        {
          id: 'each-combat-source-p2',
          controller: 'p2',
          owner: 'p2',
          ownerId: 'p2',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each Combat Source P2',
          card: {
            id: 'each-combat-source-p2-card',
            name: 'Each Combat Source P2',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each combat, draw a card.',
          },
        },
      ],
    } as any);

    bridge.initialize(state as any);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const beforeState = gameStates.get(eachCombatGameId);
    const beforeP1HandSize = beforeState.players.find((player: any) => player.id === 'p1')?.hand?.length ?? 0;
    const beforeP2HandSize = beforeState.players.find((player: any) => player.id === 'p2')?.hand?.length ?? 0;

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const advancedState = gameStates.get(eachCombatGameId);
    expect(advancedState?.step).toBe(GameStep.BEGIN_COMBAT);
    expect(advancedState?.stack).toHaveLength(2);
    expect((advancedState?.stack || []).map((object: any) => object?.spellId).sort()).toEqual([
      'each-combat-source-p1',
      'each-combat-source-p2',
    ]);

    const firstResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(firstResolveResult.success).toBe(true);
    const secondResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(secondResolveResult.success).toBe(true);

    const resolvedState = gameStates.get(eachCombatGameId);
    const player1 = resolvedState.players.find((player: any) => player.id === 'p1');
    const player2 = resolvedState.players.find((player: any) => player.id === 'p2');

    expect(player1?.hand?.length).toBe(beforeP1HandSize + 1);
    expect(player2?.hand?.length).toBe(beforeP2HandSize + 1);
    expect(resolvedState?.stack ?? []).toHaveLength(0);
  });

  it('queues and resolves your-upkeep triggers through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(upkeepGameId, io);

    const state = makeMerfolkIterationState({
      id: upkeepGameId,
      phase: GamePhase.BEGINNING as any,
      step: GameStep.UNTAP as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'upkeep-source-p1',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Upkeep Source P1',
          card: {
            id: 'upkeep-source-p1-card',
            name: 'Upkeep Source P1',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your upkeep, draw a card.',
          },
        },
        {
          id: 'upkeep-source-p2',
          controller: 'p2',
          owner: 'p2',
          ownerId: 'p2',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Upkeep Source P2',
          card: {
            id: 'upkeep-source-p2-card',
            name: 'Upkeep Source P2',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your upkeep, draw a card.',
          },
        },
      ],
    } as any);

    bridge.initialize(state as any);

    const beforeState = ((rulesEngine as any).gameStates as Map<string, any>).get(upkeepGameId);
    const beforeHandSize = beforeState.players.find((player: any) => player.id === 'p1')?.hand?.length ?? 0;
    const beforeLibrarySize = beforeState.players.find((player: any) => player.id === 'p1')?.library?.length ?? 0;

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const advancedState = gameStates.get(upkeepGameId);
    expect(advancedState?.step).toBe(GameStep.UPKEEP);
    expect(advancedState?.stack).toHaveLength(1);
    expect(advancedState?.stack[0]?.spellId).toBe('upkeep-source-p1');

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    const resolvedState = gameStates.get(upkeepGameId);
    const player1 = resolvedState.players.find((player: any) => player.id === 'p1');
    const player2 = resolvedState.players.find((player: any) => player.id === 'p2');

    expect(player1?.hand?.length).toBe(beforeHandSize + 1);
    expect(player1?.library?.length).toBe(beforeLibrarySize - 1);
    expect(player2?.hand?.length ?? 0).toBe(0);
  });

  it('queues and resolves your-end-step triggers through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(endStepGameId, io);

    const state = makeMerfolkIterationState({
      id: endStepGameId,
      phase: GamePhase.POSTCOMBAT_MAIN as any,
      step: GameStep.MAIN2 as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'end-source-p1',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'End Source P1',
          card: {
            id: 'end-source-p1-card',
            name: 'End Source P1',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your end step, draw a card.',
          },
        },
        {
          id: 'end-source-p2',
          controller: 'p2',
          owner: 'p2',
          ownerId: 'p2',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'End Source P2',
          card: {
            id: 'end-source-p2-card',
            name: 'End Source P2',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of your end step, draw a card.',
          },
        },
      ],
    } as any);

    bridge.initialize(state as any);

    const beforeState = ((rulesEngine as any).gameStates as Map<string, any>).get(endStepGameId);
    const beforeHandSize = beforeState.players.find((player: any) => player.id === 'p1')?.hand?.length ?? 0;
    const beforeLibrarySize = beforeState.players.find((player: any) => player.id === 'p1')?.library?.length ?? 0;

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const advancedState = gameStates.get(endStepGameId);
    expect(advancedState?.step).toBe(GameStep.END);
    expect(advancedState?.stack).toHaveLength(1);
    expect(advancedState?.stack[0]?.spellId).toBe('end-source-p1');

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    const resolvedState = gameStates.get(endStepGameId);
    const player1 = resolvedState.players.find((player: any) => player.id === 'p1');
    const player2 = resolvedState.players.find((player: any) => player.id === 'p2');

    expect(player1?.hand?.length).toBe(beforeHandSize + 1);
    expect(player1?.library?.length).toBe(beforeLibrarySize - 1);
    expect(player2?.hand?.length ?? 0).toBe(0);
  });

  it('queues and resolves each-upkeep triggers for all controllers through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(eachUpkeepGameId, io);

    const state = makeMerfolkIterationState({
      id: eachUpkeepGameId,
      phase: GamePhase.BEGINNING as any,
      step: GameStep.UNTAP as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'each-upkeep-source-p1',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each Upkeep Source P1',
          card: {
            id: 'each-upkeep-source-p1-card',
            name: 'Each Upkeep Source P1',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each upkeep, draw a card.',
          },
        },
        {
          id: 'each-upkeep-source-p2',
          controller: 'p2',
          owner: 'p2',
          ownerId: 'p2',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each Upkeep Source P2',
          card: {
            id: 'each-upkeep-source-p2-card',
            name: 'Each Upkeep Source P2',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each upkeep, draw a card.',
          },
        },
      ],
    } as any);

    bridge.initialize(state as any);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const beforeState = gameStates.get(eachUpkeepGameId);
    const beforeP1HandSize = beforeState.players.find((player: any) => player.id === 'p1')?.hand?.length ?? 0;
    const beforeP2HandSize = beforeState.players.find((player: any) => player.id === 'p2')?.hand?.length ?? 0;

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const advancedState = gameStates.get(eachUpkeepGameId);
    expect(advancedState?.step).toBe(GameStep.UPKEEP);
    expect(advancedState?.stack).toHaveLength(2);
    expect((advancedState?.stack || []).map((object: any) => object?.spellId).sort()).toEqual([
      'each-upkeep-source-p1',
      'each-upkeep-source-p2',
    ]);

    const firstResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(firstResolveResult.success).toBe(true);
    const secondResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(secondResolveResult.success).toBe(true);

    const resolvedState = gameStates.get(eachUpkeepGameId);
    const player1 = resolvedState.players.find((player: any) => player.id === 'p1');
    const player2 = resolvedState.players.find((player: any) => player.id === 'p2');

    expect(player1?.hand?.length).toBe(beforeP1HandSize + 1);
    expect(player2?.hand?.length).toBe(beforeP2HandSize + 1);
    expect(resolvedState?.stack ?? []).toHaveLength(0);
  });

  it('queues and resolves each-end-step triggers for all controllers through advanceGame', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(eachEndStepGameId, io);

    const state = makeMerfolkIterationState({
      id: eachEndStepGameId,
      phase: GamePhase.POSTCOMBAT_MAIN as any,
      step: GameStep.MAIN2 as any,
      activePlayerIndex: 0 as any,
      priorityPlayerIndex: 0 as any,
      battlefield: [
        {
          id: 'each-end-source-p1',
          controller: 'p1',
          owner: 'p1',
          ownerId: 'p1',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each End Source P1',
          card: {
            id: 'each-end-source-p1-card',
            name: 'Each End Source P1',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each end step, draw a card.',
          },
        },
        {
          id: 'each-end-source-p2',
          controller: 'p2',
          owner: 'p2',
          ownerId: 'p2',
          tapped: false,
          counters: {},
          summoningSickness: false,
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          name: 'Each End Source P2',
          card: {
            id: 'each-end-source-p2-card',
            name: 'Each End Source P2',
            type_line: 'Enchantment',
            oracle_text: 'At the beginning of each end step, draw a card.',
          },
        },
      ],
    } as any);

    bridge.initialize(state as any);

    const gameStates = (rulesEngine as any).gameStates as Map<string, any>;
    const beforeState = gameStates.get(eachEndStepGameId);
    const beforeP1HandSize = beforeState.players.find((player: any) => player.id === 'p1')?.hand?.length ?? 0;
    const beforeP2HandSize = beforeState.players.find((player: any) => player.id === 'p2')?.hand?.length ?? 0;

    const advanceResult = bridge.executeAction({ type: 'advanceGame' });
    expect(advanceResult.success).toBe(true);

    const advancedState = gameStates.get(eachEndStepGameId);
    expect(advancedState?.step).toBe(GameStep.END);
    expect(advancedState?.stack).toHaveLength(2);
    expect((advancedState?.stack || []).map((object: any) => object?.spellId).sort()).toEqual([
      'each-end-source-p1',
      'each-end-source-p2',
    ]);

    const firstResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(firstResolveResult.success).toBe(true);
    const secondResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(secondResolveResult.success).toBe(true);

    const resolvedState = gameStates.get(eachEndStepGameId);
    const player1 = resolvedState.players.find((player: any) => player.id === 'p1');
    const player2 = resolvedState.players.find((player: any) => player.id === 'p2');

    expect(player1?.hand?.length).toBe(beforeP1HandSize + 1);
    expect(player2?.hand?.length).toBe(beforeP2HandSize + 1);
    expect(resolvedState?.stack ?? []).toHaveLength(0);
  });
});
