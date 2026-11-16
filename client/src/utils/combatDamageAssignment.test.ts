import { describe, it, expect, vi } from 'vitest';
import {
  applyCombatDamageAssignmentPrompt,
  buildCombatDamageAssignmentModalData,
  buildCombatDamageAssignmentResponse,
  isCombatDamageAssignmentStep,
  playerCombatDamageTargetId,
} from './combatDamageAssignment';

const orgg = {
  id: 'orgg_1',
  controller: 'p1',
  card: { name: 'Butcher Orgg', type_line: 'Creature — Orgg', power: '6', toughness: '6' },
};
const bear = {
  id: 'bear_3',
  controller: 'p2',
  card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
};
const view = {
  id: 'game_1',
  battlefield: [orgg, bear],
  players: [
    { id: 'p1', username: 'P1' },
    { id: 'p2', username: 'P2' },
  ],
};

const orggStep = {
  id: 'step_orgg',
  type: 'combat_damage_assignment',
  assignmentMode: 'free-division',
  specialCombatDamageAssignment: true,
  specialCombatDamageMode: 'divide',
  attackerId: 'orgg_1',
  sourceId: 'orgg_1',
  sourceName: 'Butcher Orgg',
  defendingPlayerId: 'p2',
  requireLethalOrder: false,
  recipients: [
    { id: 'player:p2', label: 'Defending player', type: 'player', playerId: 'p2' },
    { id: 'bear_3', label: 'Grizzly Bears', type: 'creature', toughness: 2 },
  ],
};

describe('combat damage assignment prompt (Orgg free-division)', () => {
  it('recognizes queued combat_damage_assignment steps only', () => {
    expect(isCombatDamageAssignmentStep(orggStep)).toBe(true);
    expect(isCombatDamageAssignmentStep({ type: 'target_selection' })).toBe(false);
    expect(isCombatDamageAssignmentStep({ type: 'option_choice' })).toBe(false);
  });

  it('builds free-division modal data from a Butcher Orgg step and the current view', () => {
    const data = buildCombatDamageAssignmentModalData(orggStep, view);
    expect(data).toBeTruthy();
    expect(data?.stepId).toBe('step_orgg');
    expect(data?.assignmentMode).toBe('free-division');
    expect(data?.hasTrample).toBe(false);
    expect(data?.attacker).toBe(orgg);
    expect(data?.defendingPlayerId).toBe('p2');
    expect(data?.defendingPlayerName).toBe('P2');
    expect(data?.blockers.map((perm: any) => perm.id)).toEqual(['bear_3']);
  });

  it('opens the modal through the prompt-late helper', () => {
    const setDamageAssignmentData = vi.fn();
    const setDamageAssignmentModalOpen = vi.fn();
    const opened = applyCombatDamageAssignmentPrompt(orggStep, view, {
      setDamageAssignmentData,
      setDamageAssignmentModalOpen,
    });
    expect(opened).toBe(true);
    expect(setDamageAssignmentModalOpen).toHaveBeenCalledWith(true);
    expect(setDamageAssignmentData).toHaveBeenCalledTimes(1);
    expect(setDamageAssignmentData.mock.calls[0][0].assignmentMode).toBe('free-division');
  });

  it('does not open the modal for other resolution steps', () => {
    const setDamageAssignmentData = vi.fn();
    const setDamageAssignmentModalOpen = vi.fn();
    expect(applyCombatDamageAssignmentPrompt({ type: 'proliferate', id: 'x' }, view, {
      setDamageAssignmentData,
      setDamageAssignmentModalOpen,
    })).toBe(false);
    expect(setDamageAssignmentModalOpen).not.toHaveBeenCalled();
    expect(setDamageAssignmentData).not.toHaveBeenCalled();
  });

  it('emits the shares payload the server already accepts for Orgg', () => {
    const response = buildCombatDamageAssignmentResponse({
      stepId: 'step_orgg',
      assignmentMode: 'free-division',
      defendingPlayerId: 'p2',
      assignments: [
        { blockerId: playerCombatDamageTargetId('p2'), damage: 4 },
        { blockerId: 'bear_3', damage: 2 },
      ],
      trampleDamage: 0,
    });
    expect(response).toEqual({
      stepId: 'step_orgg',
      cancelled: false,
      selections: {
        shares: [
          { target: 'player:p2', amount: 4 },
          { target: 'bear_3', amount: 2 },
        ],
      },
    });
  });

  it('does not treat leftover trample as a player share in free-division mode', () => {
    const response = buildCombatDamageAssignmentResponse({
      stepId: 'step_orgg',
      assignmentMode: 'free-division',
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'bear_3', damage: 2 }],
      trampleDamage: 4,
    });
    expect(response.selections.shares).toEqual([{ target: 'bear_3', amount: 2 }]);
  });
});

describe('ordinary blockers-mode payload (no auto-queue; do not invent prompts)', () => {
  it('maps leftover trample onto the defending player only when the step is not free-division', () => {
    const response = buildCombatDamageAssignmentResponse({
      stepId: 'step_blockers',
      assignmentMode: 'blockers',
      defendingPlayerId: 'p2',
      assignments: [
        { blockerId: 'bear_3', damage: 2 },
        { blockerId: 'wall_1', damage: 3 },
      ],
      trampleDamage: 1,
    });
    expect(response.selections.shares).toEqual([
      { target: 'bear_3', amount: 2 },
      { target: 'wall_1', amount: 3 },
      { target: 'player:p2', amount: 1 },
    ]);
  });
});
