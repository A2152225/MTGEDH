import { describe, expect, it } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  applyEnduringAngelLifeFloorOrQueueOrder,
  applyLifeFloorReplacementAfterChoice,
  listLifeFloorReplacementCandidates,
  LIFE_FLOOR_REPLACEMENT_ORDER_FLAG,
} from '../src/state/modules/lifeFloorReplacementOrder.js';
import { computeGrantedSaddle } from '../src/state/modules/viewPermanentCharacteristics.js';

const ANGEL = 'If your life total would be reduced to 0 or less, instead transform this creature and your life total becomes 3. Then if this creature didn\'t transform this way, you lose the game.';

function angel(id: string) {
  return {
    id,
    controller: 'p1',
    card: {
      name: `Enduring Angel ${id}`,
      oracle_text: ANGEL,
      card_faces: [
        { name: 'Enduring Angel', oracle_text: ANGEL },
        { name: 'Angel Sustainer' },
      ],
    },
  };
}

describe('Enduring Angel life-floor CR 616.1 order', () => {
  it('lists every applicable life-floor source', () => {
    const state = { battlefield: [angel('a1'), angel('a2')], life: { p1: 2 } };
    const candidates = listLifeFloorReplacementCandidates(state, 'p1');
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.sourcePermanentId).sort()).toEqual(['a1', 'a2']);
  });

  it('queues a CR 616.1 option choice instead of auto-applying the first floor', () => {
    const ctx: any = {
      gameId: 'ui100-floor',
      state: { battlefield: [angel('a1'), angel('a2')], life: { p1: 2 }, players: [{ id: 'p1', life: 2 }] },
    };
    const result = applyEnduringAngelLifeFloorOrQueueOrder(ctx, 'p1', 2, 5);
    expect(result.queued).toBe(true);
    expect(result.applied).toBe(false);
    expect(ctx.state.life.p1).toBe(2);
    const step = ResolutionQueueManager.getStepsForPlayer('ui100-floor', 'p1' as any)
      .find((entry: any) => entry?.[LIFE_FLOOR_REPLACEMENT_ORDER_FLAG] === true);
    expect(step).toBeTruthy();
    expect(step?.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((step as any).options).toHaveLength(2);

    const applied = applyLifeFloorReplacementAfterChoice({
      ctx,
      playerId: 'p1',
      currentLife: 2,
      lossAmount: 5,
      chosenId: 'a2:life-floor-transform',
    });
    expect(applied.applied).toBe(true);
    expect(applied.nextLife).toBe(3);
    try {
      ResolutionQueueManager.completeStep('ui100-floor', (step as any).id, { playerId: 'p1', selections: ['a2:life-floor-transform'] } as any);
    } catch { /* cleanup */ }
  });

  it('still applies a single floor immediately', () => {
    const ctx: any = {
      gameId: 'ui100-floor-one',
      state: { battlefield: [angel('a1')], life: { p1: 2 }, players: [{ id: 'p1', life: 2 }] },
    };
    const result = applyEnduringAngelLifeFloorOrQueueOrder(ctx, 'p1', 2, 5);
    expect(result.queued).toBeUndefined();
    expect(result.applied).toBe(true);
    expect(result.nextLife).toBe(3);
  });
});

describe('Jandor type-granted saddle in rules status', () => {
  it('stamps granted saddle from permanentGainsSaddleFromTypeGrant', () => {
    const oracle = 'Each Beast, Camel, Horse, Elephant, and Wolf creature you control is a Mount in addition to its other types and has saddle 2.';
    const jandor = { id: 'j1', controller: 'p1', card: { name: 'Jandor, Fortuned Traveler', oracle_text: oracle, type_line: 'Legendary Creature — Human Soldier' } };
    const wolf = { id: 'w1', controller: 'p1', card: { name: 'Gray Wolf', type_line: 'Creature — Wolf', oracle_text: '' } };
    const granted = computeGrantedSaddle(wolf, { battlefield: [jandor, wolf] });
    expect(granted).toEqual({ value: 2, sourceName: 'Jandor, Fortuned Traveler' });
  });
});
