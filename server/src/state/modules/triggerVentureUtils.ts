import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType, type CreateResolutionStepConfig } from '../resolution/index.js';
import {
  advanceDungeonProgress,
  createDungeonProgress,
  getDungeonNameById,
  markDungeonCompleted,
  normalizeDungeonProgress,
} from './dungeons.js';
import {
  applyAutomaticDungeonRoomEffect,
  applyAutomaticDungeonRoomTokenEffects,
  buildDungeonRoomPromptSteps,
} from './dungeon-effects.js';
import { appendQueuedResolutionPromptEvent, queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

function appendDungeonRoomExecuteEffectEvents(
  ctx: GameContext,
  effectPayloads: any[],
): void {
  if (!Array.isArray(effectPayloads) || effectPayloads.length === 0) {
    return;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    return;
  }

  for (const payload of effectPayloads) {
    try {
      appendEvent(
        gameId,
        Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
        'executeEffect',
        payload,
      );
    } catch (err) {
      debugWarn(1, '[resolveTopOfStack] appendEvent(executeEffect/createToken) failed for dungeon room:', err);
    }
  }
}

function queueDungeonRoomPromptSteps(
  ctx: GameContext,
  promptSteps: CreateResolutionStepConfig[],
  fallbackPlayerId: PlayerID,
  sourceId?: string,
): void {
  if (!Array.isArray(promptSteps) || promptSteps.length === 0) {
    return;
  }

  const gameId = String((ctx as any).gameId || 'unknown');
  if (!gameId || gameId === 'unknown') {
    return;
  }

  if (promptSteps.length === 1) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, promptSteps[0] as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String((queuedResolutionStep as any)?.playerId || fallbackPlayerId || '').trim(),
      sourceId: String((queuedResolutionStep as any)?.sourceId || sourceId || '').trim(),
      queuedResolutionStep,
    });
    return;
  }

  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  const turnOrder = players
    .filter((player: any) => player && player.spectator !== true && player.hasLost !== true && String(player.id || '').trim())
    .map((player: any) => String(player.id)) as PlayerID[];
  const activePlayerId = String(
    (ctx.state as any)?.turnPlayer ||
    (ctx.state as any)?.activePlayer ||
    (ctx.state as any)?.activePlayerId ||
    turnOrder[0] ||
    fallbackPlayerId ||
    '',
  ) as PlayerID;

  const queuedResolutionSteps = ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    promptSteps as any,
    turnOrder,
    activePlayerId,
  );

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: String((queuedResolutionSteps[0] as any)?.playerId || fallbackPlayerId || '').trim(),
    sourceId: String((queuedResolutionSteps[0] as any)?.sourceId || sourceId || '').trim(),
    queuedResolutionSteps: queuedResolutionSteps as any[],
  });
}

export function resolveVentureProgress(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  sourceId: string,
  mode: 'dungeon' | 'undercity',
): void {
  const stateAny = (ctx as any).state as any;
  stateAny.dungeonProgress = stateAny.dungeonProgress || {};
  const progress = normalizeDungeonProgress(stateAny.dungeonProgress[playerId]);

  if (!progress) {
    if (mode === 'undercity') {
      const undercityProgress = createDungeonProgress('undercity');
      if (undercityProgress) {
        stateAny.dungeonProgress[playerId] = undercityProgress;
        applyAutomaticDungeonRoomEffect(ctx, playerId, undercityProgress);
        const tokenEffectPayloads = applyAutomaticDungeonRoomTokenEffects(ctx, playerId, undercityProgress);
        const promptSteps = buildDungeonRoomPromptSteps(ctx, playerId, undercityProgress, sourceId);
        queueDungeonRoomPromptSteps(ctx, promptSteps, playerId, sourceId);
        appendDungeonRoomExecuteEffectEvents(ctx, tokenEffectPayloads);
      }
      return;
    }

    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose a dungeon to enter',
      mandatory: true,
      sourceId: sourceId || undefined,
      sourceName: String(sourceName || 'Venture').trim() || 'Venture',
      options: [
        { id: 'lost_mine', label: getDungeonNameById('lost_mine') },
        { id: 'mad_mage', label: getDungeonNameById('mad_mage') },
        { id: 'tomb', label: getDungeonNameById('tomb') },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseDungeon: true,
    } as any);
    return;
  }

  const advancement = advanceDungeonProgress(progress);
  if (advancement.choiceRequired.length > 1) {
    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: `Choose the next room in ${progress.dungeonName}`,
      mandatory: true,
      sourceId: sourceId || undefined,
      sourceName: String(sourceName || 'Venture').trim() || 'Venture',
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
    return;
  }

  if (!advancement.progress) {
    return;
  }

  applyAutomaticDungeonRoomEffect(ctx, playerId, advancement.progress);
  const tokenEffectPayloads = applyAutomaticDungeonRoomTokenEffects(ctx, playerId, advancement.progress);
  const promptSteps = buildDungeonRoomPromptSteps(ctx, playerId, advancement.progress, sourceId);
  queueDungeonRoomPromptSteps(ctx, promptSteps, playerId, sourceId);
  appendDungeonRoomExecuteEffectEvents(ctx, tokenEffectPayloads);

  if (advancement.completed) {
    markDungeonCompleted(stateAny, String(playerId), String(advancement.progress.dungeonName || getDungeonNameById(progress.dungeonId)).trim());
    delete stateAny.dungeonProgress[playerId];
    return;
  }

  stateAny.dungeonProgress[playerId] = advancement.progress;
}

export function queueInitiativeVentureTrigger(
  ctx: GameContext,
  controller: PlayerID,
  sourceId: string,
): void {
  const stateAny = (ctx as any).state as any;
  stateAny.stack = stateAny.stack || [];
  stateAny.stack.push({
    id: uid('initiative_trigger'),
    type: 'triggered_ability',
    controller,
    sourceId,
    sourceName: 'The Initiative',
    description: 'Venture into Undercity.',
    effect: 'Venture into Undercity.',
    triggerType: 'initiative',
    mandatory: true,
    initiativeVentureTrigger: true,
  });
}
