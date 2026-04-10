import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import type { DungeonProgressState } from "./dungeons.js";
import { triggerLifeGainEffects } from "../utils.js";
import { processLifeChange } from "./game-state-effects.js";
import { updateCounters } from "./counters_tokens.js";
import { applyGoadToCreature } from "./goad-effects.js";
import { drawCards } from "./zones.js";
import { ResolutionStepType, type CreateResolutionStepConfig } from "../resolution/index.js";

function buildScryCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId) || [];
  if (!Array.isArray(library)) return [];

  const actualCount = Math.min(Math.max(0, Number(count || 0)), library.length);
  if (actualCount <= 0) return [];

  return library.slice(0, actualCount).map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    imageUrl: card.image_uris?.normal,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
  }));
}

function buildLibrarySearchAvailableCards(ctx: GameContext, playerId: PlayerID): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId) || [];
  if (!Array.isArray(library)) return [];

  return library.map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  }));
}

function applyLifeChange(ctx: GameContext, playerId: PlayerID, amount: number, isGain: boolean): number {
  const numericAmount = Math.max(0, Number(amount || 0));
  if (!playerId || numericAmount <= 0) return 0;

  const { finalAmount } = processLifeChange(ctx as any, playerId, numericAmount, isGain);
  if (finalAmount === 0) return 0;

  const stateAny = (ctx.state as any) || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const player = players.find((candidate: any) => String(candidate?.id || '') === String(playerId));
  const startingLife = Number(stateAny.startingLife ?? 40) || 40;

  stateAny.life = stateAny.life || {};
  (ctx as any).life = (ctx as any).life || {};

  const current = stateAny.life[playerId] ?? (ctx as any).life[playerId] ?? player?.life ?? startingLife;
  const next = isGain ? current + finalAmount : current - Math.abs(finalAmount);

  stateAny.life[playerId] = next;
  (ctx as any).life[playerId] = next;
  if (player) player.life = next;

  if (isGain) {
    try {
      stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
      stateAny.lifeGainedThisTurn[String(playerId)] =
        (stateAny.lifeGainedThisTurn[String(playerId)] || 0) + finalAmount;
    } catch {}
    try {
      triggerLifeGainEffects((ctx as any).state, playerId, finalAmount);
    } catch {}
  } else {
    try {
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[String(playerId)] =
        (stateAny.lifeLostThisTurn[String(playerId)] || 0) + Math.abs(finalAmount);
    } catch {}
    try {
      stateAny.damageTakenThisTurnByPlayer = stateAny.damageTakenThisTurnByPlayer || {};
      stateAny.damageTakenThisTurnByPlayer[String(playerId)] =
        (stateAny.damageTakenThisTurnByPlayer[String(playerId)] || 0) + Math.abs(finalAmount);
    } catch {}
  }

  if (typeof ctx.bumpSeq === 'function') {
    ctx.bumpSeq();
  }

  return finalAmount;
}

function getActivePlayers(ctx: GameContext): PlayerID[] {
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  return players
    .filter((player: any) => player && player.spectator !== true && String(player.id || '').trim())
    .map((player: any) => String(player.id) as PlayerID);
}

function getActivePlayerChoiceEntries(ctx: GameContext, choosingPlayerId: PlayerID): Array<{
  id: string;
  name: string;
  life: number;
  libraryCount: number;
  isOpponent: boolean;
  isSelf: boolean;
}> {
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  const stateLife = (ctx.state as any)?.life || {};
  const zones = (ctx.state as any)?.zones || {};

  return players
    .filter((player: any) => player && player.spectator !== true && String(player.id || '').trim())
    .map((player: any) => {
      const playerId = String(player.id);
      return {
        id: playerId,
        name: String(player.name || playerId),
        life: Number(stateLife[playerId] ?? player.life ?? 40) || 40,
        libraryCount: Number((zones[playerId] as any)?.libraryCount ?? 0) || 0,
        isOpponent: playerId !== String(choosingPlayerId),
        isSelf: playerId === String(choosingPlayerId),
      };
    });
}

function getCreatureTargetEntries(ctx: GameContext): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];

  return battlefield
    .filter((permanent: any) => {
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return permanent && String(permanent.id || '').trim() && typeLine.includes('creature');
    })
    .map((permanent: any) => {
      const controllerId = String(permanent.controller || '');
      const controller = players.find((player: any) => String(player?.id || '') === controllerId);
      const controllerName = String(controller?.name || controllerId || '').trim();
      const typeLine = String(permanent.card?.type_line || 'creature').trim();

      return {
        id: String(permanent.id),
        label: String(permanent.card?.name || 'Creature'),
        description: controllerName ? `${typeLine} controlled by ${controllerName}` : typeLine,
        imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      };
    });
}

export function applyDungeonTargetCreatureEffect(
  ctx: GameContext,
  targetPermanentId: string,
  choosingPlayerId: PlayerID,
  effectData:
    | {
        dungeonId?: string;
        roomId?: string;
        amount?: number;
        counterType?: string;
      }
    | null
    | undefined,
): boolean {
  if (!targetPermanentId || !choosingPlayerId || !effectData) return false;

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  const targetIndex = battlefield.findIndex((permanent: any) => String(permanent?.id || '') === String(targetPermanentId));
  if (targetIndex < 0) return false;

  const targetPermanent = battlefield[targetIndex] as any;
  const typeLine = String(targetPermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;

  const roomKey = `${String(effectData.dungeonId || '').trim().toLowerCase()}:${String(effectData.roomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
    case 'undercity:forge': {
      const amount = Math.max(0, Number(effectData.amount || 2));
      const counterType = String(effectData.counterType || '+1/+1').trim() || '+1/+1';
      if (amount <= 0) return false;

      if (typeof (ctx as any).updateCounters === 'function') {
        (ctx as any).updateCounters(targetPermanentId, { [counterType]: amount });
        return true;
      }

      updateCounters(ctx, targetPermanentId, { [counterType]: amount });
      return true;
    }

    case 'undercity:arena': {
      const currentTurn = Number(((ctx.state as any)?.turnNumber ?? 0)) || 0;
      const expiryTurn = currentTurn + 1;
      battlefield[targetIndex] = applyGoadToCreature(targetPermanent as any, choosingPlayerId, expiryTurn) as any;
      if (typeof ctx.bumpSeq === 'function') {
        ctx.bumpSeq();
      }
      return true;
    }

    default:
      return false;
  }
}

export function applyDungeonTargetPlayerEffect(
  ctx: GameContext,
  targetPlayerId: PlayerID,
  effectData: { dungeonId?: string; roomId?: string; amount?: number } | null | undefined,
): boolean {
  if (!targetPlayerId || !effectData) return false;

  const roomKey = `${String(effectData.dungeonId || '').trim().toLowerCase()}:${String(effectData.roomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
    case 'undercity:trap': {
      const amount = Math.max(0, Number(effectData.amount || 5));
      if (amount <= 0) return false;
      applyLifeChange(ctx, targetPlayerId, amount, false);
      return true;
    }

    default:
      return false;
  }
}

export function applyAutomaticDungeonRoomEffect(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
): boolean {
  if (!progress) return false;

  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;
  switch (roomKey) {
    case 'lost_mine:dark_pool': {
      for (const opponentId of getActivePlayers(ctx)) {
        if (String(opponentId) === String(playerId)) continue;
        applyLifeChange(ctx, opponentId, 1, false);
      }
      applyLifeChange(ctx, playerId, 1, true);
      return true;
    }

    case 'lost_mine:temple_of_dumathoin':
    case 'undercity:archives': {
      drawCards(ctx, playerId, 1);
      return true;
    }

    case 'mad_mage:yawning_portal': {
      applyLifeChange(ctx, playerId, 1, true);
      return true;
    }

    case 'tomb:trapped_entry': {
      for (const affectedPlayerId of getActivePlayers(ctx)) {
        applyLifeChange(ctx, affectedPlayerId, 1, false);
      }
      return true;
    }

    default:
      return false;
  }
}

export function buildDungeonRoomPromptStep(
  ctx: GameContext,
  playerId: PlayerID,
  progress: DungeonProgressState | null,
  sourceId?: string,
): CreateResolutionStepConfig | null {
  if (!progress) return null;

  const roomKey = `${String(progress.dungeonId || '').trim().toLowerCase()}:${String(progress.currentRoomId || '').trim().toLowerCase()}`;
  let scryCount = 0;

  switch (roomKey) {
    case 'undercity:forge': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          amount: 2,
          counterType: '+1/+1',
        },
      } as any;
    }

    case 'undercity:arena': {
      const validTargets = getCreatureTargetEntries(ctx);
      if (validTargets.length === 0) return null;

      return {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target creature`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        dungeonTargetCreatureEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
        },
      } as any;
    }

    case 'undercity:trap': {
      const players = getActivePlayerChoiceEntries(ctx, playerId);
      if (players.length === 0) return null;

      return {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Choose target player`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        players,
        dungeonTargetPlayerEffect: {
          dungeonId: progress.dungeonId,
          roomId: progress.currentRoomId,
          amount: 5,
        },
      } as any;
    }

    case 'undercity:secret_entrance': {
      const availableCards = buildLibrarySearchAvailableCards(ctx, playerId).filter((card: any) => {
        const typeLine = String(card?.type_line || '').toLowerCase();
        return typeLine.includes('basic') && typeLine.includes('land');
      });
      if (availableCards.length === 0) return null;

      return {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId,
        description: `${progress.dungeonName}: ${progress.currentRoomName} - Search your library for a basic land card`,
        mandatory: true,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName: progress.currentRoomName,
        searchCriteria: 'a basic land card',
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        availableCards,
        remainderDestination: 'shuffle',
        remainderRandomOrder: true,
        filter: { allTypes: ['basic', 'land'] },
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'dungeon_room',
      } as any;
    }

    case 'lost_mine:cave_entrance':
    case 'mad_mage:dungeon_level':
      scryCount = 1;
      break;
    case 'mad_mage:lost_level':
    case 'undercity:lost_well':
      scryCount = 2;
      break;
    case 'mad_mage:deep_mines':
      scryCount = 3;
      break;
    default:
      return null;
  }

  const cards = buildScryCards(ctx, playerId, scryCount);
  if (cards.length === 0) return null;

  return {
    type: ResolutionStepType.SCRY,
    playerId,
    description: `${progress.dungeonName}: ${progress.currentRoomName} - Scry ${cards.length}`,
    mandatory: true,
    sourceId: String(sourceId || '').trim() || undefined,
    sourceName: progress.currentRoomName,
    scryCount: cards.length,
    cards,
  } as any;
}