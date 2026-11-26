/**
 * socket/interaction-handlers/activationPayXEnergyCost.ts
 *
 * "Pay X {E}" activation costs (Chthonian Nightmare: "Pay X {E}, Sacrifice a creature, Return this
 * enchantment to its owner's hand: Return target creature card with mana value X from your
 * graveyard to the battlefield."). CR 601.2b / 602.2b order:
 *
 * 1. Announce X: X_VALUE_SELECTION (0..current energy), tagged payXEnergyActivation.
 * 2. Choose targets with X known: the ability text gets X's value, so "mana value X" only offers
 *    legal cards (TARGET_SELECTION, payXEnergyActivationStage 'target').
 * 3. Choose what to sacrifice when the cost has "Sacrifice a <type>" (stage 'sacrifice').
 * 4. Pay and put the ability on the stack through the normal battlefield-ability continuation,
 *    which pays the deferred costs together (deferredEnergyPaymentForCost,
 *    deferredSacrificeChoiceIds, deferredSelfSourceCost 'return_to_hand') and records them for replay.
 *
 * Nothing is paid before step 4; cancelling or running out of legal choices costs nothing.
 * Public entry symbols: parsePayXEnergyCost, tryHandleActivatePayXEnergyCost,
 * continuePayXEnergyActivationAfterX, handlePayXEnergyActivationStage.
 */

import type { Server } from "socket.io";
import { parseTargetRequirements } from "../../rules-engine/targeting.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { cardManaValue } from "../../state/utils.js";
import { debug } from "../../utils/debug.js";
import { buildActivatedAbilityValidTargets } from "../resolutionActivatedAbilityTargetingUtils.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import { broadcastGame, emitToPlayer } from "../util.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { matchesParsedGraveyardCardTargetType } from "./interactionActivationEventPersistence.js";

export type PayXEnergyCostPlan = {
  sacrificeType?: string;
  sacrificeOther?: boolean;
  returnSelfToHand: boolean;
};

const PAY_X_ENERGY_RE = /\bpay\s+x\s+\{e\}/i;
const RETURN_SELF_RE = /\breturn\s+(?:this|~)\b[^,]*?\bto\s+its\s+owner['\u2019]s\s+hand\b/i;
const SACRIFICE_RE = /\bsacrifice\s+(another\s+)?(?:a|an|one)\s+([a-z]+(?:\s+[a-z]+)?)\b/i;

/** Cost made only of "Pay X {E}" plus optional "Sacrifice a <type>" / "Return this ... to its owner's hand". */
export function parsePayXEnergyCost(costText: unknown): PayXEnergyCostPlan | null {
  const cost = String(costText || '');
  if (!PAY_X_ENERGY_RE.test(cost)) return null;
  const sacrifice = cost.match(SACRIFICE_RE);
  const returnSelfToHand = RETURN_SELF_RE.test(cost);
  let rest = cost.replace(PAY_X_ENERGY_RE, ' ').replace(RETURN_SELF_RE, ' ');
  if (sacrifice) rest = rest.replace(sacrifice[0], ' ');
  if (rest.replace(/[\s,.]+/g, ' ').trim()) return null;
  return {
    ...(sacrifice ? { sacrificeType: sacrifice[2].toLowerCase().replace(/s$/, ''), sacrificeOther: Boolean(sacrifice[1]) } : {}),
    returnSelfToHand,
  };
}

function sorceryTimingOk(game: any, pid: string): boolean {
  const state = game?.state || {};
  const phase = String(state.phase || '').toLowerCase();
  const stack = Array.isArray(state.stack) ? state.stack : [];
  return String(state.turnPlayer || '') === pid && phase.includes('main') && stack.length === 0;
}

function sacrificeCandidates(game: any, pid: string, plan: PayXEnergyCostPlan, sourceId: string): any[] {
  if (!plan.sacrificeType) return [];
  const type = plan.sacrificeType;
  const battlefield: any[] = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  return battlefield.filter((perm: any) => perm && String(perm.controller || '') === pid
    && (type === 'permanent' || String(perm.card?.type_line || '').toLowerCase().includes(type))
    && !(plan.sacrificeOther && String(perm.id) === sourceId));
}

/** Activation entry: announce X first. Returns true when it handled (or refused) the activation. */
export function tryHandleActivatePayXEnergyCost(
  ctx: ActivateBattlefieldAbilityContext,
  costText: string,
  abilityText: string,
  requiresTap: boolean,
): boolean {
  const plan = parsePayXEnergyCost(costText);
  if (!plan || requiresTap) return false;
  const { io, socket, game, gameId, pid, permanentId, abilityId, cardName } = ctx;
  const fullText = String(ctx.scopedAbilityFullText || ctx.scopedAbilityText || '');
  if (/\bactivate only as a sorcery\b/i.test(fullText) && !sorceryTimingOk(game, String(pid))) {
    socket.emit('error', { code: 'SORCERY_SPEED_ONLY', message: `${cardName}: activate only as a sorcery.` });
    return true;
  }
  if (plan.sacrificeType && sacrificeCandidates(game, String(pid), plan, String(permanentId)).length === 0) {
    socket.emit('error', { code: 'INSUFFICIENT_TARGETS', message: `${cardName}: you control no ${plan.sacrificeType} to sacrifice.` });
    return true;
  }
  const energy = Math.max(0, Math.floor(Number(game.state?.energy?.[pid] || 0)));
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.X_VALUE_SELECTION,
    playerId: pid,
    description: `${cardName}: choose X, the energy to pay (you have ${energy}).`,
    mandatory: false,
    sourceId: permanentId,
    sourceName: cardName,
    minValue: 0,
    maxValue: energy,
    payXEnergyActivation: {
      permanentId: String(permanentId),
      abilityId: String(abilityId || ''),
      cardName,
      abilityText: String(abilityText || ''),
      activatedAbilityText: fullText,
      plan,
    },
  } as any);
  debug(2, `[activationPayXEnergyCost] ${cardName}: announce X (energy ${energy}) before targets`);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

function graveyardTargetEntries(game: any, pid: string, targetReqs: any, abilityText: string): any[] {
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  const owners = targetReqs.graveyardScope === 'any'
    ? players.filter((player: any) => player?.id).map((player: any) => String(player.id))
    : [pid];
  const exact = typeof targetReqs.targetFilterExactManaValue === 'number'
    ? Number(targetReqs.targetFilterExactManaValue)
    : (abilityText.match(/\bmana value (\d+)\b(?! or)/i) ? Number(abilityText.match(/\bmana value (\d+)\b(?! or)/i)![1]) : undefined);
  const types: string[] = (targetReqs.targetTypes || []).map(String);
  return owners.flatMap((ownerId) => {
    const graveyard: any[] = Array.isArray(game.state?.zones?.[ownerId]?.graveyard) ? game.state.zones[ownerId].graveyard : [];
    return graveyard
      .filter((card: any) => types.some((type) => matchesParsedGraveyardCardTargetType(card, type)))
      .filter((card: any) => typeof exact !== 'number' || cardManaValue(card) === exact)
      .map((card: any) => ({
        id: String(card.id),
        name: card.name || 'Card',
        label: card.name || 'Card',
        type: 'graveyard_card',
        controller: ownerId,
        zoneOwnerId: ownerId,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
      }));
  });
}

/** X announced: queue the target prompt with X's value in the text. */
export async function continuePayXEnergyActivationAfterX(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  selectedX: number | null,
): Promise<void> {
  const stepAny = step as any;
  const payload = stepAny.payXEnergyActivation;
  if (!payload || response.cancelled || selectedX == null) return;
  const pid = String(step.playerId || response.playerId);
  const energy = Math.max(0, Math.floor(Number(game.state?.energy?.[pid] || 0)));
  if (selectedX > energy) {
    emitToPlayer(io, pid as any, 'error', { code: 'INSUFFICIENT_ENERGY', message: `${payload.cardName}: you have only ${energy} energy.` });
    return;
  }
  const battlefield: any[] = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((perm: any) => perm && String(perm.id) === payload.permanentId);
  if (!permanent) {
    emitToPlayer(io, pid as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
    return;
  }
  const xValue = Math.max(0, Math.floor(selectedX));
  // Ability text may arrive lowercased; a standalone x is the announced variable either way.
  const abilityText = String(payload.abilityText || '').replace(/\bx\b/gi, String(xValue));
  const next = { ...payload, xValue, abilityText };
  const targetReqs: any = parseTargetRequirements(abilityText, {
    gameState: game.state,
    controllerId: pid,
    sourceName: payload.cardName,
    sourcePermanent: permanent,
  } as any);
  if (!targetReqs?.needsTargets) {
    await queueSacrificeOrActivate(io, game, gameId, pid, { ...next, targets: [], targetEntries: [], targetReqs: null });
    return;
  }
  const types: string[] = (targetReqs.targetTypes || []).map(String);
  const graveyardOnly = types.length > 0 && types.every((type) => type.toLowerCase().startsWith('graveyard_'));
  const validTargets = graveyardOnly
    ? graveyardTargetEntries(game, pid, targetReqs, abilityText)
    : buildActivatedAbilityValidTargets(game, pid, targetReqs, { sourcePermanentId: payload.permanentId, abilityText } as any);
  const maxTargets = Math.max(1, Number(targetReqs.maxTargets ?? targetReqs.minTargets ?? 1));
  // "target ..." needs one; only "up to" lets the player choose none.
  const minTargets = /\bup to\b/i.test(abilityText) ? Number(targetReqs.minTargets ?? 0) : Math.max(1, Number(targetReqs.minTargets ?? 1));
  if (validTargets.length < minTargets) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'NO_VALID_TARGETS',
      message: `${payload.cardName}: no legal ${targetReqs.targetDescription || 'target'} for X = ${xValue}. Nothing was paid.`,
    });
    broadcastGame(io, game, gameId);
    return;
  }
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: payload.permanentId,
    sourceName: payload.cardName,
    description: `Choose ${targetReqs.targetDescription || 'target'} for ${payload.cardName} (X = ${xValue})`,
    mandatory: false,
    validTargets,
    targetTypes: types,
    minTargets,
    maxTargets,
    targetDescription: targetReqs.targetDescription || 'target',
    permanentId: payload.permanentId,
    payXEnergyActivationStage: 'target',
    payXEnergyActivation: { ...next, targetReqs: { targetTypes: types, minTargets, maxTargets, targetDescription: targetReqs.targetDescription } },
  } as any);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}

async function queueSacrificeOrActivate(io: Server, game: any, gameId: string, pid: string, payload: any): Promise<void> {
  const plan: PayXEnergyCostPlan = payload.plan || { returnSelfToHand: false };
  if (!plan.sacrificeType) {
    await activateWithDeferredCosts(io, game, gameId, pid, payload, []);
    return;
  }
  const candidates = sacrificeCandidates(game, pid, plan, payload.permanentId);
  if (candidates.length === 0) {
    emitToPlayer(io, pid as any, 'error', { code: 'INSUFFICIENT_TARGETS', message: `${payload.cardName}: you control no ${plan.sacrificeType} to sacrifice.` });
    return;
  }
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: payload.permanentId,
    sourceName: payload.cardName,
    description: `${payload.cardName}: choose a ${plan.sacrificeType} to sacrifice (cost)`,
    mandatory: false,
    validTargets: candidates.map((perm: any) => ({
      id: String(perm.id),
      label: perm.card?.name || 'Permanent',
      description: perm.card?.type_line || 'Permanent',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      type: 'permanent',
      controller: perm.controller,
    })),
    targetTypes: [plan.sacrificeType],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: `${plan.sacrificeType} to sacrifice`,
    permanentId: payload.permanentId,
    sacrificeAsCost: true,
    payXEnergyActivationStage: 'sacrifice',
    payXEnergyActivation: payload,
  } as any);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}

/** Every choice made: the battlefield-ability continuation pays the costs and stacks the ability. */
async function activateWithDeferredCosts(io: Server, game: any, gameId: string, pid: string, payload: any, sacrificeIds: string[]): Promise<void> {
  const reqs = payload.targetReqs || { targetTypes: [], minTargets: 0, maxTargets: 0, targetDescription: '' };
  const targets: string[] = Array.isArray(payload.targets) ? payload.targets : [];
  const xValue = Number(payload.xValue || 0);
  const plan: PayXEnergyCostPlan = payload.plan || { returnSelfToHand: false };
  const syntheticStep: any = {
    id: `payx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: payload.permanentId,
    sourceName: payload.cardName,
    description: `Choose ${reqs.targetDescription || 'target'} for ${payload.cardName}`,
    mandatory: true,
    validTargets: Array.isArray(payload.targetEntries) ? payload.targetEntries : [],
    targetTypes: reqs.targetTypes,
    minTargets: targets.length,
    maxTargets: targets.length,
    targetDescription: reqs.targetDescription || 'target',
    battlefieldAbilityTargetSelection: true,
    permanentId: payload.permanentId,
    abilityId: payload.abilityId,
    cardName: payload.cardName,
    abilityText: payload.abilityText,
    activatedAbilityText: payload.activatedAbilityText,
    tappedPermanentsForCost: [],
    xValue,
    ...(xValue > 0 ? { deferredEnergyPaymentForCost: xValue } : {}),
    ...(sacrificeIds.length > 0 ? { deferredSacrificeChoiceIds: sacrificeIds } : {}),
    ...(plan.returnSelfToHand ? { deferredSelfSourceCost: 'return_to_hand' } : {}),
  };
  const response: ResolutionStepResponse = {
    stepId: syntheticStep.id,
    playerId: pid,
    selections: targets,
    cancelled: false,
    timestamp: Date.now(),
  } as any;
  debug(2, `[activationPayXEnergyCost] ${payload.cardName}: X=${xValue}, targets [${targets.join(', ')}], sacrifice [${sacrificeIds.join(', ')}]`);
  await getResolutionHandlerDeps().handleBattlefieldAbilityTargetSelection(io, game, gameId, syntheticStep, response);
}

/** TARGET_SELECTION answers for the target and sacrifice stages. */
export async function handlePayXEnergyActivationStage(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepAny = step as any;
  const payload = stepAny.payXEnergyActivation;
  if (!payload || response.cancelled) {
    broadcastGame(io, game, gameId);
    return;
  }
  const pid = String(step.playerId || response.playerId);
  const selections = (Array.isArray(response.selections) ? response.selections : []).map((id: any) => String(id));
  const legal = new Set((stepAny.validTargets || []).map((entry: any) => String(entry?.id || '')));
  const min = Number(stepAny.minTargets ?? 1);
  const max = Number(stepAny.maxTargets ?? min);
  if (selections.length < min || selections.length > max || !selections.every((id) => legal.has(id))) {
    emitToPlayer(io, pid as any, 'error', { code: 'INVALID_TARGET', message: 'Invalid selection' });
    return;
  }
  if (stepAny.payXEnergyActivationStage === 'target') {
    const targetEntries = (stepAny.validTargets || []).filter((entry: any) => selections.includes(String(entry?.id || '')));
    await queueSacrificeOrActivate(io, game, gameId, pid, { ...payload, targets: selections, targetEntries });
    return;
  }
  await activateWithDeferredCosts(io, game, gameId, pid, payload, selections);
}
