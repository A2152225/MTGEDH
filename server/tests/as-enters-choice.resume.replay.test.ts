import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { pruneObsoleteResolutionQueueAfterReplay } from '../src/state/resolution/replayCleanup.js';
import { runPostResolutionPermanentPromptChecks } from '../src/socket/game-actions.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function buildMorophonCard() {
  return {
    id: 'morophon_card_1',
    name: 'Morophon, the Boundless',
    type_line: 'Legendary Creature — Shapeshifter',
    oracle_text:
      'Changeling\nAs Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay. Other creatures you control of the chosen type get +1/+1.',
    power: '6',
    toughness: '6',
  };
}

describe('as-enters choose-X resume / replay', () => {
  it('restores Morophon creature type across permanent-id remapping and does not re-prompt', () => {
    const gameId = 't_morophon_as_enters_resume';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    // Replay rebuilds permanent spells with the stack-item id, while the live
    // choice event still carries the original permanent id.
    (game.state as any).battlefield = [
      {
        id: 'stack_morophon_1',
        controller: p1,
        owner: p1,
        card: buildMorophonCard(),
      },
    ];

    const staleStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: p1,
      description: 'Choose a creature type for Morophon, the Boundless',
      mandatory: true,
      permanentId: 'perm_morophon_live_1',
      sourceId: 'perm_morophon_live_1',
      sourceName: 'Morophon, the Boundless',
      cardName: 'Morophon, the Boundless',
    } as any, { allowDuringReplay: true });

    game.applyEvent({
      type: 'creatureTypeSelected',
      playerId: p1,
      resolvedStepId: staleStep.id,
      resolvedStepType: ResolutionStepType.CREATURE_TYPE_CHOICE,
      permanentId: 'perm_morophon_live_1',
      creatureType: 'Dragon',
      cardName: 'Morophon, the Boundless',
    } as any);

    const morophon = ((game.state as any).battlefield || [])[0];
    expect(morophon?.chosenCreatureType).toBe('Dragon');
    expect(morophon?.card?.chosenCreatureType).toBe('Dragon');
    expect((game.state as any).morophonChosenType?.stack_morophon_1).toBe('Dragon');

    pruneObsoleteResolutionQueueAfterReplay(gameId, game.state);
    const queueAfterPrune = ResolutionQueueManager.getQueue(gameId) as any;
    expect((queueAfterPrune.steps || []).some((step: any) => step?.type === ResolutionStepType.CREATURE_TYPE_CHOICE)).toBe(false);

    const noopIo = {
      to: () => ({ emit: () => undefined }),
      emit: () => undefined,
      sockets: { sockets: new Map() },
    } as any;
    runPostResolutionPermanentPromptChecks(noopIo, game, gameId);

    const queueAfterCheck = ResolutionQueueManager.getQueue(gameId) as any;
    expect((queueAfterCheck.steps || []).some((step: any) => step?.type === ResolutionStepType.CREATURE_TYPE_CHOICE)).toBe(false);
    expect(((game.state as any).battlefield || [])[0]?.chosenCreatureType).toBe('Dragon');

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('restores permanent color choices when replay remaps the permanent id', () => {
    const gameId = 't_caged_sun_as_enters_resume';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'stack_caged_sun_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'caged_sun_card_1',
          name: 'Caged Sun',
          type_line: 'Artifact',
          oracle_text: 'As Caged Sun enters the battlefield, choose a color.',
        },
      },
    ];

    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      permanentId: 'perm_caged_sun_live_1',
      cardName: 'Caged Sun',
      color: 'green',
      resolvedStepType: ResolutionStepType.COLOR_CHOICE,
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenColor).toBe('green');
    expect(((game.state as any).battlefield || [])[0]?.card?.chosenColor).toBe('green');

    const noopIo = {
      to: () => ({ emit: () => undefined }),
      emit: () => undefined,
      sockets: { sockets: new Map() },
    } as any;
    runPostResolutionPermanentPromptChecks(noopIo, game, gameId);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect((queue.steps || []).some((step: any) => step?.type === ResolutionStepType.COLOR_CHOICE)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
