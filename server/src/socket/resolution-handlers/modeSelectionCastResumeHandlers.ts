/**
 * socket/resolution-handlers/modeSelectionCastResumeHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MODE_SELECTION case).
 * Cluster moved: the spell-casting mode prompts that open that case - steps carrying
 * `castSpellFromHandArgs`, i.e. modal / spree / tiered mode picks, Abundant Harvest's
 * `abundantChoice`, and the overload-vs-normal prompt. Each records the choice on the card in hand,
 * persists a cast-spell continuation event, and resumes castSpellFromHand.
 * Public entry symbols: tryHandleModeSelectionCastResume.
 *
 * Returns true when the original switch case would have hit `break` here, false when the remaining
 * MODE_SELECTION branches in resolution.ts still need to run.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import {
  appendCastSpellContinuationEvent,
  resumePlayerCastSpellFromHand,
} from "../resolutionSyntheticCastSocketUtils.js";
import { emitToPlayer, getPlayerName } from "../util.js";

/** MODE_SELECTION prefix: mode prompts raised mid-cast that resume castSpellFromHand. */
export async function tryHandleModeSelectionCastResume(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const stepData = step as any;
  const selectedRaw = response.selections as any;
  const chosenMode = Array.isArray(selectedRaw) ? selectedRaw[0] : selectedRaw;

  // Special-case: spell-casting mode prompts (overload, Abundant Harvest style)
  // These steps carry server-only continuation args so we can resume castSpellFromHand.
  if (!stepData?.castSpellFromHandArgs || response.cancelled) return false;

  const castArgs = stepData.castSpellFromHandArgs as any;
  const cardId = String(castArgs.cardId || stepData.sourceId || '');
  const purpose = String(stepData.modeSelectionPurpose || '');

  const zones = (game.state as any)?.zones?.[pid];
  const zoneName = castArgs.fromZone === 'exile' || castArgs.fromZone === 'graveyard' || castArgs.fromZone === 'library'
    ? castArgs.fromZone
    : 'hand';
  const zoneCards = Array.isArray(zones?.[zoneName]) ? zones[zoneName] : undefined;

  if (!zones || !Array.isArray(zoneCards)) {
    emitToPlayer(io, pid as any, 'error', { code: 'NO_HAND', message: 'Hand not found' });
    return true;
  }

  const cardInHand = (zoneCards as any[]).find((c: any) => c && c.id === cardId);
  if (!cardInHand) {
    emitToPlayer(io, pid as any, 'error', { code: 'CARD_NOT_IN_HAND', message: 'Card not found in hand' });
    return true;
  }

  if (purpose === 'modalSpell' || purpose === 'spree' || purpose === 'tiered') {
    const selectedModes = (Array.isArray(selectedRaw) ? selectedRaw : [selectedRaw])
      .map((x: any) => String(x ?? ''))
      .filter(Boolean);

    if (selectedModes.length === 0) {
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_SELECTION', message: 'No modes selected' });
      return true;
    }

    const modeOptions: any[] = Array.isArray(stepData?.modes) ? stepData.modes : [];
    const entwineCost = purpose === 'modalSpell' && typeof stepData?.entwineCost === 'string' && stepData.entwineCost.trim().length > 0
      ? String(stepData.entwineCost).trim()
      : undefined;
    const isEntwinedSelection = Boolean(entwineCost) && modeOptions.length > 0 && selectedModes.length === modeOptions.length;

    (cardInHand as any).selectedModes = selectedModes;
    if (purpose === 'spree' || purpose === 'tiered') {
      (cardInHand as any).selectedAdditionalCostModes = selectedModes;
    }
    if (purpose === 'spree') {
      (cardInHand as any).selectedSpreeModes = selectedModes;
    }
    if (purpose === 'modalSpell') {
      if (isEntwinedSelection) {
        (cardInHand as any).castWithEntwine = true;
        (cardInHand as any).entwineCost = entwineCost;
      } else {
        delete (cardInHand as any).castWithEntwine;
        delete (cardInHand as any).entwineCost;
      }
    }

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      cardUpdates: {
        selectedModes,
        selectedAdditionalCostModes: purpose === 'spree' || purpose === 'tiered' ? selectedModes : null,
        selectedSpreeModes: purpose === 'spree' ? selectedModes : null,
        ...(purpose === 'modalSpell'
          ? {
              castWithEntwine: isEntwinedSelection ? true : null,
              entwineCost: isEntwinedSelection ? entwineCost : null,
            }
          : {}),
      },
    });

    const labels = selectedModes.map((id: string) => {
      const m = modeOptions.find(o => String(o?.id) === id);
      return String(m?.label || id);
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chose mode${selectedModes.length === 1 ? '' : 's'} for ${cardInHand.name}: ${labels.join(', ')}`,
      ts: Date.now(),
    });

    await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
      cardId,
      faceIndex: castArgs.faceIndex,
      fromZone: castArgs.fromZone,
      payment: castArgs.payment,
      targets: castArgs.targets,
      xValue: castArgs.xValue,
      alternateCostId: castArgs.alternateCostId,
      convokeTappedCreatures: castArgs.convokeTappedCreatures,
    });
    return true;
  }

  if (purpose === 'abundantChoice') {
    (cardInHand as any).abundantChoice = String(chosenMode);

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      cardUpdates: {
        abundantChoice: String(chosenMode),
      },
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} chooses ${String(chosenMode)} for ${cardInHand.name}.`,
      ts: Date.now(),
    });

    await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
      cardId,
      faceIndex: castArgs.faceIndex,
      fromZone: castArgs.fromZone,
      payment: castArgs.payment,
      targets: castArgs.targets,
      xValue: castArgs.xValue,
      alternateCostId: castArgs.alternateCostId,
      convokeTappedCreatures: castArgs.convokeTappedCreatures,
    });
    return true;
  }

  if (purpose === 'overload') {
    const chosen = String(chosenMode);
    if (chosen === 'overload') {
      const oracleText = String((cardInHand as any).oracle_text || '').toLowerCase();
      const overloadMatch = oracleText.match(/overload\s*\{([^}]+)\}/i);
      const overloadCost = overloadMatch ? `{${overloadMatch[1]}}` : null;

      if (!overloadCost) {
        emitToPlayer(io, pid as any, 'error', { code: 'NO_OVERLOAD_COST', message: 'Could not determine overload cost' });
        return true;
      }

      (cardInHand as any).castWithOverload = true;
      (cardInHand as any).overloadCost = overloadCost;

      appendCastSpellContinuationEvent(gameId, game, {
        playerId: pid,
        cardId,
        cardUpdates: {
          castWithOverload: true,
          overloadCost,
        },
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} is casting ${cardInHand.name} with Overload!`,
        ts: Date.now(),
      });

      // Resume the original cast attempt with overload selected.
      // The cost/payment UI will be requested by the normal cast flow.
      await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
        cardId,
        faceIndex: castArgs.faceIndex,
        fromZone: castArgs.fromZone,
        payment: castArgs.payment,
        targets: castArgs.targets,
        xValue: castArgs.xValue,
        alternateCostId: 'overload',
        selectedCastMode: 'overload',
        skipPriorityCheck: castArgs.skipPriorityCheck === true,
        convokeTappedCreatures: castArgs.convokeTappedCreatures,
      });
      return true;
    }

    // Normal mode: clear overload flag and continue the original cast attempt.
    delete (cardInHand as any).castWithOverload;
    delete (cardInHand as any).overloadCost;

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      cardUpdates: {
        castWithOverload: null,
        overloadCost: null,
      },
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} is casting ${cardInHand.name} normally.`,
      ts: Date.now(),
    });

    await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
      cardId,
      faceIndex: castArgs.faceIndex,
      fromZone: castArgs.fromZone,
      payment: castArgs.payment,
      targets: castArgs.targets,
      xValue: castArgs.xValue,
      alternateCostId: castArgs.alternateCostId,
      selectedCastMode: 'normal',
      skipPriorityCheck: castArgs.skipPriorityCheck === true,
      convokeTappedCreatures: castArgs.convokeTappedCreatures,
    });
    return true;
  }

  // Unknown purpose: just continue the cast attempt.
  await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
    cardId,
    faceIndex: castArgs.faceIndex,
    fromZone: castArgs.fromZone,
    payment: castArgs.payment,
    targets: castArgs.targets,
    xValue: castArgs.xValue,
    alternateCostId: castArgs.alternateCostId,
    skipPriorityCheck: castArgs.skipPriorityCheck === true,
    convokeTappedCreatures: castArgs.convokeTappedCreatures,
  });
  return true;
}
