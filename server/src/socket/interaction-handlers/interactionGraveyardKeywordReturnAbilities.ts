// server/src/socket/interaction-handlers/interactionGraveyardKeywordReturnAbilities.ts
// B41: unearth and embalm/eternalize branches of handleActivateGraveyardAbilityRequest, moved out of
// interactionGraveyardAbilitySocketHandlers.ts (size cap) and extended with non-mana keyword costs
// ("Eternalize\u2014{3}{U}{U}, Discard a card.", "Unearth\u2014Pay eight {E}.") via graveyardKeywordNonManaCost.ts.
// Origin parent: interactionGraveyardAbilitySocketHandlers.ts (handleActivateGraveyardAbilityRequest).
// Public entry symbols: handleUnearthOrEmbalmGraveyardAbility, KeywordReturnArgs.

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { adjustActivationManaCostForPayment } from "../../state/modules/ability-cost-adjustments.js";
import { buildEmbalmOrEternalizeTokenPermanent } from "../../state/modules/graveyard-tokens.js";
import { getGrantedEmbalmInfo, getGrantedUnearthInfo, getPrintedUnearthInfo } from "../../state/modules/graveyard-permissions.js";
import {
  graveyardKeywordCostError,
  parseGraveyardKeywordCost,
  payGraveyardKeywordImmediateCosts,
  queueGraveyardKeywordDiscardCost,
  type GraveyardKeywordCost,
} from "../../state/modules/graveyardKeywordNonManaCost.js";
import { calculateTotalAvailableMana, consumeManaFromPool, getOrInitManaPool, getPlayerName, parseManaCost, validateManaPayment } from "../util";
import { getNextEndStepFireTurnNumber } from "./interactionGraveyardCastExecution.js";
import {
  enforceSorcerySpeedGraveyardAbility,
  getKeywordGraveyardActivationManaCost,
  markCardLeftGraveyardLive,
  queueSelfEtbForLiveGraveyardEntry,
} from "./interactionGraveyardCastCostAndTimingRules.js";
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

export interface KeywordReturnArgs {
  io: Server; socket: Socket; game: any; gameId: string; pid: string; card: any; cardId: string;
  cardIndex: number; cardName: string; zones: any; abilityId: string; generateId: (prefix: string) => string;
}

function checkB41Cost(socket: Socket, game: any, pid: string, cardName: string, keyword: string, cost: GraveyardKeywordCost | null): boolean {
  const err = graveyardKeywordCostError(game.state, String(pid), cost);
  if (!err) return true;
  socket.emit("error", { code: "CANNOT_PAY_COST", message: `Cannot pay ${cardName}'s ${keyword} cost (${cost?.text}): ${err}` });
  return false;
}

export function handleUnearthOrEmbalmGraveyardAbility(args: KeywordReturnArgs): boolean {
  const { io, socket, game, gameId, pid, card, cardId, cardIndex, cardName, zones, abilityId, generateId } = args;
  if (abilityId === 'unearth') {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), 'Unearth')) {
      return false;
    }

    const printedUnearthInfo = getPrintedUnearthInfo(card);
    const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo(game as any, pid as any, card);
    if (!printedUnearthInfo.hasIt && !grantedUnearthInfo.hasIt) {
      socket.emit("error", {
        code: "ABILITY_NOT_AVAILABLE",
        message: `${cardName} does not currently have unearth.`,
      });
      return false;
    }

    const b41Cost = parseGraveyardKeywordCost(card, 'unearth');
    const recordedManaCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || b41Cost?.manaCost || '').trim();
    if (!checkB41Cost(socket, game, pid, cardName, 'unearth', b41Cost)) return false;
    if (recordedManaCost) {
      const costAdjustment = adjustActivationManaCostForPayment({
        state: game.state,
        activatorId: String(pid),
        sourceCard: card,
        sourceZone: 'graveyard',
        sourceController: String(pid),
        sourceId: String(cardId),
        isManaAbility: false,
        manaCostString: recordedManaCost,
        sourceName: cardName,
      });
      const effectiveManaCost = costAdjustment.adjustedManaCost || recordedManaCost;
      const parsedCost = parseManaCost(effectiveManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${effectiveManaCost}: ${validationError}`,
        });
        return false;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    payGraveyardKeywordImmediateCosts(game.state, String(pid), b41Cost);
    // Return to battlefield
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Add to battlefield
    game.state.battlefield = game.state.battlefield || [];
      const createdPermanentId = generateId("perm");
      const createdPermanent = {
        id: createdPermanentId,
      controller: pid,
      owner: pid,
      tapped: false,
      wasUnearthed: true,
      unearthed: true,
      counters: {},
        leaveBattlefieldReplacementDestination: 'exile',
        leaveBattlefieldReplacementSourceName: cardName,
        card: {
          ...card,
          zone: "battlefield",
          unearth: true,
          wasUnearthed: true,
          leaveBattlefieldReplacementDestination: 'exile',
          leaveBattlefieldReplacementSourceName: cardName,
        },
    } as any;
      game.state.battlefield.push(createdPermanent);
      stampPermanentEntryTimestamp(game.state, game.state.battlefield[game.state.battlefield.length - 1]);
      queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), createdPermanent);
    const fireAtTurnNumber = getNextEndStepFireTurnNumber(game.state);
    (game.state as any).pendingExileAtNextEndStep = Array.isArray((game.state as any).pendingExileAtNextEndStep)
      ? (game.state as any).pendingExileAtNextEndStep
      : [];
    const pendingExileAtNextEndStep = (game.state as any).pendingExileAtNextEndStep as any[];
    if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === String(createdPermanentId))) {
      pendingExileAtNextEndStep.push({
        permanentId: createdPermanentId,
        fireAtTurnNumber,
        sourceName: cardName,
        createdBy: pid,
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    queueGraveyardKeywordDiscardCost(gameId, game.state, String(pid), String(cardId), cardName, 'unearth', b41Cost);
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
      ...(b41Cost ? { nonManaCost: b41Cost.text } : {}),
      createdPermanentIds: [createdPermanentId],
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} unearthed ${cardName}.`,
      ts: Date.now(),
    });
  } else {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), abilityId === 'eternalize' ? 'Eternalize' : 'Embalm')) {
      return false;
    }

    const printedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
    const hasPrintedAbility = abilityId === 'embalm'
      ? /\bembalm\b/i.test(String(card?.oracle_text || card?.oracleText || ''))
      : /\beternalize\b/i.test(String(card?.oracle_text || card?.oracleText || ''));
    const grantedEmbalmInfo = abilityId === 'embalm' && !hasPrintedAbility
      ? getGrantedEmbalmInfo(game as any, pid as any, card)
      : { hasIt: false };
    if (!hasPrintedAbility && !grantedEmbalmInfo.hasIt) {
      socket.emit("error", {
        code: "ABILITY_NOT_AVAILABLE",
        message: `${cardName} does not currently have ${abilityId}.`,
      });
      return false;
    }

    const b41Cost = parseGraveyardKeywordCost(card, abilityId);
    const recordedManaCost = String(printedManaCost || grantedEmbalmInfo.cost || b41Cost?.manaCost || '').trim();
    if (!checkB41Cost(socket, game, pid, cardName, abilityId, b41Cost)) return false;
    if (recordedManaCost) {
      const parsedCost = parseManaCost(recordedManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${recordedManaCost}: ${validationError}`,
        });
        return false;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    payGraveyardKeywordImmediateCosts(game.state, String(pid), b41Cost);
    // Exile original from graveyard
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Move to exile
    zones.exile = zones.exile || [];
    zones.exile.push({ ...card, zone: "exile" });
    zones.exileCount = zones.exile.length;
    
    game.state.battlefield = game.state.battlefield || [];
    const createdPermanentId = generateId("token");
    const createdToken = buildEmbalmOrEternalizeTokenPermanent(
      card,
      abilityId as 'embalm' | 'eternalize',
      String(pid),
      createdPermanentId,
    );
    game.state.battlefield.push(createdToken as any);
    stampPermanentEntryTimestamp(game.state, game.state.battlefield[game.state.battlefield.length - 1]);
    queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), createdToken);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    queueGraveyardKeywordDiscardCost(gameId, game.state, String(pid), String(cardId), cardName, abilityId, b41Cost);
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
      ...(b41Cost ? { nonManaCost: b41Cost.text } : {}),
      createdPermanentIds: [createdPermanentId],
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} created a token copy of ${cardName} using ${abilityId}.`,
      ts: Date.now(),
    });
  }
  return true;
}
