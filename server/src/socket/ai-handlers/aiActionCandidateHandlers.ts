/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: battlefield-ability timing, mana-payment plan, action-candidate
 * enumeration, cast-control snapshots, tryAIResponseActions.
 *
 * Public entry symbols: canAIAssembleManaPaymentPlan, canAIActivateBattlefieldAbilityNow,
 * enumerateAIActionCandidates, captureAICastControlFlowSnapshot,
 * didAICastAttemptChangeControlFlow, waitForAISharedCastToSettle, tryAIResponseActions.
 *
 * Response-window activations that produce no state change are remembered for the current
 * phase/step/stack window so the AI passes instead of retrying tap-cost no-ops.
 */
import { isClassOrLevelUpActivation } from "../../state/modules/activation-timing.js";
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { abilityAllowsAnyPlayerActivation } from "../../../../shared/src/anyPlayerActivatedAbility.js";
import { AIDecisionType } from "../../../../rules-engine/src/AIEngine.js";
import {
  isHandOnlyDiscardThisCardActivatedAbility,
  isManaRockSelfUntapAbility,
} from "../../../../rules-engine/src/aiEngineActivatedAbilitySupport.js";
import {
  classifySingleCardGraveyardExile,
  isSingleCardGraveyardExileAbility,
} from "../../../../rules-engine/src/aiGraveyardExileActivation.js";
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
import { isPointlessGainLifeActivatedAbility } from "./aiActivatedAbilityContextualIdle.js";
import { findCastableSpells } from "./aiFindCastableSpells.js";
import { getPaymentSources } from "./aiPaymentSources.js";
import { AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { aiEngine, getAIPendingSpellCastStatus, scheduleAIPriority } from "./aiScheduler.js";
import { calculateSpellPriority } from "./aiSpellPriority.js";
import {
  candidatesFromAIActionList,
  recordDecision,
  traceContextFromGame,
} from "./aiDecisionTrace.js";
import { applyBrain, takeShadow } from "./aiBrain.js";

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
  const sorceryRestriction = /(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i;

  // Xantcha-style "{3}: ... Any player may activate this ability." is instant-speed.
  // Do not inherit Equip/Reconfigure/sorcery flags from the rest of the card.
  if (abilityAllowsAnyPlayerActivation({
    scopedAbilityText: String(action?.abilityText || ''),
    cardOracleText: String(permanent?.card?.oracle_text || ''),
  })) {
    return sorceryRestriction.test(abilityText);
  }

  if (/-reconfigure-|-equip-|fortify/.test(abilityId)) {
    return true;
  }
  // Class level-ups and level up are sorcery speed even without "Activate only as a sorcery".
  if (isClassOrLevelUpActivation(String(action?.abilityText || ''))) {
    return true;
  }
  if (/\breconfigure\b/.test(abilityText) || /\bequip\b/.test(abilityText) || /\bfortify\b/.test(abilityText)) {
    return true;
  }
  if (/\breconfigure\b/.test(oracleText) || /\bequip\b/.test(oracleText) || /\bfortify\b/.test(oracleText)) {
    return true;
  }
  return sorceryRestriction.test(oracleText);
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

function aiCommanderIsInCommandZone(game: any, playerId: PlayerID): boolean {
  const info = game?.state?.commandZone?.[playerId];
  if (!info || Array.isArray(info)) return Array.isArray(info) && info.length > 0;
  if (!Array.isArray(info.inCommandZone)) return false;
  return info.inCommandZone.some((id: unknown) => String(id || '').trim().length > 0);
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

  if (isPointlessGainLifeActivatedAbility({ state: game.state } as any, playerId, permanent)) {
    return false;
  }

  if (isHandOnlyDiscardThisCardActivatedAbility(String(action?.abilityText || ''))) {
    return false;
  }

  // Pay-to-untap on a mana rock is not a main-phase or response action. The end step
  // before this player's turn handles it when spare mana would otherwise be wasted.
  if (isManaRockSelfUntapAbility(
    String(action?.abilityText || ''),
    String(permanent?.card?.oracle_text || ''),
    String(permanent?.card?.name || action?.cardName || ''),
  )) {
    return false;
  }

  // Repeatable single-card graveyard exile (Keen-Eyed Curator, Intrepid Paleontologist)
  // is not a mana sink. Activate only to set up a cast from cards exiled with this
  // permanent, or to stop an opponent recovering a graveyard card. Setup waits for
  // the main phase so draw-step priority does not tap lands before a hand spell.
  if (isSingleCardGraveyardExileAbility(String(action?.abilityText || ''))) {
    if ((permanent as any).activatedThisTurn === true && aiCommanderIsInCommandZone(game, playerId)) {
      return false;
    }
    const exileReason = classifySingleCardGraveyardExile(
      game.state,
      String(playerId),
      permanent,
      String(action?.abilityText || ''),
    );
    if (exileReason === 'none' || (exileReason === 'setup' && mode === 'response')) {
      return false;
    }
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
  const isChargeInvest = isAIManaBatteryChargeInvestAction(permanent, action, game.state?.battlefield);

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

  // Never pay a charge ability with that permanent's own remove-counter mana.
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
  const { setAIActionDebugStage } = await import('./aiScheduler.js');
  // Prefer explicit gameId on the query when present (InMemoryGame often has no .id).
  const stageGameId = String((query as any).gameId || gameIdFromGame(game) || 'unknown');
  const stage = (label: string) => setAIActionDebugStage(stageGameId, playerId, `enum:${query.mode}:${label}`);
  const kinds = getAIActionCandidateKinds(query);
  const candidates: AIActionCandidate[] = [];
  const willNeedToDiscard = query.willNeedToDiscard === true;
  stage('start');

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
    stage('abilities');
    const abilityCandidate = await getAIActivatedAbilityCandidate(
      game,
      playerId,
      willNeedToDiscard,
      query.mode === 'response' ? 'response' : 'main',
    );
    stage('abilities-done');
    if (abilityCandidate) {
      const confidenceBonus = Math.round(Number(abilityCandidate.confidence || 0) * 10);
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const abilityPermanent = battlefield.find(
        (entry: any) => String(entry?.id || '') === String(abilityCandidate.action?.permanentId || ''),
      );
      const isBatteryChargeInvest = abilityPermanent
        ? isAIManaBatteryChargeInvestAction(abilityPermanent, abilityCandidate.action, battlefield)
        : false;
      // Battery charge is spare-mana / color-fixing — sit below real casts (base 320+)
      // and commanders (650+), but above "nothing" so leftover mana still stocks the battery.
      // Graveyard exile that only sets up a later cast also sits below hand spells.
      // Denying a recovery stays at the normal ability rank so it answers the threat.
      const exileReason = isSingleCardGraveyardExileAbility(String(abilityCandidate.action?.abilityText || ''))
        ? classifySingleCardGraveyardExile(
          game.state,
          String(playerId),
          abilityPermanent,
          String(abilityCandidate.action?.abilityText || ''),
        )
        : null;
      const basePriority = exileReason && exileReason !== 'deny-recovery'
        ? (query.mode === 'response' ? 210 : 190)
        : query.mode === 'response'
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
    stage('commander');
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
    stage('spells');
    const spellCandidates = findCastableSpells(game, playerId, { responseOnly: query.mode === 'response' });
    stage(`spells-done:${spellCandidates.length}`);
    for (const spellCandidate of spellCandidates) {
      candidates.push({
        kind: 'cast_spell',
        priority: (query.mode === 'response' ? 420 : 320) + Math.max(0, spellCandidate.priority),
        spell: spellCandidate,
      });
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  stage(`done:${candidates.length}`);
  return applyBrain(game, playerId, query, candidates);
}

function gameIdFromGame(game: any): string {
  return String(game?.id || game?.gameId || game?.state?.gameId || 'unknown');
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
  maxWaitMs: number = 250,
): Promise<boolean> {
  // Real wall clock + node:timers — vitest fakes Date/setTimeout for AI scheduling.
  // A stuck _completingSpellCastByPlayer marker used to burn 2s×N cast attempts inside
  // one tick (selfplay-1000-20-1 MAIN1 tick-timeout).
  const { setTimeout: realSetTimeout } = await import('node:timers');
  const { clearPlayerCompletingSpellCast } = await import('../game-actions-handlers/gameActionsSpellCastLock.js');
  const startedAt = process.hrtime.bigint();
  const budgetNs = BigInt(Math.max(1, maxWaitMs)) * 1_000_000n;
  while (process.hrtime.bigint() - startedAt < budgetNs) {
    if (!isPlayerCompletingSpellCast(game, playerId)) {
      break;
    }
    await new Promise<void>((resolve) => {
      realSetTimeout(() => resolve(), 25).unref?.();
    });
  }

  // Marker never cleared (cast aborted mid-prompt): drop it so later attempts cannot
  // serialize another real-time wait budget inside the same exclusive AI action.
  if (isPlayerCompletingSpellCast(game, playerId)) {
    debugWarn(1, '[AI] Clearing stuck completing-spell-cast marker after settle wait', {
      gameId,
      playerId,
      cardId,
    });
    clearPlayerCompletingSpellCast(game, playerId, cardId);
    clearPlayerCompletingSpellCast(game, playerId);
  }

  return didAICastAttemptChangeControlFlow(gameId, game, playerId, { card: { id: cardId }, sourceZone }, before);
}

type FailedResponseAbilityWindow = {
  fingerprint: string;
  keys: Set<string>;
};

const failedResponseAbilityWindows = new Map<string, FailedResponseAbilityWindow>();

type ResponseActionsTakenWindow = {
  fingerprint: string;
  count: number;
};

/** Successful response actions per seat per phase/step/stack window (caps END/MAIN churn). */
const responseActionsTakenWindows = new Map<string, ResponseActionsTakenWindow>();

function getAIResponseAbilityWindowFingerprint(game: any): string {
  return [
    String(game?.state?.phase || ''),
    String(game?.state?.step || ''),
    String(game?.state?.turnPlayer || ''),
    String(Array.isArray(game?.state?.stack) ? game.state.stack.length : 0),
  ].join('|');
}

function getAIResponseActionsTaken(gameId: string, playerId: string, game: any): number {
  const existing = responseActionsTakenWindows.get(`${gameId}:${playerId}`);
  if (!existing || existing.fingerprint !== getAIResponseAbilityWindowFingerprint(game)) return 0;
  return existing.count;
}

function noteAIResponseActionTaken(gameId: string, playerId: string, game: any): void {
  const fingerprint = getAIResponseAbilityWindowFingerprint(game);
  const windowKey = `${gameId}:${playerId}`;
  const existing = responseActionsTakenWindows.get(windowKey);
  if (!existing || existing.fingerprint !== fingerprint) {
    responseActionsTakenWindows.set(windowKey, { fingerprint, count: 1 });
    return;
  }
  existing.count += 1;
}

function maxAIResponseActionsForWindow(game: any): number {
  const stackLen = Array.isArray(game?.state?.stack) ? game.state.stack.length : 0;
  // Empty stack: at most one "response" activate/cast per seat per step, then pass.
  // Non-empty: allow a few answers before forcing pass so the stack can resolve.
  return stackLen === 0 ? 1 : 4;
}

function rememberFailedAIResponseAbility(
  gameId: string,
  game: any,
  playerId: string,
  permanentId: string,
): void {
  const id = String(permanentId || '').trim();
  if (!id) return;
  const fingerprint = getAIResponseAbilityWindowFingerprint(game);
  const windowKey = `${gameId}:${playerId}`;
  const existing = failedResponseAbilityWindows.get(windowKey);
  if (!existing || existing.fingerprint !== fingerprint) {
    failedResponseAbilityWindows.set(windowKey, { fingerprint, keys: new Set([id]) });
    return;
  }
  existing.keys.add(id);
}

function didAIResponseAbilityFailThisWindow(
  gameId: string,
  game: any,
  playerId: string,
  permanentId: string,
): boolean {
  const id = String(permanentId || '').trim();
  if (!id) return false;
  const existing = failedResponseAbilityWindows.get(`${gameId}:${playerId}`);
  return Boolean(
    existing
    && existing.fingerprint === getAIResponseAbilityWindowFingerprint(game)
    && existing.keys.has(id),
  );
}

export async function tryAIResponseActions(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  game: any,
): Promise<boolean> {
  const { setAIActionDebugStage } = await import('./aiScheduler.js');
  const stage = (label: string) => setAIActionDebugStage(gameId, playerId, `response:${label}`);
  stage('enter');
  const responseContext = getAIActionContext(game);
  if (!canRespond(responseContext, playerId)) {
    stage('cannot-respond');
    return false;
  }

  const responseActionCap = maxAIResponseActionsForWindow(game);
  if (getAIResponseActionsTaken(gameId, String(playerId), game) >= responseActionCap) {
    stage(`window-cap:${responseActionCap}`);
    return false;
  }

  stage('enumerate');
  const responseCandidates = await enumerateAIActionCandidates(game, playerId, {
    mode: 'response',
    gameId,
  } as any);
  stage(`enumerate-done:${responseCandidates.length}`);
  const responseTraceCandidates = candidatesFromAIActionList(responseCandidates);
  const responseShadow = takeShadow(responseCandidates);
  const recordResponseChoice = (chosen: number | null, note?: string) => {
    recordDecision({
      ...traceContextFromGame(game, gameId, playerId),
      kind: 'response',
      candidates: responseTraceCandidates,
      chosen,
      note,
      shadow: responseShadow,
    });
  };

  for (let candidateIndex = 0; candidateIndex < responseCandidates.length; candidateIndex++) {
    const candidate = responseCandidates[candidateIndex];
    if (candidate.kind === 'activate_ability') {
      const permanentId = String(candidate.ability.action?.permanentId || '');
      const abilityName = String(candidate.ability.action?.cardName || permanentId || 'ability');
      if (didAIResponseAbilityFailThisWindow(gameId, game, playerId, permanentId)) {
        debugWarn(1, '[AI] Skipping previously failed response-window ability this priority window', {
          gameId,
          playerId,
          permanentId,
          cardName: candidate.ability.action?.cardName,
        });
        continue;
      }

      debug(1, '[AI] Taking response-window activated ability:', candidate.ability.action.cardName);
      stage(`activate:${abilityName}`);
      // continueAfterResolution=false so shared activation drains prompts inline; we must
      // still wake this seat afterward or beginning/UPKEEP returns with priority held and
      // no timer (self-play soft-deadlock after a successful response activate).
      if (await executeAIActivateAbility(io, gameId, playerId, candidate.ability.action, false)) {
        noteAIResponseActionTaken(gameId, String(playerId), game);
        recordResponseChoice(candidateIndex);
        stage(`activate-ok:${abilityName}`);
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return true;
      }

      rememberFailedAIResponseAbility(gameId, game, playerId, permanentId);
      debugWarn(1, '[AI] Response-window ability candidate produced no state change; continuing to next response option', {
        gameId,
        playerId,
        permanentId,
        cardName: candidate.ability.action?.cardName,
      });
      continue;
    }

    if (candidate.kind === 'cast_spell') {
      const candidateSpell = candidate.spell;
      const spellName = String(candidateSpell.castCard?.name || candidateSpell.card?.name || 'spell');
      debug(1, '[AI] Taking response-window spell action:', {
        name: spellName,
        sourceZone: candidateSpell.sourceZone,
        priority: candidateSpell.priority,
      });

      stage(`cast:${spellName}`);
      const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
      const castProgressed = await executeAICastSpell(io, gameId, playerId, candidateSpell);
      if (castProgressed) {
        noteAIResponseActionTaken(gameId, String(playerId), game);
        recordResponseChoice(candidateIndex);
        stage(`cast-ok:${spellName}`);
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return true;
      }

      if (didAICastAttemptChangeControlFlow(gameId, game, playerId, candidateSpell, beforeCast)) {
        noteAIResponseActionTaken(gameId, String(playerId), game);
        recordResponseChoice(candidateIndex, 'control-flow-changed');
        stage(`cast-flow:${spellName}`);
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return true;
      }
    }

    if (candidate.kind === 'cast_commander') {
      const commanderName = String(candidate.commander.card.name || 'commander');
      debug(1, '[AI] Taking response-window commander action:', commanderName);
      stage(`cast-commander:${commanderName}`);
      const beforeCast = captureAICastControlFlowSnapshot(gameId, game, playerId);
      const castProgressed = await executeAICastCommander(io, gameId, playerId, candidate.commander);
      if (castProgressed) {
        noteAIResponseActionTaken(gameId, String(playerId), game);
        recordResponseChoice(candidateIndex);
        stage(`cast-commander-ok:${commanderName}`);
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return true;
      }

      if (didAICastAttemptChangeControlFlow(gameId, game, playerId, {
        card: candidate.commander.card,
        sourceZone: 'command',
      }, beforeCast)) {
        noteAIResponseActionTaken(gameId, String(playerId), game);
        recordResponseChoice(candidateIndex, 'control-flow-changed');
        stage(`cast-commander-flow:${commanderName}`);
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
        return true;
      }
    }
  }

  stage('none');
  return false;
}
