import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  scrubStaleReplayedStackAfterFullReplay,
} from '../src/state/modules/replay-prompt-cleanup.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import type { PlayerID } from '../../shared/src';

/**
 * G1 regression: after undo/restore, answered Nim Deathmantle / Sephiroth
 * prompts reappeared because movePermanentToGraveyard and self-ETB paths
 * re-pushed triggers during isReplaying (duplicating persisted
 * pushTriggeredAbility events). Scrub then preserved the whole stack when
 * the replay batch ended on pushTriggeredAbility.
 */

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('stale Deathmantle/Sephiroth prompts after undo replay', () => {
  const gameIds = [
    't_replay_no_death_reemit',
    't_replay_no_etb_reemit',
    't_scrub_trailing_push_only',
  ];

  beforeEach(() => {
    for (const gameId of gameIds) {
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('does not re-push death triggers onto the stack while isReplaying', () => {
    const gameId = 't_replay_no_death_reemit';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    const deathmantle = {
      id: 'perm_deathmantle',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'card_deathmantle',
        name: 'Nim Deathmantle',
        type_line: 'Artifact — Equipment',
        oracle_text:
          'Whenever a nontoken creature is put into your graveyard from the battlefield, you may pay {4}. If you do, return that card to the battlefield and attach Nim Deathmantle to it.',
      },
    };
    const creature = {
      id: 'perm_creature',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'card_creature',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: 2,
        toughness: 2,
      },
    };
    (game.state as any).battlefield = [deathmantle, creature];
    (game.state as any).stack = [];
    (game as any).isReplaying = true;
    (game as any).ctx = game;
    (game as any).gameId = gameId;

    movePermanentToGraveyard(game as any, 'perm_creature', true);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack.filter((i: any) => String(i?.sourceName || '').includes('Deathmantle'))).toHaveLength(0);
  });

  it('does not re-queue self-ETB optional triggers while isReplaying', () => {
    const gameId = 't_replay_no_etb_reemit';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    const sephiroth = {
      id: 'stack_sephiroth',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'card_sephiroth',
        name: 'Sephiroth, Fabled SOLDIER',
        type_line: 'Legendary Creature — Human Soldier Avatar',
        oracle_text:
          'Whenever Sephiroth enters or attacks, you may sacrifice another creature. If you do, draw a card.',
      },
    };
    (game.state as any).battlefield = [sephiroth];
    (game.state as any).stack = [];
    (game as any).isReplaying = true;
    (game as any).ctx = game;
    (game as any).gameId = gameId;

    queueSelfETBTriggersForPermanent(game as any, sephiroth, playerId);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack).toHaveLength(0);
  });

  it('scrub keeps only trailing unanswered pushTriggeredAbility ids, not older orphans', () => {
    const gameId = 't_scrub_trailing_push_only';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    (game.state as any).stack = [
      {
        id: 'trigger_orphan_old',
        type: 'triggered_ability',
        controller: playerId,
        source: 'perm_deathmantle',
        sourceName: 'Nim Deathmantle',
        description: 'you may pay {4}',
      },
      {
        id: 'trigger_seph_orphan',
        type: 'triggered_ability',
        controller: playerId,
        source: 'stack_sephiroth',
        sourceName: 'Sephiroth, Fabled SOLDIER',
        description: 'you may sacrifice another creature',
      },
      {
        id: 'trigger_trailing',
        type: 'triggered_ability',
        controller: playerId,
        source: 'perm_deathmantle',
        sourceName: 'Nim Deathmantle',
        description: 'you may pay {4}',
      },
    ];
    (game as any)._replayLastEventType = 'pushTriggeredAbility';
    (game as any)._replayLastEvent = {
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_trailing',
      sourceId: 'perm_deathmantle',
      sourceName: 'Nim Deathmantle',
    };
    (game as any)._replayPenultimateEvent = {
      type: 'playLand',
      playerId,
    };
    (game as any).gameId = gameId;
    (game as any).ctx = game;

    scrubStaleReplayedStackAfterFullReplay(game as any);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack.map((i: any) => i.id)).toEqual(['trigger_trailing']);
  });

  it('full replay of answered Deathmantle + Sephiroth leaves no stale prompts after finalize', () => {
    const gameId = 't_replay_answered_optional_triggers_clean';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;

    game.replay([
      { type: 'join', playerId, name: 'P1' },
      { type: 'join', playerId: opponentId, name: 'P2' },
      {
        type: 'executeEffect',
        effectType: 'createToken',
        controllerId: playerId,
        tokenData: {
          id: 'perm_deathmantle',
          name: 'Nim Deathmantle',
          typeLine: 'Artifact — Equipment',
          power: 0,
          toughness: 0,
          abilities: [
            'Whenever a nontoken creature is put into your graveyard from the battlefield, you may pay {4}. If you do, return that card to the battlefield and attach Nim Deathmantle to it.',
          ],
        },
      },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'trigger_seph_1',
        sourceId: 'stack_seph',
        permanentId: 'stack_seph',
        sourceName: 'Sephiroth, Fabled SOLDIER',
        controllerId: playerId,
        description: 'you may sacrifice another creature. If you do, draw a card.',
        effect: 'you may sacrifice another creature. If you do, draw a card.',
        triggerType: 'self_enters_or_attacks',
        mandatory: false,
        requiresChoice: true,
      },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'trigger_dm_1',
        sourceId: 'perm_deathmantle',
        permanentId: 'perm_deathmantle',
        sourceName: 'Nim Deathmantle',
        controllerId: playerId,
        description: 'you may pay {4}. If you do, return that card to the battlefield and attach this Equipment to it.',
        effect: 'you may pay {4}. If you do, return that card to the battlefield and attach this Equipment to it.',
        triggerType: 'creature_dies',
        mandatory: false,
        requiresChoice: true,
      },
      { type: 'resolveTopOfStack', playerId },
      {
        type: 'optionalPaymentPromptResolve',
        playerId,
        sourceId: 'perm_deathmantle',
        resolvedStepId: 'step_dm_1',
        choiceId: 'decline',
        optionalPaymentValidationKind: 'mana',
        manaCost: '{4}',
      },
      { type: 'resolveTopOfStack', playerId },
      {
        type: 'optionalTriggeredAbilityChoice',
        playerId,
        sourceId: 'stack_seph',
        sourceName: 'Sephiroth, Fabled SOLDIER',
        resolvedStepId: 'step_seph_1',
        choice: 'no',
      },
      { type: 'nextStep', reason: 'allPlayersPassed', by: playerId },
    ] as any);

    // game.replay() already runs finalizeGameStateAfterReplay in endReplayPass.

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    const pending = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (s: any) => String(s?.status || '') === 'pending' || !s?.status,
    );
    expect(stack.filter((i: any) => String(i?.type || '') === 'triggered_ability')).toHaveLength(0);
    expect(
      pending.filter((s: any) =>
        /Deathmantle|Sephiroth|option_choice/i.test(
          `${s?.sourceName || ''} ${s?.type || ''} ${s?.description || ''}`,
        ),
      ),
    ).toHaveLength(0);
  });
});
