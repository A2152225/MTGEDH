import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { handleRepeatedZoneDraftResponse } from '../src/socket/resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.js';
import { buildRepeatedZoneDraftCardChoiceInfo } from '../../rules-engine/src/oracleIRExecutorRepeatedZoneDraft.js';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
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

  it('shows the owner and chosen characteristics on an auction card', () => {
    const exiled = buildZoneObjectWithRetainedCounters(
      { id: 'card_elf', name: 'Voice of Resurgence', type_line: 'Creature — Elemental' },
      {
        owner: 'p2',
        chosenCreatureType: 'Elemental',
        chosenColor: 'green',
        chosenPlayer: 'p1',
        chosenPlayerName: 'Ada',
      },
      'exile',
    );
    expect(exiled.chosenCreatureType).toBe('Elemental');
    expect(exiled.chosenColor).toBe('green');
    expect(exiled.ownerId).toBe('p2');

    const info = buildRepeatedZoneDraftCardChoiceInfo({
      players: [
        { id: 'p1', name: 'Ada' },
        { id: 'p2', name: 'Nissa' },
      ],
      zones: { p2: { exile: [exiled] } },
      battlefield: [],
    }, 'card_elf', 'p1');
    expect(info?.ownerName).toBe('Nissa');
    expect(info?.details).toContain('Owner: Nissa');
    expect(info?.details).toContain('Color: green');
    expect(info?.details).toContain('Creature type: Elemental');
    expect(info?.details).toContain('Chosen player: Ada');
  });

  it('does not restore earlier auction rounds after a pick has been replayed', () => {
    const gameId = 'auction_replay_rounds';
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'draft_round_1',
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: 'p1',
      description: 'round 1',
      mandatory: true,
      sourceId: 'auction_spell',
      remainingCardIds: ['card_a', 'card_b'],
    } as any, { allowDuringReplay: true, skipEmit: true });
    ResolutionQueueManager.addStep(gameId, {
      id: 'draft_round_2',
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: 'p2',
      description: 'round 2',
      mandatory: true,
      sourceId: 'auction_spell',
      remainingCardIds: ['card_b'],
    } as any, { allowDuringReplay: true, skipEmit: true });

    const ctx = {
      gameId,
      isReplaying: true,
      state: { stack: [], battlefield: [], zones: {} },
      bumpSeq() {},
    } as any;
    applyEvent(ctx, {
      type: 'repeatedZoneDraftPick',
      playerId: 'p1',
      cardId: 'card_a',
      resolvedStepId: 'live_step_id_that_was_not_stored',
      sourceId: 'auction_spell',
    } as any);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);

    applyEvent(ctx, {
      type: 'resolveTopOfStackPrompt',
      playerId: 'p2',
      sourceId: 'auction_spell',
      queuedResolutionSteps: [{
        type: ResolutionStepType.REPEATED_ZONE_DRAFT,
        playerId: 'p2',
        description: 'current round',
        mandatory: true,
        sourceId: 'auction_spell',
        remainingCardIds: ['card_b'],
      }],
    } as any);

    const left = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(left).toHaveLength(1);
    expect(left[0].remainingCardIds).toEqual(['card_b']);
    expect(left[0].playerId).toBe('p2');
    ResolutionQueueManager.removeQueue(gameId);
  });
});
