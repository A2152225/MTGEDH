import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { handleRepeatedZoneDraftResponse } from '../src/socket/resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.js';
import { buildAiHandAndDraftStepResponse } from '../src/socket/resolution-handlers/aiHandAndDraftStepResponses.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const THIEVES_AUCTION_TEXT =
  'Exile all nontoken permanents. Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen.';

function stubIo() {
  return {
    to: () => ({ emit: () => undefined }),
  } as any;
}

describe("Thieves' Auction live attach and LTB/ETB hold", () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('auction_attach');
    ResolutionQueueManager.removeQueue('auction_hold');
  });

  it('rejects an Aura pick with multiple hosts unless attachId is supplied, and AI sends attachId', () => {
    const gameId = 'auction_attach';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const aura = {
      id: 'card_pac',
      name: 'Pacifism',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature',
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [aura], exileCount: 1 },
    };
    (game.state as any).battlefield = [
      { id: 'perm_bear', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'perm_wolf', controller: p1, owner: p1, card: { name: 'Wolf', type_line: 'Creature — Wolf' } },
    ];
    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.io = stubIo();

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: p1,
      description: 'Choose a card',
      mandatory: true,
      remainingCardIds: ['card_pac'],
      chooserOrder: [p1],
      chooserIndex: 0,
      entersTapped: true,
    } as any);

    handleRepeatedZoneDraftResponse(stubIo(), game, gameId, step, {
      stepId: String(step.id),
      playerId: p1,
      selections: ['card_pac'],
      cancelled: false,
      timestamp: Date.now(),
    });
    expect((game.state as any).battlefield.some((perm: any) => perm.card?.name === 'Pacifism')).toBe(false);
    expect((game.state as any).zones[p1].exile.map((card: any) => card.id)).toContain('card_pac');

    const ai = buildAiHandAndDraftStepResponse(game, step);
    expect(ai?.selections).toEqual({ cardId: 'card_pac', attachId: expect.any(String) });

    handleRepeatedZoneDraftResponse(stubIo(), game, gameId, step, {
      stepId: String(step.id),
      playerId: p1,
      selections: ai!.selections,
      cancelled: false,
      timestamp: Date.now(),
    });
    const attached = ((game.state as any).battlefield || []).find((perm: any) => perm.card?.name === 'Pacifism');
    expect(attached).toBeTruthy();
    expect(['perm_bear', 'perm_wolf']).toContain(attached.attachedTo);
  });

  it('holds LTB/ETB until the last auction pick, then flushes', () => {
    const gameId = 'auction_hold';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'perm_etb',
        owner: p1,
        controller: p1,
        card: {
          id: 'card_etb',
          name: 'Soul Warden',
          type_line: 'Creature — Human Cleric',
          oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
        },
      },
    ];
    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction"),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'auction-1',
        sourceName: "Thieves' Auction",
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
      { controller: p1 },
    );

    expect((game.state as any).oracleIrHeldChaosZoneTriggers?.ltb?.length).toBeGreaterThan(0);
    const draftStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.REPEATED_ZONE_DRAFT);
    expect(draftStep).toBeTruthy();

    const pickResponse = {
      stepId: String(draftStep!.id),
      playerId: p1,
      selections: ['card_etb'],
      cancelled: false,
      timestamp: Date.now(),
    };
    ResolutionQueueManager.completeStep(gameId, String(draftStep!.id), pickResponse);
    handleRepeatedZoneDraftResponse(stubIo(), game, gameId, draftStep!, pickResponse);
    expect((game.state as any).oracleIrHeldChaosZoneTriggers).toBeUndefined();
  });
});
