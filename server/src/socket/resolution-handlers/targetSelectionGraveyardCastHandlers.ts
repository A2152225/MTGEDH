/**
 * socket/resolution-handlers/targetSelectionGraveyardCastHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two branches that resume a cast-from-graveyard ability once the player has
 * answered its prompt - `graveyardCastSacrificeAsCost` (validate and sacrifice the chosen
 * permanents, then continue the cast carrying the sacrificed ids) and
 * `graveyardSpellCastTargetSelection` (the chosen targets are the spell's targets).
 * Public entry symbols: handleGraveyardCastSacrificeAsCostTargetSelection,
 * handleGraveyardSpellCastTargetSelection.
 *
 * The sacrifice-cost branch returns a boolean because its body was wrapped in a try/catch whose
 * catch fell through to the branches below; the target-selection branch always returned.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import { continueCastFromGraveyardAbility } from "../interaction.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/**
 * TARGET_SELECTION with `graveyardCastSacrificeAsCost`: pay the sacrifice cost, then resume the cast.
 *
 * Returns false only when the body threw, matching the parent's original fall-through on error.
 */
export async function handleGraveyardCastSacrificeAsCostTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  try {
    const stepAny = step as any;
    const controllerId = String(pid);
    const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
    const abilityId = String(stepAny?.abilityId || '').trim();
    const cardName = String(stepAny?.cardName || step.sourceName || 'Spell');
    const sacrificeType = String(stepAny?.sacrificeType || '').trim();
    const sacrificeSubtype = stepAny?.sacrificeSubtype ? String(stepAny.sacrificeSubtype) : undefined;
    const sacrificeCount = Number(stepAny?.sacrificeCount || selections.length || 1);
    const mustBeOther = Boolean(stepAny?.mustBeOther);

    const playerZones = (game.state as any)?.zones?.[controllerId];
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    if (!graveyard.some((entry: any) => entry && String(entry.id || '') === cardId)) {
      emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
      return true;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const matchesSacrificeRequirement = (perm: any): boolean => {
      if (!perm) return false;
      if (String(perm.controller || '') !== controllerId) return false;
      if (mustBeOther && String(perm.id || '') === cardId) return false;

      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      let okType = false;
      switch (sacrificeType) {
        case 'creature':
          okType = typeLine.includes('creature');
          break;
        case 'artifact':
          okType = typeLine.includes('artifact');
          break;
        case 'enchantment':
          okType = typeLine.includes('enchantment');
          break;
        case 'land':
          okType = typeLine.includes('land');
          break;
        case 'nonland_permanent':
          okType = !typeLine.includes('land');
          break;
        case 'artifact_or_creature':
          okType = typeLine.includes('artifact') || typeLine.includes('creature');
          break;
        case 'permanent':
          okType = true;
          break;
        default:
          okType = false;
          break;
      }

      if (!okType) return false;
      if (sacrificeSubtype) {
        return typeLine.includes(sacrificeSubtype.toLowerCase());
      }
      return true;
    };

    if (selections.length < sacrificeCount) {
      emitToPlayer(io, controllerId, 'error', { code: 'INVALID_SELECTION', message: 'Not enough permanents were selected.' });
      return true;
    }

    for (const chosenId of selections) {
      const chosenPerm = battlefield.find((perm: any) => perm && String(perm.id || '') === String(chosenId));
      if (!chosenPerm || !matchesSacrificeRequirement(chosenPerm)) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INVALID_SELECTION',
          message: 'One or more chosen permanents can no longer be sacrificed for this cost',
        });
        return true;
      }
    }

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;

    const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
    const sacrificedNames: string[] = [];
    const sacrificedIds: string[] = [];
    for (const chosenId of selections) {
      const chosenPerm = battlefield.find((perm: any) => perm && String(perm.id || '') === String(chosenId));
      const permName = String(chosenPerm?.card?.name || 'permanent');
      const ok = movePermanentToGraveyard(ctx, String(chosenId), true);
      if (ok) {
        sacrificedNames.push(permName);
        sacrificedIds.push(String(chosenId));
      }
    }

    if (sacrificedIds.length < sacrificeCount) {
      emitToPlayer(io, controllerId, 'error', {
        code: 'SACRIFICE_FAILED',
        message: 'Failed to sacrifice the required permanents',
      });
      return true;
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'sacrificeSelectionResolve', {
        resolvedStepId: String(step?.id || '').trim(),
        playerId: controllerId,
        sourceId: cardId,
        sourceName: cardName,
        permanentType: String(stepAny?.sacrificePermanentType || 'permanent'),
        permanentIds: sacrificedIds,
        reason: String(stepAny?.sacrificeReason || step.description || '').trim(),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist graveyard sacrificeSelectionResolve:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, controllerId)} sacrifices ${sacrificedNames.join(', ') || 'permanents'} (${cardName}).`,
      ts: Date.now(),
    });

    const result = continueCastFromGraveyardAbility({
      gameId,
      game,
      io,
      playerId: controllerId,
      cardId,
      abilityId,
      targets: Array.isArray(stepAny?.targetsForCast) ? stepAny.targetsForCast : undefined,
      discardedCardIds: Array.isArray(stepAny?.discardedCardIdsForCost)
        ? stepAny.discardedCardIdsForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      exiledCardIdsFromHandForCost: Array.isArray(stepAny?.exiledCardIdsFromHandForCost)
        ? stepAny.exiledCardIdsFromHandForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      exiledCardIdsFromGraveyardForCost: Array.isArray(stepAny?.exiledCardIdsFromGraveyardForCost)
        ? stepAny.exiledCardIdsFromGraveyardForCost.map((id: any) => String(id)).filter(Boolean)
        : undefined,
      sacrificedPermanentIdsForCost: sacrificedIds,
      xValue: Number.isFinite(Number(stepAny?.xValue)) ? Math.max(0, Math.floor(Number(stepAny.xValue))) : undefined,
      emitError: (payload) => emitToPlayer(io, controllerId as any, 'error', payload),
    });

    if (result !== 'error') {
      broadcastGame(io, game, gameId);
    }
    return true;
  } catch (err) {
    debugError(1, '[Resolution] Failed to resume graveyard sacrifice-cost cast', err);
  }
  return false;
}

/** TARGET_SELECTION with `graveyardSpellCastTargetSelection`: the chosen ids are the spell's targets. */
export function handleGraveyardSpellCastTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const result = continueCastFromGraveyardAbility({
    gameId,
    game,
    io,
    playerId: String(pid),
    cardId: String((step as any)?.cardId || step.sourceId || '').trim(),
    abilityId: String((step as any)?.abilityId || '').trim(),
    targets: selections,
    discardedCardIds: Array.isArray((step as any)?.discardedCardIdsForCost)
      ? (step as any).discardedCardIdsForCost.map((id: any) => String(id)).filter(Boolean)
      : undefined,
    exiledCardIdsFromHandForCost: Array.isArray((step as any)?.exiledCardIdsFromHandForCost)
      ? (step as any).exiledCardIdsFromHandForCost.map((id: any) => String(id)).filter(Boolean)
      : undefined,
    exiledCardIdsFromGraveyardForCost: Array.isArray((step as any)?.exiledCardIdsFromGraveyardForCost)
      ? (step as any).exiledCardIdsFromGraveyardForCost.map((id: any) => String(id)).filter(Boolean)
      : undefined,
    sacrificedPermanentIdsForCost: Array.isArray((step as any)?.sacrificedPermanentIdsForCost)
      ? (step as any).sacrificedPermanentIdsForCost.map((id: any) => String(id)).filter(Boolean)
      : undefined,
    xValue: Number.isFinite(Number((step as any)?.xValue)) ? Math.max(0, Math.floor(Number((step as any).xValue))) : undefined,
    emitError: (payload) => emitToPlayer(io, pid as any, 'error', payload),
  });

  if (result !== 'error') {
    broadcastGame(io, game, gameId);
  }
}
