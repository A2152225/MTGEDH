/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: battlefield-ability timing, mana-payment plan, action-candidate
 * enumeration, cast-control snapshots, tryAIResponseActions.
 *
 * Public entry symbols: canAIAssembleManaPaymentPlan, canAIActivateBattlefieldAbilityNow,
 * enumerateAIActionCandidates, captureAICastControlFlowSnapshot,
 * didAICastAttemptChangeControlFlow, waitForAISharedCastToSettle, tryAIResponseActions.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { AIDecisionType } from "../../../../rules-engine/src/AIEngine.js";
import { canRespond } from "../../state/modules/can-respond.js";
import { parseManaCost, type ParsedManaCost } from "../../state/modules/mana-check.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { isPlayerCompletingSpellCast } from "../game-actions.js";
import { calculateManaProduction, getOrInitManaPool, validateManaPayment } from "../util.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import {
  executeAIActivateAbility,
  isAIManaBatteryChargeInvestAction,
} from "./aiActivateAbilityHandlers.js";
import type {
  AIActionCandidate,
  AIActionCandidateQuery,
  AIActivatedAbilityCandidate,
  AICastableCommanderCandidate,
  AICastableSpellCandidate,
  AICastAttemptDescriptor,
  AICastRequestSourceZone,
  AIPlayableLandCandidate,
} from "./aiActionCandidateTypes.js";
import { AI_MANA_ABILITY_PATTERN, COLOR_IDENTITY_MAP } from "./aiConstants.js";
import { findCastableSpells } from "./aiFindCastableSpells.js";
import { getPaymentSources } from "./aiPaymentSources.js";
import { aiEngine, getAIPendingSpellCastStatus } from "./aiScheduler.js";
import { calculateSpellPriority } from "./aiSpellPriority.js";

function getAIActionContext(game: any): any {
  return getAIHandlerDeps().getAIActionContext(game);
}

function findPlayableLand(game: any, playerId: PlayerID): AIPlayableLandCandidate | null {
  return getAIHandlerDeps().findPlayableLand(game, playerId);
}

function findCastableCommander(game: any, playerId: PlayerID, options?: any): any {
  return getAIHandlerDeps().findCastableCommander(game, playerId, options);
}

async function executeAICastSpell(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableSpellCandidate,
): Promise<boolean> {
  return getAIHandlerDeps().executeAICastSpell(io, gameId, playerId, candidate);
}

async function executeAICastCommander(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  candidate: AICastableCommanderCandidate,
): Promise<boolean> {
  return getAIHandlerDeps().executeAICastCommander(io, gameId, playerId, candidate);
}

function isAISorcerySpeedBattlefieldAbility(action: any, permanent: any): boolean {
  const abilityId = String(action?.abilityId || '').toLowerCase();
  const abilityText = String(action?.abilityText || '').toLowerCase();
  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();

  if (/-reconfigure-|-equip-|fortify/.test(abilityId)) {
    return true;
  }
  if (/\breconfigure\b/.test(abilityText) || /\bequip\b/.test(abilityText) || /\bfortify\b/.test(abilityText)) {
    return true;
  }
  if (/\breconfigure\b/.test(oracleText) || /\bequip\b/.test(oracleText) || /\bfortify\b/.test(oracleText)) {
    return true;
  }
  return /(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText);
}

function resolveAIActivatedAbilityManaCostText(action: any, permanent: any): string {
  const abilityText = String(action?.abilityText || '').trim();
  const oracleText = String(permanent?.card?.oracle_text || '').trim();

  const reconfigureMatch = abilityText.match(/reconfigure\s*(\{[^}]+\}(?:\{[^}]+\})*)/i)
    || oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (reconfigureMatch) {
    return String(reconfigureMatch[1] || '').trim();
  }

  const equipMatch = abilityText.match(/equip\s+(\{[^}]+\}(?:\{[^}]+\})*)/i)
    || oracleText.match(/equip\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (equipMatch) {
    return String(equipMatch[1] || '').trim();
  }

  const fortifyMatch = abilityText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i)
    || oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch) {
    return String(fortifyMatch[1] || '').trim();
  }

  const genericMatch = abilityText.match(/^(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:/i);
  if (genericMatch) {
    return String(genericMatch[1] || '')
      .replace(/\{T\}/gi, '')
      .replace(/,\s*,/g, ',')
      .replace(/^,\s*|\s*,$/g, '')
      .trim();
  }

  return '';
}

export function canAIAssembleManaPaymentPlan(
  game: any,
  playerId: PlayerID,
  parsedCost: ParsedManaCost,
  excludePermanentIds: string[] = [],
): boolean {
  const pool = getOrInitManaPool(game.state, String(playerId)) as any;
  const totalAvailable: Record<string, number> = {
    white: Number(pool.white || 0),
    blue: Number(pool.blue || 0),
    black: Number(pool.black || 0),
    red: Number(pool.red || 0),
    green: Number(pool.green || 0),
    colorless: Number(pool.colorless || 0),
  };

  if (!validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic)) {
    return true;
  }

  const excluded = new Set(excludePermanentIds.map((id) => String(id || '')).filter(Boolean));
  const paymentSources = getPaymentSources(game, playerId, {
    colors: { ...(parsedCost.colors || {}) },
    generic: Number(parsedCost.generic || 0),
  });
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];

  for (const source of paymentSources) {
    if (excluded.has(String(source.sourceId || ''))) continue;
    const permanent = battlefield.find((entry: any) =>
      entry &&
      String(entry.id || '') === String(source.sourceId || '') &&
      entry.controller === playerId &&
      !entry.tapped
    );
    if (!permanent) continue;

    const manaInfo = calculateManaProduction(game.state, permanent, String(playerId), source.produceColor, source.abilityId);
    const poolKey = COLOR_IDENTITY_MAP[String(source.produceColor || '').toUpperCase()] || 'colorless';
    totalAvailable[poolKey] = Number(totalAvailable[poolKey] || 0) + Number(manaInfo.totalAmount || 0);

    for (const bonus of manaInfo.bonusMana || []) {
      const bonusKey = COLOR_IDENTITY_MAP[String(bonus?.color || '').toUpperCase()] || 'colorless';
      totalAvailable[bonusKey] = Number(totalAvailable[bonusKey] || 0) + Number(bonus?.amount || 0);
    }
  }

  return !validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
}

function isAIPureManaAbilityAction(action: any): boolean {
  const abilityText = String(action?.abilityText || '').trim();
  if (!abilityText) return false;
  // Mana abilities that only add mana (no targets) — not useful as a free-standing priority action.
  return AI_MANA_ABILITY_PATTERN.test(abilityText) && !/target/i.test(abilityText);
}

export function canAIActivateBattlefieldAbilityNow(
  game: any,
  playerId: PlayerID,
  action: any,
  mode: 'main' | 'response',
): boolean {
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(action?.permanentId || ''));
  if (!permanent) {
    return false;
  }

  // Never treat pure mana taps as activate-ability candidates. Floating mana empties
  // between steps/phases unless retention effects apply; those (and spell payment taps)
  // use dedicated paths that call executeAIActivateAbility directly.
  if (isAIPureManaAbilityAction(action)) {
    return false;
  }

  const stackEmpty = !game.state?.stack || game.state.stack.length === 0;
  const phase = String(game.state?.phase || '').toLowerCase();
  const isMainPhase = phase.includes('main');
  const isOwnTurn = game.state?.turnPlayer === playerId;

  if (isAISorcerySpeedBattlefieldAbility(action, permanent)) {
    if (!stackEmpty || !isMainPhase || !isOwnTurn || mode === 'response') {
      return false;
    }
  }

  // Mana-battery "put a charge counter" lines are main-phase value plays, not responses.
  // Charging Gemstone Array (etc.) during every combat priority window dumps the AI's mana.
  const isChargeInvest = isAIManaBatteryChargeInvestAction(permanent, action);

  if (isChargeInvest) {
    if (mode === 'response') {
      return false;
    }
  }

  const manaCostText = resolveAIActivatedAbilityManaCostText(action, permanent);
  if (!manaCostText) {
    return true;
  }

  const parsedCost = parseManaCost(manaCostText);
  const needsMana = Number(parsedCost.generic || 0) > 0
    || Object.values(parsedCost.colors || {}).some((value) => Number(value || 0) > 0);
  if (!needsMana) {
    return true;
  }

  // Never treat this permanent's own remove-counter mana as payment for putting more counters on it.
  if (isChargeInvest) {
    return canAIAssembleManaPaymentPlan(game, playerId, parsedCost, [String(permanent.id || '')]);
  }

  return canAIAssembleManaPaymentPlan(game, playerId, parsedCost);
}

async function getAIActivatedAbilityCandidate(
  game: any,
  playerId: PlayerID,
  willNeedToDiscard: boolean,
  queryMode: 'main' | 'response' = 'main',
): Promise<AIActivatedAbilityCandidate | null> {
  const abilityDecision = await aiEngine.makeDecision({
    gameState: game.state as any,
    playerId,
    decisionType: AIDecisionType.ACTIVATE_ABILITY,
    options: [],
  });

  if (!abilityDecision.action?.activate) {
    return null;
  }

  if (!canAIActivateBattlefieldAbilityNow(game, playerId, abilityDecision.action, queryMode)) {
    debug(1, '[AI] Skipping activated ability candidate (timing or affordability):', {
      playerId,
      cardName: abilityDecision.action.cardName,
      permanentId: abilityDecision.action.permanentId,
      abilityId: abilityDecision.action.abilityId,
      queryMode,
    });
    return null;
  }

  return {
    action: abilityDecision.action,
    reasoning: abilityDecision.reasoning,
    confidence: abilityDecision.confidence,
  };
}

function getAIActionCandidateKinds(query: AIActionCandidateQuery): Set<AIActionCandidate['kind']> {
  if (Array.isArray(query.kinds) && query.kinds.length > 0) {
    return new Set(query.kinds);
  }

  if (query.mode === 'response') {
    return new Set<AIActionCandidate['kind']>(['activate_ability', 'cast_commander', 'cast_spell']);
  }

  return new Set<AIActionCandidate['kind']>(['play_land', 'activate_ability', 'cast_commander', 'cast_spell']);
}

export async function enumerateAIActionCandidates(
  game: any,
  playerId: PlayerID,
  query: AIActionCandidateQuery,
): Promise<AIActionCandidate[]> {
  const kinds = getAIActionCandidateKinds(query);
  const candidates: AIActionCandidate[] = [];
  const willNeedToDiscard = query.willNeedToDiscard === true;

  if (query.mode === 'main' && kinds.has('play_land')) {
    const landCandidate = findPlayableLand(game, playerId);
    if (landCandidate) {
      candidates.push({
        kind: 'play_land',
        priority: 1000,
        land: landCandidate,
      });
    }
  }

  if (kinds.has('activate_ability')) {
    const abilityCandidate = await getAIActivatedAbilityCandidate(
      game,
      playerId,
      willNeedToDiscard,
      query.mode === 'response' ? 'response' : 'main',
    );
    if (abilityCandidate) {
      const confidenceBonus = Math.round(Number(abilityCandidate.confidence || 0) * 10);
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const abilityPermanent = battlefield.find(
        (entry: any) => String(entry?.id || '') === String(abilityCandidate.action?.permanentId || ''),
      );
      const isBatteryChargeInvest = abilityPermanent
        ? isAIManaBatteryChargeInvestAction(abilityPermanent, abilityCandidate.action)
        : false;
      // Battery charge is spare-mana / color-fixing — sit below real casts (base 320+)
      // and commanders (650+), but above "nothing" so leftover mana still stocks the battery.
      const basePriority = query.mode === 'response'
        ? 820
        : (willNeedToDiscard
          ? 220
          : (isBatteryChargeInvest ? 250 : 720));

      candidates.push({
        kind: 'activate_ability',
        priority: basePriority + confidenceBonus,
        ability: abilityCandidate,
      });
    }
  }

  if (kinds.has('cast_commander')) {
    const commanderCandidate = findCastableCommander(game, playerId, { responseOnly: query.mode === 'response' });
    if (commanderCandidate) {
      const basePriority = query.mode === 'response' ? 430 : 650;
      candidates.push({
        kind: 'cast_commander',
        priority: basePriority + Math.max(0, calculateSpellPriority(commanderCandidate.card, game, playerId, commanderCandidate.cost)),
        commander: commanderCandidate,
      });
    }
  }

  if (kinds.has('cast_spell')) {
    const spellCandidates = findCastableSpells(game, playerId, { responseOnly: query.mode === 'response' });
    for (const spellCandidate of spellCandidates) {
      candidates.push({
        kind: 'cast_spell',
        priority: (query.mode === 'response' ? 420 : 320) + Math.max(0, spellCandidate.priority),
        spell: spellCandidate,
      });
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  return candidates;
}

type AICastControlFlowSnapshot = {
  stackLength: number;
  pendingSteps: boolean;
  pendingCastCount: number;
};

/**
 * Capture the control-flow-relevant state immediately BEFORE an AI cast attempt so that
 * didAICastAttemptChangeControlFlow can compare deltas rather than absolute values.
 */
export function captureAICastControlFlowSnapshot(
  gameId: string,
  game: any,
  playerId: PlayerID,
): AICastControlFlowSnapshot {
  return {
    stackLength: Array.isArray(game.state?.stack) ? game.state.stack.length : 0,
    pendingSteps: ResolutionQueueManager.playerHasPendingSteps(gameId, playerId),
    pendingCastCount: getAIPendingSpellCastStatus(gameId, game, playerId).effectIds.length,
  };
}

export function didAICastAttemptChangeControlFlow(
  gameId: string,
  game: any,
  playerId: PlayerID,
  candidate: AICastAttemptDescriptor,
  before: AICastControlFlowSnapshot,
): boolean {
  const pendingCastStatus = getAIPendingSpellCastStatus(gameId, game, playerId);
  const stackNow = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
  const aiHasPendingSteps = ResolutionQueueManager.playerHasPendingSteps(gameId, playerId);
  const priorityStillHeld = game.state.priority === playerId;

  // Compare against the pre-attempt snapshot. A failed cast (e.g. INSUFFICIENT_MANA) that
  // increases nothing did NOT progress, and the AI must fall through to passing priority.
  // Using absolute values here (e.g. `stackNow > 0`) falsely reports progress whenever the
  // stack was already non-empty before the attempt — for instance when responding while our
  // own counterspell and a trigger already sit on the stack — which caused the AI to stop
  // without passing priority and deadlocked the game.
  const stackGrew = stackNow > before.stackLength;
  const gainedPendingSteps = aiHasPendingSteps && !before.pendingSteps;
  const gainedPendingCast = pendingCastStatus.effectIds.length > before.pendingCastCount;
  const castStillCompleting = isPlayerCompletingSpellCast(game, playerId);

  if (castStillCompleting || !priorityStillHeld || stackGrew || gainedPendingSteps || gainedPendingCast) {
    debug(1, '[AI] Cast attempt changed control flow; stopping additional cast attempts', {
      gameId,
      playerId,
      cardName: candidate.castCard?.name || candidate.card?.name,
      sourceZone: candidate.sourceZone,
      priority: game.state.priority,
      stackBefore: before.stackLength,
      stackNow,
      aiHasPendingSteps,
      pendingCastIds: pendingCastStatus.effectIds,
    });
    return true;
  }

  return false;
}

export async function waitForAISharedCastToSettle(
  gameId: string,
  game: any,
  playerId: PlayerID,
  cardId: string,
  sourceZone: AICastRequestSourceZone,
  before: AICastControlFlowSnapshot,
  maxWaitMs: number = 2000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    if (!isPlayerCompletingSpellCast(game, playerId)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return didAICastAttemptChangeControlFlow(gameId, game, playerId, { card: { id: cardId }, sourceZone }, before);
}

export async function tryAIResponseActions(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  game: any,
): Promise<boolean> {
  const responseContext = getAIActionContext(game);
  if (!canRespond(responseContext, playerId)) {
    return false;
  }

  const responseCandidates = await enumerateAIActionCandidates(game, playerId, { mode: 'response' });
  for (const candidate of responseCandidates) {
    if (candidate.kind === 'activate_ability') {
      debug(1, '[AI] Taking response-window activated ability:', candidate.ability.action.cardName);
      if (await executeAIActivateAbility(io, gameId, playerId, candidate.ability.action, false)) {
        return true;
      }

      debugWarn(1, '[AI] Response-window ability candidate produced no state change; continuing to next response option', {
        gameId,
        playerId,
        permanentId: candidate.ability.action?.permanentId,
        cardName: candidate.ability.action?.cardName,
      });
      continue;
    }

    if (candidate.kind === 'cast_spell') {
      const candidateSpell = candidate.spell;
      debug(1, '[AI] Taking response-window spell action:', {
        name: candidateSpell.castCard?.name || candidateSpell.card?.name,
        sourceZone: candidateSpell.sourceZone,
        priority: candidateSpell.priority,
      });

      const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
      const castProgressed = await executeAICastSpell(io, gameId, playerId, candidateSpell);
      if (castProgressed) {
        return true;
      }

      if (didAICastAttemptChangeControlFlow(gameId, game, playerId, candidateSpell, beforeCast)) {
        return true;
      }
    }

    if (candidate.kind === 'cast_commander') {
      debug(1, '[AI] Taking response-window commander action:', candidate.commander.card.name);
      const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
      const castProgressed = await executeAICastCommander(io, gameId, playerId, candidate.commander);
      if (castProgressed) {
        return true;
      }

      if (didAICastAttemptChangeControlFlow(gameId, game, playerId, {
        card: candidate.commander.card,
        sourceZone: 'command',
      }, beforeCast)) {
        return true;
      }
    }
  }

  return false;
}
