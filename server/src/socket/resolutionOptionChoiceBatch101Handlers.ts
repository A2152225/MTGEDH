// server/src/socket/resolutionOptionChoiceBatch101Handlers.ts
// OPTION_CHOICE handlers for Esix first-tokens, Land Equilibrium sacrifice,
// Recover, and Paleontologist's Pick-Axe craft-card choice.
// Public: tryHandleBatch101OptionChoice.

import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../state/resolution/index.js';
import { chosenEsixCopyCreature } from '../state/modules/batch101EnterCopyAndTokens.js';
import { applyRecoverDecision } from '../state/modules/batch101LandRecoverSurveil.js';
import { applyPickAxeChosenCraftCard } from '../state/modules/batch101LongTailApply.js';
import { createToken } from '../state/modules/counters_tokens.js';
import { sacrificePermanent } from '../state/modules/upkeep-triggers.js';
import type { GameContext } from '../state/context.js';
import { queueRecoverManaPaymentIfNeeded } from './resolutionOptionChoiceBatch102Handlers.js';

function selectedId(response: ResolutionStepResponse): string {
  const anyResp = response as any;
  if (typeof anyResp.selectedOption === 'string') return anyResp.selectedOption;
  if (typeof anyResp.optionId === 'string') return anyResp.optionId;
  if (typeof anyResp.choice === 'string') return anyResp.choice;
  const selections = anyResp.selections;
  if (Array.isArray(selections) && selections[0]) return String(selections[0]?.id || selections[0]);
  return String(anyResp.value || '').trim();
}

function asCtx(game: any, gameId: string): GameContext {
  return { ...(game as any), gameId, state: game.state } as GameContext;
}

export async function tryHandleBatch101OptionChoice(
  _io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  const choice = selectedId(response);
  const state = game.state;

  if (stepData?.esixFirstTokensChoice === true) {
    const original = stepData.esixOriginalTokenCreate || {};
    const controller = String(original.controller || response.playerId || '');
    const count = Math.max(1, Math.floor(Number(original.count || 1)));
    const sourceId = String(stepData.esixSourcePermanentId || stepData.sourceId || '');
    const ctx = asCtx(game, gameId);
    const copyOf = chosenEsixCopyCreature(state, sourceId, choice);
    if (copyOf) {
      const card = copyOf.card || copyOf;
      createToken(
        ctx,
        controller as any,
        String(card.name || 'Creature'),
        count,
        Number(copyOf.power ?? copyOf.basePower ?? card.power ?? 0),
        Number(copyOf.toughness ?? copyOf.baseToughness ?? card.toughness ?? 0),
        {
          typeLine: String(card.type_line || 'Token Creature'),
          copyOfPermanentId: String(copyOf.id),
          skipTokenReplacements: true,
        } as any,
        true,
      );
    } else {
      createToken(
        ctx,
        controller as any,
        String(original.name || 'Token'),
        count,
        original.basePower,
        original.baseToughness,
        { ...(original.options || {}), skipTokenReplacements: true },
        true,
      );
    }
    return true;
  }

  if (stepData?.landEquilibriumSacrificeChoice === true) {
    const landId = choice || String(stepData.enteredLandId || '');
    if (landId) {
      try {
        sacrificePermanent(game as any, landId, String(response.playerId || ""));
      } catch {
        const idx = Array.isArray(state.battlefield) ? state.battlefield.findIndex((p: any) => String(p?.id) === landId) : -1;
        if (idx >= 0) state.battlefield.splice(idx, 1);
      }
    }
    return true;
  }

  if (stepData?.recoverChoice === true) {
    const ownerId = String(stepData.recoverOwnerId || response.playerId || '');
    const cardId = String(stepData.recoverCardId || stepData.sourceId || '');
    const paid = choice === 'pay';
    if (paid && queueRecoverManaPaymentIfNeeded(game, gameId, ownerId, cardId, stepData.recoverCost)) {
      return true;
    }
    applyRecoverDecision(state, ownerId, cardId, paid);
    return true;
  }

  if (stepData?.pickAxeCraftChoice === true) {
    applyPickAxeChosenCraftCard(
      state,
      String(stepData.pickAxeEquipmentId || stepData.sourceId || ''),
      choice,
      stepData.pickAxeAttachedToId,
    );
    return true;
  }

  return false;
}
