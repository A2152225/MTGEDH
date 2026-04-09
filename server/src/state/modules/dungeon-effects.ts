import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import type { DungeonProgressState } from "./dungeons.js";
import { triggerLifeGainEffects } from "../utils.js";
import { processLifeChange } from "./game-state-effects.js";
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