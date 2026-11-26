/**
 * socket/interaction-handlers/activationCraftCost.ts
 *
 * Generic craft activation (CR 702.167) for every "Craft with [materials] [cost]" permanent
 * (Dire Flail, Throne of the Grim Captain, Eye of Ojer Taq, Sunbird Standard, ...).
 *
 * 1. tryHandleActivateCraft: sorcery timing, mana availability and material feasibility, then the
 *    existing card-selection modal (TARGET_SELECTION, craftMaterialSelection) listing other
 *    permanents you control and cards in your graveyard that can be materials.
 * 2. handleCraftMaterialSelection: validates the chosen set against the requirement (counts,
 *    "share a card type", one material per listed type), pays the mana, exiles the materials and
 *    the source, puts the craft ability on the stack and records 'activateCraft' for replay.
 * Resolution (return transformed + remember materials) is state/modules/craftAbility.ts.
 * Nothing is paid until the materials are confirmed; cancelling costs nothing.
 * Public entry symbols: findCraftAbilityForActivation, tryHandleActivateCraft, handleCraftMaterialSelection.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import {
  craftMaterialsFeasible,
  craftSelectionBounds,
  filterCraftCandidatesForSpec,
  orderCraftCandidatesValidFirst,
  listCraftMaterialCandidates,
  parseCraftAbilityText,
  payCraftExileCosts,
  validateCraftMaterials,
  type ParsedCraftAbility,
} from "../../state/modules/craftAbility.js";
import { debug } from "../../utils/debug.js";
import { fireBattlefieldAbilityActivatedTriggers } from "../resolutionActivatedAbilityTargetingUtils.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  emitToPlayer,
  getOrInitManaPool,
  parseManaCost,
  validateManaPayment,
} from "../util.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

/** The craft ability this activation refers to, when the chosen ability is a craft line. */
export function findCraftAbilityForActivation(texts: string[], abilityText: string): ParsedCraftAbility | undefined {
  for (const text of texts) {
    if (/^\s*craft with\b/i.test(String(text || ''))) return parseCraftAbilityText(text);
  }
  if (/\breturn (?:this card|it) (?:to the battlefield )?transformed\b/i.test(String(abilityText || ''))) {
    for (const text of texts) {
      const parsed = parseCraftAbilityText(text);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function sorceryTimingOk(game: any, pid: string): boolean {
  const state = game?.state || {};
  const phase = String(state.phase || '').toLowerCase();
  const stack = Array.isArray(state.stack) ? state.stack : [];
  return String(state.turnPlayer || '') === pid && phase.includes('main') && stack.length === 0;
}

function manaShortfall(game: any, pid: string, manaCost: string): boolean {
  const parsed = parseManaCost(manaCost);
  const pool = getOrInitManaPool(game.state, pid);
  const available = calculateTotalAvailableMana(pool, []);
  return Boolean(validateManaPayment(available, parsed.colors, parsed.generic));
}

function candidateEntries(game: any, pid: string, permanentId: string, parsed: ParsedCraftAbility): any[] {
  const candidates = orderCraftCandidatesValidFirst(parsed.spec, filterCraftCandidatesForSpec(parsed.spec, listCraftMaterialCandidates(game.state, pid, permanentId)));
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    label: c.zone === 'graveyard' ? `${c.name} (graveyard)` : c.name,
    description: c.typeLine,
    type: c.zone === 'graveyard' ? 'graveyard_card' : 'permanent',
    controller: pid,
    zoneOwnerId: c.zone === 'graveyard' ? pid : undefined,
    imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal || c.card?.card_faces?.[0]?.image_uris?.small,
  }));
}

/** Entry from the battlefield activation pipeline; true when this was a craft activation. */
export function tryHandleActivateCraft(
  ctx: ActivateBattlefieldAbilityContext,
  texts: string[],
  abilityText: string,
): boolean {
  const lowered = findCraftAbilityForActivation(texts, abilityText);
  if (!lowered) return false;
  const { io, socket, game, gameId, pid, permanentId, abilityId, cardName } = ctx;
  // Prefer the printed line (same materials) so prompts keep the card's capitalization.
  const printed = parseCraftAbilityText(String(ctx.oracleText || ''));
  const parsed = printed && printed.materialsText.toLowerCase().replace(/,/g, '') === lowered.materialsText.toLowerCase().replace(/,/g, '')
    ? printed
    : lowered;
  if (!sorceryTimingOk(game, String(pid))) {
    socket.emit('error', { code: 'SORCERY_SPEED_ONLY', message: `${cardName}: craft only as a sorcery.` });
    return true;
  }
  if (manaShortfall(game, String(pid), parsed.manaCost)) {
    socket.emit('error', { code: 'INSUFFICIENT_MANA', message: `${cardName}: craft costs ${parsed.manaCost}.` });
    return true;
  }
  const candidates = listCraftMaterialCandidates(game.state, String(pid), String(permanentId));
  if (!craftMaterialsFeasible(parsed.spec, candidates)) {
    socket.emit('error', {
      code: 'INSUFFICIENT_TARGETS',
      message: `${cardName}: you don't have the materials to craft with ${parsed.materialsText} (permanents you control or cards in your graveyard).`,
    });
    return true;
  }
  const validTargets = candidateEntries(game, String(pid), String(permanentId), parsed);
  const bounds = craftSelectionBounds(parsed.spec, validTargets.length);
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: permanentId,
    sourceName: cardName,
    description: `Craft ${cardName} (${parsed.manaCost}): choose ${parsed.materialsText} to exile from permanents you control and/or your graveyard.`,
    mandatory: false,
    validTargets,
    targetTypes: ['craft_material'],
    minTargets: bounds.min,
    maxTargets: bounds.max,
    targetDescription: `craft materials (${parsed.materialsText})`,
    permanentId,
    craftMaterialSelection: true,
    aiSuggestedSelections: validTargets.slice(0, bounds.min).map((entry: any) => String(entry.id)),
    craftActivation: {
      permanentId: String(permanentId),
      abilityId: String(abilityId || ''),
      cardName,
      manaCost: parsed.manaCost,
      materialsText: parsed.materialsText,
    },
  } as any);
  debug(2, `[activationCraftCost] ${cardName}: choose craft materials (${parsed.materialsText}, ${validTargets.length} candidates)`);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

function requeue(gameId: string, step: ResolutionStep): void {
  const { id: _id, status: _status, createdAt: _createdAt, response: _response, completedAt: _completedAt, ...rest } = step as any;
  ResolutionQueueManager.addStep(gameId, rest);
}

/** Materials confirmed: validate, pay, exile and put the craft ability on the stack. */
export async function handleCraftMaterialSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = String(response.playerId);
  const payload = (step as any).craftActivation || {};
  const permanentId = String(payload.permanentId || '');
  const cardName = String(payload.cardName || 'Craft');
  const parsed = parseCraftAbilityText(`Craft with ${payload.materialsText} ${payload.manaCost}`);
  const selections = (Array.isArray(response.selections) ? response.selections : []).map((id: any) => String(id));
  if (!parsed) return;
  const fail = (code: string, message: string, retry: boolean) => {
    emitToPlayer(io, pid as any, 'error', { code, message: `${cardName}: ${message}. Nothing was paid.` });
    if (retry) requeue(gameId, step);
    broadcastGame(io, game, gameId);
  };
  if (!sorceryTimingOk(game, pid)) return fail('SORCERY_SPEED_ONLY', 'craft only as a sorcery', false);
  const candidates = listCraftMaterialCandidates(game.state, pid, permanentId);
  const chosen = selections.map((id) => candidates.find((c) => c.id === id)).filter(Boolean) as any[];
  if (chosen.length !== selections.length) return fail('INVALID_SELECTION', 'a chosen material is no longer available', true);
  const reason = validateCraftMaterials(parsed.spec, chosen);
  if (reason) return fail('INVALID_SELECTION', reason, true);
  if (manaShortfall(game, pid, parsed.manaCost)) return fail('INSUFFICIENT_MANA', `craft costs ${parsed.manaCost}`, false);

  const pool = getOrInitManaPool(game.state, pid);
  const before = JSON.parse(JSON.stringify(pool || {}));
  const manaParsed = parseManaCost(parsed.manaCost);
  consumeManaFromPool(pool, manaParsed.colors, manaParsed.generic, '[craft]');
  const after = JSON.parse(JSON.stringify(pool || {}));
  const result = payCraftExileCosts(game, { playerId: pid, permanentId, materialIds: selections, materialsText: parsed.materialsText });
  if (!result.stackItem) return fail('INVALID_SELECTION', result.error || 'craft failed', false);
  game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
  game.state.stack.push(result.stackItem);
  const paymentManaDelta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = Number(after[key] || 0) - Number(before[key] || 0);
    if (Number.isFinite(delta) && delta !== 0) paymentManaDelta[key] = delta;
  }
  fireBattlefieldAbilityActivatedTriggers(game, pid, permanentId, `Craft with ${parsed.materialsText}`, gameId, result.stackItem.id, () => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateCraft', {
        playerId: pid,
        permanentId,
        cardName,
        materialIds: selections,
        materialsText: parsed.materialsText,
        manaCost: parsed.manaCost,
        stackItemId: result.stackItem.id,
        paymentManaDelta,
      });
    } catch {
      // ignore persistence failures
    }
  });
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${cardName} crafted with ${chosen.map((c: any) => c.name).join(', ')} (paid ${parsed.manaCost}).`,
    ts: Date.now(),
  });
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
