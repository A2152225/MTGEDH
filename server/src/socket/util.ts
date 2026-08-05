// server/src/socket/util.ts
// Socket helper utilities used by server socket handlers.
// Provides: ensureGame (create/replay), broadcastGame, appendGameEvent,
// priority timer scheduling (schedulePriorityTimeout + doAutoPass),
// clearPriorityTimer, parseManaCost helper, and transformDbEventsForReplay.
//
// This is a full-file authoritative implementation (no truncation).
//
// NOTE: Small, safe additions: normalizeViewForEmit + ensureStateZonesForPlayers
// and env-gated verbose logging when DEBUG_STATE=1.

import type { Server } from "socket.io";
import { sumActiveTemporaryPTMods } from "../state/modules/temporaryPtMods.js";
import { syncDerivedContinuousEffects } from "../state/modules/staticEffectSpec.js";
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket.js";
import { appendEvent, createGameIfNotExists, getEvents, gameExistsInDb } from "../db/index.js";
import { createInitialGameState } from "../state/index.js";
import type { InMemoryGame } from "../state/types.js";
import { GameManager } from "../GameManager.js";
import type { CardCostAdjustment, GameID, PlayerID, ManaPool, RestrictedManaEntry, ManaRestrictionType } from "../../../shared/src/index.js";
import { getEffectiveBasicLandTypes, manaColorForBasicLandType } from "../../../shared/src/landTypes.js";
import { getActualPowerToughness, calculateAllPTBonuses, uid, cardManaValue } from "../state/utils.js";
import { registerTokenGroupMembers } from "./tokenGroupResolve.js";
import { getDevotionManaAmount, getCreatureCountManaAmount, getManaAbilitiesForPermanent, getMoxAmberAvailableColors, isMoxAmberConditionalManaSource, resolvePermanentChosenColorSymbol, parseManaSpendRestrictionFromOracle, getCommanderColorIdentity, getOpponentLandProducibleColorSymbols } from "../state/modules/mana-abilities.js";
import { canRespond, canAct, getCastableCommanderCandidates, getCastableSpellCandidates, getCostAdjustmentInfo, getHandCastEvaluationCards, getPlayableLandCandidates, hasSacrificePrefixActivatedAbility, isPlayerIdleForAutoPass, isTransformBackFace, type SharedSpellCastCandidate } from "../state/modules/can-respond.js";
import { getGrantedCastFromGraveyardKeywordInfo, getGrantedEmbalmInfo, getGrantedFlashbackInfo, getGrantedUnearthInfo, getPrintedUnearthInfo } from "../state/modules/graveyard-permissions.js";
import { parseManaCost as parseManaFromString, canPayManaCostWithAvailableSources, getManaPoolFromState, getAvailableMana, getTotalManaFromPool, stripReminderTextFromOracle } from "../state/modules/mana-check.js";
import { hasPayableAlternateCost } from "../state/modules/alternate-costs.js";
import { calculateCostReduction, creatureHasHaste, runPostResolutionPermanentPromptChecks } from "./game-actions.js";
import { checkSpellTimingRestriction } from "../../../rules-engine/src/castingRestrictions.js";
import { hasValidTargetsForSpell } from "../rules-engine/target-availability.js";
import { applyStaticAbilitiesToBattlefield } from "../../../rules-engine/src/staticAbilities.js";
import { emitPendingCombatDamageChat } from "./combatLogUtils.js";
import {
  formatGameOverDrawMessage,
  formatGameOverVictoryMessage,
  formatPlayerEliminatedMessage,
} from "../../../shared/src/gameLogFormat.js";
import { canCastFromTop } from "../state/modules/game-state-effects.js";
import { cardHasCreatureType, getCreatureTypesNow } from "../state/creatureTypeNow.js";
import { movePermanentToGraveyard } from "../state/modules/counters_tokens.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../state/modules/graveyardEntryUtils.js";
import { debug, debugWarn, debugError, debugEnv } from "../utils/debug.js";
import { BOOT_ID } from "../utils/bootId.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { tryQueueMoxDiamondBeforeStackResolve } from "../state/modules/mox-diamond-choice.js";
import { pruneObsoleteResolutionQueueAfterReplay } from "../state/resolution/replayCleanup.js";
import { isSpellCastingProhibitedByChosenName } from "../state/modules/chosen-name-restrictions.js";
import { getTopTriggeredAbilityAutoPassReason } from "./trigger-shortcuts.js";
import { advanceStepPersistingEvent } from "./step-advance.js";
import { evaluateLibrarySearchReplacementEvent } from "../state/modules/replacement-effects.js";
import { battlefieldPermanentInstanceCount, countControlledCreaturesOfChosenType } from "../state/modules/chosen-creature-type.js";
import { repairNonPermanentBattlefieldGhosts, isImpossibleFaceUpNonPermanentBattlefieldCard } from "../state/modules/stackReplayUtils.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Delay in milliseconds before auto-passing priority for human players.
 * This gives them a brief moment to evaluate board state and claim priority.
 * AI players and "Auto-Pass Rest of Turn" skip this delay for faster gameplay.
 */
const AUTO_PASS_DELAY_MS = 150;

/**
 * Smart Pass may skip the idle/canRespond check only when the top stack object
 * is controlled by the priority player (so floating mana does not stall their
 * own spells). Opponent-controlled objects fail closed and require a real response check.
 */
function topStackObjectControlledByPlayer(state: any, playerId: string): boolean {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  if (stack.length === 0) return false;
  const top = stack[stack.length - 1];
  const controller = String(top?.controller || '').trim();
  if (!controller) return false;
  return controller === String(playerId || '').trim();
}

/**
 * Whether Smart Pass / loop-drain may bypass idle checks for a nonempty stack.
 * Explicit rest-of-turn and loop-drain bypass idle only while the stack is
 * non-empty; ordinary Smart Pass only bypasses for the player's own top stack
 * object. Loop drain must not force empty-stack passes on the active player's
 * main phase (that ping-pongs with opponents who report canRespond).
 */
function shouldBypassIdleForNonEmptyStack(options: {
  stackLen: number;
  autoPassEnabled: boolean;
  loopStackDrain: boolean;
  autoPassForTurn: boolean;
  state: any;
  playerId: string;
}): boolean {
  const { stackLen, autoPassEnabled, loopStackDrain, autoPassForTurn, state, playerId } = options;
  if (stackLen <= 0) return false;
  if (loopStackDrain || autoPassForTurn) return true;
  if (!autoPassEnabled) return false;
  return topStackObjectControlledByPlayer(state, playerId);
}

/** Loop drain may skip idle checks only while there is something to resolve. */
function isLoopStackDrainActive(loopStackDrain: boolean, stackLen: number): boolean {
  return loopStackDrain && stackLen > 0;
}

const LAND_PLAY_AUTOMATION_SUPPRESSION_MS = 600;

type PendingHumanAutoPass = {
  playerId: PlayerID;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingAutomationResume = {
  suppressUntil: number;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingHumanAutoPassTimers = new Map<string, PendingHumanAutoPass>();
const pendingAutomationResumeTimers = new Map<string, PendingAutomationResume>();

function clearScheduledHumanAutoPass(gameId: string, playerId?: PlayerID | string | null) {
  const pending = pendingHumanAutoPassTimers.get(gameId);
  if (!pending) return;
  if (playerId && pending.playerId !== playerId) return;
  clearTimeout(pending.timeout);
  pendingHumanAutoPassTimers.delete(gameId);
}

export function clearScheduledHumanAutoPassForGame(gameId: string): void {
  clearScheduledHumanAutoPass(gameId);
}

function clearScheduledAutomationResume(gameId: string): void {
  const pending = pendingAutomationResumeTimers.get(gameId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingAutomationResumeTimers.delete(gameId);
}

function scheduleAutomationResume(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  suppressUntil: number,
): void {
  const remainingMs = suppressUntil - Date.now();
  if (remainingMs <= 0) {
    const stateAny = (game.state as any) || {};
    if (Number(stateAny._suppressAutomationUntil || 0) === suppressUntil) {
      delete stateAny._suppressAutomationUntil;
    }
    clearScheduledAutomationResume(gameId);
    checkAndTriggerAI(io, game, gameId);
    checkAndTriggerAutoPass(io, game, gameId);
    return;
  }

  const existing = pendingAutomationResumeTimers.get(gameId);
  if (existing?.suppressUntil === suppressUntil) {
    return;
  }

  clearScheduledAutomationResume(gameId);
  const timeout = setTimeout(() => {
    const pending = pendingAutomationResumeTimers.get(gameId);
    if (!pending || pending.suppressUntil !== suppressUntil) {
      return;
    }
    pendingAutomationResumeTimers.delete(gameId);

    const stateAny = (game.state as any) || {};
    const currentSuppressUntil = Number(stateAny._suppressAutomationUntil || 0);
    if (currentSuppressUntil !== suppressUntil) {
      return;
    }

    if (Date.now() < suppressUntil) {
      scheduleAutomationResume(io, game, gameId, suppressUntil);
      return;
    }

    delete stateAny._suppressAutomationUntil;
    debug(2, `${ts()} [broadcastGame] Resuming deferred automation for ${gameId} after ${suppressUntil}`);
    checkAndTriggerAI(io, game, gameId);
    checkAndTriggerAutoPass(io, game, gameId);
  }, remainingMs);

  pendingAutomationResumeTimers.set(gameId, {
    suppressUntil,
    timeout,
  });
}

export function suppressAutomationOnNextBroadcast(game: InMemoryGame, delayMs = 0): void {
  try {
    const stateAny = (game.state as any) || {};
    stateAny._suppressAutomationOnNextBroadcast = true;
    if (delayMs > 0) {
      stateAny._suppressAutomationUntil = Date.now() + delayMs;
    } else {
      delete stateAny._suppressAutomationUntil;
    }
  } catch {
    // best-effort only
  }
}

export function pauseHumanAutoPassUntilAction(
  game: InMemoryGame,
  playerId?: PlayerID | string | null,
): void {
  try {
    const stateAny = (game.state as any) || {};
    const pausedPlayerId = String(playerId || stateAny.turnPlayer || '').trim();
    if (!pausedPlayerId) return;
    stateAny._pauseHumanAutoPassUntilActionFor = pausedPlayerId;

    const gameId = String((game as any)?.gameId || '').trim();
    if (gameId) {
      clearScheduledHumanAutoPass(gameId, pausedPlayerId);
    }
  } catch {
    // best-effort only
  }
}

export function clearHumanAutoPassPauseOnAction(
  game: InMemoryGame,
  playerId?: PlayerID | string | null,
  reason = 'action',
  // When true, also clears the "auto-pass rest of turn" flag. Set this for genuinely
  // voluntary player-initiated actions (ability activation, spell casting, land play) so
  // that the auto-pass preference is reset after the player re-engages with the game.
  clearAutoPassForTurn = false,
): boolean {
  try {
    const stateAny = (game.state as any) || {};
    const actingPlayerId = String(playerId || '').trim();

    // Clear autoPassForTurn when a player takes a voluntary action.
    // If the player actively chose to do something, they are no longer in "auto-pass rest of turn" mode.
    if (clearAutoPassForTurn && actingPlayerId && stateAny.autoPassForTurn?.[actingPlayerId]) {
      delete stateAny.autoPassForTurn[actingPlayerId];
      debug(2, `${ts()} [auto-pass] Cleared autoPassForTurn for ${actingPlayerId} after voluntary ${reason}`);
    }

    const pausedPlayerId = String(stateAny._pauseHumanAutoPassUntilActionFor || '').trim();
    if (!pausedPlayerId || !actingPlayerId || pausedPlayerId !== actingPlayerId) {
      return false;
    }

    delete stateAny._pauseHumanAutoPassUntilActionFor;

    const gameId = String((game as any)?.gameId || '').trim();
    if (gameId) {
      clearScheduledHumanAutoPass(gameId, actingPlayerId);
    }

    debug(2, `${ts()} [auto-pass] Cleared undo auto-pass pause for ${actingPlayerId} after ${reason}`);
    return true;
  } catch {
    return false;
  }
}

export { LAND_PLAY_AUTOMATION_SUPPRESSION_MS };

/**
 * Timeout for clearing the priority restoration flag.
 * This prevents recursive broadcasts when restoring stuck priority.
 */
const PRIORITY_RESTORE_FLAG_TIMEOUT_MS = 100;

// ============================================================================
// Pre-compiled RegExp patterns for mana color matching in devotion calculations
// Optimization: Created once at module load instead of inside loops
// ============================================================================
const DEVOTION_COLOR_PATTERNS: Record<string, RegExp> = {
  W: /\{W\}/gi,
  U: /\{U\}/gi,
  B: /\{B\}/gi,
  R: /\{R\}/gi,
  G: /\{G\}/gi,
};

/**
 * Mana color keys used in ManaPool interface
 * Extracted as constant to ensure consistency across mana pool operations
 */
const MANA_COLOR_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
type ManaColorKey = typeof MANA_COLOR_KEYS[number];

// ============================================================================
// Helper function for timestamps in debug logging
// ============================================================================
function ts() {
  return new Date().toISOString();
}

function parseSpelledOutAmount(rawAmount: string): number | undefined {
  const normalized = String(rawAmount || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const wordToAmount: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  return wordToAmount[normalized];
}

function repairMissingPriorityIfStuck(
  game: InMemoryGame,
  gameId: string,
  logScope: string,
  debugCallId?: string,
): boolean {
  const stateAny = (game.state as any) || {};
  if (stateAny.priority) return false;

  const phase = String(stateAny?.phase || '').toLowerCase();
  const step = String(stateAny?.step || '').toUpperCase();
  if (phase === 'pre_game' || phase === 'pre-game') return false;
  if (['UNTAP', 'CLEANUP'].includes(step)) return false;

  const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (pendingSummary.hasPending) return false;

  const turnPlayer = String(stateAny.turnPlayer || '').trim();
  if (!turnPlayer) return false;

  debugWarn(1, `${ts()} ${logScope} STUCK STATE DETECTED: Priority is null in ${phase}/${step} with no pending resolution steps!`, {
    bootId: BOOT_ID,
    gameId,
    debugCallId,
    phase,
    step,
  });
  debugWarn(1, `${ts()} ${logScope} Restoring priority to turn player to fix stuck game${debugCallId ? ` (ID: ${debugCallId})` : ''}`, {
    bootId: BOOT_ID,
    gameId,
    debugCallId,
  });

  stateAny.priority = turnPlayer;
  stateAny._priorityJustRestored = true;
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  setTimeout(() => {
    delete stateAny._priorityJustRestored;
  }, PRIORITY_RESTORE_FLAG_TIMEOUT_MS);

  debug(1, `${ts()} ${logScope} Priority restored to ${turnPlayer}`);
  return true;
}

/* ------------------- Event transformation helpers ------------------- */

/**
 * Transform events from DB format { type, payload } to replay format { type, ...payload }
 * This is used when replaying events after a server restart or during undo.
 * 
 * DB format: { type: 'playLand', payload: { playerId: 'p1', cardId: 'c1' } }
 * Replay format: { type: 'playLand', playerId: 'p1', cardId: 'c1' }
 */
export function transformDbEventsForReplay(events: Array<{ type: string; payload?: any }>): any[] {
  return events.map((e: any) =>
    e && e.type
      ? e.payload && typeof e.payload === "object"
        ? { type: e.type, ...(e.payload as any) }
        : { type: e.type }
      : e
  );
}

/* ------------------- Defensive normalization helpers ------------------- */

/** canonical minimal zone shape for a player */
function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

/**
 * Ensure authoritative in-memory game.state.zones has entries for all players.
 */
function ensureStateZonesForPlayers(game: any) {
  try {
    if (!game) return;
    game.state = (game.state || {}) as any;
    game.state.players = game.state.players || [];
    game.state.zones = game.state.zones || {};
    for (const p of game.state.players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!game.state.zones[pid]) game.state.zones[pid] = defaultPlayerZones();
      else {
        const z = game.state.zones[pid];
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.handCount =
          typeof z.handCount === "number"
            ? z.handCount
            : Array.isArray(z.hand)
            ? z.hand.length
            : 0;
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount =
          typeof z.libraryCount === "number"
            ? z.libraryCount
            : Array.isArray(z.library)
            ? z.library.length
            : 0;
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount =
          typeof z.graveyardCount === "number"
            ? z.graveyardCount
            : Array.isArray(z.graveyard)
            ? z.graveyard.length
            : 0;
      }
    }

    // Intervening-if baseline trackers: make per-player entries exist early
    // so templates can return deterministic false/0 instead of null before the first turn transition.
    const stateAny = game.state as any;
    stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
    stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
    stateAny.descendedThisTurn = stateAny.descendedThisTurn || {};
    stateAny.permanentLeftBattlefieldThisTurn = stateAny.permanentLeftBattlefieldThisTurn || {};
    stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};

    stateAny.attackedPlayersLastTurnByPlayer = stateAny.attackedPlayersLastTurnByPlayer || {};
    stateAny.attackedYouLastTurnByPlayer = stateAny.attackedYouLastTurnByPlayer || {};
    stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts = stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts || {};
    stateAny.creaturesEnteredBattlefieldLastTurnByController = stateAny.creaturesEnteredBattlefieldLastTurnByController || {};
    if (typeof stateAny.spellsCastLastTurnCount !== 'number') stateAny.spellsCastLastTurnCount = 0;
    if (stateAny.spellsCastLastTurnByPlayerCounts === undefined) stateAny.spellsCastLastTurnByPlayerCounts = {};

    for (const p of stateAny.players as any[]) {
      const pid = String(p?.id ?? p?.playerId ?? '').trim();
      if (!pid) continue;

      if (typeof stateAny.tookCombatDamageSinceLastTurn[pid] !== 'boolean') stateAny.tookCombatDamageSinceLastTurn[pid] = false;
      if (typeof stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] !== 'boolean') stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] = false;
      if (typeof stateAny.descendedThisTurn[pid] !== 'boolean') stateAny.descendedThisTurn[pid] = false;
      if (typeof stateAny.permanentLeftBattlefieldThisTurn[pid] !== 'boolean') stateAny.permanentLeftBattlefieldThisTurn[pid] = false;
      if (!Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[pid])) stateAny.attackedPlayersThisTurnByPlayer[pid] = [];

      if (!Array.isArray(stateAny.attackedPlayersLastTurnByPlayer[pid])) stateAny.attackedPlayersLastTurnByPlayer[pid] = [];
      if (!stateAny.attackedYouLastTurnByPlayer[pid] || typeof stateAny.attackedYouLastTurnByPlayer[pid] !== 'object') {
        stateAny.attackedYouLastTurnByPlayer[pid] = {};
      }
      if (typeof stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] !== 'number') stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] = 0;
      if (typeof stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] !== 'number') stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] = 0;
      if (stateAny.spellsCastLastTurnByPlayerCounts && typeof stateAny.spellsCastLastTurnByPlayerCounts === 'object') {
        if (typeof stateAny.spellsCastLastTurnByPlayerCounts[pid] !== 'number') stateAny.spellsCastLastTurnByPlayerCounts[pid] = 0;
      }
    }
  } catch (e) {
    debugWarn(1, "ensureStateZonesForPlayers failed:", e);
  }
}

/**
 * Mill cards from the top of a player's library until a land is revealed.
 * Moves all revealed cards to the graveyard and returns the milled cards.
 */
export function millUntilLand(
  game: any,
  targetPlayerId: string
): { milled: any[]; landHit?: any } {
  const result = { milled: [] as any[], landHit: undefined as any };
  try {
    const zones = game.state?.zones?.[targetPlayerId];
    if (!zones || !Array.isArray(zones.library)) return result;
    
    zones.graveyard = zones.graveyard || [];
    const millCtx = {
      state: game.state,
      libraries: game.libraries,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      rng: game.rng,
      gameId: game.gameId || game.id,
    } as any;
    
    while (zones.library.length > 0) {
      const card = zones.library.shift();
      if (!card) break;
      result.milled.push(card);
      const isLand = (card.type_line || "").toLowerCase().includes("land");
      pushCardToPlayerGraveyardWithReplacements(millCtx, targetPlayerId, card, zones.graveyard);
      if (isLand) {
        result.landHit = card;
        break;
      }
    }
    
    zones.libraryCount = zones.library?.length ?? zones.libraryCount;
    zones.graveyardCount = zones.graveyard?.length ?? zones.graveyardCount;
  } catch (err) {
    if (process.env.DEBUG_STATE) {
      debugWarn(1, "[millUntilLand] Error milling:", err);
    }
  }
  return result;
}

/**
 * Get IDs of cards/permanents that the player can currently play or activate
 * This is used for UI highlighting to show players their available options
 * Includes: cards in hand, battlefield abilities, foretell cards in exile, 
 * playable cards from graveyard/exile/top deck, etc.
 * 
 * NOTE: Checks both affordability AND timing to ensure automation works correctly.
 */
function getPlayableCardIds(game: InMemoryGame, playerId: PlayerID): string[] {
  const playableIds: string[] = [];
  
  try {
    const state = game.state;
    if (!state) {
      debug(2, `[getPlayableCardIds] No state for player ${playerId}`);
      return playableIds;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[getPlayableCardIds] No zones for player ${playerId}`);
      return playableIds;
    }
    
    const isMainPhase = isInMainPhase(state);
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const turnPlayer = state.turnPlayer;
    const isMyTurn = turnPlayer === playerId;

    const spellCandidateMode = isMainPhase && stackIsEmpty && isMyTurn ? 'main' : 'response';
    const sharedSpellCandidates = getCastableSpellCandidates({
      state,
      libraries: (game as any).libraries,
    } as any, playerId, {
      mode: spellCandidateMode,
      allowUnknownCostFallback: false,
      conservativeTargets: false,
    });

    const highlightedSpellIds = new Set<string>();
    for (const candidate of sharedSpellCandidates) {
      const playableId = candidate.sourceZone === 'library'
        ? `library-${playerId}`
        : String(candidate.card?.id || candidate.castCard?.id || '').trim();
      if (!playableId || highlightedSpellIds.has(playableId)) continue;
      highlightedSpellIds.add(playableId);
      playableIds.push(playableId);
    }
    
    // Check for playable lands from any supported zone (during main phase with empty stack)
    if (isMainPhase && stackIsEmpty && isMyTurn) {
      const playableLandCandidates = getPlayableLandCandidates({
        state,
        libraries: (game as any).libraries,
      } as any, playerId);

      const highlightedLandIds = new Set<string>();
      for (const candidate of playableLandCandidates) {
        const playableId = candidate.sourceZone === 'library'
          ? `library-${playerId}`
          : String(candidate.card?.id || '');
        if (!playableId || highlightedLandIds.has(playableId)) continue;
        highlightedLandIds.add(playableId);
        playableIds.push(playableId);
      }
    }
    
    const commanderCandidates = getCastableCommanderCandidates({
      state,
      libraries: (game as any).libraries,
    } as any, playerId as any);
    for (const candidate of commanderCandidates) {
      const canCastNow = candidate.grantsFlash || (isMainPhase && stackIsEmpty && isMyTurn);
      if (!canCastNow) continue;

      const commanderId = String(candidate.commanderId || candidate.card?.id || '').trim();
      if (!commanderId || playableIds.includes(commanderId)) continue;
      playableIds.push(commanderId);
    }
    
    if (Array.isArray(zones.graveyard)) {
      const battlefield = state.battlefield || [];
      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        if (!isMyTurn || !isMainPhase || !stackIsEmpty) continue;

        const printedUnearthInfo = getPrintedUnearthInfo(card);
        const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo({ state } as any, playerId, card);
        if (!printedUnearthInfo.hasIt && !grantedUnearthInfo.hasIt) continue;

        const unearthCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || '').trim();
        if (!unearthCost) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
          continue;
        }

        const parsedCost = parseManaFromString(unearthCost);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
        }
      }

      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        if (!isMyTurn || !isMainPhase || !stackIsEmpty) continue;

        const grantedEmbalmInfo = getGrantedEmbalmInfo({ state } as any, playerId, card);
        if (!grantedEmbalmInfo.hasIt) continue;

        const embalmCost = String(grantedEmbalmInfo.cost || '').trim();
        if (!embalmCost) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
          continue;
        }

        const parsedCost = parseManaFromString(embalmCost);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          if (!playableIds.includes(card.id)) playableIds.push(card.id);
        }
      }
      
      // Check graveyard for cards with activated abilities that can be used from there
      // Examples: Magma Phoenix "{3}{R}{R}: Return this card from your graveyard to your hand."
      // IMPORTANT: Only highlight cards that are ACTUALLY in the graveyard, not on battlefield
      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        
        // Skip this card if it's also on the battlefield
        // This prevents highlighting abilities like Magma Phoenix's graveyard return when it's on battlefield
        const isOnBattlefield = battlefield.some((perm: any) => 
          perm.card?.id === card.id || perm.card?.name === card.name
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        const oracleText = (card.oracle_text || "").replace(/\([^)]*\)/g, "");
        
        // Look for activated abilities that mention graveyard in the effect
        // Pattern: "{Cost}: [Effect mentions graveyard]"
        const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
        const matches = [...oracleText.matchAll(activatedAbilityPattern)];
        
        let hasGraveyardAbility = false;
        for (const match of matches) {
          const costPart = match[1];
          const effectPart = match[2];
          
          // Check if the effect mentions "from your graveyard" or "from a graveyard"
          if (effectPart.toLowerCase().includes("graveyard")) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasGraveyardAbility = true;
              break;
            }
          }
        }
        
        if (hasGraveyardAbility) {
          playableIds.push(card.id);
        }
      }
    }
    
    // Check battlefield for activatable abilities
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      
      const oracleText = stripReminderTextFromOracle(perm.card?.oracle_text || "");
      let hasActivatableAbility = false;
      
      // Check for tap abilities
      if (/\{T\}:/.test(oracleText) && !perm.tapped) {
        const abilityMatch = oracleText.match(/\{T\}(?:,\s*([^:]+))?:\s*(.+)/i);
        if (abilityMatch) {
          const effect = abilityMatch[2] || "";
          const effectLower = effect.toLowerCase();
          
          // Skip pure mana abilities (they don't require priority)
          const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                    !/target/i.test(effect);
          
          if (!isPureManaAbility) {
            hasActivatableAbility = true;
          }
        }
      }
      
      // Check for other activated abilities with costs
      const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
      const matches = [...oracleText.matchAll(activatedAbilityPattern)];
      
      for (const match of matches) {
        const costPart = match[1];
        const effectPart = match[2];
        
        // Skip if already checked (tap ability)
        if (costPart.includes("{T}")) continue;
        
        // Skip pure mana abilities
        const effectLower = effectPart.toLowerCase();
        const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                  !/target/i.test(effectPart);
        
        if (isPureManaAbility) continue;
        
        // Check for sorcery-speed-only abilities (equip, reconfigure, etc.)
        if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // Check for explicit sorcery-speed restriction
        if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // {Q} untap cost (e.g. Gilder Bairn): the permanent must be tapped to pay the untap
        // symbol. parseManaFromString ignores {Q}, so gate on tapped state here too.
        if (/\{Q\}/i.test(costPart)) {
          if (!perm.tapped) continue;
          const permTypeLine = (perm.card?.type_line || "").toLowerCase();
          const isCreature = /\bcreature\b/.test(permTypeLine);
          const isLand = permTypeLine.includes("land");
          if (isCreature && !isLand && (perm as any).summoningSickness) {
            if (!creatureHasHaste(perm, battlefield, playerId)) continue;
          }
        }

        // Instant-speed abilities - check if we can pay the cost
        const parsedCost = parseManaFromString(costPart);
        if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          hasActivatableAbility = true;
          break;
        }
      }
      
      // Add permanent once if it has any activatable abilities
      if (hasActivatableAbility) {
        playableIds.push(perm.id);
        continue;
      }

      if (hasSacrificePrefixActivatedAbility({ state, libraries: (game as any).libraries } as any, playerId, perm)) {
        playableIds.push(perm.id);
      }
    }
    
  } catch (err) {
    debugWarn(1, "[getPlayableCardIds] Error:", err);
  }
  
  debug(2, `[getPlayableCardIds] Player ${playerId}: ${playableIds.length} playable option(s); step=${game.state?.step}, priority=${game.state?.priority}, hand=${Array.isArray(game.state?.zones?.[playerId]?.hand) ? game.state.zones[playerId].hand.length : 0}, availableMana=${getTotalManaFromPool(getAvailableMana(game.state, playerId))}`);
  return playableIds;
}

type GrantedPlayableGraveyardCastKeyword = 'jump-start' | 'retrace' | 'escape';

function getGrantedPlayableGraveyardCastKeywordInfo(state: any, playerId: PlayerID, card: any): { keyword: GrantedPlayableGraveyardCastKeyword; cost?: string; additionalExileCount?: number } | undefined {
  for (const keyword of ['jump-start', 'retrace', 'escape'] as GrantedPlayableGraveyardCastKeyword[]) {
    const grantedInfo = getGrantedCastFromGraveyardKeywordInfo({ state } as any, playerId, card, keyword);
    if (grantedInfo.hasIt && grantedInfo.cost) {
      return { keyword, cost: grantedInfo.cost, additionalExileCount: grantedInfo.additionalExileCount };
    }
  }
  return undefined;
}

function canPayGrantedGraveyardCastKeywordAdditionalCost(state: any, playerId: PlayerID, card: any, keywordInfo: { keyword: GrantedPlayableGraveyardCastKeyword; additionalExileCount?: number }): boolean {
  const zones = state?.zones?.[playerId];
  if (!zones) return false;

  if (keywordInfo.keyword === 'jump-start') {
    return Array.isArray(zones.hand) && zones.hand.length > 0;
  }

  if (keywordInfo.keyword === 'retrace') {
    return Array.isArray(zones.hand) && zones.hand.some((entry: any) => /\bland\b/i.test(String(entry?.type_line || entry?.typeLine || '')));
  }

  if (keywordInfo.keyword === 'escape') {
    const requiredExileCount = Number(keywordInfo.additionalExileCount || 0);
    if (requiredExileCount <= 0) return true;
    return Array.isArray(zones.graveyard)
      && zones.graveyard.filter((entry: any) => entry && String(entry.id || '') !== String(card?.id || '')).length >= requiredExileCount;
  }

  return true;
}

function buildGraveyardCastHintFromCandidate(candidate: SharedSpellCastCandidate): any {
  const costMode = String(candidate?.graveyardPermissionCostMode || 'normal').trim();
  const sourceName = String(candidate?.graveyardPermissionSourceName || '').trim();
  const cost = costMode === 'without_paying_mana_cost'
    ? ''
    : String(candidate?.manaCost || candidate?.card?.mana_cost || candidate?.castCard?.mana_cost || '').trim();

  let description = costMode === 'without_paying_mana_cost'
    ? 'Cast from graveyard without paying its mana cost'
    : cost
    ? `Cast from graveyard for ${cost}`
    : 'Cast from graveyard';

  if (sourceName) {
    description = `${description} via ${sourceName}`;
  }

  return {
    id: 'graveyard-cast',
    label: 'Cast',
    description,
    ...(cost ? { cost } : {}),
    ...(String(candidate?.graveyardPermissionId || '').trim() ? { permissionId: candidate.graveyardPermissionId } : {}),
    ...(sourceName ? { sourceName } : {}),
    costMode,
  };
}

function getGraveyardAbilityHints(game: InMemoryGame, playerId: PlayerID): Record<string, any[]> {
  const hints: Record<string, any[]> = {};

  try {
    const state = game.state;
    const zones = state?.zones?.[playerId];
    if (!state || !zones || !Array.isArray(zones.graveyard)) return hints;

    const isMainPhase = isInMainPhase(state);
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const isMyTurn = state.turnPlayer === playerId;
    const spellCandidateMode = isMainPhase && stackIsEmpty && isMyTurn ? 'main' : 'response';
    const graveyardSpellCandidates = getCastableSpellCandidates({ state, libraries: (game as any).libraries } as any, playerId, {
      mode: spellCandidateMode,
      allowUnknownCostFallback: false,
      conservativeTargets: false,
    }).filter((candidate) => String(candidate.sourceZone || '') === 'graveyard');
    const genericGraveyardCastableIds = new Set(
      graveyardSpellCandidates
        .map((candidate) => String(candidate.card?.id || candidate.castCard?.id || '').trim())
        .filter(Boolean),
    );
    const graveyardPermanentCandidatesByCardId = new Map<string, SharedSpellCastCandidate>();
    for (const candidate of graveyardSpellCandidates) {
      if (candidate.castMethod !== 'graveyard_permanent') continue;
      const cardId = String(candidate.card?.id || candidate.castCard?.id || '').trim();
      if (!cardId || graveyardPermanentCandidatesByCardId.has(cardId)) continue;
      graveyardPermanentCandidatesByCardId.set(cardId, candidate);
    }

    const addHint = (cardId: string, hint: any) => {
      if (!cardId) return;
      hints[cardId] = Array.isArray(hints[cardId]) ? hints[cardId] : [];
      if (!hints[cardId].some((entry: any) => String(entry?.id || '') === String(hint.id || ''))) {
        hints[cardId].push(hint);
      }
    };

    for (const card of zones.graveyard) {
      if (!card || typeof card === "string") continue;
      const cardId = String(card.id || '').trim();
      if (!cardId) continue;

      const grantedFlashbackInfo = getGrantedFlashbackInfo({ state } as any, playerId, card);
      if (grantedFlashbackInfo.hasIt && grantedFlashbackInfo.cost) {
        const typeLine = String(card.type_line || '').toLowerCase();
        const oracleText = String(card.oracle_text || '').toLowerCase();
        const isInstantSpeed = typeLine.includes('instant') || /\bflash\b/i.test(oracleText);
        const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty && isMyTurn);
        const parsedCost = parseManaFromString(grantedFlashbackInfo.cost);
        if (canCastNow && hasValidTargetsForSpell(state as any, playerId, card, { conservative: false }) && canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          addHint(cardId, {
            id: 'flashback',
            label: 'Cast',
            description: `Cast from graveyard for ${grantedFlashbackInfo.cost}`,
            cost: grantedFlashbackInfo.cost,
          });
        }
      }

      if (isMainPhase && stackIsEmpty && isMyTurn && !getPrintedUnearthInfo(card).hasIt) {
        const grantedUnearthInfo = getGrantedUnearthInfo({ state } as any, playerId, card);
        if (grantedUnearthInfo.hasIt && grantedUnearthInfo.cost) {
          const parsedCost = parseManaFromString(grantedUnearthInfo.cost);
          if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
            addHint(cardId, {
              id: 'unearth',
              label: 'Unearth',
              description: `Return to battlefield for ${grantedUnearthInfo.cost}`,
              cost: grantedUnearthInfo.cost,
            });
          }
        }
      }

      if (isMainPhase && stackIsEmpty && isMyTurn) {
        const grantedEmbalmInfo = getGrantedEmbalmInfo({ state } as any, playerId, card);
        if (grantedEmbalmInfo.hasIt && grantedEmbalmInfo.cost) {
          const parsedCost = parseManaFromString(grantedEmbalmInfo.cost);
          if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
            addHint(cardId, {
              id: 'embalm',
              label: 'Embalm',
              description: `Create token copy for ${grantedEmbalmInfo.cost}`,
              cost: grantedEmbalmInfo.cost,
            });
          }
        }
      }

      const grantedCastKeywordInfo = getGrantedPlayableGraveyardCastKeywordInfo(state, playerId, card);
      if (grantedCastKeywordInfo) {
        const typeLine = String(card.type_line || '').toLowerCase();
        const oracleText = String(card.oracle_text || '').toLowerCase();
        const isInstantSpeed = typeLine.includes('instant') || /\bflash\b/i.test(oracleText);
        const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty && isMyTurn);
        const parsedCost = parseManaFromString(grantedCastKeywordInfo.cost || '');
        if (
          canCastNow
          && hasValidTargetsForSpell(state as any, playerId, card, { conservative: false })
          && canPayGrantedGraveyardCastKeywordAdditionalCost(state, playerId, card, grantedCastKeywordInfo)
          && canPayManaCostWithAvailableSources(state, playerId, parsedCost)
        ) {
          const labels: Record<GrantedPlayableGraveyardCastKeyword, string> = {
            'jump-start': 'Jump-start',
            retrace: 'Retrace',
            escape: 'Escape',
          };
          addHint(cardId, {
            id: grantedCastKeywordInfo.keyword,
            label: labels[grantedCastKeywordInfo.keyword],
            description: `Cast from graveyard for ${grantedCastKeywordInfo.cost}`,
            cost: grantedCastKeywordInfo.cost,
          });
        }
      }

      const graveyardPermanentCandidate = graveyardPermanentCandidatesByCardId.get(cardId);
      if (graveyardPermanentCandidate) {
        addHint(cardId, buildGraveyardCastHintFromCandidate(graveyardPermanentCandidate));
      }

      if (
        genericGraveyardCastableIds.has(cardId)
        && !/\bland\b/i.test(String(card.type_line || ''))
      ) {
        const cost = String(card.mana_cost || '').trim();
        addHint(cardId, {
          id: 'graveyard-cast',
          label: 'Cast',
          description: cost ? `Cast from graveyard for ${cost}` : 'Cast from graveyard',
          ...(cost ? { cost } : {}),
        });
      }
    }
  } catch (err) {
    debugWarn(1, "[getGraveyardAbilityHints] Error:", err);
  }

  return hints;
}

/**
 * Check if game is in main phase
 */
function isInMainPhase(state: any): boolean {
  try {
    const step = state.step;
    if (!step) return false;
    const stepStr = String(step).toUpperCase();
    // Check for main phase steps (with or without underscore for compatibility)
    return stepStr === 'MAIN1' || stepStr === 'MAIN2' || 
           stepStr === 'MAIN_1' || stepStr === 'MAIN_2' || 
           stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch {
    return false;
  }
}

type SharedEmitBattlefieldCache = {
  seq: number;
  battlefield: any[];
  tokenGroupingApplied?: boolean;
  originalBattlefieldCount?: number;
};

function getSharedEmitBattlefieldCache(game: any): SharedEmitBattlefieldCache | null {
  const seq = Number(game?.seq ?? 0);
  const cached = game?._sharedEmitBattlefieldCache as SharedEmitBattlefieldCache | undefined;
  if (cached && cached.seq === seq) {
    return cached;
  }
  return null;
}

const MIN_TOKEN_GROUPING_REDUCTION_RATIO = 0.9;

function optimizeBattlefieldTokensForEmit(
  battlefield: any[],
  game?: any,
): {
  battlefield: any[];
  tokenGroupingApplied?: boolean;
  originalBattlefieldCount?: number;
} {
  const tokenGroups = new Map<string, { prototype: any; ids: string[] }>();
  const nonTokenPermanents: any[] = [];

  for (const perm of battlefield) {
    if (!perm) continue;

    const hasEquipment = perm.attachedEquipment?.length > 0 || perm.isEquipped;
    const hasAuras = perm.attachments?.length > 0;
    const isAttachedToSomething = !!perm.attachedTo;
    const hasDamage = (perm.damageTaken || 0) > 0 || (perm.damageMarked || 0) > 0;
    // `attacking` is the live combat flag set by declareAttackers (string player/planeswalker id).
    // `isAttacking` is not consistently set, so omit it and attacking tokens stay grouped as
    // `group_*` during declare blockers — client then sends invalid attackerIds.
    const isInCombat =
      perm.isBlocking ||
      perm.isAttacking ||
      (typeof perm.attacking === 'string' && perm.attacking.length > 0) ||
      (Array.isArray(perm.blocking) && perm.blocking.length > 0);

    const hasModifiers = perm.modifiers?.length > 0;
    const hasTemporaryEffects = perm.temporaryEffects?.length > 0;
    const hasTempPTMod = !!perm.tempPTMod;
    const hasTemporaryProtection = perm.temporaryProtection?.length > 0;
    const hasTempMods = hasModifiers || hasTemporaryEffects || hasTempPTMod || hasTemporaryProtection;

    const isGroupableToken =
      perm.isToken === true &&
      !hasEquipment &&
      !hasAuras &&
      !isAttachedToSomething &&
      !hasDamage &&
      !isInCombat &&
      !hasTempMods;

    if (isGroupableToken) {
      const card = perm.card || {};
      const countersStr = Object.entries(perm.counters || {})
        .filter(([, v]) => (v as number) > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

      const grantedAbilitiesStr = (perm.grantedAbilities || [])
        .slice()
        .sort()
        .join('|');

      const oracleText = (card.oracle_text || '').toLowerCase();
      const staticAbilities: string[] = [];
      const keywordPatterns = [
        'flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
        'vigilance', 'trample', 'haste', 'hexproof', 'indestructible',
        'menace', 'reach', 'defender', 'flash', 'shroud', 'protection',
        'infect', 'wither', 'persist', 'undying', 'annihilator',
        'intimidate', 'skulk', 'prowess', 'afflict', 'afterlife',
      ];
      for (const keyword of keywordPatterns) {
        if (oracleText.includes(keyword)) {
          staticAbilities.push(keyword);
        }
      }
      if (oracleText.includes('power and toughness are each equal to')) {
        staticAbilities.push('variable_pt');
      }

      const staticAbilitiesStr = staticAbilities.sort().join('|');
      const colorsStr = (card.colors || []).slice().sort().join('');

      const key = [
        `ctrl:${perm.controller}`,
        `name:${card.name || ''}`,
        `p:${perm.effectivePower ?? perm.basePower ?? card.power ?? 0}`,
        `t:${perm.effectiveToughness ?? perm.baseToughness ?? card.toughness ?? 0}`,
        `tap:${perm.tapped ? 1 : 0}`,
        `sick:${perm.summoningSickness ? 1 : 0}`,
        `cnt:${countersStr}`,
        `grantedAbil:${grantedAbilitiesStr}`,
        `staticAbil:${staticAbilitiesStr}`,
        `col:${colorsStr}`,
      ].join('|');

      const existing = tokenGroups.get(key);
      if (existing) {
        existing.ids.push(perm.id);
      } else {
        tokenGroups.set(key, { prototype: perm, ids: [perm.id] });
      }
    } else {
      nonTokenPermanents.push(perm);
    }
  }

  const optimizedBattlefield = [...nonTokenPermanents];
  let hasGroupedTokens = false;

  for (const [, group] of tokenGroups) {
    if (group.ids.length === 1) {
      optimizedBattlefield.push({
        ...group.prototype,
        isToken: true,
      });
    } else {
      hasGroupedTokens = true;
      const groupId = `group_${group.ids[0]}`;
      if (game) {
        registerTokenGroupMembers(game, groupId, group.ids);
      }
      optimizedBattlefield.push({
        ...group.prototype,
        tokenCount: group.ids.length,
        isGroupedTokens: true,
        isToken: true,
        id: groupId,
        originalId: group.ids[0],
        // Client can use real ids when present; server still resolves virtual refs after restart.
        groupedTokenIds: group.ids.slice(),
      });
    }
  }

  const originalCount = battlefield.length;
  const optimizedCount = optimizedBattlefield.length;

  if (hasGroupedTokens || optimizedCount < originalCount * MIN_TOKEN_GROUPING_REDUCTION_RATIO) {
    if (hasGroupedTokens) {
      debug(2, `[TokenOptimization] Applied grouping: ${originalCount} → ${optimizedCount} entries, has grouped tokens with counts`);
    } else {
      debug(2, `[TokenOptimization] Reduced battlefield from ${originalCount} to ${optimizedCount} entries (${Math.round((1 - optimizedCount / originalCount) * 100)}% reduction)`);
    }
    return {
      battlefield: optimizedBattlefield,
      tokenGroupingApplied: true,
      originalBattlefieldCount: originalCount,
    };
  }

  return { battlefield };
}

function augmentBattlefieldManaAmountsForEmit(battlefield: any[], game: any): void {
  if (!Array.isArray(battlefield) || !game?.state) return;

  for (const perm of battlefield) {
    if (!perm || perm.tapped) continue;

    const controller = perm.controller;
    if (!controller) continue;

    const devotionMana = getDevotionManaAmount(game.state, perm, controller);
    if (devotionMana && devotionMana.amount > 0) {
      perm.manaAmount = devotionMana.amount;
      perm.manaColor = devotionMana.color;
    }

    const creatureCountMana = getCreatureCountManaAmount(game.state, perm, controller);
    if (creatureCountMana && creatureCountMana.amount > 0 && !perm.manaAmount) {
      perm.manaAmount = creatureCountMana.amount;
      perm.manaColor = creatureCountMana.color;
    }
  }
}

function buildSharedEmitBattlefieldCache(game: any, sourceBattlefield: any[]): SharedEmitBattlefieldCache {
  const seq = Number(game?.seq ?? 0);
  let battlefield = sourceBattlefield;

  try {
    if (battlefield.length > 0) {
      battlefield = applyStaticAbilitiesToBattlefield(battlefield, game?.state);
    }
  } catch (e) {
    debugWarn(1, "Failed to apply static abilities to battlefield:", e);
  }

  let tokenGroupingApplied: boolean | undefined;
  let originalBattlefieldCount: number | undefined;
  try {
    const optimized = optimizeBattlefieldTokensForEmit(battlefield, game);
    battlefield = optimized.battlefield;
    tokenGroupingApplied = optimized.tokenGroupingApplied;
    originalBattlefieldCount = optimized.originalBattlefieldCount;
  } catch (e) {
    debugWarn(1, "Token grouping optimization failed:", e);
  }

  try {
    augmentBattlefieldManaAmountsForEmit(battlefield, game);
  } catch (e) {
    debugWarn(1, "Failed to augment mana amounts:", e);
  }

  const cache: SharedEmitBattlefieldCache = {
    seq,
    battlefield,
    tokenGroupingApplied,
    originalBattlefieldCount,
  };
  if (game) {
    game._sharedEmitBattlefieldCache = cache;
    // Emit projection only — do not replace authoritative battlefield (oracle text, ids, etc.).
  }
  return cache;
}

function applySharedBattlefieldCacheToView(view: any, game: any): void {
  if (!view?.battlefield || !Array.isArray(view.battlefield) || view.battlefield.length === 0) {
    return;
  }

  // Scrub impossible face-up instant/sorcery ghosts before reusing or building
  // the emit projection. Repairs must invalidate any cache for this seq.
  try {
    const repaired = repairNonPermanentBattlefieldGhosts(game);
    if (repaired > 0) {
      if (game) {
        game._sharedEmitBattlefieldCache = undefined;
      }
      if (Array.isArray(game?.state?.battlefield)) {
        // viewFor may have copied ghosts before repair; prefer authoritative BF.
        view.battlefield = game.state.battlefield.map((perm: any) => ({ ...perm }));
      } else {
        view.battlefield = view.battlefield.filter(
          (perm: any) => !isImpossibleFaceUpNonPermanentBattlefieldCard(perm),
        );
      }
      debug(1, `applySharedBattlefieldCacheToView: removed ${repaired} non-permanent battlefield ghost(s)`);
    }
  } catch (err) {
    debugWarn(1, "applySharedBattlefieldCacheToView: ghost repair failed", err);
  }

  if (!Array.isArray(view.battlefield) || view.battlefield.length === 0) {
    return;
  }

  let cache = getSharedEmitBattlefieldCache(game);
  if (!cache) {
    cache = buildSharedEmitBattlefieldCache(game, view.battlefield);
  }

  view.battlefield = cache.battlefield;
  if (cache.tokenGroupingApplied) {
    view.tokenGroupingApplied = true;
    view.originalBattlefieldCount = cache.originalBattlefieldCount;
  }
}

function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players =
      Array.isArray(view.players)
        ? view.players
        : game &&
          game.state &&
          Array.isArray(game.state.players)
        ? game.state.players
        : [];
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Mirror minimal shape back into authoritative game.state.zones to avoid other server modules observing undefined.
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
          }
        }
      }
    } catch {
      // non-fatal
    }

    applySharedBattlefieldCacheToView(view, game);

    // Add playable cards highlighting for the current priority player
    // This helps players see which cards/permanents they can play/activate
    try {
      view.playableCards = [];
      view.graveyardAbilityHints = {};
      view.canAct = false;
      view.canRespond = false;

      if (game && game.state && view.viewer) {
        const priority = game.state.priority;
        const viewerId = view.viewer;

        // Only add playable cards for the current priority holder viewing their own game
        if (priority === viewerId) {
          const playableCardIds = getPlayableCardIds(game, viewerId);
          view.playableCards = playableCardIds || [];
          view.graveyardAbilityHints = {
            [viewerId]: getGraveyardAbilityHints(game, viewerId),
          };

          // Add canAct and canRespond flags to the view
          // These are calculated server-side to ensure consistency with game rules
          try {
            view.canAct = canAct(game as any, viewerId);
            view.canRespond = canRespond(game as any, viewerId);
          } catch (err) {
            debugWarn(1, "Failed to calculate canAct/canRespond:", err);
            // Fallback: use playableCards as indicator
            view.canAct = playableCardIds && playableCardIds.length > 0;
            view.canRespond = view.canAct; // Conservative fallback
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if playable calculation fails
      debugWarn(1, "Failed to calculate playable cards:", e);
    }

    try {
      if (game && game.state && view.viewer) {
        const viewerId = view.viewer;
        const zones = game.state.zones?.[viewerId];

        if (zones?.hand && Array.isArray(zones.hand)) {
          const costAdjustments: Record<string, CardCostAdjustment> = {};

          for (const card of zones.hand) {
            if (!card || typeof card === 'string' || !card.id) continue;

            const adjustmentInfo = getCostAdjustmentInfo(game.state, viewerId, card);
            if (adjustmentInfo) {
              costAdjustments[card.id] = {
                originalCost: adjustmentInfo.originalCost,
                adjustedCost: adjustmentInfo.adjustedCost,
                adjustment: adjustmentInfo.adjustment,
                genericAdjustment: adjustmentInfo.genericAdjustment,
                sources: adjustmentInfo.sources.map(s => s.name),
                isIncrease: adjustmentInfo.adjustment > 0,
              };
            }
          }

          if (Object.keys(costAdjustments).length > 0) {
            view.costAdjustments = costAdjustments;
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if cost adjustment calculation fails
      debugWarn(1, "Failed to calculate cost adjustments:", e);
    }

    return view;
  } catch (e) {
    debugWarn(1, "normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging helper (env-gated) --- */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;

    const players = Array.isArray(view?.players) ? view.players : [];
    const playerIds = players
      .map((p: any) => p?.id ?? p?.playerId)
      .filter(Boolean);
    const playerLabels = players
      .map((p: any) => {
        const playerId = String(p?.id ?? p?.playerId ?? '').trim();
        if (!playerId) return '';
        const playerName = String(p?.name || '').trim();
        return playerName ? `${playerName}:${playerId}` : playerId;
      })
      .filter(Boolean);
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    // Pick the first player (if any) and derive a compact summary
    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    debug(1,
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerLabels.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${z?.handCount ?? 0} libraryCount=${z?.libraryCount ?? 0}`
    );

    debugEnv('DEBUG_REPLAY_RESTORE', `[replay-restore] ${prefix} gameId=${gameId}`, {
      phase: String(view?.phase || ''),
      step: String(view?.step || ''),
      turn: Number(view?.turn ?? 0) || undefined,
      turnNumber: Number(view?.turnNumber ?? 0) || undefined,
      priority: String(view?.priority || ''),
      turnPlayer: String(view?.turnPlayer || ''),
      players: playerLabels,
      zoneKeys,
    });

    // Compact library sample instead of full JSON dump
    debug(2, `[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch (e) {
    // non-fatal
  }
}

/**
 * Get player name from player ID.
 * Falls back to the ID if name is not found.
 */
export function getPlayerName(game: any, playerId: PlayerID): string {
  if (!game || !playerId) return playerId || 'Unknown';
  try {
    const players = game.state?.players || [];
    const player = players.find((p: any) => p?.id === playerId);
    return player?.name || playerId;
  } catch (e) {
    return playerId || 'Unknown';
  }
}

/* ------------------- Core exported utilities (based on original file) ------------------- */

/**
 * Options for ensureGame when creating a new game with creator tracking.
 */
export interface EnsureGameOptions {
  createdBySocketId?: string;
  createdByPlayerId?: string;
}

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 * Prefer using the centralized GameManager to ensure consistent factory/reset behavior.
 * Falls back to the local create/replay flow if GameManager is not available or fails.
 *
 * Returns an InMemoryGame wrapper with a fully-initialized runtime state.
 */
export function ensureGame(gameId: string, options?: EnsureGameOptions): InMemoryGame | undefined {
  // Defensive validation: reject invalid/falsy gameId early to prevent creating games with no id.
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGame called with invalid gameId: ${String(gameId)}`;
    debugError(1, "[ensureGame] " + msg, { bootId: BOOT_ID });
    throw new Error(msg);
  }

  // Prefer GameManager to keep a single source of truth for game creation/reset, if it's exposing helper methods.
  try {
    if (GameManager && typeof (GameManager as any).getGame === "function") {
      try {
        const gmGame =
          (GameManager as any).getGame(gameId) ||
          (GameManager as any).ensureGame?.(gameId);
        if (gmGame) {
          try {
            games.set(gameId, gmGame);
          } catch {
            /* best-effort */
          }
          try {
            ensureStateZonesForPlayers(gmGame);
          } catch {
            /* ignore */
          }
          return gmGame as InMemoryGame;
        }
        // GameManager.ensureGame returned undefined - game doesn't exist in DB (was deleted)
        // Don't fall through to local recreation
        return undefined;
      } catch (err) {
        debugWarn(2,
          "ensureGame: GameManager.getGame/ensureGame failed, falling back to local recreation:",
          { bootId: BOOT_ID, gameId },
          err
        );
      }
    }
  } catch (err) {
    debugWarn(2, "ensureGame: GameManager not usable, falling back:", { bootId: BOOT_ID, gameId }, err);
  }

  // Original fallback behavior - but first check if the game exists in the database
  let game = games.get(gameId) as InMemoryGame | undefined;

  if (!game) {
    // IMPORTANT: Check if the game exists in the database before recreating it.
    // This prevents re-creating games that were previously deleted.
    if (!gameExistsInDb(gameId)) {
      debug(1, 
        `[ensureGame] game ${gameId} does not exist in database, not recreating (may have been deleted)`,
        { bootId: BOOT_ID, gameId }
      );
      return undefined;
    }

    game = createInitialGameState(gameId) as InMemoryGame;

    // No need to call createGameIfNotExists since we already verified the game exists in DB
    // The game data is already persisted, we're just restoring the in-memory state

    try {
      const persisted = getEvents(gameId) || [];
      const replayEvents = persisted.map((ev: any) => ({
        type: ev.type,
        ...(ev.payload || {}),
      }));
      if (typeof (game as any).replay === "function") {
        (game as any).replay(replayEvents);
      } else if (typeof (game as any).applyEvent === "function") {
        for (const e of replayEvents) {
          (game as any).applyEvent(e);
        }
      }
    } catch (err) {
      debugWarn(1, 
        "ensureGame: replay persisted events failed, continuing with fresh state:",
        { bootId: BOOT_ID, gameId },
        err
      );
    }

    try {
      ensureStateZonesForPlayers(game);
    } catch {
      /* ignore */
    }

    try {
      pruneObsoleteResolutionQueueAfterReplay(gameId, game.state, (game as any).libraries);
    } catch (err) {
      debugWarn(1, 'ensureGame: prune replayed resolution prompts failed:', { bootId: BOOT_ID, gameId }, err);
    }

    // Re-register AI players after replay (done asynchronously to keep function synchronous)
    if (game.state && Array.isArray(game.state.players)) {
      // Dynamically import AI module to avoid circular dependencies
      import('./ai.js').then((aiModule) => {
        if (aiModule && aiModule.rehydrateAIGameRuntime) {
          const restored = aiModule.rehydrateAIGameRuntime(gameId, { refreshDeckProfiles: true });
          debug(1, '[ensureGame] Rehydrated AI runtime after replay:', {
            bootId: BOOT_ID,
            gameId,
            restoredPlayers: restored,
          });
        }
      }).catch(err => {
        debugWarn(1, '[ensureGame] Error rehydrating AI runtime:', { bootId: BOOT_ID, gameId }, err);
      });
    }

    games.set(gameId, game);
  }

  return game;
}

/**
 * Async variant of {@link ensureGame} that yields during event replay so
 * resume progress can be broadcast to the game browser.
 */
export async function ensureGameAsync(
  gameId: string,
  options?: EnsureGameOptions,
): Promise<InMemoryGame | undefined> {
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGameAsync called with invalid gameId: ${String(gameId)}`;
    debugError(1, "[ensureGameAsync] " + msg, { bootId: BOOT_ID });
    throw new Error(msg);
  }

  try {
    if (GameManager && typeof (GameManager as any).ensureGameAsync === "function") {
      const gmGame = await (GameManager as any).ensureGameAsync(gameId);
      if (gmGame) {
        try {
          games.set(gameId, gmGame);
        } catch {
          /* best-effort */
        }
        try {
          ensureStateZonesForPlayers(gmGame);
        } catch {
          /* ignore */
        }
        return gmGame as InMemoryGame;
      }
      return undefined;
    }
  } catch (err) {
    debugWarn(2,
      "ensureGameAsync: GameManager.ensureGameAsync failed, falling back to sync ensureGame:",
      { bootId: BOOT_ID, gameId },
      err
    );
  }

  return ensureGame(gameId, options);
}

/**
 * Emit a full, normalized state snapshot directly to a specific socketId for a given game,
 * using the same normalization semantics as other emitters.
 */
export function emitStateToSocket(
  io: Server,
  gameId: GameID,
  socketId: string,
  playerId?: PlayerID
) {
  try {
    const game = games.get(gameId);
    if (!game) return;

    let rawView: any;
    try {
      if (typeof (game as any).viewFor === "function" && playerId) {
        rawView = (game as any).viewFor(playerId, false);
      } else if (typeof (game as any).viewFor === "function") {
        const statePlayers: any[] = (game as any).state?.players || [];
        const firstId: string | undefined = statePlayers[0]?.id;
        rawView = firstId
          ? (game as any).viewFor(firstId, false)
          : (game as any).state;
      } else {
        rawView = (game as any).state;
      }
    } catch {
      rawView = (game as any).state;
    }

    const view = normalizeViewForEmit(rawView, game);
    try {
      io.to(socketId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq || 0,
      });
    } catch (e) {
      debugWarn(1, 
        "emitStateToSocket: failed to emit state to socket",
        socketId,
        e
      );
    }
  } catch (e) {
    debugWarn(1, "emitStateToSocket: failed to build or emit view", e);
  }
}

/**
 * Broadcasts the full state of a game to all participants.
 * Uses the game's participants() method if available, otherwise falls back to participantsList.
 *
 * This version normalizes view and mirrors minimal zone shapes back into game.state so clients
 * and other server code never observe missing per-player zones.
 * 
 * After broadcasting, checks if the current priority holder is an AI player
 * and triggers AI handling if needed.
 */
export function broadcastGame(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  options: { forceStateReplace?: boolean } = {},
) {
  // Loop-shortcut batch runs suppress mid-batch broadcasts; caller emits once at end.
  if (Number((game.state as any)?._suppressBroadcastCount || 0) > 0) {
    return;
  }

  repairMissingPriorityIfStuck(game, gameId, '[broadcastGame]');

  let participants:
    | Array<{
        socketId: string;
        playerId: string;
        spectator: boolean;
      }>
    | null = null;

  try {
    if (typeof (game as any).participants === "function") {
      participants = (game as any).participants();
    } else if (
      (game as any).participantsList &&
      Array.isArray((game as any).participantsList)
    ) {
      participants = (game as any).participantsList.slice();
    } else {
      participants = [];
    }
  } catch (err) {
    debugWarn(1, "broadcastGame: failed to obtain participants:", err);
    participants = [];
  }

  let anySent = false;

  if (participants && participants.length) {
    for (const p of participants) {
      try {
        const participantIsSpectator = !!(
          (p as any)?.spectator || (p as any)?.isSpectator
        );
        let rawView;
        try {
          rawView =
            typeof (game as any).viewFor === "function"
              ? (game as any).viewFor(p.playerId, participantIsSpectator)
              : (game as any).state;
        } catch {
          rawView = (game as any).state;
        }

        const view = normalizeViewForEmit(rawView, game);

        logStateDebug("BROADCAST_STATE", gameId, view);

        if (p.socketId) {
          io.to(p.socketId).emit("state", {
            gameId,
            view,
            seq: (game as any).seq,
            ...(options.forceStateReplace ? { forceStateReplace: true } : {}),
          });
          anySent = true;
        }
      } catch (err) {
        debugWarn(1, 
          "broadcastGame: failed to send state to",
          p.socketId,
          err
        );
      }
    }
  }

  // Fallback: if we had no participants or failed to send to anyone,
  // emit to the entire game room so rejoined sockets still receive updates.
  if (!anySent) {
    try {
      let rawView: any;
      try {
        if (typeof (game as any).viewFor === "function") {
          const statePlayers: any[] = (game as any).state?.players || [];
          const firstId: string | undefined = statePlayers[0]?.id;
          rawView = firstId
            ? (game as any).viewFor(firstId, true)
            : (game as any).state;
        } else {
          rawView = (game as any).state;
        }
      } catch {
        rawView = (game as any).state;
      }

      const view = normalizeViewForEmit(rawView, game);
      logStateDebug("BROADCAST_STATE", gameId, view);
      io.to(gameId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq,
        ...(options.forceStateReplace ? { forceStateReplace: true } : {}),
      });
    } catch (err) {
      debugWarn(1, 
        "broadcastGame: fallback emit to room failed for gameId",
        gameId,
        err
      );
    }
  }
  
  const stateAny = (game.state as any) || {};
  const suppressAutomation = stateAny._suppressAutomationOnNextBroadcast === true;
  const suppressUntil = Number(stateAny._suppressAutomationUntil || 0);
  const deferAutomation = suppressUntil > Date.now();
  if (suppressAutomation || deferAutomation) {
    delete stateAny._suppressAutomationOnNextBroadcast;
    clearScheduledHumanAutoPass(gameId);

    if (deferAutomation) {
      scheduleAutomationResume(io, game, gameId, suppressUntil);
      debug(2, `${ts()} [broadcastGame] Suppressed AI/auto-pass automation until ${suppressUntil} for ${gameId}`);
    } else {
      delete stateAny._suppressAutomationUntil;
      clearScheduledAutomationResume(gameId);
      debug(2, `[broadcastGame] Suppressed AI/auto-pass automation once for ${gameId}`);
    }

    // CRITICAL RUNTIME FIX: AI players should NEVER have their automatic priority responses suppressed.
    // Suppressing AI results in infinite game deadlocks if the active player is an AI,
    // because human players have no priority to act and break the silence.
    checkAndTriggerAI(io, game, gameId);
  } else {
    clearScheduledAutomationResume(gameId);
    // After broadcasting, check if the current priority holder is an AI player
    // This ensures AI responds to game state changes
    checkAndTriggerAI(io, game, gameId);
    
    // Check if the current priority holder should auto-pass
    // This ensures human players with auto-pass enabled don't get stuck with priority
    checkAndTriggerAutoPass(io, game, gameId);
  }
  
  // Check for pending Kynaios and Tiro style choices (play land or draw)
  checkAndEmitKynaiosChoicePrompts(io, game, gameId);
  
  // Legacy checkAndEmitProliferatePrompts call removed - now handled by processPendingProliferate()
  // in resolution queue after stack resolution
  
  // Check for newly eliminated players (commander damage, life loss, etc.)
  checkAndEmitPlayerElimination(io, game, gameId);

  emitPendingCombatDamageChat(io, game, gameId);
}

/** AI reaction delay - matches timing in ai.ts */
const AI_REACTION_DELAY_MS = 300;

/**
 * DEPRECATED: Legacy Kynaios choice prompt checker
 * 
 * Kynaios and Tiro choices are now handled by the Resolution Queue system.
 * This function only cleans up any legacy pendingKynaiosChoice state if found.
 */
function checkAndEmitKynaiosChoicePrompts(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const pendingKynaiosChoice = gameState.pendingKynaiosChoice;
    if (!pendingKynaiosChoice || Object.keys(pendingKynaiosChoice).length === 0) return;
    
    // Legacy state found - clean it up as this should not be used anymore
    debugWarn(1, `[util] DEPRECATED: Found legacy pendingKynaiosChoice state. This should use Resolution Queue. Cleaning up.`);
    delete gameState.pendingKynaiosChoice;
    delete gameState._kynaiosChoicePromptedPlayers;
    
  } catch (e) {
    debugWarn(1, '[util] checkAndEmitKynaiosChoicePrompts error:', e);
  }
}

/**
 * Check if any player needs to order multiple simultaneous triggers
 * and emit the appropriate prompts
 */
/**
 * Legacy proliferate prompt function removed
 * Proliferate is now handled through processPendingProliferate() in resolution queue
 */

/**
 * Check for newly eliminated players and emit appropriate notifications
 * This handles commander damage wins, life loss, poison counters, etc.
 */
function checkAndEmitPlayerElimination(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const players = gameState.players || [];
    
    // Track if we've already notified about this player
    // Store this on the game state to avoid duplicate notifications
    if (!(gameState as any).eliminationNotifications) {
      (gameState as any).eliminationNotifications = new Set<string>();
    }
    const notifiedPlayers = (gameState as any).eliminationNotifications;
    
    // Check each player for elimination
    for (const player of players) {
      if (!player || !player.id) continue;
      
      // Skip if we've already notified about this player
      if (notifiedPlayers.has(player.id)) continue;
      
      // Check if player has been marked as eliminated
      if (player.hasLost || player.eliminated) {
        const playerName = player.name || player.id;
        const reason = player.lossReason || "Unknown reason";
        
        // Mark as notified to avoid duplicate emissions
        notifiedPlayers.add(player.id);
        
        // Emit player elimination event
        io.to(gameId).emit("playerEliminated", {
          gameId,
          playerId: player.id,
          playerName,
          reason,
        });

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          gameId,
          from: 'system',
          message: formatPlayerEliminatedMessage(playerName, reason),
          ts: Date.now(),
        });
        
        debug(1, `[checkAndEmitPlayerElimination] Player ${playerName} eliminated: ${reason}`);
        
        // Check if game is over (only 1 or 0 active players remaining)
        const activePlayers = players.filter(
          (p: any) =>
            p &&
            p.id &&
            !p.hasLost &&
            !p.eliminated &&
            !p.conceded &&
            !(p.spectator || p.isSpectator)
        );
        
        if (activePlayers.length === 1) {
          // One player left - they win!
          const winner = activePlayers[0];
          const winnerName = winner.name || winner.id;
          
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'victory',
            winnerId: winner.id,
            winnerName,
            loserId: player.id,
            loserName: playerName,
            message: `${winnerName} Wins!`,
          });

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            gameId,
            from: 'system',
            message: formatGameOverVictoryMessage(winnerName),
            ts: Date.now(),
          });
          
          // Mark game as over
          gameState.gameOver = true;
          gameState.winner = winner.id;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! ${winnerName} wins.`);
        } else if (activePlayers.length === 0) {
          // No players left - draw
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'draw',
            message: "Draw!",
          });

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            gameId,
            from: 'system',
            message: formatGameOverDrawMessage(),
            ts: Date.now(),
          });
          
          gameState.gameOver = true;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! Draw.`);
        }
      }
    }
  } catch (err) {
    debugWarn(1, `[checkAndEmitPlayerElimination] Error:`, err);
  }
}

/**
 * Check if the current priority holder is an AI and trigger their turn.
 * Also kicks AI players who have pending resolution prompts after reconnect/replay
 * (those prompts are not re-emitted as STEP_ADDED, so the normal AI handler never runs).
 *
 * Called after broadcasting and after join/resume state sync.
 */
export function checkAndTriggerAI(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const stateAny = game.state as any;
    const paymentResumeLock = stateAny?._paymentResumeCastLock;
    const completingCasts = stateAny?._completingSpellCastByPlayer;
    if (
      (paymentResumeLock && typeof paymentResumeLock === 'object' && String(paymentResumeLock.playerId || '').trim())
      || (completingCasts && typeof completingCasts === 'object' && Object.keys(completingCasts).length > 0)
    ) {
      return;
    }

    const priority = stateAny?.priority;
    const players = stateAny?.players || [];

    // Resume/reconnect: AI-owned resolution prompts must be kicked explicitly.
    try {
      const queue = ResolutionQueueManager.getQueue(gameId);
      const pendingAiPlayerIds = new Set<string>();
      for (const step of queue?.steps || []) {
        if (!step || String(step.status || '').toLowerCase() === 'completed' || String(step.status || '').toLowerCase() === 'cancelled') {
          continue;
        }
        const stepPlayerId = String(step.playerId || '').trim();
        if (!stepPlayerId) continue;
        const owner = players.find((p: any) => p?.id === stepPlayerId);
        if (owner?.isAI === true) {
          pendingAiPlayerIds.add(stepPlayerId);
        }
      }
      for (const aiPlayerId of pendingAiPlayerIds) {
        void import('./ai.js').then((aiModule) => {
          if (typeof aiModule.scheduleAIGameFlow === 'function') {
            aiModule.scheduleAIGameFlow(io, gameId, aiPlayerId, AI_REACTION_DELAY_MS);
          } else if (typeof aiModule.scheduleAIPriority === 'function') {
            aiModule.scheduleAIPriority(io, gameId, aiPlayerId, AI_REACTION_DELAY_MS);
          }
        }).catch((e) => {
          debugError(1, '[util] Failed to trigger AI for pending resolution step:', { gameId, playerId: aiPlayerId, error: e });
        });
      }
    } catch (e) {
      debugWarn(2, '[util] checkAndTriggerAI pending-resolution scan failed:', e);
    }
    
    // Special case: Kynaios and Tiro style choices
    // These can affect any player (not just the one with priority)
    // Check if any AI player needs to make a Kynaios choice
    const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice) {
      for (const [controllerId, choiceData] of Object.entries(pendingKynaiosChoice)) {
        const choice = choiceData as any;
        if (!choice.active) continue;
        
        const playersWhoMayPlayLand = choice.playersWhoMayPlayLand || [];
        const playersWhoPlayedLand = choice.playersWhoPlayedLand || [];
        const playersWhoDeclined = choice.playersWhoDeclined || [];
        
        // Find AI players who need to make a choice
        for (const playerId of playersWhoMayPlayLand) {
          if (playersWhoPlayedLand.includes(playerId) || playersWhoDeclined.includes(playerId)) {
            continue; // Already made choice
          }
          
          const playerObj = players.find((p: any) => p?.id === playerId);
          if (playerObj && playerObj.isAI) {
            // Trigger AI to handle Kynaios choice
            void import('./ai.js').then((aiModule) => {
              if (typeof aiModule.scheduleAIGameFlow === 'function') {
                aiModule.scheduleAIGameFlow(io, gameId, playerId, AI_REACTION_DELAY_MS);
              } else if (typeof aiModule.handleAIGameFlow === 'function') {
                void aiModule.handleAIGameFlow(io, gameId, playerId).catch((e: any) => {
                  debugError(1, '[util] Failed to trigger AI handler for Kynaios choice:', { gameId, playerId, error: e });
                });
              }
            }).catch((e) => {
              debugError(1, '[util] Failed to trigger AI handler for Kynaios choice:', { gameId, playerId, error: e });
            });
            return; // Exit - handle one AI at a time
          }
        }
      }
    }
    
    if (!priority) return;
    
    // Check if the current priority holder is an AI player
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    
    if (priorityPlayer && priorityPlayer.isAI) {
      // Dynamically import AI handler to avoid circular deps
      void import('./ai.js').then((aiModule) => {
        if (typeof aiModule.scheduleAIGameFlow === 'function') {
          aiModule.scheduleAIGameFlow(io, gameId, priority, AI_REACTION_DELAY_MS);
        } else if (typeof aiModule.handleAIGameFlow === 'function') {
          void aiModule.handleAIGameFlow(io, gameId, priority).catch((e: any) => {
            debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
          });
        } else if (typeof aiModule.handleAIPriority === 'function') {
          void aiModule.handleAIPriority(io, gameId, priority).catch((e: any) => {
            debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
          });
        }
      }).catch((e) => {
        debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
      });
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAI error:', { gameId, error: e });
  }
}

/**
 * Check if the current priority holder should auto-pass and trigger it if needed
 * This ensures human players with auto-pass enabled don't get stuck with priority
 * when they have no legal actions available.
 * 
 * For human players, a small delay is added before auto-passing to give them a chance
 * to evaluate the board state and potentially claim priority if they want to act.
 */
export function checkAndTriggerAutoPass(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const stateAny = game.state as any;
    const priority = stateAny?.priority;
    const priorityPlayerId = priority ? String(priority) as PlayerID : null;
    const existingHumanAutoPass = pendingHumanAutoPassTimers.get(gameId);
    if (existingHumanAutoPass && existingHumanAutoPass.playerId !== priorityPlayerId) {
      clearScheduledHumanAutoPass(gameId);
    }
    
    // ========================================================================
    // DEBUG: Track auto-pass calls to diagnose skip issues
    // ========================================================================
    const debugCallId = `autopass_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    debug(2, `${ts()} [checkAndTriggerAutoPass] ========== CALLED (ID: ${debugCallId}) ==========`);
    debug(2, `${ts()} [checkAndTriggerAutoPass] Priority: ${priority}, Phase: ${stateAny?.phase}, Step: ${stateAny?.step}`);
    // ========================================================================

    const paymentResumeLock = stateAny?._paymentResumeCastLock;
    const completingCasts = stateAny?._completingSpellCastByPlayer;
    if (
      (paymentResumeLock && typeof paymentResumeLock === 'object' && String(paymentResumeLock.playerId || '').trim())
      || (completingCasts && typeof completingCasts === 'object' && Object.keys(completingCasts).length > 0)
    ) {
      clearScheduledHumanAutoPass(gameId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] Spell cast completion in progress - returning early (ID: ${debugCallId})`);
      return;
    }
    
    if (!priority) {
      clearScheduledHumanAutoPass(gameId);
      const repaired = repairMissingPriorityIfStuck(game, gameId, '[checkAndTriggerAutoPass]', debugCallId);
      if (!repaired) {
        const phase = String(stateAny?.phase || '').toLowerCase();
        const step = String(stateAny?.step || '').toUpperCase();
        const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);

        if (phase === 'pre_game' || phase === 'pre-game') {
          debug(2, `${ts()} [checkAndTriggerAutoPass] In pre_game phase, auto-pass disabled (ID: ${debugCallId})`);
          return;
        }

        if (pendingSummary.hasPending) {
          debug(2, `${ts()} [checkAndTriggerAutoPass] Priority is null due to active resolution (${pendingSummary.pendingCount} pending steps), returning (ID: ${debugCallId})`);
          return;
        }

        if (['UNTAP', 'CLEANUP'].includes(step)) {
          debug(2, `${ts()} [checkAndTriggerAutoPass] No priority holder (step ${step} doesn't grant priority), returning (ID: ${debugCallId})`);
          return;
        }

        debugError(1, `${ts()} [checkAndTriggerAutoPass] Cannot restore priority - no turn player found!`);
        return;
      }
    }
    
    // IMPORTANT: Do not auto-pass during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    // Auto-pass should not interfere with these setup steps.
    if (stateAny?.phase === 'pre_game' || stateAny?.phase === 'PRE_GAME') {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] In pre_game phase, auto-pass disabled (ID: ${debugCallId})`);
      return;
    }
    
    // Prevent re-entry while auto-passing is in progress
    // This avoids recursive calls that might advance steps incorrectly
    if (!stateAny._autoPassInProgress) {
      stateAny._autoPassInProgress = new Set<string>();
    }
    if (stateAny._autoPassInProgress.has(priority)) {
      debug(2, `[checkAndTriggerAutoPass] Already processing auto-pass for ${priority}, skipping re-entry (ID: ${debugCallId})`);
      return;
    }
    
    // Idle players auto-pass; autoPassForTurn, loop stack-drain (non-empty stack
    // only), and top-stack trigger shortcuts bypass the idle check. With a
    // non-empty stack, enabled auto-pass ("Smart Pass") may also bypass — but
    // only for the player's own top stack object — otherwise floating mana /
    // activatable abilities leave them stuck clicking Pass Priority to resolve
    // their own spells. Opponent spells still require a real canRespond check
    // (e.g. Cyclonic Rift vs Murder).
    const autoPassForTurn = stateAny.autoPassForTurn?.[priority] || false;
    const loopStackDrain = stateAny.loopShortcutStackDrain?.[priority] === true;
    const autoPassEnabled = stateAny.autoPassPlayers instanceof Set
      ? stateAny.autoPassPlayers.has(priority)
      : false;
    const stackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
    const loopDrainActive = isLoopStackDrainActive(loopStackDrain, stackLen);
    const autoPassEmptyStackOnOpponentsTurn =
      (
        stateAny.autoPassEmptyStackOnOpponentsTurn?.[priority] === true
        || stateAny.autoPassEmptyStackForTurn?.[priority] === true
      )
      && stackLen === 0
      && String(stateAny.turnPlayer || '') !== String(priority);
    let triggerAutoPassReason = (autoPassForTurn || loopDrainActive)
      ? undefined
      : getTopTriggeredAbilityAutoPassReason(game.state, priority);
    const bypassIdleForStack = shouldBypassIdleForNonEmptyStack({
      stackLen,
      autoPassEnabled,
      loopStackDrain,
      autoPassForTurn,
      state: game.state,
      playerId: String(priority),
    });
    const pausedForUndoPlayer = String(stateAny._pauseHumanAutoPassUntilActionFor || '').trim();

    if (pausedForUndoPlayer && pausedForUndoPlayer === String(priority)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] Auto-pass paused for ${priority} until a manual action is taken (ID: ${debugCallId})`);
      return;
    }

    // Never Smart-Pass / stack-drain while a non-payment resolution prompt is open.
    // Mox Diamond stays on the stack during its discard-land choice; without this
    // guard, bypassIdleForStack re-resolves the spell and queues a second prompt.
    {
      const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
      if (pendingSummary.hasPending) {
        const blockingTypes = pendingSummary.pendingTypes.filter(
          (type) => String(type) !== 'mana_payment_choice',
        );
        if (blockingTypes.length > 0) {
          clearScheduledHumanAutoPass(gameId, priorityPlayerId);
          debug(
            2,
            `${ts()} [checkAndTriggerAutoPass] Blocking auto-pass — pending resolution steps: ${blockingTypes.join(', ')} (ID: ${debugCallId})`,
          );
          return;
        }
      }
    }

    const players = stateAny?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    if (priorityPlayer && priorityPlayer.isAI) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} is AI, handled separately (ID: ${debugCallId})`);
      return;
    }

    if (!stateAny.priorityClaimed) {
      stateAny.priorityClaimed = new Set<string>();
    }
    if (stateAny.priorityClaimed.has(priority)) {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} claimed priority, returning (ID: ${debugCallId})`);
      return;
    }
    
    // CRITICAL: Forced pass preferences skip the normal legal-action idle check.
    // Loop drain only skips idle while the stack is non-empty.
    if (!autoPassForTurn && !loopDrainActive && !autoPassEmptyStackOnOpponentsTurn && !triggerAutoPassReason && !bypassIdleForStack) {
      const ctx: any = {
        gameId,
        state: game.state,
        libraries: (game as any).libraries || new Map(),
        life: stateAny.life || {},
        poison: {},
        experience: {},
        commandZone: stateAny.commandZone || {},
        joinedBySocket: new Map(),
        participantsList: [],
        tokenToPlayer: new Map(),
        playerToToken: new Map(),
        grants: new Map(),
        inactive: new Set(),
        spectatorNames: new Map(),
        pendingInitialDraw: new Set(),
        handVisibilityGrants: new Map(),
        rngSeed: null,
        rng: () => 0,
        seq: { value: 0 },
        bumpSeq: () => {},
        passesInRow: { value: 0 },
        landsPlayedThisTurn: stateAny.landsPlayedThisTurn || {},
        maxLandsPerTurn: {},
        additionalDrawsPerTurn: {},
        manaPool: stateAny.manaPool || {},
      };

      let playerIdle = false;
      try {
        playerIdle = isPlayerIdleForAutoPass(ctx, priority);
        debug(2, `${ts()} [checkAndTriggerAutoPass] idle check: ${priority} playerIdle=${playerIdle} (ID: ${debugCallId})`);
      } catch (err) {
        debugWarn(1, `[checkAndTriggerAutoPass] Error checking if player ${priority} is idle (ID: ${debugCallId}):`, err);
        return;
      }

      if (!playerIdle) {
        clearScheduledHumanAutoPass(gameId, priorityPlayerId);
        debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} has available actions - returning early, NO auto-pass (ID: ${debugCallId})`);
        return;
      }

      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} is idle - proceeding with auto-pass (ID: ${debugCallId})`);
    } else if (bypassIdleForStack) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} bypassing idle (stackLen=${stackLen}, autoPass=${autoPassEnabled}, loopDrain=${loopStackDrain}, autoPassForTurn=${autoPassForTurn}) (ID: ${debugCallId})`);
    } else if (triggerAutoPassReason) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} will auto-pass due to top stack trigger shortcut (${triggerAutoPassReason}) (ID: ${debugCallId})`);
    } else if (autoPassEmptyStackOnOpponentsTurn) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} will auto-pass empty stack on opponent ${stateAny.turnPlayer}'s turn (ID: ${debugCallId})`);
    } else {
      debug(2, `[checkAndTriggerAutoPass] Auto-pass for rest of turn / loop drain is enabled for ${priority} - bypassing canAct check`);
    }
    
    // For human players, add a small delay before auto-passing
    // This gives them a moment to see the board state and potentially claim priority
    // AI players and autoPassForTurn skip this delay for snappier gameplay
    const isHumanPlayer = priorityPlayer && !priorityPlayer.isAI;
    
    const executeAutoPass = () => {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      debug(2, `${ts()} [executeAutoPass] ========== EXECUTING for ${priority} (ID: ${debugCallId}) ==========`);
      debug(2, `${ts()} [executeAutoPass] Phase: ${(game.state as any)?.phase}, Step: ${(game.state as any)?.step}`);
      
      // Re-check conditions after delay (state might have changed)
      const currentState = game.state as any;
      const currentPriority = currentState?.priority;
      
      // Only proceed if priority hasn't changed
      if (currentPriority !== priority) {
        debug(2, `${ts()} [executeAutoPass] Priority changed from ${priority} to ${currentPriority}, aborting (ID: ${debugCallId})`);
        return;
      }
      
      // Check if player claimed priority during the delay
      if (currentState.priorityClaimed?.has(priority)) {
        debug(2, `${ts()} [executeAutoPass] ${priority} claimed priority during delay, aborting (ID: ${debugCallId})`);
        return;
      }
      
      // CRITICAL FIX: Re-check if player can act before auto-passing
      // This prevents auto-pass from advancing when a player gains the ability to act
      // (e.g., after step advancement gives them priority in their main phase)
      const currentLoopDrain = currentState.loopShortcutStackDrain?.[priority] === true;
      const currentAutoPassForTurn = currentState.autoPassForTurn?.[priority] || false;
      const currentAutoPassEnabled = currentState.autoPassPlayers instanceof Set
        ? currentState.autoPassPlayers.has(priority)
        : false;
      const currentStackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
      const currentLoopDrainActive = isLoopStackDrainActive(currentLoopDrain, currentStackLen);
      const currentAutoPassEmptyStackOnOpponentsTurn =
        (
          currentState.autoPassEmptyStackOnOpponentsTurn?.[priority] === true
          || currentState.autoPassEmptyStackForTurn?.[priority] === true
        )
        && currentStackLen === 0
        && String(currentState.turnPlayer || '') !== String(priority);
      const currentBypassIdleForStack = shouldBypassIdleForNonEmptyStack({
        stackLen: currentStackLen,
        autoPassEnabled: currentAutoPassEnabled,
        loopStackDrain: currentLoopDrain,
        autoPassForTurn: currentAutoPassForTurn,
        state: game.state,
        playerId: String(priority),
      });
      triggerAutoPassReason = (currentAutoPassForTurn || currentLoopDrainActive)
        ? undefined
        : getTopTriggeredAbilityAutoPassReason(game.state, priority);
      if (!currentAutoPassForTurn && !currentLoopDrainActive && !currentAutoPassEmptyStackOnOpponentsTurn && !triggerAutoPassReason && !currentBypassIdleForStack) {
        // Recreate context for re-check
        // CRITICAL: Use actual game data (libraries, mana pool) for accurate checks
        const recheckCtx: any = {
          gameId,
          state: game.state,
          // Use actual libraries from game, not an empty map
          libraries: (game as any).libraries || new Map(),
          life: currentState.life || {},
          poison: {},
          experience: {},
          commandZone: currentState.commandZone || {},
          joinedBySocket: new Map(),
          participantsList: [],
          tokenToPlayer: new Map(),
          playerToToken: new Map(),
          grants: new Map(),
          inactive: new Set(),
          spectatorNames: new Map(),
          pendingInitialDraw: new Set(),
          handVisibilityGrants: new Map(),
          rngSeed: null,
          rng: () => 0,
          seq: { value: 0 },
          bumpSeq: () => {},
          passesInRow: { value: 0 },
          landsPlayedThisTurn: currentState.landsPlayedThisTurn || {},
          maxLandsPerTurn: {},
          additionalDrawsPerTurn: {},
          // Use actual mana pool from game state
          manaPool: currentState.manaPool || {},
        };
        
        try {
          const playerStillIdle = isPlayerIdleForAutoPass(recheckCtx, priority);
          debug(2, `${ts()} [executeAutoPass] Re-check: ${priority} playerIdle=${playerStillIdle} (ID: ${debugCallId})`);
          
          if (!playerStillIdle) {
            debug(2, `${ts()} [executeAutoPass] Player ${priority} CAN NOW ACT - canceling auto-pass (ID: ${debugCallId})`);
            return;
          }
        } catch (err) {
          debugWarn(1, `${ts()} [executeAutoPass] Error re-checking if player ${priority} is idle (ID: ${debugCallId}):`, err);
          return;
        }
      } else if (triggerAutoPassReason) {
        debug(2, `${ts()} [executeAutoPass] Re-check confirms top stack trigger shortcut (${triggerAutoPassReason}) for ${priority} (ID: ${debugCallId})`);
      }

      const currentStep = String(currentState?.step || '').toUpperCase();
      const turnPlayer = currentState?.turnPlayer;
      const battlefield = game.state?.battlefield || [];
      const isBeingAttacked = battlefield.some((perm: any) => perm?.attacking === priority);
      const hasPotentialBlockers = battlefield.some((perm: any) => {
        if (!perm || perm.controller !== priority) return false;
        if (perm.tapped) return false;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature');
      });
      const isDefendingPlayer = isBeingAttacked && hasPotentialBlockers;
      if ((currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) && isDefendingPlayer) {
        debug(2, `${ts()} [executeAutoPass] Skipping auto-pass for ${priority} during DECLARE_BLOCKERS - player has potential blockers (ID: ${debugCallId})`);
        return;
      }
      
      // Player cannot act - auto-pass their priority
      debug(2, `${ts()} [executeAutoPass] Proceeding with auto-pass for ${priority} (ID: ${debugCallId})`);
      
      // Mark that we're processing auto-pass for this player
      const autoPassState = game.state as any;
      if (!autoPassState._autoPassInProgress) {
        autoPassState._autoPassInProgress = new Set<string>();
      }
      autoPassState._autoPassInProgress.add(priority);
      debug(2, `${ts()} [executeAutoPass] Set _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
      
      // Call passPriority with isAutoPass flag
      if (typeof (game as any).passPriority === 'function') {
        try {
          const result = (game as any).passPriority(priority, true); // true = isAutoPass
          debug(2, `${ts()} [executeAutoPass] passPriority result: changed=${result.changed}, advanceStep=${result.advanceStep}, resolvedNow=${result.resolvedNow} (ID: ${debugCallId})`);
          
          if (result.changed) {
            // Priority was passed successfully
            appendGameEvent(game, gameId, "passPriority", { by: priority, auto: true });
            
            // Handle stack resolution or step advancement if needed
            if (result.resolvedNow) {
              debug(2, `[checkAndTriggerAutoPass] Stack resolved after auto-pass for ${priority}`);
              const deferredMox = tryQueueMoxDiamondBeforeStackResolve(game);
              if (!deferredMox && persistAndResolveTopOfStack(game, gameId, { auto: true })) {
                runPostResolutionPermanentPromptChecks(io, game, gameId);
              }
            }
            
            if (result.advanceStep) {
              debug(2, `${ts()} [executeAutoPass] Advancing step after auto-pass for ${priority} (ID: ${debugCallId})`);
              advanceStepPersistingEvent(io, game as any, gameId, {
                reason: 'autoPassAdvance',
                by: priority,
                auto: true,
              });
            }
            
            // Clear the in-progress flag before broadcasting
            // This allows the next player to be checked
            autoPassState._autoPassInProgress?.delete(priority);
            debug(2, `${ts()} [executeAutoPass] Cleared _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
            
            // Broadcast updated state after auto-pass
            // Note: This will recursively call checkAndTriggerAutoPass for the next player
            debug(2, `${ts()} [executeAutoPass] Broadcasting state after auto-pass (ID: ${debugCallId})`);
            broadcastGame(io, game, gameId);
            debug(2, `${ts()} [executeAutoPass] Broadcast complete (ID: ${debugCallId})`);
          } else {
            // Priority pass didn't change state - clear flag
            debug(2, `${ts()} [executeAutoPass] Priority pass didn't change state (ID: ${debugCallId})`);
            autoPassState._autoPassInProgress?.delete(priority);
          }
        } catch (err) {
          debugError(1, `${ts()} [executeAutoPass] Error passing priority for ${priority} (ID: ${debugCallId}):`, err);
          // Clear flag on error
          autoPassState._autoPassInProgress?.delete(priority);
        }
      } else {
        // passPriority function not available - clear flag
        debug(2, `${ts()} [executeAutoPass] passPriority function not available (ID: ${debugCallId})`);
        autoPassState._autoPassInProgress?.delete(priority);
      }
    };
    
    // For human players without forced stack-drain, add a small delay
    // This allows them to evaluate and claim priority if needed
    if (isHumanPlayer && !autoPassForTurn && !loopDrainActive && !autoPassEmptyStackOnOpponentsTurn && !bypassIdleForStack && !triggerAutoPassReason) {
      if (existingHumanAutoPass?.playerId === priorityPlayerId) {
        debug(2, `${ts()} [checkAndTriggerAutoPass] Auto-pass already scheduled for ${priority} (ID: ${debugCallId})`);
        return;
      }

      const floatingMana = getTotalManaFromPool(getManaPoolFromState(game.state as any, priorityPlayerId as PlayerID));
      const autoPassDelayMs = floatingMana > 0 ? 750 : AUTO_PASS_DELAY_MS;
      debug(2, `${ts()} [checkAndTriggerAutoPass] Scheduling auto-pass for ${priority} with ${autoPassDelayMs}ms delay (floatingMana=${floatingMana}) (ID: ${debugCallId})`);
      const timeout = setTimeout(executeAutoPass, autoPassDelayMs);
      pendingHumanAutoPassTimers.set(gameId, {
        playerId: priorityPlayerId as PlayerID,
        timeout,
      });
    } else {
      clearScheduledHumanAutoPass(gameId, priorityPlayerId);
      // AI players or stack-drain / autoPassForTurn: execute immediately
      debug(2, `${ts()} [checkAndTriggerAutoPass] Executing auto-pass for ${priority} IMMEDIATELY (isHuman=${isHumanPlayer}, autoPassForTurn=${autoPassForTurn}, emptyStackOpponentTurn=${autoPassEmptyStackOnOpponentsTurn}, loopDrain=${loopStackDrain}, bypassStack=${bypassIdleForStack}) (ID: ${debugCallId})`);
      executeAutoPass();
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAutoPass error:', { gameId, error: e });
  }
}

/**
 * Appends a game event (both in-memory and persisted to the DB).
 * This attempts to call game.applyEvent and then persists via appendEvent.
 */
export function appendGameEvent(
  game: InMemoryGame,
  gameId: string,
  type: string,
  payload: Record<string, any> = {}
) {
  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type, ...payload });
    } else if (typeof (game as any).apply === "function") {
      (game as any).apply(type, payload);
    } else {
      if ((game as any).state && typeof (game as any).state === "object") {
        // no-op; rely on persisted events for reconstruction
      }
    }
  } catch (err) {
    debugWarn(1, "appendGameEvent: in-memory apply failed:", err);
  }

  try {
    appendEvent(gameId, (game as any).seq, type, payload);
  } catch (err) {
    debugWarn(1, "appendGameEvent: DB appendEvent failed:", err);
  }
}

/**
 * Persist-first stack resolve: write `resolveTopOfStack` to the event log *before*
 * applying the resolve, so as-enters prompts / ETB `pushTriggeredAbility` events
 * appended during live resolve appear *after* it. Replay needs that order to put
 * permanent spells onto the battlefield while they are still on top of the stack.
 *
 * Do not call `game.resolveTopOfStack()` or `appendGameEvent(resolveTopOfStack)`
 * around this — this helper owns both the DB row and the in-memory apply.
 */
export function persistAndResolveTopOfStack(
  game: InMemoryGame,
  gameId: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (
    typeof (game as any).resolveTopOfStack !== "function"
    && typeof (game as any).applyEvent !== "function"
  ) {
    return false;
  }

  // DB first — side effects during apply append after this row.
  try {
    appendEvent(gameId, (game as any).seq ?? 0, "resolveTopOfStack", payload);
  } catch (err) {
    debugWarn(1, "persistAndResolveTopOfStack: DB appendEvent failed:", err);
  }

  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type: "resolveTopOfStack", ...payload });
    } else if (typeof (game as any).resolveTopOfStack === "function") {
      (game as any).resolveTopOfStack();
    }
  } catch (err) {
    debugWarn(1, "persistAndResolveTopOfStack: in-memory apply failed:", err);
    return false;
  }

  return true;
}

/**
 * Clears the priority timer for a given Game ID.
 */
export function clearPriorityTimer(gameId: string) {
  const existingTimeout = priorityTimers.get(gameId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    priorityTimers.delete(gameId);
  }
}

/**
 * Schedules a priority pass timeout, automatically passing after the configured delay.
 * If the game has only one active player and a non-empty stack, passes immediately.
 * If priority is null (no player has priority), auto-advance to next step.
 */
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  clearPriorityTimer(gameId);

  try {
    if (!game.state || !game.state.active) return;
    
    // IMPORTANT: Do not auto-advance during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    const currentPhase = String((game.state as any)?.phase || '').toLowerCase();
    if (currentPhase === 'pre_game') {
      debug(2, `[schedulePriorityTimeout] In pre_game phase, not scheduling timeout for game ${gameId}`, { bootId: BOOT_ID, gameId });
      return;
    }
    
    // If priority is null (no player has priority), auto-advance to next step.
    // This is intended for steps like UNTAP/CLEANUP where we normally don't grant priority.
    // IMPORTANT: Never auto-advance while the stack is non-empty.
    // Otherwise we can skip stack resolution and end up in a later step/turn with spells still on the stack.
    if (!game.state.priority) {
      const stackLen = Array.isArray((game.state as any).stack) ? ((game.state as any).stack as any[]).length : 0;

      if (stackLen > 0) {
        debugWarn(1, `[schedulePriorityTimeout] Priority is null but stack is non-empty (len=${stackLen}); not auto-advancing for game ${gameId}`,
          { bootId: BOOT_ID, gameId, stackLen }
        );
        // Best-effort recovery: ensure some player has priority so the stack can be resolved.
        try {
          if (typeof (game as any).passPriority === 'function') {
            // passPriority with no args will assign priority to the first active player.
            (game as any).passPriority();
          } else if ((game.state as any).turnPlayer) {
            (game.state as any).priority = (game.state as any).turnPlayer;
          }
        } catch {
          // ignore
        }
        try {
          broadcastGame(io, game, gameId);
        } catch {
          // ignore
        }
        return;
      }

      debug(2, `[schedulePriorityTimeout] Priority is null, auto-advancing step for game ${gameId}`, { bootId: BOOT_ID, gameId });
      // Schedule immediate step advancement
      priorityTimers.set(
        gameId,
        setTimeout(() => {
          // Auto-advance to next step
          if (advanceStepPersistingEvent(io, game as any, gameId, { reason: 'noPriority' })) {
            suppressAutomationOnNextBroadcast(game);
            broadcastGame(io, game, gameId);
            debug(2, `[schedulePriorityTimeout] Auto-advanced step (no priority) for game ${gameId}`,
              { bootId: BOOT_ID, gameId }
            );
          }
        }, 0)
      );
      return;
    }
  } catch {
    return;
  }

  const activePlayers = (game.state.players || []).filter(
    (p: any) => !p.inactive
  );
  if (
    activePlayers.length === 1 &&
    Array.isArray(game.state.stack) &&
    game.state.stack.length > 0
  ) {
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)");
      }, 0)
    );
    return;
  }

  const startSeq = (game as any).seq;
  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);
    const updatedGame = games.get(gameId);
    if (!updatedGame || (updatedGame as any).seq !== startSeq) return;
    doAutoPass(io, updatedGame, gameId, "auto-pass (timeout)");
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, timeout);
}

/**
 * Automatically passes the priority during a timeout.
 * For AI players: Always auto-pass.
 * For human players: Only auto-pass if they have no valid responses available.
 */
function doAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  reason: string
) {
  try {
    const playerId = game.state.priority;
    if (!playerId) return;
    const triggerAutoPassReason = getTopTriggeredAbilityAutoPassReason(game.state, playerId);
    
    // Check if priority player exists
    const players = (game.state as any)?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === playerId);
    
    if (!priorityPlayer) {
      debugWarn(2, `[doAutoPass] Priority player ${playerId} not found in game ${gameId}`);
      return;
    }
    
    // Get turn player and current step for checks below
    const turnPlayer = game.state.turnPlayer;
    const currentStep = (game.state.step || '').toString().toUpperCase();
    
    // In multiplayer, defending player is anyone being attacked, not just "not the turn player"
    // Check if this player has creatures attacking them
    const battlefield = game.state?.battlefield || [];
    const isBeingAttacked = battlefield.some((perm: any) => perm?.attacking === playerId);
    
    // Check if player has potential blockers (untapped creatures)
    const hasPotentialBlockers = battlefield.some((perm: any) => {
      if (!perm || perm.controller !== playerId) return false;
      if (perm.tapped) return false;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    
    const isDefendingPlayer = isBeingAttacked && hasPotentialBlockers;
    
    // For human players, only auto-pass if they have NO valid responses
    if (!priorityPlayer.isAI) {
      // For the active player (turn player), check BOTH canAct and canRespond
      // They need to be able to hold priority to cast instants on their own turn
      // For non-active players, only check canRespond (instant-speed responses)
      const isActivePlayer = playerId === turnPlayer;
      const hasActions = isActivePlayer 
        ? (canAct(game as any, playerId) || canRespond(game as any, playerId))
        : canRespond(game as any, playerId);

      const stateAny = game.state as any;
      const stackLen = Array.isArray(game.state?.stack) ? game.state.stack.length : 0;
      const autoPassForTurn = stateAny.autoPassForTurn?.[playerId] || false;
      const loopStackDrain = stateAny.loopShortcutStackDrain?.[playerId] === true;
      const autoPassEnabled = stateAny.autoPassPlayers instanceof Set
        ? stateAny.autoPassPlayers.has(playerId)
        : false;
      const bypassIdleForStack = shouldBypassIdleForNonEmptyStack({
        stackLen,
        autoPassEnabled,
        loopStackDrain,
        autoPassForTurn,
        state: game.state,
        playerId: String(playerId),
      });
      
      if (hasActions && !triggerAutoPassReason && !bypassIdleForStack) {
        debug(2, `[doAutoPass] Skipping auto-pass for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - they have valid actions available`);
        return; // Player has options, don't auto-pass
      }

      if (hasActions && (triggerAutoPassReason || bypassIdleForStack)) {
        debug(2, `[doAutoPass] Auto-passing for human player ${playerId} despite valid actions because ${triggerAutoPassReason || `stack drain (len=${stackLen})`} applies`);
      }
      
      debug(2, `[doAutoPass] Auto-passing for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - no valid actions available`);
      // Fall through to auto-pass since player has no valid responses
    }
    
    // IMPORTANT: Don't auto-pass during DECLARE_BLOCKERS step for defending players
    // Per Rule 509, the defending player must be given the opportunity to declare blockers
    // This is a turn-based action that doesn't use the stack
    // Only prevent auto-pass if player is being attacked AND has untapped creatures to block with
    
    if ((currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) && isDefendingPlayer) {
      debug(2, `[doAutoPass] Skipping auto-pass for ${playerId} during DECLARE_BLOCKERS step - player has potential blockers`);
      return;
    }

    // game.passPriority may not exist on some wrappers; call defensively
    let res: any = null;
    if (typeof (game as any).passPriority === "function") {
      res = (game as any).passPriority(playerId, true); // true = isAutoPass
    } else if (typeof (game as any).nextPass === "function") {
      res = (game as any).nextPass(playerId);
    } else {
      debugWarn(1, 
        "doAutoPass: game.passPriority not implemented for this game wrapper"
      );
      return;
    }

    const changed = Boolean(res && (res.changed ?? true));
    const resolvedNow = Boolean(res && (res.resolvedNow ?? false));
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, reason });

    if (resolvedNow) {
      const deferredMox = tryQueueMoxDiamondBeforeStackResolve(game);
      if (!deferredMox && persistAndResolveTopOfStack(game, gameId)) {
        runPostResolutionPermanentPromptChecks(io, game, gameId);
        debug(2, `[doAutoPass] Stack resolved for game ${gameId}`);
      }
      try {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved automatically.",
          ts: Date.now(),
        });
      } catch (err) {
        debugWarn(1, "doAutoPass: failed to emit chat", err);
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err) {
    debugWarn(1, "doAutoPass: unexpected error", err);
  }
}

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/**
 * Check for search restrictions affecting a player
 */
export function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const result = evaluateLibrarySearchReplacementEvent({ game, searchingPlayerId });
  const metadata = (result.metadata || {}) as any;
  
  return {
    canSearch: metadata.canSearch !== false,
    limitToTop: typeof metadata.limitToTop === 'number' ? metadata.limitToTop : undefined,
    triggerEffects: Array.isArray(metadata.triggerEffects) ? metadata.triggerEffects : [],
    controlledBy: metadata.controlledBy,
    reason: metadata.reason,
    paymentRequired: metadata.paymentRequired,
  };
}



/**
 * Parse search criteria string into a filter object for library search.
 * E.g., "basic land card" -> { types: ['land'], supertypes: ['basic'] }
 * E.g., "planeswalker card" -> { types: ['planeswalker'] }
 * 
 * The filter format must match LibrarySearchModalProps['filter']:
 * - types: string[] (e.g., ['creature', 'planeswalker'])
 * - subtypes: string[] (e.g., ['forest', 'equipment'])
 * - supertypes: string[] (e.g., ['basic', 'legendary'])
 * - maxCmc: number
 */
function parseSearchFilter(criteria: string): { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } {
  if (!criteria) return {};
  
  const filter: { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } = {};
  const text = criteria.toLowerCase();
  
  // Card types - must be in types array for client filter to work
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('land')) types.push('land');
  if (text.includes('tribal') || text.includes('kindred')) types.push('tribal');
  if (text.includes('battle')) types.push('battle');
  
  // Special composite types (these are handled specially by client matchesFilter)
  if (text.includes('historic')) types.push('historic');
  if (text.includes('permanent')) types.push('permanent');
  if (text.includes('noncreature')) types.push('noncreature');
  if (text.includes('nonland')) types.push('nonland');
  if (text.includes('nonartifact')) types.push('nonartifact');
  
  if (types.length > 0) {
    filter.types = types;
  }
  
  // Supertypes (Basic, Legendary, Snow, World, Ongoing)
  // Note: 'host' is included for consistency with existing code, though per MTG rules it's a creature type
  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  if (text.includes('world')) supertypes.push('world');
  if (text.includes('ongoing')) supertypes.push('ongoing');
  if (text.includes('host')) supertypes.push('host');
  
  if (supertypes.length > 0) {
    filter.supertypes = supertypes;
  }
  
  // Subtypes (land types, creature types, etc.)
  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('equipment')) subtypes.push('equipment');
  if (text.includes('aura')) subtypes.push('aura');
  if (text.includes('vehicle')) subtypes.push('vehicle');
  
  if (subtypes.length > 0) {
    filter.subtypes = subtypes;
  }
  
  // CMC restrictions
  const cmcMatch = text.match(/mana value (\d+) or less/);
  if (cmcMatch) {
    filter.maxCmc = parseInt(cmcMatch[1], 10);
  }
  
  return filter;
}






/**
 * Maps mana color symbols to their human-readable names.
 */
export const MANA_COLOR_NAMES: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
  'C': 'colorless',
};

/**
 * Standard mana color symbols in WUBRG order plus colorless.
 */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColorSymbol = typeof MANA_COLORS[number];

/**
 * Gets the human-readable name for a mana color symbol.
 */
export function getManaColorName(symbol: string): string {
  return MANA_COLOR_NAMES[symbol] || symbol.toLowerCase();
}

/**
 * Parses a string mana cost into its individual components (color distribution, generic mana, etc.).
 * Handles Phyrexian mana symbols like {W/P} (can be paid with W or 2 life)
 */
export function parseManaCost(
  manaCost?: string
): {
  colors: Record<string, number>;
  generic: number;
  hybrid: Array<Array<string>>;
  hybrids: Array<Array<string>>;
  hasX: boolean;
} {
  const parsed = parseManaFromString(manaCost);
  const hybrids = Array.isArray((parsed as any).hybrids)
    ? (parsed as any).hybrids.map((entry: string[]) => [...entry])
    : Array.isArray(parsed.hybrid)
      ? parsed.hybrid.map((entry) => [...entry])
      : [];
  return {
    colors: { ...parsed.colors },
    generic: parsed.generic,
    hybrid: hybrids,
    hybrids,
    hasX: parsed.hasX,
  };
}

/**
 * True when an activation cost includes costs spell-payment cannot currently pay
 * (discard, exile, pay life text residue, remove-from-other, etc.). Shared by cast
 * payment and AI payment planning so the AI never selects sources the caster rejects.
 * Self remove-counter clauses are supported and stripped before the residue check.
 */
export function paymentActivationCostHasUnsupportedAdditionalCosts(
  activationCost?: string | null,
  sourceCardName?: string,
): boolean {
  const normalizedCost = String(activationCost || '').trim();
  if (!normalizedCost) return false;

  let residue = normalizedCost;
  residue = residue.replace(/\{(?:[tq]|\d+|[wubrgc])\}/gi, ' ');
  residue = residue.replace(/sacrifice\s+[^,;:]*/gi, ' ');
  // Self remove-counter costs are paid during spell payment; strip only those.
  const parsedRemove = parseRemoveCounterActivationCost(normalizedCost, sourceCardName);
  if (parsedRemove?.refersToSource) {
    residue = residue.replace(parsedRemove.matchPattern, ' ');
  }
  residue = residue.replace(/[().]/g, ' ');
  residue = residue.replace(/,/g, ' ');
  residue = residue.replace(/\s+/g, ' ').trim();

  return residue.length > 0;
}

const REMOVE_COUNTER_COUNT_WORDS = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x';
const REMOVE_COUNTER_COST_PATTERN = new RegExp(
  `\\bremove\\s+(${REMOVE_COUNTER_COUNT_WORDS})\\s+([^,;:]+?)\\s+counters?(?:\\s+from\\s+([^,;:]+))?\\b`,
  'i',
);

export type ParsedRemoveCounterActivationCost = {
  count: number;
  counterType: string;
  refersToSource: boolean;
  matchText: string;
  matchPattern: RegExp;
};

function normalizeRemoveCounterTypePhrase(rawTypePhrase: string): string | null {
  let counterType = String(rawTypePhrase || '')
    .trim()
    .toLowerCase()
    .replace(/^\s*(?:a|an)\s+/i, '')
    .replace(/\s+from\b.*$/i, '')
    .replace(/\s+/g, ' ');
  if (!counterType) return null;
  if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType) || /\bplus\s*one\b/.test(counterType)) return '+1/+1';
  if (/-\s*1\s*\/\s*-\s*1/i.test(counterType) || /\bminus\s*one\b/.test(counterType)) return '-1/-1';
  if (/^\d+\s*\/\s*\d+$/i.test(counterType)) return null;
  const first = counterType.split(/\s+/)[0];
  return String(first || '').toLowerCase() || null;
}

function parseRemoveCounterCountToken(rawCount: string): number {
  const normalized = String(rawCount || '').trim().toLowerCase();
  if (!normalized || normalized === 'x') return 0;
  const wordMap: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  if (Object.prototype.hasOwnProperty.call(wordMap, normalized)) {
    return wordMap[normalized];
  }
  const asNumber = Number.parseInt(normalized, 10);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}

/**
 * Parse "Remove N <counter> counter(s) [from <source>]" activation costs.
 * Missing "from ..." is treated as removing from the source permanent.
 */
export function parseRemoveCounterActivationCost(
  costText: string,
  sourceCardName?: string,
): ParsedRemoveCounterActivationCost | null {
  const match = String(costText || '').match(REMOVE_COUNTER_COST_PATTERN);
  if (!match) return null;

  const count = parseRemoveCounterCountToken(String(match[1] || ''));
  const counterType = normalizeRemoveCounterTypePhrase(String(match[2] || ''));
  if (count <= 0 || !counterType) return null;

  const sourceRef = String(match[3] || '').trim().toLowerCase();
  const nameLower = String(sourceCardName || '').trim().toLowerCase();
  const refersToSource = !sourceRef
    || /\b(this|this permanent|this artifact|this creature|this land|this enchantment|it|~|source)\b/i.test(sourceRef)
    || (nameLower.length > 0 && sourceRef.includes(nameLower));

  return {
    count,
    counterType,
    refersToSource,
    matchText: String(match[0] || ''),
    matchPattern: new RegExp(REMOVE_COUNTER_COST_PATTERN.source, 'i'),
  };
}

export function getPermanentCounterKeyCandidates(counterType: string): string[] {
  const ct = String(counterType || '');
  if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
  if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
  return [ct];
}

export function getPermanentCounterAmount(permanent: any, counterType: string): number {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  for (const key of getPermanentCounterKeyCandidates(counterType)) {
    const amount = Number(counters[key] || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

export function resolvePermanentCounterKey(permanent: any, counterType: string, requiredCount: number = 1): string | null {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  const needed = Math.max(1, Number(requiredCount || 1));
  return getPermanentCounterKeyCandidates(counterType).find((key) => Number(counters[key] || 0) >= needed) || null;
}

function resolveRemoveCounterCostFromActivation(
  activationCost: string,
  sourceCardName?: string,
): ParsedRemoveCounterActivationCost | null {
  return parseRemoveCounterActivationCost(activationCost, sourceCardName);
}

/**
 * True when a permanent both invests counters via a paid activated ability and can
 * later remove those counters for mana (Gemstone Array, Trigon charge lines, etc.).
 */
export function permanentHasManaBatteryCounterLoop(permanent: any): {
  invests: boolean;
  paysOut: boolean;
  counterTypes: string[];
} {
  const oracleText = String(permanent?.card?.oracle_text || '');
  const lines = oracleText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const investTypes = new Set<string>();
  const payoutTypes = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    const putMatch = lower.match(
      /(?:^|:\s*)(?:\{[^}]+\}(?:,\s*\{[^}]+\})*\s*,?\s*)?put\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
    );
    if (putMatch && /\{[^}]+\}/.test(line.split(':')[0] || '')) {
      const counterType = normalizeRemoveCounterTypePhrase(String(putMatch[1] || ''));
      if (counterType) investTypes.add(counterType);
    }

    const colonSplit = line.split(':');
    if (colonSplit.length < 2) continue;
    const costPart = colonSplit[0] || '';
    const effectPart = colonSplit.slice(1).join(':');
    const remove = parseRemoveCounterActivationCost(costPart, String(permanent?.card?.name || ''));
    if (remove?.refersToSource && /\badd\b/i.test(effectPart) && /\bmana\b|\{[wubrgc]\}/i.test(effectPart)) {
      payoutTypes.add(remove.counterType);
    }
  }

  const shared = [...investTypes].filter((type) => payoutTypes.has(type));
  return {
    invests: investTypes.size > 0,
    paysOut: payoutTypes.size > 0,
    counterTypes: shared.length > 0 ? shared : [...payoutTypes],
  };
}


/**
 * Consumes mana from a player's mana pool to pay for a spell cost.
 * Returns the remaining mana in the pool after payment.
 * 
 * This function first consumes colored mana requirements, then uses remaining mana
 * (preferring colorless) to pay for generic costs. Any unspent mana remains in the pool
 * for subsequent spells.
 * 
 * @param pool - The player's mana pool (will be modified in place)
 * @param coloredCost - The colored mana requirements (e.g., { W: 1, U: 1, ... })
 * @param genericCost - The amount of generic mana required
 * @param logPrefix - Optional prefix for debug logging
 * @returns The mana consumed and remaining in pool
 */
export function consumeManaFromPool(
  pool: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  logPrefix?: string
): { consumed: Record<string, number>; remaining: Record<string, number> } {
  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  
  // First, consume colored mana requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    if (needed > 0 && colorKey && pool[colorKey] >= needed) {
      pool[colorKey] -= needed;
      consumed[colorKey] = (consumed[colorKey] || 0) + needed;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${needed} ${color} mana from pool`);
      }
    }
  }
  
  // Then, consume generic mana (use any available mana, preferring colorless first)
  let genericLeft = genericCost;
  
  // First use colorless
  if (genericLeft > 0 && pool.colorless > 0) {
    const useColorless = Math.min(pool.colorless, genericLeft);
    pool.colorless -= useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
    if (logPrefix) {
      debug(2, `${logPrefix} Consumed ${useColorless} colorless mana for generic cost`);
    }
  }
  
  // Then use other colors
  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (colorKey && pool[colorKey] > 0) {
      const useColor = Math.min(pool[colorKey], genericLeft);
      pool[colorKey] -= useColor;
      consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
      genericLeft -= useColor;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${useColor} ${color} mana for generic cost`);
      }
    }
  }
  
  // Log remaining mana in pool
  if (logPrefix) {
    const remainingMana = Object.entries(pool).filter(([_, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
    if (remainingMana) {
      debug(2, `${logPrefix} Unspent mana remaining in pool: ${remainingMana}`);
    }
  }

  // Treasure provenance: maintain a conservative lower bound of Treasure-produced mana
  // remaining in this pool. We pessimistically decrement by all mana spent, which keeps
  // the lower bound <= actual Treasure mana (replay-safe, avoids false positives).
  try {
    const lb = (pool as any).treasureManaLowerBound;
    if (lb && typeof lb === 'object') {
      for (const k of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
        const used = Number((consumed as any)[k] || 0);
        if (!Number.isFinite(used) || used <= 0) continue;
        lb[k] = Math.max(0, Number(lb[k] || 0) - used);
      }
    }
  } catch {
    // best-effort only
  }

  // Creature-spell haste provenance: maintain a conservative lower bound of mana
  // remaining in this pool that can grant haste to a creature spell when spent.
  try {
    const lb = (pool as any).creatureSpellHasteManaLowerBound;
    if (lb && typeof lb === 'object') {
      for (const k of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
        const used = Number((consumed as any)[k] || 0);
        if (!Number.isFinite(used) || used <= 0) continue;
        lb[k] = Math.max(0, Number(lb[k] || 0) - used);
      }
    }
  } catch {
    // best-effort only
  }
  
  // Return only the mana color properties for the remaining pool
  const remaining: Record<string, number> = {};
  for (const key of MANA_COLOR_KEYS) {
    remaining[key] = pool[key] || 0;
  }
  
  return { consumed, remaining };
}

  type GenericManaPaymentOptions = {
    excludedPermanentIds?: string[];
  };

  type GenericManaPaymentResult = {
    ok: boolean;
    error?: string;
    tappedPermanents: string[];
    sacrificedPermanents: string[];
    paymentManaDelta: Record<string, number>;
    consumed: Record<string, number>;
  };

  function escapeRegExp(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isSelfSacrificeManaSource(permanent: any): boolean {
    const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
    const cardName = String(permanent?.card?.name || '').trim().toLowerCase();
    if (!oracleText.includes('add')) return false;
    if (/\bsacrifice\s+this\b[^:]*:\s*add\b/i.test(oracleText)) return true;
    if (cardName && new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^:]*:\\s*add\\b`, 'i').test(oracleText)) {
      return true;
    }
    return false;
  }

  function isPureSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    let normalized = costText;
    for (const pattern of [
      /\bsacrifice\s+(?:this|~|it)\b[^,]*/gi,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^,]*`, 'gi') : null,
    ]) {
      if (!pattern) continue;
      normalized = normalized.replace(pattern, ' ');
    }

    return normalized.replace(/[\s,]+/g, ' ').trim().length === 0;
  }

  function hasSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    return [
      /\bsacrifice\s+(?:this|~|it)\b/i,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b`, 'i') : null,
    ].some((pattern) => Boolean(pattern && pattern.test(costText)));
  }

  function isTapAndOrSelfSacrificeActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return false;

    const cardName = String(permanent?.card?.name || '').trim();
    let normalized = costText;
    for (const pattern of [
      /\bsacrifice\s+(?:this|~|it)\b[^,]*/gi,
      cardName ? new RegExp(`\\bsacrifice\\s+${escapeRegExp(cardName)}\\b[^,]*`, 'gi') : null,
    ]) {
      if (!pattern) continue;
      normalized = normalized.replace(pattern, ' ');
    }

    normalized = normalized
      .replace(/\{t\}/gi, ' ')
      .replace(/[\s,]+/g, ' ')
      .trim();

    return normalized.length === 0;
  }

  function supportsGenericAutoPaymentActivationCost(permanent: any, activationCost: unknown): boolean {
    const costText = String(activationCost || '').trim();
    if (!costText) return true;
    if (isTapAndOrSelfSacrificeActivationCost(permanent, costText)) return true;

    const manaSymbols = costText.match(/\{[^}]+\}/g) || [];
    if (manaSymbols.some((symbol) => !/^\{t\}$/i.test(symbol))) {
      return false;
    }

    const stripped = costText
      .replace(/\{t\}/gi, ' ')
      .replace(/[\s,]+/g, ' ')
      .trim()
      .toLowerCase();

    return stripped.length === 0;
  }

  function getBestGenericAutoPaymentOption(
    gameState: any,
    permanent: any,
    playerId: string,
  ): { amount: number; sacrificesSelf: boolean } | null {
    let bestOption: { amount: number; sacrificesSelf: boolean } | null = null;
    const genericAbilityPrefix = String(permanent?.id || 'permanent');
    let sawExplicitManaAbility = false;
    for (let index = 0; index < 50; index += 1) {
      const resolvedLine = resolveActivatedAbilityLineById(permanent, `${genericAbilityPrefix}-ability-${index}`);
      if (!resolvedLine) break;

      if (!/\badd\b/i.test(String(resolvedLine.effectText || ''))) continue;
      sawExplicitManaAbility = true;
      if (!supportsGenericAutoPaymentActivationCost(permanent, resolvedLine.costText)) continue;

      const production = calculateManaProduction(
        gameState,
        permanent,
        playerId,
        undefined,
        `${genericAbilityPrefix}-ability-${index}`,
      );
      const amount = Number(production?.totalAmount || production?.baseAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Array.isArray(production?.colors) || production.colors.length === 0) continue;

      const candidate = {
        amount: Math.max(1, amount),
        sacrificesSelf: hasSelfSacrificeActivationCost(permanent, resolvedLine.costText),
      };

      if (!bestOption || candidate.amount > bestOption.amount) {
        bestOption = candidate;
      }
    }

    if (sawExplicitManaAbility) return bestOption;

    let manaAbilities: any[] = [];
    try {
      manaAbilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
    } catch {
      manaAbilities = [];
    }

    for (const ability of manaAbilities) {
      if (!supportsGenericAutoPaymentActivationCost(permanent, ability?.cost)) continue;

      const production = calculateManaProduction(gameState, permanent, playerId, undefined, ability?.id);
      const amount = Number(production?.totalAmount || production?.baseAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Array.isArray(production?.colors) || production.colors.length === 0) continue;

      const candidate = {
        amount: Math.max(1, amount),
        sacrificesSelf: hasSelfSacrificeActivationCost(permanent, ability?.cost)
          || (!ability?.cost && isSelfSacrificeManaSource(permanent)),
      };

      if (!bestOption || candidate.amount > bestOption.amount) {
        bestOption = candidate;
      }
    }

    if (bestOption) return bestOption;
    if (manaAbilities.length > 0) return null;

    const production = calculateManaProduction(gameState, permanent, playerId);
    const amount = Number(production?.totalAmount || production?.baseAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!supportsGenericAutoPaymentActivationCost(permanent, production?.activationCost)) return null;
    if (!Array.isArray(production?.colors) || production.colors.length === 0) return null;

    return {
      amount: Math.max(1, amount),
      sacrificesSelf: hasSelfSacrificeActivationCost(permanent, production?.activationCost)
        || (!production?.activationCost && isSelfSacrificeManaSource(permanent)),
    };
  }

  function recordTokenGraveyardSnapshot(gameState: any, ownerId: string, permanent: any): void {
    const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
      ? { ...(permanent.card || {}), zone: 'graveyard' }
      : null;
    if (!tokenGraveyardSnapshot || !ownerId) return;

    const zones = (gameState.zones = gameState.zones || {});
    const playerZones = (zones[ownerId] = zones[ownerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

    const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
      if (!card) return false;
      const cardId = String((card as any).id || '').trim();
      const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
      if (cardId && snapshotId) return cardId === snapshotId;
      return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
    });

    if (!alreadyPresent) {
      (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
      playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    }
  }

  function getGenericAutoPaymentCandidates(
    gameState: any,
    playerId: string,
    excludedPermanentIds?: string[],
  ): Array<{ permanent: any; amount: number; sacrificesSelf: boolean }> {
    const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    const excluded = new Set((excludedPermanentIds || []).map((id) => String(id)));

    return battlefield
      .filter((permanent: any) => {
        if (!permanent) return false;
        if (String(permanent.controller || '') !== String(playerId)) return false;
        if (permanent.tapped) return false;
        if (excluded.has(String(permanent.id || ''))) return false;

        const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
        const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
        const hasExplicitManaAbility =
          /\{t\}(?:[,\s]*[^:]*)?:\s*add/i.test(oracleText) ||
          oracleText.includes('mana of any color') ||
          oracleText.includes('any color') ||
          typeLine.includes('plains') ||
          typeLine.includes('island') ||
          typeLine.includes('swamp') ||
          typeLine.includes('mountain') ||
          typeLine.includes('forest');
        if (!hasExplicitManaAbility) return false;

        return !!getBestGenericAutoPaymentOption(gameState, permanent, playerId);
      })
      .map((permanent: any) => {
        const option = getBestGenericAutoPaymentOption(gameState, permanent, playerId);
        return {
          permanent,
          amount: Math.max(1, Number(option?.amount || 0)),
          sacrificesSelf: option?.sacrificesSelf === true,
        };
      })
      .sort((left, right) => {
        const leftType = String(left.permanent?.card?.type_line || '').toLowerCase();
        const rightType = String(right.permanent?.card?.type_line || '').toLowerCase();
        const leftIsLand = leftType.includes('land') ? 0 : 1;
        const rightIsLand = rightType.includes('land') ? 0 : 1;
        if (leftIsLand !== rightIsLand) return leftIsLand - rightIsLand;
        const leftIsConsumable = left.sacrificesSelf ? 1 : 0;
        const rightIsConsumable = right.sacrificesSelf ? 1 : 0;
        if (leftIsConsumable !== rightIsConsumable) return leftIsConsumable - rightIsConsumable;
        return left.amount - right.amount;
      });
  }

  export function getMaxGenericManaAvailable(
    gameState: any,
    playerId: string,
    options?: GenericManaPaymentOptions,
  ): number {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    const floating =
      Number(pool?.white || 0) +
      Number(pool?.blue || 0) +
      Number(pool?.black || 0) +
      Number(pool?.red || 0) +
      Number(pool?.green || 0) +
      Number(pool?.colorless || 0);

    const sourceTotal = getGenericAutoPaymentCandidates(gameState, playerId, options?.excludedPermanentIds)
      .reduce((sum, entry) => sum + entry.amount, 0);

    return floating + sourceTotal;
  }

  export function payGenericManaWithAvailableSources(
    gameState: any,
    playerId: string,
    amount: number,
    options?: GenericManaPaymentOptions,
  ): GenericManaPaymentResult {
    const needed = Math.max(0, Math.floor(Number(amount) || 0));
    const emptyConsumed = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    if (needed <= 0) {
      return { ok: true, tappedPermanents: [], sacrificedPermanents: [], paymentManaDelta: {}, consumed: emptyConsumed };
    }

    const maxAvailable = getMaxGenericManaAvailable(gameState, playerId, options);
    if (maxAvailable < needed) {
      return {
        ok: false,
        error: `Insufficient mana. Missing ${needed - maxAvailable} generic mana.`,
        tappedPermanents: [],
        sacrificedPermanents: [],
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const pool = getOrInitManaPool(gameState, playerId) as any;
    const beforePool = {
      white: Number(pool.white || 0),
      blue: Number(pool.blue || 0),
      black: Number(pool.black || 0),
      red: Number(pool.red || 0),
      green: Number(pool.green || 0),
      colorless: Number(pool.colorless || 0),
    };
    const tappedPermanents: string[] = [];
    const sacrificedPermanents: string[] = [];
    const floating = Object.values(beforePool).reduce((sum, value) => sum + Number(value || 0), 0);
    let manaNeeded = Math.max(0, needed - floating);

    if (manaNeeded > 0) {
      for (const entry of getGenericAutoPaymentCandidates(gameState, playerId, options?.excludedPermanentIds)) {
        if (manaNeeded <= 0) break;

        const permanent = entry.permanent;
        if (!permanent || permanent.tapped) continue;

        if (entry.sacrificesSelf) {
          const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
          const sacrificed = movePermanentToGraveyard({
            state: gameState,
            libraries: new Map(),
            bumpSeq: () => undefined,
            rng: Math.random,
            gameId: '',
          } as any, String(permanent.id || ''), true);
          if (!sacrificed) continue;
          recordTokenGraveyardSnapshot(gameState, graveyardOwnerId, permanent);
          sacrificedPermanents.push(String(permanent.id || ''));
        } else {
          permanent.tapped = true;
          tappedPermanents.push(String(permanent.id || ''));
        }

        pool.colorless = Number(pool.colorless || 0) + entry.amount;
        manaNeeded -= entry.amount;
      }
    }

    const { consumed } = consumeManaFromPool(pool, {}, needed, `[genericPayment:${playerId}]`);
    const paymentManaDelta: Record<string, number> = {};
    for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const) {
      const delta = Number(pool[key] || 0) - beforePool[key];
      if (delta !== 0) paymentManaDelta[key] = delta;
    }

    return {
      ok: true,
      tappedPermanents,
      sacrificedPermanents,
      paymentManaDelta,
      consumed,
    };
  }

  type AvailableSourceManaPaymentPlanEntry = {
    permanent: any;
    additions: Record<string, number>;
    sacrificesSelf: boolean;
  };

  export type AvailableSourceManaPaymentResult = GenericManaPaymentResult;

  function getAvailableSourceManaPaymentOptions(
    gameState: any,
    playerId: string,
  ): Array<{ permanent: any; options: Array<{ additions: Record<string, number>; sacrificesSelf: boolean }> }> {
    const candidates = getGenericAutoPaymentCandidates(gameState, playerId);
    const symbolToPoolKey: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      C: 'colorless',
    };

    return candidates.flatMap((candidate) => {
      const production = calculateManaProduction(gameState, candidate.permanent, playerId);
      const amount = Math.max(1, Number(production?.totalAmount || production?.baseAmount || candidate.amount || 0));
      const colors = Array.from(new Set(
        (Array.isArray(production?.colors) ? production.colors : [])
          .map((color: any) => String(color || '').toUpperCase())
          .filter(Boolean),
      ));
      if (colors.length === 0) return [];

      const options: Array<{ additions: Record<string, number>; sacrificesSelf: boolean }> = [];
      const isChoice = production?.requiresColorChoice === true || colors.includes('ANY');
      if (isChoice) {
        const choices = colors.includes('ANY')
          ? ['W', 'U', 'B', 'R', 'G']
          : colors.filter((color) => symbolToPoolKey[color]);
        for (const color of choices) {
          const poolKey = symbolToPoolKey[color];
          if (!poolKey) continue;
          options.push({
            additions: { [poolKey]: amount },
            sacrificesSelf: candidate.sacrificesSelf,
          });
        }
      } else if (colors.length > 1) {
        const amountPerColor = Math.max(1, Math.floor(amount / colors.length));
        const additions: Record<string, number> = {};
        for (const color of colors) {
          const poolKey = symbolToPoolKey[color];
          if (poolKey) additions[poolKey] = amountPerColor;
        }
        if (Object.keys(additions).length > 0) {
          options.push({ additions, sacrificesSelf: candidate.sacrificesSelf });
        }
      } else {
        const poolKey = symbolToPoolKey[colors[0]];
        if (poolKey) {
          options.push({
            additions: { [poolKey]: amount },
            sacrificesSelf: candidate.sacrificesSelf,
          });
        }
      }

      return options.length > 0 ? [{ permanent: candidate.permanent, options }] : [];
    });
  }

  function findAvailableSourceManaPaymentPlan(
    gameState: any,
    playerId: string,
    manaCost: string,
  ): AvailableSourceManaPaymentPlanEntry[] | null {
    const startingPool = getPoolNumericSnapshot(getOrInitManaPool(gameState, playerId));
    if (validateAndConsumeManaCostFromPool({ ...startingPool }, manaCost).ok) {
      return [];
    }

    const sources = getAvailableSourceManaPaymentOptions(gameState, playerId);
    const memo = new Set<string>();

    const search = (
      sourceIndex: number,
      pool: Record<string, number>,
      plan: AvailableSourceManaPaymentPlanEntry[],
    ): AvailableSourceManaPaymentPlanEntry[] | null => {
      if (validateAndConsumeManaCostFromPool({ ...pool }, manaCost).ok) {
        return plan;
      }
      if (sourceIndex >= sources.length) return null;

      const signature = `${sourceIndex}|${MANA_COLOR_KEYS.map((key) => Number(pool[key] || 0)).join(',')}`;
      if (memo.has(signature)) return null;
      memo.add(signature);

      const source = sources[sourceIndex];
      for (const option of source.options) {
        const nextPool = { ...pool };
        for (const [poolKey, rawAmount] of Object.entries(option.additions)) {
          nextPool[poolKey] = Number(nextPool[poolKey] || 0) + Number(rawAmount || 0);
        }
        const found = search(sourceIndex + 1, nextPool, [
          ...plan,
          {
            permanent: source.permanent,
            additions: option.additions,
            sacrificesSelf: option.sacrificesSelf,
          },
        ]);
        if (found) return found;
      }

      return search(sourceIndex + 1, pool, plan);
    };

    return search(0, startingPool, []);
  }

  export function canPayManaCostStringWithAvailableSources(
    gameState: any,
    playerId: string,
    manaCost: string,
  ): boolean {
    return findAvailableSourceManaPaymentPlan(gameState, playerId, manaCost) !== null;
  }

  export function payManaCostWithAvailableSources(
    gameState: any,
    playerId: string,
    manaCost: string,
  ): AvailableSourceManaPaymentResult {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    const beforePool = getPoolNumericSnapshot(pool);
    const emptyConsumed = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    const plan = findAvailableSourceManaPaymentPlan(gameState, playerId, manaCost);
    if (!plan) {
      return {
        ok: false,
        error: `Insufficient available mana to pay ${manaCost}.`,
        tappedPermanents: [],
        sacrificedPermanents: [],
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const tappedPermanents: string[] = [];
    const sacrificedPermanents: string[] = [];
    for (const entry of plan) {
      const permanent = entry.permanent;
      if (!permanent || permanent.tapped) continue;
      if (entry.sacrificesSelf) {
        const ownerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
        const sacrificed = movePermanentToGraveyard({
          state: gameState,
          libraries: new Map(),
          bumpSeq: () => undefined,
          rng: Math.random,
          gameId: '',
        } as any, String(permanent.id || ''), true);
        if (!sacrificed) continue;
        recordTokenGraveyardSnapshot(gameState, ownerId, permanent);
        sacrificedPermanents.push(String(permanent.id || ''));
      } else {
        permanent.tapped = true;
        tappedPermanents.push(String(permanent.id || ''));
      }
      for (const [poolKey, rawAmount] of Object.entries(entry.additions)) {
        pool[poolKey] = Number(pool[poolKey] || 0) + Number(rawAmount || 0);
      }
    }

    const paid = validateAndConsumeManaCostFromPool(pool, manaCost, {
      logPrefix: `[availableSourcePayment:${playerId}]`,
    });
    if (!paid.ok) {
      for (const permanentId of tappedPermanents) {
        const permanent = (Array.isArray(gameState?.battlefield) ? gameState.battlefield : [])
          .find((entry: any) => String(entry?.id || '') === permanentId);
        if (permanent) permanent.tapped = false;
      }
      for (const key of MANA_COLOR_KEYS) {
        pool[key] = Number(beforePool[key] || 0);
      }
      return {
        ok: false,
        error: (paid as any).error || `Unable to pay ${manaCost}.`,
        tappedPermanents: [],
        sacrificedPermanents,
        paymentManaDelta: {},
        consumed: emptyConsumed,
      };
    }

    const paymentManaDelta: Record<string, number> = {};
    for (const key of MANA_COLOR_KEYS) {
      const delta = Number(pool[key] || 0) - Number(beforePool[key] || 0);
      if (delta !== 0) paymentManaDelta[key] = delta;
    }
    return {
      ok: true,
      tappedPermanents,
      sacrificedPermanents,
      paymentManaDelta,
      consumed: paid.consumed,
    };
  }

  export function refundGenericManaPayment(
    gameState: any,
    playerId: string,
    payment: Pick<GenericManaPaymentResult, 'paymentManaDelta' | 'tappedPermanents'>,
  ): void {
    const pool = getOrInitManaPool(gameState, playerId) as any;
    for (const [poolKey, rawAmount] of Object.entries(payment.paymentManaDelta || {})) {
      const amount = Number(rawAmount || 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      pool[poolKey] = Number(pool[poolKey] || 0) - amount;
    }

    const tappedIds = new Set((payment.tappedPermanents || []).map((id) => String(id)).filter(Boolean));
    if (tappedIds.size === 0) return;

    const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent) continue;
      if (!tappedIds.has(String((permanent as any).id || ''))) continue;
      (permanent as any).tapped = false;
    }
  }

type ManaPoolColorKey = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

function getOrInitTreasureManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const pool = getOrInitManaPool(gameState, String(playerId)) as any;
  pool.treasureManaLowerBound = pool.treasureManaLowerBound || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
  return pool.treasureManaLowerBound as Record<ManaPoolColorKey, number>;
}

/**
 * Best-effort, replay-safe lower-bound tracking for how much mana in the pool could
 * have been produced by Treasures.
 *
 * This is intentionally conservative:
 * - We only ever increment when we directly see a Treasure produce mana.
 * - We may decrement aggressively during spending so we never over-claim Treasure provenance.
 */
export function recordTreasureManaProduced(
  gameState: any,
  playerId: string,
  poolKey: ManaPoolColorKey,
  amount: number
): void {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return;
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  lb[poolKey] = Number(lb[poolKey] || 0) + n;
}

export function snapshotTreasureManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  return { ...lb };
}

export function applyManaSpendToTreasureLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const lb = getOrInitTreasureManaLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    lb[k] = Math.max(0, Number(lb[k] || 0) - used);
  }
}

/**
 * Derive a replay-stable boolean for "mana from a Treasure was spent".
 *
 * We only return a known result when:
 * - No mana was spent at all => deterministically false.
 * - Treasure mana was *forced* based on a lower bound of Treasure-produced mana
 *   present in the pool at the moment of payment.
 */
export function deriveManaFromTreasureSpent(
  gameState: any,
  playerId: string,
  opts: {
    poolBeforePayment: Record<string, number> | null | undefined;
    consumed: Record<string, number> | null | undefined;
    treasureLowerBoundBeforePayment?: Record<string, number> | null | undefined;
  }
): { manaFromTreasureSpentKnown?: true; manaFromTreasureSpent?: boolean } {
  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return {};

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, k) => sum + Number((consumed as any)[k] || 0), 0);

  if (spentTotal <= 0) {
    return { manaFromTreasureSpentKnown: true, manaFromTreasureSpent: false };
  }

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const treasureLB = (opts.treasureLowerBoundBeforePayment && typeof opts.treasureLowerBoundBeforePayment === 'object')
    ? (opts.treasureLowerBoundBeforePayment as any)
    : snapshotTreasureManaLowerBound(gameState, playerId);

  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;

    const before = Number((poolBefore as any)[k] || 0);
    const lb = Number((treasureLB as any)[k] || 0);
    const maxNonTreasure = Math.max(0, before - lb);
    const minTreasureSpent = Math.max(0, used - maxNonTreasure);
    if (minTreasureSpent > 0) {
      return { manaFromTreasureSpentKnown: true, manaFromTreasureSpent: true };
    }
  }

  return {};
}

function getOrInitCreatureSpellHasteManaLowerBound(gameState: any, playerId: string): Record<ManaPoolColorKey, number> {
  const pool = getOrInitManaPool(gameState, String(playerId)) as any;
  if (!pool.creatureSpellHasteManaLowerBound || typeof pool.creatureSpellHasteManaLowerBound !== 'object') {
    Object.defineProperty(pool, 'creatureSpellHasteManaLowerBound', {
      value: {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return pool.creatureSpellHasteManaLowerBound as Record<ManaPoolColorKey, number>;
}

export function recordCreatureSpellHasteManaProduced(
  gameState: any,
  playerId: string,
  poolKey: ManaPoolColorKey,
  amount: number,
): void {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return;
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  lb[poolKey] = Number(lb[poolKey] || 0) + n;
}

export function snapshotCreatureSpellHasteManaLowerBound(
  gameState: any,
  playerId: string,
): Record<ManaPoolColorKey, number> {
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  return { ...lb };
}

export function applyManaSpendToCreatureSpellHasteManaLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined,
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const lb = getOrInitCreatureSpellHasteManaLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    lb[k] = Math.max(0, Number(lb[k] || 0) - used);
  }
}

export function deriveCreatureSpellHasteFromManaSpent(
  gameState: any,
  playerId: string,
  opts: {
    poolBeforePayment: Record<string, number> | null | undefined;
    consumed: Record<string, number> | null | undefined;
    creatureSpellHasteLowerBoundBeforePayment?: Record<string, number> | null | undefined;
  },
): boolean {
  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return false;

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, k) => sum + Number((consumed as any)[k] || 0), 0);
  if (spentTotal <= 0) return false;

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const hasteLB = (opts.creatureSpellHasteLowerBoundBeforePayment && typeof opts.creatureSpellHasteLowerBoundBeforePayment === 'object')
    ? (opts.creatureSpellHasteLowerBoundBeforePayment as any)
    : snapshotCreatureSpellHasteManaLowerBound(gameState, playerId);

  for (const k of keys) {
    const used = Number((consumed as any)[k] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;

    const before = Number((poolBefore as any)[k] || 0);
    const lb = Number((hasteLB as any)[k] || 0);
    const maxNormalMana = Math.max(0, before - lb);
    const minHasteManaSpent = Math.max(0, used - maxNormalMana);
    if (minHasteManaSpent > 0) {
      return true;
    }
  }

  return false;
}

function getOrInitManaProducedByPermanentLowerBound(gameState: any, playerId: string): Record<string, Record<ManaPoolColorKey, number>> {
  const pool = getOrInitManaPool(gameState, playerId) as any;
  if (!pool.manaProducedByPermanentLowerBound || typeof pool.manaProducedByPermanentLowerBound !== 'object') {
    Object.defineProperty(pool, 'manaProducedByPermanentLowerBound', {
      value: {},
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return pool.manaProducedByPermanentLowerBound as Record<string, Record<ManaPoolColorKey, number>>;
}

export function recordManaProducedByPermanentSource(
  gameState: any,
  playerId: string,
  permanentId: string,
  poolKey: ManaPoolColorKey,
  amount: number,
): void {
  const sourceId = String(permanentId || '').trim();
  const n = Number(amount || 0);
  if (!sourceId || !Number.isFinite(n) || n <= 0) return;
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const entry = byPermanent[sourceId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
  };
  entry[poolKey] = Number(entry[poolKey] || 0) + n;
  byPermanent[sourceId] = entry;
}

export function snapshotManaProducedByPermanentLowerBound(
  gameState: any,
  playerId: string,
): Record<string, Record<ManaPoolColorKey, number>> {
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const snapshot: Record<string, Record<ManaPoolColorKey, number>> = {};
  for (const [permanentId, colors] of Object.entries(byPermanent)) {
    snapshot[permanentId] = { ...(colors as Record<ManaPoolColorKey, number>) };
  }
  return snapshot;
}

export function applyManaSpendToManaProducedByPermanentLowerBound(
  gameState: any,
  playerId: string,
  consumed: Record<string, number> | null | undefined,
): void {
  if (!consumed || typeof consumed !== 'object') return;
  const byPermanent = getOrInitManaProducedByPermanentLowerBound(gameState, playerId);
  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  for (const permanentId of Object.keys(byPermanent)) {
    const entry = byPermanent[permanentId];
    if (!entry) continue;
    for (const key of keys) {
      const used = Number((consumed as any)[key] || 0);
      if (!Number.isFinite(used) || used <= 0) continue;
      entry[key] = Math.max(0, Number(entry[key] || 0) - used);
    }
  }
}

export function deriveCastUsedManaFromPermanentSource(
  gameState: any,
  playerId: string,
  permanentId: string,
  opts: {
    poolBeforePayment?: Record<string, number> | null | undefined;
    consumed?: Record<string, number> | null | undefined;
    manaProducedByPermanentBeforePayment?: Record<string, Record<ManaPoolColorKey, number>> | null | undefined;
    manaPayment?: Array<{ permanentId?: string }> | null | undefined;
  },
): boolean {
  const sourceId = String(permanentId || '').trim();
  if (!sourceId) return false;

  const payment = Array.isArray(opts.manaPayment) ? opts.manaPayment : [];
  if (payment.some((entry) => String(entry?.permanentId || '').trim() === sourceId)) {
    return true;
  }

  const consumed = opts.consumed;
  if (!consumed || typeof consumed !== 'object') return false;

  const keys: ManaPoolColorKey[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const spentTotal = keys.reduce((sum, key) => sum + Number((consumed as any)[key] || 0), 0);
  if (spentTotal <= 0) return false;

  const poolBefore = (opts.poolBeforePayment && typeof opts.poolBeforePayment === 'object')
    ? opts.poolBeforePayment
    : {};
  const sourceLB = (opts.manaProducedByPermanentBeforePayment && typeof opts.manaProducedByPermanentBeforePayment === 'object')
    ? (opts.manaProducedByPermanentBeforePayment[sourceId] || {})
    : (snapshotManaProducedByPermanentLowerBound(gameState, playerId)[sourceId] || {});

  for (const key of keys) {
    const used = Number((consumed as any)[key] || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    const before = Number((poolBefore as any)[key] || 0);
    const lb = Number((sourceLB as any)[key] || 0);
    const maxNormalMana = Math.max(0, before - lb);
    const minSourceManaSpent = Math.max(0, used - maxNormalMana);
    if (minSourceManaSpent > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the current mana pool for a player, initializing it if needed.
 * Returns the enhanced ManaPool interface with support for restricted mana.
 */
export function getOrInitManaPool(
  gameState: any,
  playerId: string
): ManaPool {
  gameState.manaPool = gameState.manaPool || {};
  gameState.manaPool[playerId] = gameState.manaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.manaPool[playerId];
}

/**
 * Gets the "doesn't empty" mana pool for a player (mana that persists until end of turn).
 * Used by cards like Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function getOrInitPersistentManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  gameState.persistentManaPool = gameState.persistentManaPool || {};
  gameState.persistentManaPool[playerId] = gameState.persistentManaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.persistentManaPool[playerId];
}

/**
 * Mana retention effects from permanents on the battlefield.
 * 
 * Types of effects:
 * - "doesn't empty" - specific color(s) don't empty (Omnath, Leyline Tyrant)
 * - "becomes colorless" - unspent mana becomes colorless instead of emptying (Kruphix, Horizon Stone)
 * - "all mana doesn't empty" - no mana empties (Upwelling)
 */
export interface ManaRetentionEffect {
  permanentId: string;
  cardName: string;
  type: 'doesnt_empty' | 'becomes_colorless' | 'all_doesnt_empty';
  colors?: string[]; // Which colors are affected (undefined = all)
}

/**
 * Detect mana retention effects from battlefield permanents
 */
export function detectManaRetentionEffects(
  gameState: any,
  playerId: string
): ManaRetentionEffect[] {
  const effects: ManaRetentionEffect[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    if (cardName.includes("omnath, locus of mana") || 
        (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath",
        type: 'doesnt_empty',
        colors: ['green'],
      });
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    // Electro, Assaulting Battery - Red mana doesn't empty
    if (cardName.includes("leyline tyrant") || cardName.includes("electro") ||
        (oracleText.includes("red mana") && oracleText.includes("don't lose")) ||
        (oracleText.includes("don't lose unspent red mana"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Leyline Tyrant",
        type: 'doesnt_empty',
        colors: ['red'],
      });
    }
    
    // Omnath, Locus of All - Mana becomes black instead of emptying
    if (cardName.includes("omnath, locus of all") ||
        (oracleText.includes("mana becomes") && oracleText.includes("instead of emptying"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath, Locus of All",
        type: 'becomes_colorless', // Will be handled specially as 'becomes black'
        colors: ['black'], // Tag to convert to black
      });
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
        oracleText.includes("mana becomes colorless instead")) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Horizon Stone",
        type: 'becomes_colorless',
      });
    }
    
    // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
    if (cardName.includes("upwelling") ||
        (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Upwelling",
        type: 'all_doesnt_empty',
      });
    }
    
    // Omnath, Locus of the Roil / Omnath, Locus of Creation - Landfall mana
    // (These add mana that doesn't need special retention handling)
    
    // Savage Ventmaw - Adds mana that doesn't empty until end of turn
    if (cardName.includes("savage ventmaw")) {
      // This is handled by combat triggers, not retention effects
    }
    
    // Grand Warlord Radha - Adds mana that doesn't empty until end of turn
    if (cardName.includes("grand warlord radha")) {
      // This is handled by attack triggers, not retention effects
    }
  }
  
  return effects;
}

/**
 * Add mana to persistent pool (doesn't empty until end of turn).
 * Sources: Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function addPersistentMana(
  gameState: any,
  playerId: string,
  mana: { white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number }
): void {
  const pool = getOrInitPersistentManaPool(gameState, playerId);
  for (const [color, amount] of Object.entries(mana)) {
    if (amount && amount > 0) {
      pool[color] = (pool[color] || 0) + amount;
    }
  }
}

/**
 * Process mana pool emptying at phase/step end, respecting retention effects.
 * 
 * This is the main function to call when steps/phases end.
 */
export function processManaDrain(gameState: any, playerId: string): {
  drained: Record<string, number>;
  retained: Record<string, number>;
  converted: Record<string, number>; // Colored mana that became colorless
} {
  const pool = getOrInitManaPool(gameState, playerId);
  const effects = detectManaRetentionEffects(gameState, playerId);
  
  const result = {
    drained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    retained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    converted: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  
  // Check for "all mana doesn't empty" effect
  const hasUpwellingEffect = effects.some(e => e.type === 'all_doesnt_empty');
  if (hasUpwellingEffect) {
    // All mana is retained
    for (const color of Object.keys(pool)) {
      result.retained[color] = pool[color] || 0;
    }
    return result;
  }
  
  // Check for "becomes colorless" effect (Kruphix, Horizon Stone)
  const hasBecomesColorless = effects.some(e => e.type === 'becomes_colorless' && !e.colors);
  
  // Check for "becomes black" effect (Omnath, Locus of All)
  const hasBecomesBlack = effects.some(e => e.type === 'becomes_colorless' && e.colors?.includes('black'));
  
  // Check which colors don't empty
  const colorsDoNotEmpty = new Set<string>();
  for (const effect of effects) {
    if (effect.type === 'doesnt_empty' && effect.colors) {
      for (const color of effect.colors) {
        colorsDoNotEmpty.add(color);
      }
    }
  }
  
  // Process each color
  for (const color of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = pool[color] || 0;
    if (amount === 0) continue;
    
    if (colorsDoNotEmpty.has(color)) {
      // This color doesn't empty
      result.retained[color] = amount;
    } else if (hasBecomesBlack && color !== 'colorless' && color !== 'black') {
      // Colored mana becomes black (Omnath, Locus of All)
      result.converted[color] = amount;
      pool.black = (pool.black || 0) + amount;
      pool[color] = 0;
      result.retained.black = (result.retained.black || 0) + amount;
    } else if (hasBecomesColorless && color !== 'colorless') {
      // Colored mana becomes colorless (Kruphix, Horizon Stone)
      result.converted[color] = amount;
      pool.colorless = (pool.colorless || 0) + amount;
      pool[color] = 0;
      result.retained.colorless = (result.retained.colorless || 0) + amount;
    } else {
      // Mana empties normally
      result.drained[color] = amount;
      pool[color] = 0;
    }
  }
  
  return result;
}

/**
 * Clear normal mana pool (at phase/step end).
 * Use processManaDrain() instead for proper handling of retention effects.
 */
export function clearManaPool(gameState: any, playerId: string): void {
  if (gameState.manaPool?.[playerId]) {
    gameState.manaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear persistent mana pool (at end of turn only).
 */
export function clearPersistentManaPool(gameState: any, playerId: string): void {
  if (gameState.persistentManaPool?.[playerId]) {
    gameState.persistentManaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear all mana pools at end of turn.
 */
export function clearAllManaPools(gameState: any, playerId: string): void {
  clearManaPool(gameState, playerId);
  clearPersistentManaPool(gameState, playerId);
}

/**
 * Get total available mana (normal pool + persistent pool).
 */
export function getTotalManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  const normal = getOrInitManaPool(gameState, playerId);
  const persistent = getOrInitPersistentManaPool(gameState, playerId);
  
  return {
    white: (normal.white || 0) + (persistent.white || 0),
    blue: (normal.blue || 0) + (persistent.blue || 0),
    black: (normal.black || 0) + (persistent.black || 0),
    red: (normal.red || 0) + (persistent.red || 0),
    green: (normal.green || 0) + (persistent.green || 0),
    colorless: (normal.colorless || 0) + (persistent.colorless || 0),
  };
}

/**
 * Calculates the total available mana by combining existing pool with new payment.
 * Returns the combined pool in the same format as the mana pool (using color names as keys).
 */
export function calculateTotalAvailableMana(
  existingPool: ManaPool | Record<string, number>,
  newPayment: Array<{ mana: string; count?: number }> | undefined
): Record<string, number> {
  // Start with a copy of the existing pool
  const total: Record<string, number> = {
    white: existingPool.white || 0,
    blue: existingPool.blue || 0,
    black: existingPool.black || 0,
    red: existingPool.red || 0,
    green: existingPool.green || 0,
    colorless: existingPool.colorless || 0,
  };
  
  // Add new payment - use count field for multi-mana sources like Sol Ring
  if (newPayment && newPayment.length > 0) {
    for (const p of newPayment) {
      const colorKey = MANA_COLOR_NAMES[p.mana];
      if (colorKey) {
        // Use count if provided (e.g., Sol Ring produces 2), default to 1
        const manaAmount = p.count ?? 1;
        total[colorKey] = (total[colorKey] || 0) + manaAmount;
      }
    }
  }
  
  return total;
}

/**
 * Validates if the total available mana (existing pool + new payment) can pay for a spell.
 * Returns null if payment is sufficient, or an error message describing what's missing.
 */
export function validateManaPayment(
  totalAvailable: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number
): string | null {
  const pool = { ...totalAvailable };
  const missingColors: string[] = [];
  
  // Check colored requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    const available = pool[colorKey] || 0;
    
    if (available < needed) {
      missingColors.push(`${needed - available} ${getManaColorName(color)}`);
    } else {
      // Reserve this mana for the colored cost
      pool[colorKey] -= needed;
    }
  }
  
  // Check generic requirement with remaining mana
  // Only sum numeric color values from the known mana color keys
  const remainingTotal = MANA_COLOR_KEYS.reduce((sum, key) => sum + (pool[key] || 0), 0);
  const missingGeneric = Math.max(0, genericCost - remainingTotal);
  
  if (missingColors.length > 0 || missingGeneric > 0) {
    let errorMsg = "Insufficient mana.";
    if (missingColors.length > 0) {
      errorMsg += ` Missing: ${missingColors.join(', ')}.`;
    }
    if (missingGeneric > 0) {
      errorMsg += ` Missing ${missingGeneric} generic mana.`;
    }
    return errorMsg;
  }
  
  return null;
}

type ValidateConsumeManaCostResult =
  | { ok: true; consumed: Record<string, number>; remaining: Record<string, number> }
  | { ok: false; error: string };

export type ResolveManaCostForPoolPaymentResult =
  | { ok: true; coloredCost: Record<string, number>; genericCost: number }
  | { ok: false; error: string };

function getPoolNumericSnapshot(pool: ManaPool | Record<string, number>): Record<string, number> {
  return {
    white: Number((pool as any).white || 0),
    blue: Number((pool as any).blue || 0),
    black: Number((pool as any).black || 0),
    red: Number((pool as any).red || 0),
    green: Number((pool as any).green || 0),
    colorless: Number((pool as any).colorless || 0),
  };
}

function sumReservedColored(poolSnapshot: Record<string, number>, coloredCost: Record<string, number>): number {
  let used = 0;
  for (const color of MANA_COLORS) {
    const key = MANA_COLOR_NAMES[color];
    const needed = Number((coloredCost as any)[color] || 0);
    if (!key || needed <= 0) continue;
    used += needed;
    // validate shape: if pool doesn't have enough of a reserved color, payment is impossible
    if (Number(poolSnapshot[key] || 0) < needed) return Number.POSITIVE_INFINITY;
  }
  return used;
}

function orderHybridOptions(options: string[]): string[] {
  const colors = options.filter((o) => /^[WUBRGC]$/i.test(o));
  const generics = options.filter((o) => /^GENERIC:\d+$/i.test(o));
  const others = options.filter((o) => !/^[WUBRGC]$/i.test(o) && !/^GENERIC:\d+$/i.test(o));
  if (colors.length > 0 && generics.length > 0) {
    // Prefer paying with colored mana when possible rather than spending extra generic.
    return [...colors, ...generics, ...others];
  }
  return [...options];
}

/**
 * Hybrid-aware validation and consumption of mana costs from the *floating mana pool*.
 *
 * This is intentionally conservative and intended for deterministic server-side payments.
 * - Supports: colored, generic, and hybrid ({W/U}, {2/W}, etc.)
 * - Rejects: X costs and Phyrexian hybrid options (LIFE:)
 */
export function validateAndConsumeManaCostFromPool(
  pool: ManaPool | Record<string, number>,
  manaCost: string,
  opts?: { logPrefix?: string; purpose?: RestrictedManaSpendPurpose }
): ValidateConsumeManaCostResult {
  const poolForResolution = opts?.purpose
    ? buildManaTotalsIncludingEligibleRestricted(pool as ManaPool, opts.purpose)
    : getPoolNumericSnapshot(pool);
  const resolved = resolveManaCostForPoolPayment(poolForResolution, manaCost);
  if (!resolved.ok) return { ok: false, error: (resolved as any).error || 'Insufficient mana.' };

  const totalAvailable = opts?.purpose
    ? poolForResolution
    : calculateTotalAvailableMana(getPoolNumericSnapshot(pool) as any, undefined);
  const validationError = validateManaPayment(totalAvailable as any, resolved.coloredCost, resolved.genericCost);
  if (validationError) return { ok: false, error: validationError };

  const { consumed, remaining } = opts?.purpose
    ? (() => {
        const result = consumeManaFromPoolForPurpose(
          pool as ManaPool,
          resolved.coloredCost,
          resolved.genericCost,
          opts.purpose,
          opts?.logPrefix,
        );
        return { ...result, remaining: getPoolNumericSnapshot(pool) };
      })()
    : consumeManaFromPool(pool, resolved.coloredCost, resolved.genericCost, opts?.logPrefix);
  return { ok: true, consumed, remaining };
}

export function resolvePaymentManaAbilitySpendRestriction(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId?: string | null,
): { restriction: ManaRestrictionType; restrictedTo?: string } | null {
  const ability = resolveLegacyManaAbilityById(gameState, permanent, playerId, abilityId);
  const spendRestriction = ability?.spendRestriction;
  if (spendRestriction?.restriction) {
    return {
      restriction: spendRestriction.restriction,
      restrictedTo: spendRestriction.restrictedTo,
    };
  }
  return parseManaSpendRestrictionFromOracle(String(permanent?.card?.oracle_text || ''));
}

export function restrictedManaSpendRestrictionAllowsPurpose(
  spendRestriction: { restriction: ManaRestrictionType; restrictedTo?: string } | null | undefined,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  if (!spendRestriction?.restriction) return true;
  return canUseRestrictedMana(
    {
      type: 'colorless',
      amount: 1,
      restriction: spendRestriction.restriction,
      restrictedTo: spendRestriction.restrictedTo,
    },
    purpose,
  );
}

export function buildActivatedAbilityRestrictedManaPurpose(sourcePermanent: any): RestrictedManaSpendPurpose {
  const typeLine = String(sourcePermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) {
    return { isActivatedAbility: true, abilitySourceIsCreature: false };
  }
  for (const creatureType of getCreatureTypesNow(sourcePermanent)) {
    if (!creatureType || creatureType === '*') continue;
    return {
      isActivatedAbility: true,
      abilitySourceIsCreature: true,
      abilitySourceCreatureType: creatureType,
      creatureType,
    };
  }
  return { isActivatedAbility: true, abilitySourceIsCreature: true };
}

export function validateAbilityManaCostFromPool(
  gameState: any,
  controllerId: string,
  manaCost: string,
  sourcePermanent: any,
): { ok: true } | { ok: false; error: string } {
  const pool = getOrInitManaPool(gameState, controllerId);
  const purpose = buildActivatedAbilityRestrictedManaPurpose(sourcePermanent);
  const poolForResolution = buildManaTotalsIncludingEligibleRestricted(pool as ManaPool, purpose);
  const resolved = resolveManaCostForPoolPayment(poolForResolution, manaCost);
  if (!resolved.ok) {
    return { ok: false, error: (resolved as any).error || 'Insufficient mana.' };
  }
  const validationError = validateManaPayment(poolForResolution as any, resolved.coloredCost, resolved.genericCost);
  if (validationError) return { ok: false, error: validationError };
  return { ok: true };
}

export function payAbilityManaCostFromPool(
  gameState: any,
  controllerId: string,
  manaCost: string,
  sourcePermanent: any,
  logPrefix?: string,
): ValidateConsumeManaCostResult {
  const pool = getOrInitManaPool(gameState, controllerId);
  const purpose = buildActivatedAbilityRestrictedManaPurpose(sourcePermanent);
  return validateAndConsumeManaCostFromPool(pool, manaCost, { logPrefix, purpose });
}

export function addCastSpellPaymentProducedMana(
  gameState: any,
  playerId: string,
  pool: any,
  selectedTotals: Record<string, number>,
  additions: Record<string, number>,
  spendRestriction: { restriction: ManaRestrictionType; restrictedTo?: string } | null,
  source?: { id?: string; name?: string },
): void {
  for (const [colorKey, amount] of Object.entries(additions)) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount <= 0) continue;
    if (spendRestriction?.restriction) {
      addRestrictedManaToPool(
        gameState,
        playerId,
        colorKey as any,
        normalizedAmount,
        spendRestriction.restriction,
        spendRestriction.restrictedTo,
        source?.id,
        source?.name,
      );
    } else {
      pool[colorKey] = Number(pool[colorKey] || 0) + normalizedAmount;
    }
    selectedTotals[colorKey] = (selectedTotals[colorKey] || 0) + normalizedAmount;
  }
}

/**
 * Resolve a mana cost into a concrete (coloredCost, genericCost) payment *from the floating pool*,
 * deterministically choosing hybrid options.
 *
 * This does not consume mana; it only computes the payment and verifies it is payable.
 */
export function resolveManaCostForPoolPayment(
  pool: ManaPool | Record<string, number>,
  manaCost: string
): ResolveManaCostForPoolPaymentResult {
  const cost = String(manaCost || '').trim();
  if (!cost) return { ok: true, coloredCost: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, genericCost: 0 };

  const parsed = parseManaCost(cost);
  if (parsed.hasX) return { ok: false, error: 'Unsupported mana cost (X).' };

  const hasPhyrexianHybrid = (parsed.hybrids || []).some((opts) => (opts || []).some((o) => /^LIFE:/i.test(String(o))));
  if (hasPhyrexianHybrid) return { ok: false, error: 'Unsupported mana cost (Phyrexian).' };

  const poolSnapshot = getPoolNumericSnapshot(pool);
  const totalPool = MANA_COLOR_KEYS.reduce((sum, k) => sum + Number(poolSnapshot[k] || 0), 0);

  const baseColored: Record<string, number> = { ...parsed.colors };
  const baseGeneric = Number(parsed.generic || 0);
  const hybrids = Array.isArray(parsed.hybrids) ? parsed.hybrids : [];

  const tryChooseHybrids = (
    idx: number,
    reservedColored: Record<string, number>,
    extraGeneric: number
  ): { ok: true; reservedColored: Record<string, number>; extraGeneric: number } | { ok: false } => {
    if (idx >= hybrids.length) {
      const reservedSum = sumReservedColored(poolSnapshot, reservedColored);
      if (!Number.isFinite(reservedSum)) return { ok: false };
      const remainingTotal = totalPool - reservedSum;
      const requiredGeneric = baseGeneric + extraGeneric;
      if (remainingTotal < requiredGeneric) return { ok: false };
      return { ok: true, reservedColored, extraGeneric };
    }

    const optionsRaw = hybrids[idx] || [];
    const options = orderHybridOptions(optionsRaw.map((o) => String(o).toUpperCase()));

    for (const option of options) {
      if (/^GENERIC:\d+$/i.test(option)) {
        const n = Number.parseInt(option.split(':')[1], 10);
        if (!Number.isFinite(n) || n <= 0) continue;
        const res = tryChooseHybrids(idx + 1, reservedColored, extraGeneric + n);
        if (res.ok) return res;
        continue;
      }

      if (/^[WUBRGC]$/i.test(option)) {
        const sym = option.toUpperCase();
        const key = MANA_COLOR_NAMES[sym];
        if (!key) continue;

        const nextReserved = { ...reservedColored };
        nextReserved[sym] = Number(nextReserved[sym] || 0) + 1;
        if (Number(poolSnapshot[key] || 0) < Number(nextReserved[sym] || 0)) continue;

        const res = tryChooseHybrids(idx + 1, nextReserved, extraGeneric);
        if (res.ok) return res;
        continue;
      }
    }

    return { ok: false };
  };

  const baseReserved = { ...baseColored };
  const choice = tryChooseHybrids(0, baseReserved, 0);
  if (!choice.ok) {
    const totalAvailable = calculateTotalAvailableMana(poolSnapshot as any, undefined);
    const baseValidation = validateManaPayment(totalAvailable as any, baseColored, baseGeneric);
    return { ok: false, error: baseValidation || 'Insufficient mana.' };
  }

  return {
    ok: true,
    coloredCost: choice.reservedColored,
    genericCost: baseGeneric + Number(choice.extraGeneric || 0),
  };
}

/**
 * Mana production info for a permanent
 */
export interface ManaProductionInfo {
  /** Base colors this permanent can produce */
  colors: string[];
  /** Single color for creature-count mana (like any_combination for color choice) */
  color?: string;
  /** Base amount of mana produced per tap (before multipliers) */
  baseAmount: number;
  /** Whether the amount is dynamic (depends on game state) */
  isDynamic: boolean;
  /** Description of how mana is calculated (for dynamic sources) */
  dynamicDescription?: string;
  /** Extra mana from enchantments/effects on this permanent */
  bonusMana: { color: string; amount: number }[];
  /** Multiplier from global effects (Mana Reflection, Nyxbloom Ancient) */
  multiplier: number;
  /** Total mana produced (baseAmount * multiplier + bonuses) */
  totalAmount: number;
  /** Activation cost (for abilities like Three Tree City that require mana to activate) */
  activationCost?: string;
  /** Whether this ability requires a color choice prompt */
  requiresColorChoice?: boolean;
  /** Whether bonus mana (e.g. Fertile Ground) still needs an any-color choice */
  requiresBonusColorChoice?: boolean;
  /** Dynamic amount source when requiresColorChoice (e.g. devotion) */
  dynamicAmountSource?: string;
}

type ResolvedActivatedAbilityLine = {
  lineText: string;
  costText: string;
  effectText: string;
};

function normalizeActivatedAbilityOracleLine(line: string): string {
  const trimmed = String(line || '').trim();
  const wrappedMatch = trimmed.match(/^\((.*)\)\.?$/);
  return String(wrappedMatch?.[1] || trimmed).trim();
}

export function resolveActivatedAbilityLineById(permanent: any, abilityId?: string | null): ResolvedActivatedAbilityLine | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedAbilityId) return undefined;

  const genericAbilityMatch = normalizedAbilityId.match(/-ability-(\d+)$/i);
  if (!genericAbilityMatch) return undefined;

  const targetIndex = Number(genericAbilityMatch[1]);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return undefined;

  const oracleText = String(permanent?.card?.oracle_text || '').trim();
  if (!oracleText) return undefined;

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;
  const lines = oracleText
    .split(/\r?\n/)
    .map(normalizeActivatedAbilityOracleLine)
    .filter(Boolean);

  let genericAbilityIndex = 0;
  for (const line of lines) {
    const powerUpMatch = line.match(/^Power-up\s*[—-]\s*((?:\{[^}]+\})+)\s*:\s*(.+)$/i);
    if (powerUpMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(powerUpMatch[1] || '').trim(),
          effectText: String(powerUpMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
      continue;
    }

    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(activatedMatch[1] || '').trim(),
          effectText: String(activatedMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
      continue;
    }

    const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
    if (textOnlyMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(textOnlyMatch[1] || '').trim(),
          effectText: String(textOnlyMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
    }
  }

  return undefined;
}

/**
 * Client battlefield UI uses ids like "{cardId}-mana-g-1" for intrinsic basic-land mana.
 * Server legacy mana abilities use ids like "native_g" / "native_choice_2".
 */
export function resolveClientStyleManaAbilityById(
  abilityId?: string | null,
): { id: string; cost: string; produces: string[]; amount: number; producesAllAtOnce: boolean } | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  const match = normalizedAbilityId.match(/-mana-([wubrgc])-(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const color = String(match[1] || '').toUpperCase();
  if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) {
    return undefined;
  }

  return {
    id: normalizedAbilityId,
    cost: '{T}',
    produces: [color],
    amount: 1,
    producesAllAtOnce: false,
  };
}

function resolveManaAbilityForClientAbilityId(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId: string,
): any | undefined {
  const scopedLine = resolveActivatedAbilityLineById(permanent, abilityId);
  if (!scopedLine) return undefined;

  let abilities: any[] = [];
  try {
    abilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
  } catch {
    return undefined;
  }
  if (abilities.length === 0) return undefined;

  const effectText = String(scopedLine.effectText || '').toLowerCase();
  const producesColorlessOnly = /\badd\s*\{c\}/i.test(effectText) && !/any color/i.test(effectText);
  if (producesColorlessOnly) {
    return abilities.find((entry) => {
      const produces = Array.isArray(entry?.produces) ? entry.produces : [];
      return produces.length === 1 && String(produces[0] || '').toUpperCase() === 'C';
    });
  }

  if (/one mana of any color|mana of any color|any one color/i.test(effectText)) {
    return abilities.find((entry) => entry?.spendRestriction)
      || abilities.find((entry) => {
        const produces = Array.isArray(entry?.produces) ? entry.produces : [];
        return produces.length >= 2 && String(entry?.id || '') !== 'native_c';
      })
      || abilities.find((entry) => ['native_any', 'native_commander_any', 'native_pay_life_any'].includes(String(entry?.id || '')));
  }

  if (/mana\s+of\s+the\s+chosen\s+colou?r/i.test(effectText)) {
    return abilities.find((entry) => String(entry?.id || '') === 'native_chosen_color')
      || abilities.find((entry) => {
        const produces = Array.isArray(entry?.produces) ? entry.produces : [];
        return produces.length === 1 && ['W', 'U', 'B', 'R', 'G'].includes(String(produces[0] || '').toUpperCase());
      });
  }

  const abilityIndex = Number(abilityId.match(/-ability-(\d+)$/i)?.[1] ?? -1);
  if (Number.isInteger(abilityIndex) && abilityIndex >= 0) {
    const manaProducingAbilities = abilities.filter((entry) => {
      const produces = Array.isArray(entry?.produces) ? entry.produces : [];
      return produces.length > 0;
    });
    if (abilityIndex < manaProducingAbilities.length) {
      return manaProducingAbilities[abilityIndex];
    }
  }

  return abilities[0];
}

function resolveLegacyManaAbilityById(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId?: string | null,
): any | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedAbilityId) {
    return undefined;
  }

  if (/-ability-\d+$/i.test(normalizedAbilityId)) {
    return resolveManaAbilityForClientAbilityId(gameState, permanent, playerId, normalizedAbilityId);
  }

  const clientStyleAbility = resolveClientStyleManaAbilityById(normalizedAbilityId);
  if (clientStyleAbility) {
    return clientStyleAbility;
  }

  try {
    const abilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
    return abilities.find((ability: any) => String(ability?.id || '').trim() === normalizedAbilityId);
  } catch {
    return undefined;
  }
}

function isDevotionColorChoiceManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\bchoose a color\b/.test(normalized) && /\bdevotion to that color\b/.test(normalized);
}

function isColorlessOnlyManaEffect(text: string): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\badd\s*\{c\}\b/.test(normalized)
    && !/\bchoose a color\b/.test(normalized)
    && !/\bdevotion to that color\b/.test(normalized)
    && !/\bany color\b/.test(normalized)
    && !/\bany one color\b/.test(normalized);
}

function getFirstTapManaEffectText(oracleText: string): string {
  const lines = String(oracleText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!/\{t\}\s*:/i.test(line) || !/\badd\s*\{[wubrgc]\}/i.test(line)) continue;
    const match = line.match(/:\s*(.+)$/i);
    return String(match?.[1] || '').trim();
  }
  return '';
}

/** True when resolving the devotion color-choice mana ability (Nykthos {2} ability), not {T}: Add {C}. */
export function shouldApplyDevotionColorChoiceMana(
  cardName: string,
  selectedAbilityEffectText: string,
  manaOracleText: string,
  fullOracleText: string,
): boolean {
  const normalizedName = String(cardName || '').toLowerCase();
  const effectText = String(selectedAbilityEffectText || '').trim();

  if (effectText && isColorlessOnlyManaEffect(effectText)) {
    return false;
  }
  if (effectText && isDevotionColorChoiceManaEffect(effectText)) {
    return true;
  }
  if (effectText) {
    return false;
  }

  if (normalizedName.includes('nykthos') || normalizedName.includes('nyx lotus')) {
    const firstEffect = getFirstTapManaEffectText(fullOracleText);
    if (isColorlessOnlyManaEffect(firstEffect)) {
      return false;
    }
  }

  if (isDevotionColorChoiceManaEffect(manaOracleText)) {
    return true;
  }

  return String(fullOracleText || '').includes('devotion')
    && String(fullOracleText || '').includes('add')
    && !isColorlessOnlyManaEffect(manaOracleText);
}

/**
 * 
 * This considers:
 * - Fixed multi-mana (Sol Ring: {C}{C})
 * - Dynamic mana (Gaea's Cradle: {G} per creature)
 * - Land enchantments (Wild Growth, Utopia Sprawl, Overgrowth)
 * - Global effects (Caged Sun, Mana Reflection, Mirari's Wake, Nyxbloom Ancient)
 * 
 * @param gameState - Current game state
 * @param permanent - The permanent being tapped for mana
 * @param playerId - Controller of the permanent
 * @param chosenColor - For "any color" abilities, which color was chosen
 * @returns ManaProductionInfo with calculated mana amounts
 */
export function calculateManaProduction(
  gameState: any,
  permanent: any,
  playerId: string,
  chosenColor?: string,
  abilityId?: string | null,
): ManaProductionInfo {
  const card = permanent?.card || {};
  const oracleText = (card.oracle_text || '').replace(/\([^)]*\)/g, '').toLowerCase();
  const selectedAbilityLine = resolveActivatedAbilityLineById(permanent, abilityId);
  const selectedLegacyManaAbility = resolveLegacyManaAbilityById(gameState, permanent, playerId, abilityId);
  const selectedAbilityLineText = String(selectedAbilityLine?.lineText || '').toLowerCase();
  const selectedAbilityEffectText = String(selectedAbilityLine?.effectText || '').toLowerCase();
  const selectedAbilityCostText = String(selectedAbilityLine?.costText || '').trim();
  const manaOracleText = selectedAbilityLineText || oracleText;
  const typeLine = (card.type_line || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities)
    ? permanent.grantedAbilities.map((ability: any) => String(ability || '').toLowerCase())
    : [];
  const normalizedChosenColor = ['W', 'U', 'B', 'R', 'G', 'C'].includes(String(chosenColor || '').toUpperCase())
    ? String(chosenColor).toUpperCase()
    : undefined;
  const selectedLegacyManaColors: string[] = Array.isArray(selectedLegacyManaAbility?.produces)
    ? Array.from(new Set(
      selectedLegacyManaAbility.produces
        .map((color: any) => String(color || '').trim().toUpperCase())
        .filter((color: string): color is string => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color))
    ))
    : [];
  const hasSelectedLegacyManaAbility = !!selectedLegacyManaAbility;
  const spelledAnyColorAmount = (() => {
    const match = manaOracleText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana of any(?: one)? color\b/i);
    return match ? parseSpelledOutAmount(String(match[1] || '')) : undefined;
  })();
  
  const result: ManaProductionInfo = {
    colors: [],
    baseAmount: 1,
    isDynamic: false,
    bonusMana: [],
    multiplier: 1,
    totalAmount: 1,
  };

  if (selectedAbilityCostText) {
    result.activationCost = selectedAbilityCostText;
  } else if (selectedLegacyManaAbility?.cost) {
    result.activationCost = String(selectedLegacyManaAbility.cost);
  }
  
  // ===== STEP 1: Determine base mana production from the card itself =====
  
  // Check for standard mana ability patterns: "{T}: Add {X}" or "{T}: Add {X}{X}"
  // This MUST match the TAP SYMBOL followed by colon followed by Add to identify a mana ability
  // This avoids matching triggered abilities or reminder text like "firebending" which mentions adding mana
  // Pattern: \{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)
  // This matches: {T}: Add {R}, or {1}, {T}: Add {R}{R}, etc.
  // Prefer full-card oracle for land tap lines so parenthetical shock-land reminders
  // ("({T}: Add {G} or {U}.)") are not lost when reminder text is stripped elsewhere.
  const landTapOracleText = typeLine.includes('land')
    ? String(card.oracle_text || '').toLowerCase()
    : manaOracleText;

  // Dual/tri "or" choice lands — one mana of a chosen color (not consecutive multi-mana).
  if (!hasSelectedLegacyManaAbility) {
    const dualOrMatch = landTapOracleText.match(
      /\{t\}(?:[,\s]*[^:]*)?:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i,
    );
    const triOrMatch = landTapOracleText.match(
      /\{t\}(?:[,\s]*[^:]*)?:\s*add\s+\{([wubrgc])\},\s*\{([wubrgc])\},\s*or\s+\{([wubrgc])\}/i,
    );
    if (triOrMatch) {
      result.baseAmount = 1;
      result.requiresColorChoice = true;
      for (const idx of [1, 2, 3]) {
        const color = String(triOrMatch[idx] || '').toUpperCase();
        if (color && !result.colors.includes(color)) result.colors.push(color);
      }
    } else if (dualOrMatch) {
      result.baseAmount = 1;
      result.requiresColorChoice = true;
      for (const idx of [1, 2]) {
        const color = String(dualOrMatch[idx] || '').toUpperCase();
        if (color && !result.colors.includes(color)) result.colors.push(color);
      }
    }

    if (
      normalizedChosenColor
      && result.requiresColorChoice === true
      && result.colors.map((c) => String(c).toUpperCase()).includes(normalizedChosenColor)
    ) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    }
  }

  const manaAbilityMatch = manaOracleText.match(/\{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)/gi);
  
  if (result.colors.length === 0 && manaAbilityMatch && manaAbilityMatch.length > 0) {
    // Use ONLY the first mana ability found (the basic tap-for-mana ability)
    const firstManaAbility = manaAbilityMatch[0];
    const symbols = firstManaAbility.match(/\{[wubrgc]\}/gi) || [];
    if (symbols.length > 0) {
      result.baseAmount = symbols.length;
      // Get the color(s) from the first mana ability only
      for (const sym of symbols) {
        const color = sym.replace(/[{}]/g, '').toUpperCase();
        if (!result.colors.includes(color)) {
          result.colors.push(color);
        }
      }
    }
  } else if (result.colors.length === 0) {
    // Fallback: Check for simpler fixed mana patterns without tap requirement
    // (for special cases like artifacts that have different activation patterns)
    const fixedManaMatch = manaOracleText.match(/add\s+((?:\{[wubrgc]\})+)/gi);
    if (fixedManaMatch && result.colors.length === 0) {
      // Only use first match to avoid picking up reminder text
      const firstMatch = fixedManaMatch[0];
      const symbols = firstMatch.match(/\{[wubrgc]\}/gi) || [];
      if (symbols.length > 0) {
        result.baseAmount = symbols.length;
        for (const sym of symbols) {
          const color = sym.replace(/[{}]/g, '').toUpperCase();
          if (!result.colors.includes(color)) {
            result.colors.push(color);
          }
        }
      }
    }
  }
  
  const grantedManaColorMap: Record<string, string> = {
    tap_for_white: 'W',
    tap_for_blue: 'U',
    tap_for_black: 'B',
    tap_for_red: 'R',
    tap_for_green: 'G',
    tap_for_colorless: 'C',
  };
  const grantedSpecificManaColor = Object.entries(grantedManaColorMap).find(([ability]) => grantedAbilities.includes(ability))?.[1];
  const hasGrantedAnyColorMana = grantedAbilities.some((ability) =>
    ability === 'tap_for_any_color' ||
    /\{t\}:\s*add\s+(?:one\s+)?mana of any color/.test(ability) ||
    /\{t\}:\s*add\s+(?:one\s+)?mana of any one color/.test(ability)
  );

  if (hasGrantedAnyColorMana) {
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (normalizedChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else {
      result.colors = ['any'];
      result.requiresColorChoice = true;
    }
  } else if (grantedSpecificManaColor && result.colors.length === 0) {
    result.colors = [grantedSpecificManaColor];
  }

  const isMoxAmberConditionalSource = isMoxAmberConditionalManaSource(cardName, oracleText);

  if (isMoxAmberConditionalSource) {
    const availableColors = getMoxAmberAvailableColors(gameState, playerId);
    if (availableColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && availableColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (availableColors.length === 1) {
      result.colors = [availableColors[0]];
      result.requiresColorChoice = false;
    } else {
      result.colors = availableColors;
      result.requiresColorChoice = true;
    }
  }

  const isCommanderColorIdentitySource =
    !isMoxAmberConditionalSource
    && /commander'?s?\s+color\s+identity|color\s+identity.*commander/i.test(manaOracleText);
  const isOpponentLandConditionalSource =
    !isMoxAmberConditionalSource
    && !isCommanderColorIdentitySource
    && /that (?:a |an )?(?:land|permanent) an opponent controls could produce|that (?:a |an )?land.*could produce/i.test(manaOracleText);

  if (!hasSelectedLegacyManaAbility && isCommanderColorIdentitySource) {
    const commanderColors = Array.from(getCommanderColorIdentity(gameState, playerId))
      .map((key) => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[key]))
      .filter((sym): sym is string => Boolean(sym));
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (commanderColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && commanderColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (commanderColors.length === 1) {
      result.colors = commanderColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = commanderColors;
      result.requiresColorChoice = true;
    }
  } else if (!hasSelectedLegacyManaAbility && isOpponentLandConditionalSource) {
    const opponentColors = getOpponentLandProducibleColorSymbols(gameState, playerId);
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (opponentColors.length === 0) {
      result.colors = [];
      result.baseAmount = 0;
      result.totalAmount = 0;
      result.requiresColorChoice = false;
    } else if (normalizedChosenColor && opponentColors.includes(normalizedChosenColor)) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (opponentColors.length === 1) {
      result.colors = opponentColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = opponentColors;
      result.requiresColorChoice = true;
    }
  }

  const spelledChosenColorAmount = (() => {
    const match = manaOracleText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r\b/i);
    return match ? parseSpelledOutAmount(String(match[1] || '')) : undefined;
  })();
  const permanentChosenColor = resolvePermanentChosenColorSymbol(permanent);
  const effectiveChosenColor = normalizedChosenColor || permanentChosenColor || undefined;

  // Thriving lands: "Add {G} or one mana of the chosen color" — one mana, choose fixed or ETB color.
  const thrivingOrChosenMatch = !hasSelectedLegacyManaAbility
    ? manaOracleText.match(/\badd\s+\{([wubrgc])\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r\b/i)
    : null;
  if (thrivingOrChosenMatch) {
    const fixedColor = String(thrivingOrChosenMatch[1] || '').toUpperCase();
    const choiceColors: string[] = [fixedColor];
    if (permanentChosenColor && permanentChosenColor !== fixedColor) {
      choiceColors.push(permanentChosenColor);
    }
    result.baseAmount = 1;
    if (
      normalizedChosenColor
      && choiceColors.includes(normalizedChosenColor)
    ) {
      result.colors = [normalizedChosenColor];
      result.requiresColorChoice = false;
    } else if (choiceColors.length === 1) {
      result.colors = choiceColors;
      result.requiresColorChoice = false;
    } else {
      result.colors = choiceColors;
      result.requiresColorChoice = true;
    }
  }
  // "Add N mana of the chosen color" — reuse ETB color choice (Throne of Eldraine, etc.)
  else if (!hasSelectedLegacyManaAbility && /\bmana\s+of\s+the\s+chosen\s+colou?r\b/i.test(manaOracleText)) {
    if (typeof spelledChosenColorAmount === 'number' && spelledChosenColorAmount > 0) {
      result.baseAmount = spelledChosenColorAmount;
    }
    if (effectiveChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(effectiveChosenColor)) {
      result.colors = [effectiveChosenColor];
      result.requiresColorChoice = false;
    }
  }
  // Check for "any color" patterns
  else if (
    !hasSelectedLegacyManaAbility
    && !isMoxAmberConditionalSource
    && !isCommanderColorIdentitySource
    && !isOpponentLandConditionalSource
    && (manaOracleText.includes('any color') || manaOracleText.includes('mana of any color'))
  ) {
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    }
    if (effectiveChosenColor && ['W', 'U', 'B', 'R', 'G'].includes(effectiveChosenColor)) {
      result.colors = [effectiveChosenColor];
      result.requiresColorChoice = false;
    } else {
      result.colors = ['any'];
      result.requiresColorChoice = true;
    }
  }
  
  // Handle basic land types (printed + chosen-type grants like Thran Portal)
  if (!hasSelectedLegacyManaAbility) {
    const effectiveBasicTypes = getEffectiveBasicLandTypes(permanent as any);
    if (effectiveBasicTypes.length > 0) {
      for (const landType of effectiveBasicTypes) {
        const mana = manaColorForBasicLandType(landType);
        if (mana && !result.colors.includes(mana)) result.colors.push(mana);
      }
    } else {
      if (typeLine.includes('plains') && !result.colors.includes('W')) result.colors.push('W');
      if (typeLine.includes('island') && !result.colors.includes('U')) result.colors.push('U');
      if (typeLine.includes('swamp') && !result.colors.includes('B')) result.colors.push('B');
      if (typeLine.includes('mountain') && !result.colors.includes('R')) result.colors.push('R');
      if (typeLine.includes('forest') && !result.colors.includes('G')) result.colors.push('G');
    }
  }

  // Dual/tri lands (and shock lands with parenthetical "{T}: Add {G} or {U}") produce ONE mana
  // of a chosen color — never all listed colors at once. Without this, auto-tap payment for {2}
  // can treat Breeding Pool as 2 mana from a single tap.
  if (
    !hasSelectedLegacyManaAbility
    && result.requiresColorChoice !== true
    && !result.colors.some((color) => String(color || '').toUpperCase() === 'ANY')
  ) {
    const fixedColors = result.colors
      .map((color) => String(color || '').toUpperCase())
      .filter((color) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color));
    if (fixedColors.length > 1) {
      const fullOracleLower = String(card.oracle_text || '').toLowerCase();
      const hasExplicitOrChoice =
        /add\s+\{[wubrgc]\}\s+or\s+\{[wubrgc]\}/i.test(fullOracleLower)
        || /add\s+\{[wubrgc]\},\s*\{[wubrgc]\},\s*or\s+\{[wubrgc]\}/i.test(fullOracleLower);
      const hasConsecutiveMultiMana = /add\s+(?:\{[wubrgc]\}){2,}/i.test(fullOracleLower);
      const looksLikeAllAtOnce =
        hasConsecutiveMultiMana
        && Number(result.baseAmount || 0) >= fixedColors.length
        && !hasExplicitOrChoice;
      if (!looksLikeAllAtOnce) {
        result.requiresColorChoice = true;
        result.baseAmount = 1;
        if (normalizedChosenColor && fixedColors.includes(normalizedChosenColor)) {
          result.colors = [normalizedChosenColor];
          result.requiresColorChoice = false;
        }
      }
    }
  }

  if (hasSelectedLegacyManaAbility) {
    const explicitAmount = Number(selectedLegacyManaAbility?.amount || 0);
    if (typeof spelledAnyColorAmount === 'number' && spelledAnyColorAmount > 0) {
      result.baseAmount = spelledAnyColorAmount;
    } else if (Number.isFinite(explicitAmount) && explicitAmount > 0) {
      result.baseAmount = explicitAmount;
    }

    if (selectedLegacyManaAbility?.producesAllAtOnce === true && selectedLegacyManaColors.length > 0) {
      result.colors = selectedLegacyManaColors;
      result.requiresColorChoice = false;
    } else if (selectedLegacyManaColors.length > 1) {
      if (normalizedChosenColor && selectedLegacyManaColors.includes(normalizedChosenColor)) {
        result.colors = [normalizedChosenColor];
        result.requiresColorChoice = false;
      } else {
        result.colors = selectedLegacyManaColors;
        result.requiresColorChoice = true;
      }
    } else if (selectedLegacyManaColors.length === 1) {
      result.colors = selectedLegacyManaColors;
      result.requiresColorChoice = false;
    }
  }
  
  // ===== STEP 2: Check for dynamic mana production =====
  
  // Gaea's Cradle - "Add {G} for each creature you control"
  if (cardName.includes("gaea's cradle") || 
      (oracleText.includes('add {g}') && oracleText.includes('for each creature'))) {
    const creatureCount = battlefield.reduce((sum: number, p: any) => {
      if (!p || p.controller !== playerId) return sum;
      if (!(p.card?.type_line || p.type_line || '').toLowerCase().includes('creature')) return sum;
      return sum + battlefieldPermanentInstanceCount(p);
    }, 0);
    result.isDynamic = true;
    result.baseAmount = creatureCount;
    result.dynamicDescription = `{G} for each creature you control (${creatureCount})`;
    result.colors = ['G'];
  }
  
  // Serra's Sanctum - "Add {W} for each enchantment you control"
  if (cardName.includes("serra's sanctum") ||
      (oracleText.includes('add {w}') && oracleText.includes('for each enchantment'))) {
    const enchantmentCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('enchantment')
    ).length;
    result.isDynamic = true;
    result.baseAmount = enchantmentCount;
    result.dynamicDescription = `{W} for each enchantment you control (${enchantmentCount})`;
    result.colors = ['W'];
  }
  
  // Tolarian Academy - "Add {U} for each artifact you control"
  if (cardName.includes("tolarian academy") ||
      (oracleText.includes('add {u}') && oracleText.includes('for each artifact'))) {
    const artifactCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('artifact')
    ).length;
    result.isDynamic = true;
    result.baseAmount = artifactCount;
    result.dynamicDescription = `{U} for each artifact you control (${artifactCount})`;
    result.colors = ['U'];
  }
  
  // Three Tree City - Has two abilities:
  // 1. {T}: Add {C}
  // 2. {2}, {T}: Choose a color. Add an amount of mana of that color equal to creatures of the chosen type.
  // The chosen creature type is stored on the permanent
  if (cardName.includes("three tree city")) {
    const selectedThreeTreeIsDynamicLine = !selectedAbilityLine ||
      (selectedAbilityEffectText.includes('choose a color') && selectedAbilityEffectText.includes('creatures of the chosen type'));
    const selectedThreeTreeIsColorlessLine = selectedAbilityLine && /\badd\s+\{c\}/i.test(selectedAbilityEffectText);

    if (selectedThreeTreeIsColorlessLine) {
      result.baseAmount = 1;
      result.colors = ['C'];
      result.isDynamic = false;
      result.dynamicDescription = undefined;
      result.requiresColorChoice = false;
    }

    // Get the chosen creature type from the permanent
    const chosenCreatureType = (permanent?.chosenCreatureType || '').toLowerCase();

    if (selectedThreeTreeIsDynamicLine && chosenCreatureType) {
      const creatureCount = countControlledCreaturesOfChosenType({ battlefield }, playerId, chosenCreatureType);
      
      result.isDynamic = true;
      result.baseAmount = creatureCount;
      result.dynamicDescription = `Choose a color. Add ${creatureCount} mana of that color (one for each ${chosenCreatureType} you control)`;
      // Mark as "any_combination" to trigger color choice prompt
      result.color = 'any_combination';
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      // Mark that this ability requires paying {2}
      result.activationCost = '{2}';
      result.requiresColorChoice = true;
    } else if (!selectedAbilityLine) {
      // No creature type chosen yet, just produces {C}
      result.baseAmount = 1;
      result.colors = ['C'];
    }
  }
  
  // Karametra's Acolyte - "Add an amount of {G} equal to your devotion to green"
  // This is a key devotion-based mana ability that needs proper support
    if (cardName.includes("karametra's acolyte") || 
      (manaOracleText.includes('devotion to green') && manaOracleText.includes('add'))) {
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count {G} symbols using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS['G'];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes green
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes('G')) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{G} for devotion to green (${devotion})`;
    result.colors = ['G'];
  }
  
  // Elvish Archdruid - "Add {G} for each Elf you control"
  if (cardName.includes('elvish archdruid')) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `{G} for each Elf you control (${elfCount})`;
    result.colors = ['G'];
  }
  
  // Joraga Treespeaker - Leveler card (Rule 702.87)
  // Level 0: No mana ability
  // Level 1-4: {T}: Add {G}{G}
  // Level 5+: {T}: Add {G}{G} AND other Elves you control have this ability
  if (cardName.includes('joraga treespeaker')) {
    const levelCounters = permanent?.counters?.level || 0;
    if (levelCounters >= 1) {
      // At level 1+, produces {G}{G}
      result.baseAmount = 2;
      result.colors = ['G'];
      result.dynamicDescription = `{G}{G} (Level ${levelCounters})`;
    } else {
      // Level 0: no mana ability (card just taps for nothing or has no mana ability)
      result.baseAmount = 0;
      result.colors = [];
      result.dynamicDescription = `No mana (Level 0 - needs 1+ level counters)`;
    }
  }
  
  // Check if this elf is affected by a level 5+ Joraga Treespeaker
  // At level 5+, Joraga Treespeaker grants "{T}: Add {G}{G}" to all Elves you control
  if (typeLine.includes('elf') && !cardName.includes('joraga treespeaker')) {
    // Check if player controls a Joraga Treespeaker with 5+ level counters
    const joragaLevel5Plus = battlefield.find((p: any) =>
      p && p.controller === playerId &&
      (p.card?.name || '').toLowerCase().includes('joraga treespeaker') &&
      (p.counters?.level || 0) >= 5
    );
    
    if (joragaLevel5Plus) {
      // This Elf gains "{T}: Add {G}{G}" from the level 5+ Joraga Treespeaker
      // Override existing mana production if this gives more
      if (result.baseAmount < 2 || !result.colors.includes('G')) {
        result.baseAmount = 2;
        result.colors = ['G'];
        result.dynamicDescription = `{G}{G} from Joraga Treespeaker (level 5+)`;
      }
    }
  }
  
  // Generic leveler card support - check for level-dependent mana abilities
  // Pattern: "LEVEL N1-N2" ... "{T}: Add {X}" or "LEVEL N3+" ... "{T}: Add {X}"
  if (manaOracleText.includes('level up') || manaOracleText.includes('level ')) {
    const levelCounters = permanent?.counters?.level || 0;
    
    // Look for level ability patterns with mana production
    // Pattern: LEVEL N-M ... {T}: Add {mana} or LEVEL N+ ... {T}: Add {mana}
    // Note: Using matchAll for safe iteration of global matches
    const levelRangePattern = /level\s+(\d+)-(\d+)[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    const levelPlusPattern = /level\s+(\d+)\+[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    
    let foundLevelAbility = false;
    
    // Check range patterns first (LEVEL N-M)
    for (const match of manaOracleText.matchAll(levelRangePattern)) {
      const minLevel = parseInt(match[1], 10);
      const maxLevel = parseInt(match[2], 10);
      const manaSymbols = match[3].match(/\{[wubrgc]\}/gi) || [];
      
      if (levelCounters >= minLevel && levelCounters <= maxLevel) {
        result.baseAmount = manaSymbols.length;
        result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
        result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, range ${minLevel}-${maxLevel})`;
        foundLevelAbility = true;
        break;
      }
    }
    
    // If no range matched, check plus patterns (LEVEL N+)
    if (!foundLevelAbility) {
      for (const match of manaOracleText.matchAll(levelPlusPattern)) {
        const minLevel = parseInt(match[1], 10);
        const manaSymbols = match[2].match(/\{[wubrgc]\}/gi) || [];
        
        if (levelCounters >= minLevel) {
          result.baseAmount = manaSymbols.length;
          result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
          result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, ${minLevel}+)`;
          foundLevelAbility = true;
          break;
        }
      }
    }
  }
  
  // Wirewood Channeler, Priest of Titania style - "Add {G} for each Elf"
  if (manaOracleText.includes('for each elf') || 
      (cardName.includes('priest of titania')) ||
      (cardName.includes('wirewood channeler'))) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `Mana for each Elf you control (${elfCount})`;
    if (cardName.includes('wirewood channeler')) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['G'];
    }
  }
  
  // Everflowing Chalice - "Add {C} for each charge counter on Everflowing Chalice"
  if (cardName.includes('everflowing chalice') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('add'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `{C} for each charge counter (${chargeCounters})`;
    result.colors = ['C'];
  }
  
  // Astral Cornucopia - "Add one mana of any color for each charge counter"
  if (cardName.includes('astral cornucopia') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('any color'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana for each charge counter (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Gemstone Array - Based on charge counters (can remove to add mana)
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one counter for one mana
      result.dynamicDescription = `Remove charge counter for mana (${chargeCounters} available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Empowered Autogenerator - "Add X mana of any one color, where X is the number of charge counters"
  if (cardName.includes('empowered autogenerator')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana equal to charge counters (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Nykthos / Nyx Lotus devotion ability — not the basic {T}: Add {C} line
  if (shouldApplyDevotionColorChoiceMana(
    cardName,
    selectedAbilityEffectText,
    manaOracleText,
    oracleText,
  )) {
    if (!chosenColor || !['W', 'U', 'B', 'R', 'G'].includes(chosenColor)) {
      result.isDynamic = true;
      result.baseAmount = 0;
      result.dynamicDescription = 'Choose a color. Add mana equal to your devotion to that color';
      result.colors = ['any'];
      result.requiresColorChoice = true;
      result.dynamicAmountSource = 'devotion';
      return result;
    }

    // Calculate devotion for the chosen color
    const devotionColor = chosenColor as 'W' | 'U' | 'B' | 'R' | 'G';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count occurrences of the color symbol using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes this color (e.g., {W/U} counts for both W and U)
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = [devotionColor];
  }
  
  // Cabal Coffers - "Add {B} for each Swamp you control"
  if (cardName.includes('cabal coffers') ||
      (oracleText.includes('add {b}') && oracleText.includes('for each swamp'))) {
    const swampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = swampCount;
    result.dynamicDescription = `{B} for each Swamp you control (${swampCount})`;
    result.colors = ['B'];
  }
  
  // Cabal Stronghold - Similar to Cabal Coffers but only basic Swamps
  if (cardName.includes('cabal stronghold')) {
    const basicSwampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('basic') &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = basicSwampCount;
    result.dynamicDescription = `{B} for each basic Swamp (${basicSwampCount})`;
    result.colors = ['B'];
  }
  
  // Nyx Lotus - "Add X mana of any one color, where X is your devotion to that color"
  if (cardName.includes('nyx lotus')) {
    if (!chosenColor || !['W', 'U', 'B', 'R', 'G'].includes(chosenColor)) {
      result.isDynamic = true;
      result.baseAmount = 0;
      result.dynamicDescription = 'Choose a color. Add mana equal to your devotion to that color';
      result.colors = ['any'];
      result.requiresColorChoice = true;
      result.dynamicAmountSource = 'devotion';
      return result;
    }

    const devotionColor = chosenColor as 'W' | 'U' | 'B' | 'R' | 'G';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Use pre-compiled pattern for devotion color matching
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = [devotionColor];
  }
  
  // ===== POWER-BASED MANA ABILITIES =====
  
  // Selvala, Heart of the Wilds - "Add mana equal to the greatest power among creatures you control"
  if (cardName.includes('selvala, heart of the wilds') ||
      (oracleText.includes('greatest power') && oracleText.includes('among creatures'))) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Use canonical power calculation
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `Mana equal to greatest power (${greatestPower})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Generic pattern: "Add {G} equal to [this creature's / ~'s] power"
  // Catches: Marwyn, Viridian Joiner, Cradle Clearcutter, Gyre Sage, etc.
    if (manaOracleText.includes("equal to") && manaOracleText.includes("power") && 
      (manaOracleText.includes("{g}") || manaOracleText.includes("green")) &&
      !manaOracleText.includes("greatest") && !manaOracleText.includes("among")) {
    const { power } = getActualPowerToughness(permanent, gameState);
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to this creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Bighorn Rancher and similar - "Add {G} equal to the greatest power among creatures you control"
  if ((oracleText.includes("greatest power") && oracleText.includes("among creatures")) ||
      cardName.includes('bighorn rancher') || cardName.includes('bighorner rancher')) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    debug(2, `[calculateManaProduction] ${cardName}: Greatest power among creatures is ${greatestPower}`);
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `{G} equal to greatest power (${greatestPower})`;
    result.colors = ['G'];
  }
  
  // White Lotus Tile - "Add X mana of any one color, where X is the greatest number of creatures you control that have a creature type in common."
  // This counts the maximum number of creatures sharing ANY creature type
  if (cardName.includes('white lotus tile') || 
      (oracleText.includes('creature type in common') && oracleText.includes('greatest number'))) {
    // Build a map of creature types to count
    const creatureTypeCounts: Record<string, number> = {};
    
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Extract creature types from type line (after the em-dash)
      // Format: "Creature — Human Soldier" or "Legendary Creature — Elf Druid"
      const typeLineParts = permTypeLine.split(/[—-]/);
      if (typeLineParts.length > 1) {
        const subtypes = typeLineParts[1].trim().split(/\s+/);
        for (const subtype of subtypes) {
          if (subtype && subtype.length > 0) {
            creatureTypeCounts[subtype] = (creatureTypeCounts[subtype] || 0) + 1;
          }
        }
      }
    }
    
    // Find the greatest count
    let greatestCount = 0;
    let bestType = '';
    for (const [creatureType, count] of Object.entries(creatureTypeCounts)) {
      if (count > greatestCount) {
        greatestCount = count;
        bestType = creatureType;
      }
    }
    
    debug(2, `[calculateManaProduction] ${cardName}: Greatest creature type in common: ${bestType} (${greatestCount})`);
    result.isDynamic = true;
    result.baseAmount = greatestCount;
    result.dynamicDescription = `Add ${greatestCount} mana of any color (${bestType}s: ${greatestCount})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Tanuki Transplanter - "Add an amount of {G} equal to equipped creature's power"
  if (cardName.includes('tanuki transplanter')) {
    const attachedTo = (permanent as any).attachedTo;
    let power = 0;
    if (attachedTo) {
      const equippedCreature = battlefield.find((p: any) => p.id === attachedTo);
      if (equippedCreature) {
        const actualPT = getActualPowerToughness(equippedCreature, gameState);
        power = actualPT.power;
      }
    }
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to equipped creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Vhal, Candlekeep Researcher - "Add an amount of {U} equal to Vhal's toughness"
  if (cardName.includes('vhal')) {
    let toughness = (permanent.baseToughness ?? parseInt(card.toughness, 10)) || 0;
    if (permanent.counters) {
      toughness += (permanent.counters['+1/+1'] || 0) + (permanent.counters['p1p1'] || 0);
      toughness -= (permanent.counters['-1/-1'] || 0) + (permanent.counters['m1m1'] || 0);
    }
    result.isDynamic = true;
    result.baseAmount = Math.max(0, toughness);
    result.dynamicDescription = `{U} equal to toughness (${toughness})`;
    result.colors = ['U'];
  }
  
  // ===== STORAGE COUNTER BASED MANA ABILITIES =====
  
  // Mage-Ring Network, Rushwood Grove, etc. - Storage lands
  // "Remove any number of storage counters from ~: Add {C} for each storage counter removed this way"
  if (oracleText.includes('storage counter') && oracleText.includes('remove')) {
    const storageCounters = permanent?.counters?.storage || permanent?.counters?.['storage'] || 0;
    result.isDynamic = true;
    result.baseAmount = storageCounters;
    result.dynamicDescription = `{C} for each storage counter removed (${storageCounters} available)`;
    result.colors = ['C'];
    // If the card produces colored mana, detect it
    if (oracleText.includes('add {g}') || cardName.includes('rushwood grove')) {
      result.colors = ['G'];
    } else if (oracleText.includes('add {w}') || cardName.includes('saprazzan cove')) {
      result.colors = ['W'];
    } else if (oracleText.includes('add {u}') || cardName.includes('fountain of cho')) {
      result.colors = ['U'];
    } else if (oracleText.includes('add {b}') || cardName.includes('subterranean hangar')) {
      result.colors = ['B'];
    } else if (oracleText.includes('add {r}') || cardName.includes('mercadian bazaar')) {
      result.colors = ['R'];
    }
  }
  
  // Kyren Toy - "Remove X charge counters: Add X mana plus one"
  if (cardName.includes('kyren toy')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters + 1; // X plus one
    result.dynamicDescription = `{C} = charge counters + 1 (${chargeCounters + 1})`;
    result.colors = ['C'];
  }
  
  // Gemstone Caverns - Has a luck counter when starting in hand
  if (cardName.includes('gemstone caverns')) {
    const hasLuckCounter = (permanent?.counters?.luck || 0) > 0;
    if (hasLuckCounter) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['C'];
    }
    result.baseAmount = 1;
  }
  
  // Crystalline Crawler - Uses +1/+1 counters for mana
  // "Remove a +1/+1 counter from Crystalline Crawler: Add one mana of any color"
  if (cardName.includes('crystalline crawler')) {
    const p1p1Counters = (permanent?.counters?.['+1/+1'] || 0) + (permanent?.counters?.p1p1 || 0);
    if (p1p1Counters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one at a time
      result.dynamicDescription = `Any color mana (${p1p1Counters} +1/+1 counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Gemstone Array - Based on charge counters
  // "Remove a charge counter from this artifact: Add one mana of any color"
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      // Generic "any color" matching above can otherwise claim 1 mana with 0 counters.
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Coalition Relic - Uses charge counters for mana
  if (cardName.includes('coalition relic')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    // At the beginning of precombat main phase, remove all charge counters and add that much mana
    result.baseAmount = 1 + chargeCounters;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.dynamicDescription = `Any color + charge counters (${chargeCounters})`;
    }
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Mana Bloom - Uses charge counters
  if (cardName.includes('mana bloom')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Pentad Prism - Sunburst with charge counters
  // "Remove a charge counter: Add one mana of any color"
  if (cardName.includes('pentad prism')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }
  
  // Sphere of the Suns - Uses charge counters
  if (cardName.includes('sphere of the suns')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.baseAmount = 0;
      result.colors = [];
      result.requiresColorChoice = false;
    }
  }

  // Generic gate: selected ability cost requires removing counters the permanent lacks
  // (or removing from another permanent — not usable as a self mana source).
  // When no ability is selected, also gate cards whose only mana abilities spend self counters.
  const removeCounterCost = resolveRemoveCounterCostFromActivation(
    String(result.activationCost || selectedAbilityCostText || ''),
    String(permanent?.card?.name || ''),
  );
  if (
    removeCounterCost &&
    (
      !removeCounterCost.refersToSource
      || getPermanentCounterAmount(permanent, removeCounterCost.counterType) < removeCounterCost.count
    )
  ) {
    result.baseAmount = 0;
    result.colors = [];
    result.bonusMana = [];
    result.requiresColorChoice = false;
  } else if (!removeCounterCost && !selectedAbilityCostText && !hasSelectedLegacyManaAbility) {
    const selfRemoveManaCosts: ParsedRemoveCounterActivationCost[] = [];
    let hasIndependentManaAbility = false;
    for (const line of String(permanent?.card?.oracle_text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.includes(':')) continue;
      const costPart = trimmed.split(':')[0] || '';
      const effectPart = trimmed.split(':').slice(1).join(':');
      if (!/\badd\b/i.test(effectPart)) continue;
      if (!(/\bmana\b/i.test(effectPart) || /\{[wubrgc]\}/i.test(effectPart))) continue;
      const removeCost = parseRemoveCounterActivationCost(costPart, String(permanent?.card?.name || ''));
      if (removeCost?.refersToSource) {
        selfRemoveManaCosts.push(removeCost);
      } else {
        hasIndependentManaAbility = true;
      }
    }

    const canPayAnyRemove = selfRemoveManaCosts.some(
      (cost) => getPermanentCounterAmount(permanent, cost.counterType) >= cost.count,
    );
    if (selfRemoveManaCosts.length > 0 && !hasIndependentManaAbility && !canPayAnyRemove) {
      result.baseAmount = 0;
      result.colors = [];
      result.bonusMana = [];
      result.requiresColorChoice = false;
    }
  }

  // ===== STEP 3: Check for aura enchantments on this permanent (Wild Growth, etc.) =====
  
  // Find auras attached to this permanent
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const permTypeLine = (perm.card?.type_line || '').toLowerCase();
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    
    // Check if this is an aura enchanting our permanent
    const isAura = permTypeLine.includes('enchantment') && permTypeLine.includes('aura');
    const isAttachedToUs = (perm as any).attachedTo === permanent.id || 
                           (perm as any).enchanting === permanent.id;
    
    if (isAura && isAttachedToUs) {
      // Wild Growth - "Whenever enchanted land is tapped for mana, add an additional {G}"
      if (permName.includes('wild growth') || 
          (permOracleText.includes('additional {g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 1 });
      }
      
      // Fertile Ground - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('fertile ground') ||
          (permOracleText.includes('additional') && permOracleText.includes('any color') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Overgrowth - "Whenever enchanted land is tapped for mana, add {G}{G}"
      if (permName.includes('overgrowth') ||
          (permOracleText.includes('add {g}{g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 2 });
      }
      
      // Aura: tapped for mana -> add one mana of the chosen color (Utopia Sprawl template)
      if (
        /tapped for mana/i.test(permOracleText)
        && /add (?:one mana|an additional mana|a mana) of the chosen colou?r/i.test(permOracleText)
      ) {
        const chosenAuraColor = resolvePermanentChosenColorSymbol(perm) || chosenColor || 'G';
        result.bonusMana.push({ color: chosenAuraColor, amount: 1 });
      }
      
      // Dawn's Reflection - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes("dawn's reflection")) {
        result.bonusMana.push({ color: 'ANY', amount: 2 });
        result.requiresBonusColorChoice = true;
      }
      
      // Market Festival - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes('market festival')) {
        result.bonusMana.push({ color: 'ANY', amount: 2 });
        result.requiresBonusColorChoice = true;
      }
      
      // Weirding Wood - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('weirding wood')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Trace of Abundance - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('trace of abundance')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
      
      // Sheltered Aerie - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('sheltered aerie')) {
        result.bonusMana.push({ color: 'ANY', amount: 1 });
        result.requiresBonusColorChoice = true;
      }
    }
  }
  
  // ===== STEP 4: Check for global mana-boosting effects =====
  
  const isLand = typeLine.includes('land');
  const cardColors = (card.colors || []).map((c: string) => c.toUpperCase());
  
  for (const perm of battlefield) {
    if (!perm) continue;
    
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    const permController = perm.controller;
    
    // Only apply effects from our own permanents or global effects
    const isOurs = permController === playerId;
    
    // Chosen-color land mana doublers (Caged Sun / Gauntlet of Power templates)
    if (
      isLand
      && /tapped for mana of the chosen colou?r/i.test(permOracleText)
      && /add (?:one )?additional mana of that colou?r/i.test(permOracleText)
    ) {
      const requiresBasic = /\bbasic land\b/i.test(permOracleText);
      const requiresYouControl = /land you control/i.test(permOracleText);
      const hasBasicType =
        typeLine.includes('basic') || getEffectiveBasicLandTypes(permanent as any).length > 0;
      if (requiresBasic && !hasBasicType) {
        // skip
      } else if (requiresYouControl && !isOurs) {
        // skip opponents' lands for controller-limited effects
      } else {
        const chosenDoublerColor = resolvePermanentChosenColorSymbol(perm) || 'C';
        const producedMatches =
          result.colors.map((c) => String(c).toUpperCase()).includes(String(chosenDoublerColor).toUpperCase())
          || (chosenColor && String(chosenDoublerColor).toUpperCase() === String(chosenColor).toUpperCase());
        if (producedMatches && chosenDoublerColor !== 'C') {
          result.bonusMana.push({ color: chosenDoublerColor, amount: 1 });
        }
      }
    }
    
    // Mirari's Wake - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes("mirari's wake") && isOurs && isLand) {
      // Adds one of the same type
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Zendikar Resurgent - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes('zendikar resurgent') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Mana Reflection - "If you tap a permanent for mana, it produces double"
    if (permName.includes('mana reflection') && isOurs) {
      result.multiplier *= 2;
    }
    
    // Nyxbloom Ancient - "If you tap a permanent for mana, it produces three times as much"
    if (permName.includes('nyxbloom ancient') && isOurs) {
      result.multiplier *= 3;
    }
    
    // Mana Flare - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('mana flare') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Dictate of Karametra - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('dictate of karametra') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Heartbeat of Spring - Same as Mana Flare
    if (permName.includes('heartbeat of spring') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Vorinclex, Voice of Hunger - "Whenever you tap a land for mana, add one mana of any type that land could produce"
    if (permName.includes('vorinclex') && permName.includes('voice of hunger') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
  }
  
  // ===== STEP 5: Calculate total mana =====
  
  // Base amount * multiplier
  let total = result.baseAmount * result.multiplier;
  
  // Add bonus mana (bonuses are NOT multiplied in most cases, but for simplicity we add them after).
  // ANY-color bonuses are chosen via a follow-up prompt and are excluded until resolved.
  for (const bonus of result.bonusMana) {
    if (String(bonus.color || '').toUpperCase() === 'ANY') continue;
    total += bonus.amount;
  }
  
  result.totalAmount = Math.max(0, total);
  
  // If no colors determined, default to colorless
  if (result.colors.length === 0 && result.totalAmount > 0) {
    result.colors = ['C'];
  }
  
  return result;
}

/**
 * Calculate a creature's effective power including:
 * - Base power (from card data or basePower property)
 * - +1/+1 and -1/-1 counters
 * - Other P/T modifying counters (+1/+0, +2/+2, etc.)
 * - Equipment, auras, anthem effects, and other modifiers
 * - When gameState is provided: continuous lord/anthem effects (Morophon, etc.)
 * 
 * @param permanent - The creature permanent to calculate power for
 * @param gameState - Optional game state for continuous effects (lords via calculateAllPTBonuses)
 * @returns The effective power value
 */
export function getEffectivePower(permanent: any, gameState?: any): number {
  // Prefer pre-calculated view values only when we are not recomputing with state
  // (raw BF may have a stale effectivePower that omits lords).
  if (!gameState && typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  const card = permanent.card;
  let basePower = permanent.basePower ?? (parseInt(String(card?.power ?? '0'), 10) || 0);
  
  // Handle star (*) power - variable power creatures like Tarmogoyf, Morophon
  if (typeof card?.power === 'string' && card.power.includes('*')) {
    // If basePower is set, use that as it should have been calculated already
    if (typeof permanent.basePower === 'number') {
      basePower = permanent.basePower;
    }
  }
  
  // Add +1/+1 counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  // Subtract -1/-1 counters
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types that affect power
  // Examples: +1/+0, +2/+2, +1/+2, etc.
  let otherCounterPower = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      // Parse counter types like "+1/+0", "+2/+2", etc.
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const pMod = parseInt(counterMatch[1], 10);
        otherCounterPower += pMod * (count as number);
      }
    }
  }

  // State-aware path: include continuous lords/anthems/equipment (same as SBA/combat).
  // Prefer an already-synced derived cache; otherwise sync once so subsequent
  // getEffectiveToughness/Power calls on the same state stay cheap.
  // calculateAllPTBonuses already folds temporaryPowerBoost / powerBoost / pump modifiers.
  if (gameState) {
    if (!(gameState as any)._derivedContinuousEffects) {
      try {
        syncDerivedContinuousEffects(gameState);
      } catch {
        // best-effort; fall through to calculateAllPTBonuses
      }
    }
    let modifierPower = 0;
    if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
      for (const mod of permanent.modifiers) {
        if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
          modifierPower += mod.power || 0;
        }
      }
    }
    const allBonuses = calculateAllPTBonuses(permanent, gameState);
    return Math.max(
      0,
      basePower + counterDelta + otherCounterPower + allBonuses.power + modifierPower + sumActiveTemporaryPTMods(permanent).power,
    );
  }
  
  // Add modifiers from equipment, auras, anthems, lords, etc.
  let modifierPower = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierPower += mod.power || 0;
      }
    }
  }

  const temporaryPower =
    (typeof permanent.temporaryPowerBoost === 'number' ? permanent.temporaryPowerBoost : 0) +
    (typeof permanent.powerBoost === 'number' ? permanent.powerBoost : 0) +
    sumActiveTemporaryPTMods(permanent).power;
  
  return Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower + temporaryPower);
}

/**
 * Calculate a creature's effective toughness including counters and modifiers
 * 
 * @param permanent - The creature permanent to calculate toughness for
 * @param gameState - Optional game state for continuous effects (lords, equipment via calculateAllPTBonuses)
 * @returns The effective toughness value
 */
export function getEffectiveToughness(permanent: any, gameState?: any): number {
  // Prefer pre-calculated view values only when we are not recomputing with state
  // (raw BF may have a stale effectiveToughness that omits lords).
  if (!gameState && typeof permanent.effectiveToughness === 'number') {
    return permanent.effectiveToughness;
  }
  
  const card = permanent.card;
  let baseToughness = permanent.baseToughness ?? (parseInt(String(card?.toughness ?? '0'), 10) || 0);
  
  // Handle star (*) toughness
  if (typeof card?.toughness === 'string' && card.toughness.includes('*')) {
    if (typeof permanent.baseToughness === 'number') {
      baseToughness = permanent.baseToughness;
    }
  }
  
  // Add counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types
  let otherCounterToughness = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const tMod = parseInt(counterMatch[2], 10);
        otherCounterToughness += tMod * (count as number);
      }
    }
  }

  if (gameState) {
    if (!(gameState as any)._derivedContinuousEffects) {
      try {
        syncDerivedContinuousEffects(gameState);
      } catch {
        // best-effort
      }
    }
    let modifierToughness = 0;
    if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
      for (const mod of permanent.modifiers) {
        if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
          modifierToughness += mod.toughness || 0;
        }
      }
    }
    const allBonuses = calculateAllPTBonuses(permanent, gameState);
    return Math.max(
      0,
      baseToughness + counterDelta + otherCounterToughness + allBonuses.toughness + modifierToughness + sumActiveTemporaryPTMods(permanent).toughness,
    );
  }
  
  // Add modifiers
  let modifierToughness = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierToughness += mod.toughness || 0;
      }
    }
  }

  const temporaryToughness =
    (typeof permanent.temporaryToughnessBoost === 'number' ? permanent.temporaryToughnessBoost : 0) +
    (typeof permanent.toughnessBoost === 'number' ? permanent.toughnessBoost : 0) +
    sumActiveTemporaryPTMods(permanent).toughness;
  
  return Math.max(0, baseToughness + counterDelta + otherCounterToughness + modifierToughness + temporaryToughness);
}

/**
 * Emit an event to a specific player's connected sockets.
 * Iterates through all connected sockets and emits to those with matching playerId.
 */
export function emitToPlayer(
  io: Server,
  playerId: string,
  event: string,
  payload: unknown
): void {
  try {
    for (const socket of io.sockets.sockets.values()) {
      try {
        if (
          (socket.data as any)?.playerId === playerId &&
          !(socket.data as any)?.spectator &&
          !(socket.data as any)?.isSpectator
        ) {
          socket.emit(event, payload);
        }
      } catch {
        // ignore per-socket errors
      }
    }
  } catch (err) {
    debugWarn(1, `[util] emitToPlayer failed for ${event}:`, err);
  }
}

// ============================================================================
// ENHANCED MANA POOL FUNCTIONS - Support for restricted mana
// ============================================================================

/**
 * Helper function to get the color from a restricted mana entry
 * Uses the 'type' field as the primary source
 */
export function getManaEntryColor(entry: RestrictedManaEntry): 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless' {
  return entry.type;
}

/**
 * Add restricted mana to a player's mana pool
 */
export function addRestrictedManaToPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  amount: number,
  restriction: ManaRestrictionType,
  restrictedTo?: string,
  sourceId?: string,
  sourceName?: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // NOTE: ManaPool interface marks properties as readonly for immutability guarantees.
  // However, server-side code needs to mutate the pool. We use `as any` here because:
  // 1. We own the game state and control all mutations
  // 2. The readonly is for client-side type safety, not server-side enforcement
  // 3. Alternative solutions (separate mutable type) would duplicate the interface
  const mutablePool = pool as any;
  const restricted = (mutablePool.restricted as RestrictedManaEntry[] | undefined) || [];
  mutablePool.restricted = restricted;
  
  // Check if there's already an entry with the same attributes (check both type and color for compatibility)
  const existingIndex = restricted.findIndex(
    entry => getManaEntryColor(entry) === color && 
             entry.restriction === restriction && 
             entry.sourceId === sourceId &&
             entry.restrictedTo === restrictedTo
  );
  
  if (existingIndex >= 0) {
    // Add to existing entry
    restricted[existingIndex].amount += amount;
  } else {
    // Create new entry
    restricted.push({
      type: color,
      amount,
      restriction,
      restrictedTo,
      sourceId,
      sourceName,
    });
  }
}

/**
 * Remove restricted mana from pool
 */
export function removeRestrictedManaFromPool(
  gameState: any,
  playerId: string,
  restrictedIndex: number,
  amount: number = 1
): boolean {
  const pool = getOrInitManaPool(gameState, playerId);
  const restricted = pool.restricted as RestrictedManaEntry[] | undefined;
  if (!restricted || restrictedIndex >= restricted.length) {
    return false;
  }
  
  const entry = restricted[restrictedIndex];
  if (entry.amount < amount) {
    return false;
  }
  
  if (entry.amount === amount) {
    // Remove the entry entirely
    restricted.splice(restrictedIndex, 1);
    if (restricted.length === 0) {
      delete (pool as any).restricted;
    }
  } else {
    entry.amount -= amount;
  }
  
  return true;
}

/**
 * Set the "doesn't empty" flag on a player's mana pool
 * Used by effects like Horizon Stone, Omnath, Kruphix, Ozai
 * 
 * @param convertsTo - Target color to convert mana to (e.g., 'colorless', 'black', 'red')
 * @param convertsToColorless - @deprecated Use convertsTo: 'colorless' instead
 */
export function setManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string,
  convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  convertsToColorless: boolean = false
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // Cast to allow modification of readonly properties
  const mutablePool = pool as any;
  mutablePool.doesNotEmpty = true;
  
  // Support both new convertsTo and deprecated convertsToColorless
  if (convertsTo) {
    mutablePool.convertsTo = convertsTo;
  } else if (convertsToColorless) {
    mutablePool.convertsTo = 'colorless';
    mutablePool.convertsToColorless = true;
  }
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds || [];
  
  if (!mutablePool.noEmptySourceIds.includes(sourceId)) {
    mutablePool.noEmptySourceIds.push(sourceId);
  }
}

/**
 * Remove the "doesn't empty" effect from a specific source
 * Called when the source permanent leaves the battlefield
 */
export function removeManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  const mutablePool = pool as any;
  
  if (!mutablePool.noEmptySourceIds) return;
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds.filter((id: string) => id !== sourceId);
  
  if (mutablePool.noEmptySourceIds.length === 0) {
    delete mutablePool.doesNotEmpty;
    delete mutablePool.convertsTo;
    delete mutablePool.convertsToColorless;
    delete mutablePool.noEmptySourceIds;
  }
}

/**
 * Calculate total mana in pool (including restricted)
 */
export function getTotalManaInPool(
  gameState: any,
  playerId: string
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = (pool.white || 0) + (pool.blue || 0) + (pool.black || 0) +
                      (pool.red || 0) + (pool.green || 0) + (pool.colorless || 0);
  const restrictedMana = pool.restricted?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Calculate total mana of a specific color in pool (including restricted)
 * Useful for cards like Omnath, Locus of Mana which get +1/+1 for each green mana
 */
export function getTotalManaOfColorInPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = pool[color] || 0;
  const restrictedMana = pool.restricted
    ?.filter(entry => getManaEntryColor(entry) === color)
    .reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Check if restricted mana can be used for a specific purpose
 */
export type RestrictedManaSpendPurpose = {
  isCreature?: boolean;
  isAbility?: boolean;
  isColorless?: boolean;
  isArtifact?: boolean;
  isLegendary?: boolean;
  isMulticolored?: boolean;
  isCommander?: boolean;
  isActivatedAbility?: boolean;
  isInstantOrSorcery?: boolean;
  cardId?: string;
  creatureType?: string;
  spellType?: string;
  spellCard?: any;
  abilitySourceIsCreature?: boolean;
  abilitySourceCreatureType?: string;
};

export function canUseRestrictedMana(
  entry: RestrictedManaEntry,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  switch (entry.restriction) {
    case 'creatures':
      return purpose.isCreature === true;
    case 'abilities':
      return purpose.isAbility === true;
    case 'colorless_spells':
      return purpose.isColorless === true;
    case 'artifacts':
      return purpose.isArtifact === true;
    case 'legendary':
      return purpose.isLegendary === true;
    case 'multicolored':
      return purpose.isMulticolored === true;
    case 'commander':
      return purpose.isCommander === true;
    case 'activated_abilities':
      return purpose.isActivatedAbility === true;
    case 'instant_sorcery':
      return purpose.isInstantOrSorcery === true;
    case 'chosen_type_creature_spell':
    case 'chosen_type_creature_source':
      if (purpose.isCreature !== true) {
        if (entry.restriction === 'chosen_type_creature_source' && purpose.isActivatedAbility === true) {
          if (purpose.abilitySourceIsCreature !== true) return false;
          return !entry.restrictedTo
            || purpose.creatureType === entry.restrictedTo
            || purpose.abilitySourceCreatureType === entry.restrictedTo;
        }
        return false;
      }
      if (!entry.restrictedTo) return true;
      if (purpose.creatureType === entry.restrictedTo) return true;
      if (purpose.spellCard && cardHasCreatureType(purpose.spellCard, entry.restrictedTo)) {
        return true;
      }
      return false;
    case 'chosen_type_spell':
      if (!entry.restrictedTo) return true;
      if (purpose.creatureType === entry.restrictedTo || purpose.spellType === entry.restrictedTo) return true;
      if (purpose.spellCard && cardHasCreatureType(purpose.spellCard, entry.restrictedTo)) return true;
      return false;
    case 'creature_spells_mv_or_x': {
      if (purpose.isCreature !== true) return false;
      const spellCard = purpose.spellCard;
      if (!spellCard) return false;
      const manaCost = String(spellCard.mana_cost || '');
      if (/\{x\}/i.test(manaCost)) return true;
      const minMv = Number.parseInt(String(entry.restrictedTo || '4'), 10);
      const threshold = Number.isFinite(minMv) && minMv > 0 ? minMv : 4;
      let manaValue = Number(spellCard.cmc);
      if (!Number.isFinite(manaValue)) {
        manaValue = 0;
        const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
        for (const token of tokens) {
          const inner = token.replace(/[{}]/g, '');
          if (/^\d+$/.test(inner)) manaValue += Number.parseInt(inner, 10);
          else if (/^[wubrgcs]$/i.test(inner)) manaValue += 1;
          else if (inner.includes('/')) manaValue += 1;
        }
      }
      return manaValue >= threshold;
    }
    case 'specific_card':
      return entry.restrictedTo === purpose.cardId;
    default:
      return false;
  }
}

export function parseFloatingPaymentPermanentId(permanentId: string):
  | { kind: 'regular'; colorKey: string }
  | { kind: 'restricted'; index: number }
  | null {
  const rawId = String(permanentId || '').trim();
  if (!rawId.startsWith('__pool__:')) return null;

  const parts = rawId.slice('__pool__:'.length).split(':');
  const encodedKey = String(parts[0] || '').trim().toLowerCase();
  if (encodedKey === 'restricted') {
    const index = Number.parseInt(parts[1] ?? '', 10);
    return Number.isFinite(index) && index >= 0 ? { kind: 'restricted', index } : null;
  }
  if (['white', 'blue', 'black', 'red', 'green', 'colorless'].includes(encodedKey)) {
    return { kind: 'regular', colorKey: encodedKey };
  }
  return null;
}

export function getFloatingPaymentPoolColorKey(
  permanentId: string,
  mana: string,
  pool?: ManaPool,
): string | null {
  const parsed = parseFloatingPaymentPermanentId(permanentId);
  if (!parsed) return null;
  if (parsed.kind === 'regular') return parsed.colorKey;
  const entry = pool?.restricted?.[parsed.index];
  if (entry) return getManaEntryColor(entry);
  return MANA_COLOR_NAMES[String(mana || '').toUpperCase()] || null;
}

export function validateSelectedFloatingPoolMana(
  pool: ManaPool,
  selectedFloatingMana: Record<string, number>,
  selectedFloatingRestricted: Record<number, number>,
  purpose?: RestrictedManaSpendPurpose,
): string | null {
  for (const [indexStr, amount] of Object.entries(selectedFloatingRestricted)) {
    const index = Number(indexStr);
    const needed = Number(amount || 0);
    if (needed <= 0) continue;
    const entry = pool.restricted?.[index];
    if (!entry || entry.amount < needed) {
      return 'Not enough restricted mana selected from your pool.';
    }
    if (purpose && !canUseRestrictedMana(entry, purpose)) {
      return 'Selected restricted mana cannot be spent on this payment.';
    }
  }

  for (const [poolKey, amount] of Object.entries(selectedFloatingMana)) {
    const needed = Number(amount || 0);
    if (needed <= 0) continue;
    const regularAvailable = Number((pool as any)[poolKey] || 0);
    let restrictedAvailable = 0;
    for (const entry of pool.restricted || []) {
      if (getManaEntryColor(entry) !== poolKey) continue;
      if (purpose && !canUseRestrictedMana(entry, purpose)) continue;
      restrictedAvailable += entry.amount;
    }
    if (regularAvailable + restrictedAvailable < needed) {
      return `Not enough ${poolKey} mana selected from your pool.`;
    }
  }

  return null;
}

export function buildManaTotalsIncludingEligibleRestricted(
  pool: ManaPool,
  purpose: RestrictedManaSpendPurpose,
): Record<string, number> {
  const totals = calculateTotalAvailableMana(pool, undefined);
  for (const entry of pool.restricted || []) {
    if (!canUseRestrictedMana(entry, purpose)) continue;
    const color = getManaEntryColor(entry);
    totals[color] = (totals[color] || 0) + entry.amount;
  }
  return totals;
}

export function consumeManaFromPoolForPurpose(
  pool: ManaPool,
  coloredCost: Record<string, number>,
  genericCost: number,
  purpose: RestrictedManaSpendPurpose,
  logPrefix?: string,
): { consumed: Record<string, number> } {
  const mutablePool = pool as any;
  const restricted = Array.isArray(mutablePool.restricted) ? mutablePool.restricted as RestrictedManaEntry[] : [];
  const workingTotals = buildManaTotalsIncludingEligibleRestricted(pool, purpose);
  const validationError = validateManaPayment(workingTotals, coloredCost, genericCost);
  if (validationError) {
    return consumeManaFromPool(pool, coloredCost, genericCost, logPrefix);
  }

  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
  };

  const takeFromRestricted = (colorKey: string, needed: number): number => {
    let remaining = needed;
    for (let index = restricted.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const entry = restricted[index];
      if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
      if (getManaEntryColor(entry) !== colorKey) continue;
      const use = Math.min(entry.amount, remaining);
      if (use <= 0) continue;
      entry.amount -= use;
      remaining -= use;
      consumed[colorKey] = (consumed[colorKey] || 0) + use;
      if (entry.amount <= 0) {
        restricted.splice(index, 1);
      }
    }
    if (restricted.length === 0) {
      delete mutablePool.restricted;
    } else {
      mutablePool.restricted = restricted;
    }
    return needed - remaining;
  };

  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = Number((coloredCost as any)[color] || 0);
    if (!colorKey || needed <= 0) continue;
    const fromRestricted = takeFromRestricted(colorKey, needed);
    const stillNeeded = needed - fromRestricted;
    if (stillNeeded > 0 && Number(mutablePool[colorKey] || 0) >= stillNeeded) {
      mutablePool[colorKey] = Number(mutablePool[colorKey] || 0) - stillNeeded;
      consumed[colorKey] = (consumed[colorKey] || 0) + stillNeeded;
    }
  }

  let genericLeft = genericCost;
  if (genericLeft > 0 && Number(mutablePool.colorless || 0) > 0) {
    const useColorless = Math.min(Number(mutablePool.colorless || 0), genericLeft);
    mutablePool.colorless = Number(mutablePool.colorless || 0) - useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
  }

  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (!colorKey) continue;
    const fromRestricted = takeFromRestricted(colorKey, genericLeft);
    genericLeft -= fromRestricted;
    if (genericLeft <= 0) break;
    const available = Number(mutablePool[colorKey] || 0);
    if (available <= 0) continue;
    const useColor = Math.min(available, genericLeft);
    mutablePool[colorKey] = available - useColor;
    consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
    genericLeft -= useColor;
  }

  if (logPrefix) {
    debug(2, `${logPrefix} Consumed mana with restricted-purpose spending: ${JSON.stringify(consumed)}`);
  }

  return { consumed };
}

/**
 * Broadcast mana pool update to all clients
 * Also broadcasts full game state to update any P/T that depends on mana pool (e.g., Omnath)
 */
export function broadcastManaPoolUpdate(
  io: Server,
  gameId: string,
  playerId: string,
  manaPool: ManaPool,
  reason?: string,
  game?: any
): void {
  try {
    // Loop-shortcut batches suppress mid-batch UI updates; final forceStateReplace carries mana.
    if (game && Number((game.state as any)?._suppressBroadcastCount || 0) > 0) {
      return;
    }
    if (!game) {
      try {
        const live = ensureGame(gameId);
        if (live && Number((live.state as any)?._suppressBroadcastCount || 0) > 0) {
          return;
        }
      } catch {
        // continue
      }
    }

    const totalMana = getTotalManaInPool({ manaPool: { [playerId]: manaPool } }, playerId);
    
    io.to(gameId).emit('manaPoolUpdate', {
      gameId,
      playerId,
      manaPool: {
        white: manaPool.white || 0,
        blue: manaPool.blue || 0,
        black: manaPool.black || 0,
        red: manaPool.red || 0,
        green: manaPool.green || 0,
        colorless: manaPool.colorless || 0,
        restricted: manaPool.restricted,
        doesNotEmpty: manaPool.doesNotEmpty,
        convertsToColorless: manaPool.convertsToColorless,
        noEmptySourceIds: manaPool.noEmptySourceIds,
      },
      totalMana,
      reason,
    });
    
    // Also broadcast full game state to update P/T of creatures that depend on mana pool
    // (e.g., Omnath, Locus of Mana gets +1/+1 for each green mana)
    if (game) {
      broadcastGame(io, game, gameId);
    }
  } catch (err) {
    debugWarn(1, `[util] broadcastManaPoolUpdate failed:`, err);
  }
}



