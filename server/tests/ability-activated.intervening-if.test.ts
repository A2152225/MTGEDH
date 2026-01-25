import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated';
import { resolveTopOfStack } from '../src/state/modules/stack';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Ability-activated triggers + intervening-if plumbing', () => {
  it('Harsh Mentor triggers for non-mana ability and not for mana ability', () => {
    const g = createInitialGameState('t_ability_activated_harsh_mentor');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Harsh Mentor (p1)
    (g.state as any).battlefield = (g.state as any).battlefield || [];
    (g.state as any).battlefield.push({
      id: 'hm',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'hm_card',
        name: 'Harsh Mentor',
        type_line: 'Creature — Human Cleric',
      },
    } as any);

    // Opponent artifact permanent (p2)
    (g.state as any).battlefield.push({
      id: 'a1',
      controller: p2,
      owner: p2,
      tapped: false,
      card: {
        id: 'a1_card',
        name: 'Test Artifact',
        type_line: 'Artifact',
      },
    } as any);

    // Non-mana ability activation -> trigger should be added
    triggerAbilityActivatedTriggers(g as any, {
      activatedBy: p2,
      sourcePermanentId: 'a1',
      isManaAbility: false,
      abilityText: 'Draw a card.',
      stackItemId: 'ability_stack_1',
    });

    const stack1 = (g.state as any).stack || [];
    expect(stack1.some((s: any) => s.type === 'triggered_ability' && s.sourceName === 'Harsh Mentor')).toBe(true);

    // Resolve the Harsh Mentor trigger (top of stack in this test)
    const p2LifeBefore = (g.state as any).players.find((p: any) => p.id === p2)?.life ?? 40;
    resolveTopOfStack(g as any);
    const p2LifeAfter = (g.state as any).players.find((p: any) => p.id === p2)?.life ?? 40;
    expect(p2LifeAfter).toBe(p2LifeBefore - 2);

    // Mana ability activation -> should NOT add a new Harsh Mentor trigger
    const stackLenBefore = ((g.state as any).stack || []).length;
    triggerAbilityActivatedTriggers(g as any, {
      activatedBy: p2,
      sourcePermanentId: 'a1',
      isManaAbility: true,
      abilityText: 'Add {C}.',
    });
    const stackLenAfter = ((g.state as any).stack || []).length;
    expect(stackLenAfter).toBe(stackLenBefore);
  });
});
