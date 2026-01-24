import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { resolveTopOfStack } from '../src/state/modules/stack';

describe('Intervening-if landfall resolution-time checks', () => {
  it('skips resolving a landfall trigger if the intervening-if condition becomes false before resolution', () => {
    const g = createInitialGameState('t_intervening_if_landfall_resolution_false');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const landfallPerm = {
      id: 'landfall_perm_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'landfall_card_1',
        name: 'Landfall Tester',
        type_line: 'Enchantment',
        oracle_text:
          'Landfall — Whenever a land enters the battlefield under your control, if you control an artifact, you win the game.',
      },
      tapped: false,
    };

    const artifact = {
      id: 'artifact_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'artifact_card_1',
        name: 'Test Artifact',
        type_line: 'Artifact',
        oracle_text: '',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(landfallPerm);
    (g.state.battlefield as any).push(artifact);

    // This stack item mirrors how landfall triggers are queued: the stored description is decorated
    // and does not begin with When/Whenever/At.
    g.state.stack = [
      {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: p1,
        source: landfallPerm.id,
        permanentId: landfallPerm.id,
        sourceName: 'Landfall Tester',
        description: 'Landfall - if you control an artifact, you win the game.',
        effect: 'if you control an artifact, you win the game.',
        triggerType: 'landfall',
        mandatory: true,
      } as any,
    ];

    // Condition was true when the trigger was created, but becomes false before resolution.
    g.state.battlefield = (g.state.battlefield as any).filter((p: any) => p?.id !== artifact.id);

    resolveTopOfStack(g as any);

    expect((g.state as any).gameOver).not.toBe(true);
    expect((g.state as any).winner).toBeUndefined();
  });

  it('resolves a landfall trigger when the intervening-if condition is still true at resolution', () => {
    const g = createInitialGameState('t_intervening_if_landfall_resolution_true');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const landfallPerm = {
      id: 'landfall_perm_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'landfall_card_2',
        name: 'Landfall Tester',
        type_line: 'Enchantment',
        oracle_text:
          'Landfall — Whenever a land enters the battlefield under your control, if you control an artifact, you win the game.',
      },
      tapped: false,
    };

    const artifact = {
      id: 'artifact_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'artifact_card_2',
        name: 'Test Artifact',
        type_line: 'Artifact',
        oracle_text: '',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(landfallPerm);
    (g.state.battlefield as any).push(artifact);

    g.state.stack = [
      {
        id: 'trigger_2',
        type: 'triggered_ability',
        controller: p1,
        source: landfallPerm.id,
        permanentId: landfallPerm.id,
        sourceName: 'Landfall Tester',
        description: 'Landfall - if you control an artifact, you win the game.',
        effect: 'if you control an artifact, you win the game.',
        triggerType: 'landfall',
        mandatory: true,
      } as any,
    ];

    resolveTopOfStack(g as any);

    expect((g.state as any).gameOver).toBe(true);
    expect((g.state as any).winner).toBe(p1);
  });
});
