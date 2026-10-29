import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const EFFECT =
  'if two or more players have lost the game, gain control of all goaded and/or suspected creatures until end of turn. Untap them. They gain haste until end of turn.';

function gameWith(id: string, battlefield: any[]) {
  process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  const game = createInitialGameState(id);
  const p1 = 'p1' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
  (game as any).gameId = id;
  (game as any).io = { to: () => ({ emit() {} }) };
  (game as any)._suppressBroadcastCount = 1;
  const state = game.state as any;
  state.playersLostCount = 2;
  state.players = [
    { id: 'p1', hasLost: false },
    { id: 'p2', hasLost: false },
    { id: 'p3', hasLost: true },
    { id: 'p4', hasLost: true },
  ];
  state.battlefield = battlefield;
  return { game, p1 };
}

describe('Hot Pursuit combat trigger with no legal selection', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
    ResolutionQueueManager.removeQueue('hot_pursuit_empty');
    ResolutionQueueManager.removeQueue('hot_pursuit_matches');
  });

  it('resolves with an empty goaded set and does not queue a selection', () => {
    const { game, p1 } = gameWith('hot_pursuit_empty', [
      { id: 'hot', controller: 'p1', card: { name: 'Hot Pursuit', type_line: 'Enchantment' } },
      { id: 'bear', controller: 'p2', tapped: true, card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ]);
    executeTriggerEffect(game as any, p1, 'Hot Pursuit', EFFECT, {
      id: 'trig_hot',
      source: 'hot',
      permanentId: 'hot',
      triggerType: 'begin_combat',
      card: { name: 'Hot Pursuit', type_line: 'Enchantment' },
    });
    expect(ResolutionQueueManager.getQueue('hot_pursuit_empty').steps || []).toEqual([]);
    const bear = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'bear');
    expect(bear.controller).toBe('p2');
    expect(bear.tapped).toBe(true);
  });

  it('gains control of goaded and suspected creatures without a choice', () => {
    const { game, p1 } = gameWith('hot_pursuit_matches', [
      { id: 'hot', controller: 'p1', card: { name: 'Hot Pursuit', type_line: 'Enchantment' } },
      { id: 'goaded', controller: 'p2', tapped: true, goadedBy: ['p3'], card: { name: 'Goaded Bear', type_line: 'Creature — Bear' } },
      { id: 'suspected', controller: 'p2', tapped: true, isSuspected: true, card: { name: 'Suspect', type_line: 'Creature — Bear' } },
      { id: 'plain', controller: 'p2', tapped: true, card: { name: 'Plain Bear', type_line: 'Creature — Bear' } },
    ]);
    executeTriggerEffect(game as any, p1, 'Hot Pursuit', EFFECT, {
      id: 'trig_hot',
      source: 'hot',
      permanentId: 'hot',
      triggerType: 'begin_combat',
      card: { name: 'Hot Pursuit', type_line: 'Enchantment' },
    });
    expect(ResolutionQueueManager.getQueue('hot_pursuit_matches').steps || []).toEqual([]);
    const find = (id: string) => (game.state as any).battlefield.find((permanent: any) => permanent.id === id);
    expect(find('goaded').controller).toBe('p1');
    expect(find('goaded').tapped).toBe(false);
    expect((find('goaded').grantedAbilities || []).map((ability: string) => String(ability).toLowerCase())).toContain('haste');
    expect(find('suspected').controller).toBe('p1');
    expect(find('suspected').tapped).toBe(false);
    expect(find('plain').controller).toBe('p2');
    expect(find('plain').tapped).toBe(true);
  });
});
