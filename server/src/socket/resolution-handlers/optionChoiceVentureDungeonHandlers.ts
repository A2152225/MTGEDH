/**
 * socket/resolution-handlers/optionChoiceVentureDungeonHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three venture OPTION_CHOICE prompts - `ventureIntoDungeon` (no dungeon yet means
 * queue the dungeon picker, a branching room means queue the room picker, otherwise advance and apply
 * the room), `ventureChooseDungeon` (create the progress record and apply the first room) and
 * `ventureChooseRoom` (advance to the chosen room and apply it, completing the dungeon if it was the
 * last one).
 * Public entry symbols: handleVentureIntoDungeonChoice, handleVentureChooseDungeonChoice,
 * handleVentureChooseRoomChoice, applyDungeonRoomEffectsWithDoubler.
 *
 * The parent-local `applyDungeonRoomEffectsWithDoubler` and its two private helpers
 * (`queueDungeonRoomPromptSteps`, `appendDungeonRoomExecuteEffectEvents`) came along; these three
 * branches were their only callers. Every branch always returned, so each call site is
 * `handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  applyAutomaticDungeonRoomEffect,
  applyAutomaticDungeonRoomTokenEffects,
  buildDungeonRoomPromptSteps,
} from "../../state/modules/dungeon-effects.js";
import {
  advanceDungeonProgress,
  createDungeonProgress,
  getDungeonNameById,
  markDungeonCompleted,
  normalizeDungeonProgress,
} from "../../state/modules/dungeons.js";
import { playerHasDungeonRoomAbilityDoubler } from "../../state/modules/triggers/combat.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type CreateResolutionStepConfig,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

function appendDungeonRoomExecuteEffectEvents(
  game: any,
  gameId: string,
  effectPayloads: any[],
): void {
  if (!Array.isArray(effectPayloads) || effectPayloads.length === 0 || (game as any)?.isReplaying) {
    return;
  }

  for (const payload of effectPayloads) {
    try {
      appendEvent(
        gameId,
        Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
        'executeEffect',
        payload,
      );
    } catch (err) {
      debugWarn(1, '[resolution] appendEvent(executeEffect/createToken) failed for dungeon room:', err);
    }
  }
}

function queueDungeonRoomPromptSteps(
  game: any,
  gameId: string,
  promptSteps: CreateResolutionStepConfig[],
  fallbackPlayerId: string,
  sourceId?: string,
): void {
  if (!Array.isArray(promptSteps) || promptSteps.length === 0) {
    return;
  }

  if (promptSteps.length === 1) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, promptSteps[0] as any);
    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: String((queuedResolutionStep as any)?.playerId || fallbackPlayerId || '').trim(),
      sourceId: String((queuedResolutionStep as any)?.sourceId || sourceId || '').trim(),
      queuedResolutionStep,
    });
    return;
  }

  const players = Array.isArray(game.state?.players) ? game.state.players : [];
  const turnOrder = players
    .filter((player: any) => player && player.spectator !== true && player.hasLost !== true && String(player.id || '').trim())
    .map((player: any) => String(player.id));
  const activePlayerId = String(
    game.state?.turnPlayer ||
    game.state?.activePlayer ||
    game.state?.activePlayerId ||
    turnOrder[0] ||
    fallbackPlayerId ||
    '',
  );

  const queuedResolutionSteps = ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    promptSteps as any,
    turnOrder as any,
    activePlayerId as any,
  );

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId: String((queuedResolutionSteps[0] as any)?.playerId || fallbackPlayerId || '').trim(),
    sourceId: String((queuedResolutionSteps[0] as any)?.sourceId || sourceId || '').trim(),
    queuedResolutionSteps: queuedResolutionSteps as any[],
  });
}

export function applyDungeonRoomEffectsWithDoubler(
  game: any,
  gameId: string,
  playerId: PlayerID,
  progress: any,
  roomSourceId: string,
): void {
  const applyOnce = () => {
    applyAutomaticDungeonRoomEffect(game as any, playerId, progress);
    const tokenEffectPayloads = applyAutomaticDungeonRoomTokenEffects(game as any, playerId, progress);
    const promptSteps = buildDungeonRoomPromptSteps(game as any, playerId, progress, roomSourceId);
    queueDungeonRoomPromptSteps(game, gameId, promptSteps, String(playerId || '').trim(), roomSourceId);
    appendDungeonRoomExecuteEffectEvents(game, gameId, tokenEffectPayloads);
  };
  applyOnce();
  if (playerHasDungeonRoomAbilityDoubler(game?.state, String(playerId || ''))) {
    applyOnce();
  }
}

/** Venture into the dungeon. */
export function handleVentureIntoDungeonChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const playerId = response.playerId;

  const stateAny = game.state as any;
  stateAny.dungeonProgress = stateAny.dungeonProgress || {};
  const progress = normalizeDungeonProgress(stateAny.dungeonProgress[playerId]);

  if (!progress) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as PlayerID,
      description: 'Choose a dungeon to enter',
      mandatory: true,
      sourceName: String(stepData.ventureIntoDungeonSourceName || step.sourceName || 'Venture'),
      options: [
        { id: 'lost_mine', label: 'Lost Mine of Phandelver' },
        { id: 'mad_mage', label: 'Dungeon of the Mad Mage' },
        { id: 'tomb', label: 'Tomb of Annihilation' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseDungeon: true,
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: String(playerId || '').trim(),
      sourceId: String((stepData as any)?.sourceId || step.sourceId || '').trim(),
      queuedResolutionStep,
    });
    return;
  }

  const advancement = advanceDungeonProgress(progress);
  if (advancement.choiceRequired.length > 1) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as PlayerID,
      description: `Choose the next room in ${progress.dungeonName}`,
      mandatory: true,
      sourceName: String(stepData.ventureIntoDungeonSourceName || step.sourceName || 'Venture'),
      options: advancement.choiceRequired.map((room) => ({
        id: room.id,
        label: `${room.name} - ${room.effect}`,
      })),
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: progress.dungeonId,
      ventureDungeonName: progress.dungeonName,
      ventureCurrentRoomId: progress.currentRoomId,
      ventureCurrentRoomName: progress.currentRoomName,
      ventureRoomPath: [...progress.roomPath],
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: String(playerId || '').trim(),
      sourceId: String((stepData as any)?.sourceId || step.sourceId || '').trim(),
      queuedResolutionStep,
    });
    return;
  }

  if (!advancement.progress) {
    return;
  }

  const roomSourceId = String((stepData as any)?.sourceId || step.sourceId || '').trim();
  applyDungeonRoomEffectsWithDoubler(game, gameId, playerId as PlayerID, advancement.progress, roomSourceId);

  if (advancement.completed) {
    markDungeonCompleted(stateAny, String(playerId), String(advancement.progress.dungeonName || progress.dungeonName).trim());
    delete stateAny.dungeonProgress[playerId];

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} completed ${advancement.progress.dungeonName || 'a dungeon'}.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  stateAny.dungeonProgress[playerId] = advancement.progress;

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} ventured into ${advancement.progress.currentRoomName} in ${advancement.progress.dungeonName}.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}

/** The dungeon picker shown when the player has no dungeon in progress. */
export function handleVentureChooseDungeonChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const normalizedChoiceId = String(choiceId || 'lost_mine').trim() || 'lost_mine';
  const stateAny = game.state as any;
  stateAny.dungeonProgress = stateAny.dungeonProgress || {};

  const dungeonName = getDungeonNameById(normalizedChoiceId);
  const dungeonProgress = createDungeonProgress(normalizedChoiceId);

  if (!dungeonProgress) {
    return;
  }

  stateAny.dungeonProgress[playerId] = dungeonProgress;
  const roomSourceId = String(step.sourceId || '').trim();
  applyDungeonRoomEffectsWithDoubler(game, gameId, playerId as PlayerID, dungeonProgress, roomSourceId);

  try {
    appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'ventureChooseDungeonResolve',
      {
        playerId: String(playerId || '').trim(),
        resolvedStepId: String(step.id || '').trim() || undefined,
        dungeonId: normalizedChoiceId,
        dungeonName,
        roomIndex: dungeonProgress.roomIndex,
        currentRoomId: dungeonProgress.currentRoomId,
        currentRoomName: dungeonProgress.currentRoomName,
        currentRoomEffect: dungeonProgress.currentRoomEffect,
        roomPath: [...dungeonProgress.roomPath],
      },
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(ventureChooseDungeonResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} entered ${dungeonName}.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}

/** The room picker shown when the current room branches. */
export function handleVentureChooseRoomChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const playerId = response.playerId;

  const choiceId = String(extractOptionChoiceSelectionId(response.selections) || '').trim().toLowerCase();
  const stateAny = game.state as any;
  stateAny.dungeonProgress = stateAny.dungeonProgress || {};

  const progress = normalizeDungeonProgress(stateAny.dungeonProgress[playerId]);
  if (!progress || !choiceId) {
    return;
  }

  const advancement = advanceDungeonProgress(progress, choiceId);
  if (!advancement.progress || advancement.choiceRequired.length > 0) {
    return;
  }

  const roomSourceId = String(step.sourceId || '').trim();
  applyDungeonRoomEffectsWithDoubler(game, gameId, playerId as PlayerID, advancement.progress, roomSourceId);

  const completed = advancement.completed;
  if (completed) {
    markDungeonCompleted(stateAny, String(playerId), String(advancement.progress.dungeonName || progress.dungeonName).trim());
    delete stateAny.dungeonProgress[playerId];
  } else {
    stateAny.dungeonProgress[playerId] = advancement.progress;
  }

  try {
    appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'ventureChooseRoomResolve',
      {
        playerId: String(playerId || '').trim(),
        resolvedStepId: String(step.id || '').trim() || undefined,
        dungeonId: advancement.progress.dungeonId,
        dungeonName: advancement.progress.dungeonName,
        roomIndex: advancement.progress.roomIndex,
        currentRoomId: advancement.progress.currentRoomId,
        currentRoomName: advancement.progress.currentRoomName,
        currentRoomEffect: advancement.progress.currentRoomEffect,
        roomPath: [...advancement.progress.roomPath],
        completed,
      },
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(ventureChooseRoomResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: completed
      ? `${getPlayerName(game, playerId)} completed ${advancement.progress.dungeonName}.`
      : `${getPlayerName(game, playerId)} ventured into ${advancement.progress.currentRoomName} in ${advancement.progress.dungeonName}.`,
    ts: Date.now(),
  });
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
}
