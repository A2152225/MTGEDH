import { beforeAll, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

describe('Phase 2 runtime regression fixes', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('Kynaios end-step trigger queues player choices instead of only drawing via Oracle IR', () => {
    const gameId = 'phase2_kynaios_end_step';
    ResolutionQueueManager.removeQueue(gameId);
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (g.state as any).zones = {
      [p1]: { hand: [{ id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'hand' }], handCount: 1, graveyard: [], graveyardCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };

    (g.state.battlefield as any[]).push({
      id: 'kynaios_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        name: 'Kynaios and Tiro of Meletis',
        type_line: 'Legendary Enchantment',
        oracle_text: 'At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn\'t draws a card.',
      },
    });

    const handBefore = ((g.state as any).zones[p1].hand || []).length;
    executeTriggerEffect(
      g as any,
      p1,
      'Kynaios and Tiro of Meletis',
      "draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
      {
        source: 'kynaios_1',
        permanentId: 'kynaios_1',
        sourceName: 'Kynaios and Tiro of Meletis',
        gameId,
      },
    );

    const queue = ResolutionQueueManager.getQueue(gameId);
    const kynaiosSteps = queue.steps.filter((step: any) => step?.type === ResolutionStepType.KYNAIOS_CHOICE);
    expect(kynaiosSteps.length).toBeGreaterThanOrEqual(2);
    const handAfter = ((g.state as any).zones[p1].hand || []).length;
    expect(handAfter).toBe(handBefore);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('Darting Merfolk activated ability returns itself to hand via Oracle IR', () => {
    const gameId = 'phase2_darting_merfolk';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    (g.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (g.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (g.state as any).manaPool = {
      [p1]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (g.state.battlefield as any[]).push({
      id: 'darting_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        name: 'Darting Merfolk',
        type_line: 'Creature — Merfolk',
        oracle_text: '{U}: Return this creature to its owner\'s hand.',
      },
    });

    (g.state.stack as any[]).push({
      id: 'stack_darting',
      type: 'ability',
      controller: p1,
      source: 'darting_1',
      sourceName: 'Darting Merfolk',
      activatedAbilityText: '{U}: Return this creature to its owner\'s hand.',
      description: 'Return this creature to its owner\'s hand.',
    });

    resolveTopOfStack(g as any);

    expect((g.state.battlefield as any[]).some((perm: any) => perm?.id === 'darting_1')).toBe(false);
    expect(((g.state as any).zones[p1].hand || []).some((card: any) => card?.name === 'Darting Merfolk')).toBe(true);
  });

  it('Deepfathom Echo combat trigger queues optional copy selection after explore', () => {
    const gameId = 'phase2_deepfathom_echo';
    ResolutionQueueManager.removeQueue(gameId);
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    (g.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (g.state.battlefield as any[]).push(
      {
        id: 'deepfathom_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Deepfathom Echo',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'At the beginning of combat on your turn, this creature explores. Then you may have it become a copy of another creature you control until end of turn.',
        },
      },
      {
        id: 'other_merfolk',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Other Merfolk',
          type_line: 'Creature — Merfolk',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    );
    (g.libraries as any).set(p1, [
      { id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
      { id: 'lib_2', name: 'Merfolk', type_line: 'Creature — Merfolk', zone: 'library' },
    ]);

    executeTriggerEffect(
      g as any,
      p1,
      'Deepfathom Echo',
      'this creature explores. Then you may have it become a copy of another creature you control until end of turn.',
      {
        source: 'deepfathom_1',
        permanentId: 'deepfathom_1',
        sourceName: 'Deepfathom Echo',
        gameId,
      },
    );

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step?.type === ResolutionStepType.EXPLORE_DECISION)).toBe(true);
    expect(queue.steps.some((step: any) => step?.type === ResolutionStepType.TARGET_SELECTION && step?.action === 'self_become_copy_of_creature')).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });
});
