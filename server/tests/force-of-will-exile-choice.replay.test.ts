import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('Force of Will exile choice replay semantics', () => {
  it('replays the exile-choice response by clearing the prompt without duplicating cast-state mutation', () => {
    const gameId = 't_force_of_will_exile_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game.state as any).life = { [p1]: 40 };
    const zones = (game.state as any).zones[p1];
    zones.hand = [
      { id: 'spell_1', name: 'Force of Will', type_line: 'Instant', colors: ['U'], zone: 'hand' },
      { id: 'blue_1', name: 'Ponder', type_line: 'Sorcery', colors: ['U'], zone: 'hand' },
    ];
    zones.handCount = zones.hand.length;
    zones.exile = [];
    zones.exileCount = 0;

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Choose a blue card to exile',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Force of Will',
      forceOfWillExileChoice: true,
      forceSpellCardId: 'spell_1',
      forceSpellName: 'Force of Will',
      forceRequiresLifePayment: true,
      forceLifePaymentAmount: 1,
      options: [{ id: 'blue_1', label: 'Ponder' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'forceOfWillExileChoiceResolve',
      playerId: p1,
      sourceId: 'spell_1',
      sourceName: 'Force of Will',
      resolvedStepId: step.id,
      spellCardId: 'spell_1',
      spellName: 'Force of Will',
      exileCardId: 'blue_1',
      exiledCard: { id: 'blue_1', name: 'Ponder', zone: 'exile', exiledForAlternateCost: true, exiledForSpellCardId: 'spell_1' },
      requiresLifePayment: true,
      lifePaid: 1,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.forceOfWillExileChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.forceOfWillExileChoice === true)).toBe(false);
    expect((game.state as any).life[p1]).toBe(40);
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['spell_1', 'blue_1']);
    expect(zones.exile || []).toEqual([]);

    ResolutionQueueManager.removeQueue(gameId);
  });
});