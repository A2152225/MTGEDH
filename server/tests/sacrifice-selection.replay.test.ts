import { beforeEach, describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('sacrificeSelectionResolve replay', () => {
  const gameId = 'sacrifice_selection_replay';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays the sacrificed permanents and clears the queued target-selection step', () => {
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p2',
      sourceId: 'annihilator_attacker',
      sourceName: 'Annihilator Attacker',
      description: 'Choose 2 permanents to sacrifice.',
      mandatory: true,
      validTargets: [
        { id: 'def_land', label: 'Defender Land', description: 'permanent' },
        { id: 'def_relic', label: 'Defender Relic', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 2,
      maxTargets: 2,
      targetDescription: 'permanent to sacrifice',
      sacrificeSelection: true,
      sacrificePermanentType: 'permanent',
      sacrificeCount: 2,
      sacrificeReason: "Annihilator Attacker's Annihilator 2 triggered",
      sacrificeSourceName: 'Annihilator Attacker',
      annihilatorChoice: true,
    } as any);

    const ctx: any = {
      gameId,
      state: {
        players: [{ id: 'p2', name: 'P2', spectator: false, life: 40 }],
        battlefield: [
          {
            id: 'def_land',
            controller: 'p2',
            owner: 'p2',
            card: { name: 'Defender Land', type_line: 'Land' },
          },
          {
            id: 'def_relic',
            controller: 'p2',
            owner: 'p2',
            card: { name: 'Defender Relic', type_line: 'Artifact' },
          },
          {
            id: 'survivor',
            controller: 'p1',
            owner: 'p1',
            card: { name: 'Annihilator Attacker', type_line: 'Creature - Eldrazi' },
          },
        ],
        zones: {
          p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
          p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
        },
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'sacrificeSelectionResolve',
      resolvedStepId: step.id,
      playerId: 'p2',
      sourceId: 'annihilator_attacker',
      sourceName: 'Annihilator Attacker',
      permanentType: 'permanent',
      permanentIds: ['def_land', 'def_relic'],
      reason: "Annihilator Attacker's Annihilator 2 triggered",
    } as any);

    expect(((ctx.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['survivor']);
    expect((((ctx.state as any).zones?.p2?.graveyard) || []).map((card: any) => card.name)).toEqual([
      'Defender Land',
      'Defender Relic',
    ]);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep).toBeUndefined();
    expect(queue.steps).toEqual([]);
  });

  it('replays sacrificed token permanents by preserving their graveyard snapshot', () => {
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p2',
      sourceId: 'annihilator_attacker',
      sourceName: 'Annihilator Attacker',
      description: 'Choose a permanent to sacrifice.',
      mandatory: true,
      validTargets: [
        { id: 'treasure_1', label: 'Treasure', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'permanent to sacrifice',
      sacrificeSelection: true,
      sacrificePermanentType: 'permanent',
      sacrificeCount: 1,
      sacrificeReason: 'Annihilator token test',
      sacrificeSourceName: 'Annihilator Attacker',
      annihilatorChoice: true,
    } as any);

    const ctx: any = {
      gameId,
      state: {
        players: [{ id: 'p2', name: 'P2', spectator: false, life: 40 }],
        battlefield: [
          {
            id: 'treasure_1',
            controller: 'p2',
            owner: 'p2',
            isToken: true,
            card: {
              id: 'treasure_card_1',
              name: 'Treasure',
              type_line: 'Token Artifact — Treasure',
              oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
              zone: 'battlefield',
            },
          },
        ],
        zones: {
          p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0, exile: [], exileCount: 0 },
        },
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'sacrificeSelectionResolve',
      resolvedStepId: step.id,
      playerId: 'p2',
      sourceId: 'annihilator_attacker',
      sourceName: 'Annihilator Attacker',
      permanentType: 'permanent',
      permanentIds: ['treasure_1'],
      reason: 'Annihilator token test',
    } as any);

    expect(((ctx.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual([]);
    expect((((ctx.state as any).zones?.p2?.graveyard) || []).map((card: any) => card.name)).toEqual(['Treasure']);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep).toBeUndefined();
    expect(queue.steps).toEqual([]);
  });
});