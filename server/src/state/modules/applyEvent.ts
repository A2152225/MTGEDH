// server/src/state/modules/applyEvent.ts
// Event application / replay / reset helpers.
//
// Exports:
// - applyEvent(ctx, e)
// - replay(ctx, events)
// - reset(ctx, preservePlayers)
// - skip(ctx, playerId)
// - unskip(ctx, playerId)
// - remove(ctx, playerId)
//
// Defensive implementation: tolerates unknown event types and missing engine helpers.

import type { GameContext } from "../context";
import type { PlayerID, GameEvent } from "../types";

import { recordCardLeftGraveyardThisTurn, recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  searchLibrary,
  reconcileZonesConsistency,
  applyScry,
  applySurveil,
  movePermanentToHand,
  applyExplore,
} from "./zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import { exchangePermanentOracleText } from "../utils";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  removePermanent,
  movePermanentToGraveyard,
  trackCountersPlacedThisTurn,
  trackPermanentSacrificedThisTurn,
  applyEngineEffects,
  runSBA,
  movePermanentToExile,
} from "./counters_tokens";
import { cleanupCardLeavingExile } from "./playable-from-exile";
import { pushStack, resolveTopOfStack, playLand, castSpell, triggerETBEffectsForToken } from "./stack";
import { permanentHasKeyword } from "./keyword-handlers";
import { nextTurn, nextStep, passPriority } from "./turn";

function getReplayStartingPlayerId(state: any): string {
  return String(state?.startingPlayerId || state?.startingPlayer || state?.turnPlayer || '').trim();
}

function getReplayOpeningHandBattlefieldCounters(state: any, card: any, playerId?: string): Record<string, number> {
  const cardName = String(card?.name || '').toLowerCase();
  const startingPlayerId = getReplayStartingPlayerId(state);
  if (cardName === 'gemstone caverns' && startingPlayerId && playerId && playerId !== startingPlayerId) {
    return { luck: 1 };
  }
  return {};
}

function resolveReplayCommanderId(ctx: any, event: any): string {
  const explicitCommanderId = String(event?.commanderId || '').trim();
  if (explicitCommanderId) return explicitCommanderId;

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const knownCommanderIds = Array.isArray(commanderInfo?.commanderIds)
    ? commanderInfo.commanderIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];

  const fallbackIds = [event?.cardId, event?.card?.id]
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);

  for (const fallbackId of fallbackIds) {
    if (knownCommanderIds.length === 0 || knownCommanderIds.includes(fallbackId)) {
      return fallbackId;
    }
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];
  for (const fallbackName of fallbackNames) {
    const matchedCommander = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    const matchedId = String(matchedCommander?.id || '').trim();
    if (matchedId) {
      return matchedId;
    }
  }

  return '';
}

function resolveReplayCommanderCard(ctx: any, event: any, commanderId: string): any | undefined {
  if (event?.card && typeof event.card === 'object' && !Array.isArray(event.card)) {
    return event.card;
  }

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];

  if (commanderId) {
    const matchedById = commanderCards.find((card: any) => String(card?.id || '').trim() === commanderId);
    if (matchedById) return matchedById;
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  for (const fallbackName of fallbackNames) {
    const matchedByName = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    if (matchedByName) return matchedByName;
  }

  return undefined;
}
import { join, leave as leaveModule } from "./join";
import { resolveSpell } from "../../rules-engine/targeting";
import { evaluateAction } from "../../rules-engine/index";
import { mulberry32 } from "../../utils/rng";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { checkGraveyardTrigger, parsePlaneswalkerAbilities } from "./triggered-abilities.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from "./triggers/damage-received.js";
import { processLifeChange } from "./game-state-effects";
import { sacrificePermanent } from "./upkeep-triggers";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import { parseManaCost } from "./mana-check.js";
import { calculateManaProduction, consumeManaFromPool, getOrInitManaPool, resolveManaCostForPoolPayment } from "../../socket/util.js";
import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../../rules-engine/src/creatureUpgradeAbilities.js";
import { detectTutorEffect, getActivatedAbilityScopeText, parseSearchCriteria } from "../../socket/interaction.js";
import { getOpponentMayPayDrawCount, getOpponentMayPayTreasureCount } from "./opponent-may-pay-utils.js";
import { moveKynaiosLandFromHandToBattlefield } from "../resolution/handlers/kynaiosChoice.js";
import { applyTriggerOrderToStack } from "../resolution/handlers/triggerOrder.js";

/* -------- Helpers ---------- */

/**
 * Generate a deterministic ID for permanents during replay.
 * Uses the game's RNG if available, otherwise uses a counter based on the card ID.
 * This ensures IDs are consistent across replays with the same RNG seed.
 */
function generateDeterministicId(ctx: any, prefix: string, cardId: string): string {
  // Use the game's RNG if available for deterministic ID generation
  if (typeof ctx.rng === 'function') {
    const rngValue = Math.floor(ctx.rng() * 0xFFFFFFFF).toString(36);
    return `${prefix}_${cardId}_${rngValue}`;
  }
  // Fallback: use card ID with a counter (incremented on ctx)
  ctx._idCounter = (ctx._idCounter || 0) + 1;
  return `${prefix}_${cardId}_${ctx._idCounter}`;
}

const MANA_CODE_TO_POOL_KEY: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

const MANA_NAME_TO_CODE: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

const PAIN_LANDS = new Set([
  'shivan reef', 'llanowar wastes', 'caves of koilos', 'adarkar wastes',
  'sulfurous springs', 'underground river', 'karplusan forest', 'battlefield forge',
  'brushland', 'yavimaya coast',
  'horizon canopy', 'nurturing peatland', 'fiery islet', 'sunbaked canyon',
  'silent clearing', 'waterlogged grove',
]);

function normalizeManaColorCode(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (MANA_CODE_TO_POOL_KEY[upper]) return upper;
  const lower = raw.toLowerCase();
  return MANA_NAME_TO_CODE[lower];
}

function normalizeRecordedManaMap(raw: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized;

  for (const [key, amountRaw] of Object.entries(raw as Record<string, unknown>)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount)) continue;

    const lowerKey = String(key || '').trim().toLowerCase();
    if (lowerKey && Object.values(MANA_CODE_TO_POOL_KEY).includes(lowerKey)) {
      normalized[lowerKey] = (normalized[lowerKey] || 0) + amount;
      continue;
    }

    const code = normalizeManaColorCode(key);
    const poolKey = code ? MANA_CODE_TO_POOL_KEY[code] : undefined;
    if (poolKey) {
      normalized[poolKey] = (normalized[poolKey] || 0) + amount;
    }
  }

  return normalized;
}

function inferLegacyManaReplay(rawState: any, permanent: any, playerId: string, manaColor: unknown): Record<string, number> {
  const chosenColor = normalizeManaColorCode(manaColor);
  if (String(manaColor || '').toUpperCase() === 'MULTI') return {};

  const manaProduction = calculateManaProduction(rawState, permanent, playerId, chosenColor);
  const producedColor = chosenColor || normalizeManaColorCode(manaProduction.colors?.[0]);
  const poolKey = producedColor ? MANA_CODE_TO_POOL_KEY[producedColor] : undefined;
  if (!poolKey) return {};

  return {
    [poolKey]: Number(manaProduction.totalAmount || 0),
  };
}

function applyRecordedManaToPool(ctx: any, playerId: string, rawMana: unknown): void {
  const normalized = normalizeRecordedManaMap(rawMana);
  if (Object.keys(normalized).length === 0) return;

  const pool = getOrInitManaPool(ctx.state, playerId);
  for (const [poolKey, amount] of Object.entries(normalized)) {
    pool[poolKey] = Number(pool[poolKey] || 0) + Number(amount || 0);
  }
}

function inferLegacyManaLifeLoss(permanent: any, manaColor: unknown): number {
  const chosenColor = normalizeManaColorCode(manaColor);
  if (!chosenColor || chosenColor === 'C') return 0;

  const cardName = String(permanent?.card?.name || '').toLowerCase();
  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
  const isPainLand = oracleText.includes('deals 1 damage to you') ||
    (oracleText.includes('{t},') && oracleText.includes('pay 1 life')) ||
    PAIN_LANDS.has(cardName);

  return isPainLand ? 1 : 0;
}

function applyManaAbilityLifeLoss(ctx: any, playerId: string, amount: number): void {
  const finalAmount = Number(amount || 0);
  if (!playerId || finalAmount <= 0) return;

  (ctx.state as any).life = (ctx.state as any).life || {};
  const startingLife = Number((ctx.state as any).startingLife || 40);
  const currentLife = Number((ctx.state as any).life?.[playerId] ?? startingLife);
  (ctx.state as any).life[playerId] = Math.max(0, currentLife - finalAmount);

  try {
    (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
    (ctx.state as any).damageTakenThisTurnByPlayer[String(playerId)] =
      (((ctx.state as any).damageTakenThisTurnByPlayer[String(playerId)] || 0) + finalAmount);

    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
      (((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + finalAmount);
  } catch {
    // best-effort only
  }

  const player = ((ctx.state as any).players || []).find((p: any) => p?.id === playerId);
  if (player) {
    player.life = (ctx.state as any).life[playerId];
  }
}

function applyRecordedLifePayment(ctx: GameContext, playerId: string, rawAmount: unknown): void {
  const paidLife = Number(rawAmount || 0);
  if (!playerId || !Number.isFinite(paidLife) || paidLife <= 0) return;

  (ctx.state as any).life = (ctx.state as any).life || {};
  const currentLife = Number((ctx.state as any).life?.[playerId] ?? ctx.state.startingLife ?? 40);
  (ctx.state as any).life[playerId] = Math.max(0, currentLife - paidLife);

  try {
    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
      (((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + paidLife);
  } catch {
    // best-effort only
  }
}

function applyRecordedPlayLandReplayState(ctx: GameContext, event: any): void {
  const playerId = String(event?.playerId || '').trim();
  const cardId = String(event?.card?.id || event?.cardId || '').trim();
  if (!playerId || !cardId) return;

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? ((ctx.state as any).battlefield as any[]) : [];
  const permanent = [...battlefield].reverse().find((entry: any) =>
    String(entry?.controller || '') === playerId && String(entry?.card?.id || '') === cardId
  );
  if (!permanent) return;

  if (typeof event?.entersTapped === 'boolean') {
    permanent.tapped = event.entersTapped;
  }

  if (event?.paidLife != null) {
    applyRecordedLifePayment(ctx, playerId, event.paidLife);
  }
}

function consumeRecordedManaCostFromPool(pool: Record<string, number>, manaCost?: string): void {
  if (!pool || !manaCost) return;

  try {
    const resolved = resolveManaCostForPoolPayment(pool as any, manaCost);
    if (resolved && (resolved as any).ok) {
      consumeManaFromPool(pool as any, (resolved as any).coloredCost || {}, (resolved as any).genericCost || 0);
      return;
    }
  } catch {
    // Fall through to the conservative legacy spender below.
  }

  const parsedCost = parseManaCost(manaCost);
  const colorMap: Record<string, keyof typeof pool> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };

  for (const [symbol, amount] of Object.entries(parsedCost.colors || {})) {
    const poolKey = colorMap[String(symbol).toUpperCase()];
    if (!poolKey) continue;
    const current = Number(pool[poolKey] || 0);
    pool[poolKey] = Math.max(0, current - Number(amount || 0));
  }

  let remainingGeneric = Number(parsedCost.generic || 0);
  const spendOrder: Array<keyof typeof pool> = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
  for (const poolKey of spendOrder) {
    if (remainingGeneric <= 0) break;
    const available = Number(pool[poolKey] || 0);
    if (available <= 0) continue;
    const spent = Math.min(available, remainingGeneric);
    pool[poolKey] = available - spent;
    remainingGeneric -= spent;
  }
}

function resolveOpponentMayPaySourceController(ctx: GameContext, e: any): string {
  const persistedSourceController = String(e?.sourceController || '').trim();
  if (persistedSourceController) {
    return persistedSourceController;
  }

  const sourceName = String(e?.sourceName || '').trim().toLowerCase();
  if (!sourceName) {
    return '';
  }

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const matches = battlefield.filter((permanent: any) =>
    String(permanent?.card?.name || '').trim().toLowerCase() === sourceName
  );

  if (matches.length === 1) {
    return String(matches[0]?.controller || '').trim();
  }

  return '';
}

function applyAIActivateAbilityReplay(ctx: GameContext, e: any): void {
  const playerId = String(e?.playerId || '').trim();
  const permanentId = String(e?.permanentId || '').trim();
  if (!playerId || !permanentId) {
    return;
  }

  const stateAny = ctx.state as any;
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
  const sourceName = String(e?.cardName || permanent?.card?.name || 'Ability').trim() || 'Ability';
  const abilityType = String(e?.abilityType || '').trim().toLowerCase();
  const activatedAbilityText = String(e?.activatedAbilityText || e?.abilityText || permanent?.card?.oracle_text || '').trim();

  try {
    const tapped = Array.isArray(e?.tappedPermanents) ? e.tappedPermanents : [];
    if (tapped.length > 0) {
      const tappedSet = new Set(tapped.map((id: any) => String(id)));
      for (const entry of battlefield as any[]) {
        if (entry && tappedSet.has(String(entry.id || ''))) {
          (entry as any).tapped = true;
        }
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const paid = Number(e?.lifePaidForCost || 0);
    if (Number.isFinite(paid) && paid > 0) {
      stateAny.life = stateAny.life || {};
      const current = Number(stateAny.life?.[playerId] ?? ctx.state.startingLife ?? 40);
      stateAny.life[playerId] = Math.max(0, current - paid);
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[String(playerId)] =
        ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + paid);

      const player = Array.isArray(stateAny.players)
        ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
        : null;
      if (player) {
        player.life = stateAny.life[playerId];
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const sacrificed = Array.isArray(e?.sacrificedPermanents) ? e.sacrificedPermanents : [];
    for (const rawId of sacrificed) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const stillOnBattlefield = Array.isArray(ctx.state?.battlefield)
        ? (ctx.state.battlefield as any[]).some((entry: any) => entry && String(entry.id || '') === id)
        : false;
      if (!stillOnBattlefield) continue;
      movePermanentToGraveyard(ctx as any, id, true);
    }
  } catch {
    // best-effort only
  }

  if (abilityType === 'humble-defector') {
    drawCards(ctx as any, playerId, 2);

    const targetOpponentId = String(e?.targetOpponentId || '').trim();
    if (targetOpponentId) {
      const humbleDefector = Array.isArray(ctx.state?.battlefield)
        ? (ctx.state.battlefield as any[]).find((entry: any) => entry && String(entry.id || '') === permanentId)
        : null;
      if (humbleDefector) {
        (humbleDefector as any).controller = targetOpponentId;
        (humbleDefector as any).summoningSickness = true;
      }
    }

    ctx.bumpSeq();
    return;
  }

  const usesStack = e?.usesStack !== false;
  if (!usesStack || !activatedAbilityText) {
    ctx.bumpSeq();
    return;
  }

  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const stack = stateAny.stack as any[];
  const existing = stack.find((item: any) =>
    item &&
    String(item.type || '') === 'ability' &&
    String(item.controller || '') === playerId &&
    String(item.source || '') === permanentId &&
    String(item.activatedAbilityText || item.description || '') === activatedAbilityText
  );
  if (existing) {
    ctx.bumpSeq();
    return;
  }

  const stackItem: any = {
    id: generateDeterministicId(ctx, 'ability_ai', `${permanentId}:${abilityType || activatedAbilityText}`),
    type: 'ability',
    controller: playerId,
    source: permanentId,
    sourceName,
    description: activatedAbilityText,
    activatedAbilityText,
    card: {
      id: permanentId,
      name: `${sourceName} (ability)`,
      type_line: 'Activated Ability',
      oracle_text: activatedAbilityText || String(permanent?.card?.oracle_text || ''),
      image_uris: permanent?.card?.image_uris,
    },
    targets: [],
  };

  if (abilityType === 'fetch-land') {
    stackItem.abilityType = 'fetch-land';
    stackItem.searchParams = e?.searchParams ? { ...(e.searchParams as Record<string, unknown>) } : undefined;
  }

  stack.push(stackItem);
  ctx.bumpSeq();
}

function applyOpponentMayPayResolve(ctx: GameContext, e: any): void {
  const decidingPlayer = String(e?.decidingPlayer || e?.playerId || '').trim();
  const sourceName = String(e?.sourceName || '').trim();
  const manaCost = String(e?.manaCost || '').trim();
  const willPay = e?.willPay === true;
  const effectText = String(e?.declineEffect || e?.triggerText || '').trim();

  if (willPay) {
    if (decidingPlayer && manaCost) {
      const stateAny = ctx.state as any;
      stateAny.manaPool = stateAny.manaPool || {};
      stateAny.manaPool[decidingPlayer] = stateAny.manaPool[decidingPlayer] || {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      consumeRecordedManaCostFromPool(stateAny.manaPool[decidingPlayer], manaCost);
      ctx.bumpSeq();
    }
    return;
  }

  const sourceController = resolveOpponentMayPaySourceController(ctx, e);
  if (!sourceController) {
    debugWarn(2, `[applyEvent] opponentMayPayResolve: missing sourceController for ${sourceName || 'unknown source'}`);
    return;
  }

  const recordedDrawCount = Math.max(0, Number(e?.declineDrawCount ?? 0) || 0);
  const recordedTreasureCount = Math.max(0, Number(e?.declineTreasureCount ?? 0) || 0);
  const drawCount = recordedDrawCount > 0 ? recordedDrawCount : getOpponentMayPayDrawCount(sourceName, effectText);
  const treasureCount = recordedTreasureCount > 0
    ? recordedTreasureCount
    : getOpponentMayPayTreasureCount(sourceName, effectText);

  let appliedDeclineOutcome = false;
  if (drawCount > 0) {
    drawCards(ctx as any, sourceController as PlayerID, drawCount);
    appliedDeclineOutcome = true;
  }

  if (treasureCount > 0) {
    createToken(
      ctx as any,
      sourceController as PlayerID,
      'Treasure',
      treasureCount,
      undefined,
      undefined,
      {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
      }
    );
    appliedDeclineOutcome = true;
  }

  if (appliedDeclineOutcome) {
    return;
  }

  debugWarn(
    2,
    `[applyEvent] opponentMayPayResolve: unsupported decline effect for ${sourceName || 'unknown source'} (${effectText || 'no effect text'})`
  );
}

function extractReplayActivationCost(fullAbilityText: string): {
  requiresTap: boolean;
  manaCost: string;
  sacrificesSource: boolean;
} {
  const costMatch = String(fullAbilityText || '').match(/^([^:]+):/i);
  const costStr = String(costMatch?.[1] || '').trim().toLowerCase();
  const manaCostMatch = costStr.match(/\{[^}]+\}/g);
  const manaCost = manaCostMatch
    ? manaCostMatch.filter(symbol => !/^\{[tq]\}$/i.test(symbol)).join('')
    : '';

  return {
    requiresTap: costStr.includes('{t}') || costStr.includes('tap'),
    manaCost,
    sacrificesSource: /\bsacrifice\s+(?:this|~)\b/i.test(costStr),
  };
}

function snapshotLibraryForReplay(ctx: GameContext, playerId: string): any[] {
  const zoneLibrary = ((ctx.state as any)?.zones?.[playerId]?.library || []) as any[];
  const libraryCards = ctx.libraries.get(playerId as any) || zoneLibrary;
  return libraryCards.map((libraryCard: any) => ({
    id: libraryCard.id,
    name: libraryCard.name,
    type_line: libraryCard.type_line,
    oracle_text: libraryCard.oracle_text,
    image_uris: libraryCard.image_uris,
    card_faces: libraryCard.card_faces,
    layout: libraryCard.layout,
    mana_cost: libraryCard.mana_cost,
    cmc: libraryCard.cmc,
    colors: libraryCard.colors,
    power: libraryCard.power,
    toughness: libraryCard.toughness,
    loyalty: libraryCard.loyalty,
    color_identity: libraryCard.color_identity,
  }));
}

function cloneLibraryCards(cards: any[]): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => ({ ...card, zone: 'library' })) : [];
}

/**
 * reset(ctx, preservePlayers)
 * Conservative fallback reset used when no specialized engine reset is available.
 */
export function reset(ctx: any, preservePlayers = false): void {
  if (!ctx) throw new Error("reset: missing ctx");

  // Clear unified ResolutionQueue state for this game. This prevents stale
  // pending interactions from blocking subsequent replays/undo.
  try {
    const gameId = (ctx as any).gameId;
    if (typeof gameId === 'string' && gameId.trim()) {
      ResolutionQueueManager.clearAllSteps(gameId);
    }
  } catch {
    // best-effort only
  }

  // Prefer specialized reset if present on ctx or a global replayModule
  try {
    // @ts-ignore - global replayModule if present
    const globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    if (
      typeof (globalObj as any).replayModule !== "undefined" &&
      (globalObj as any).replayModule &&
      typeof (globalObj as any).replayModule.reset === "function"
    ) {
      (globalObj as any).replayModule.reset(ctx, preservePlayers);
      return;
    }
  } catch {
    // continue to fallback
  }

  if (typeof ctx.reset === "function") {
    try {
      ctx.reset(preservePlayers);
      return;
    } catch (err) {
      debugWarn(2, "reset: ctx.reset threw, falling back:", err);
    }
  }

  // Fallback conservative reset
  try {
    // preserve participants list if requested
    let participantsBackup: Array<any> = [];
    if (preservePlayers) {
      if (typeof ctx.participants === "function") {
        try {
          participantsBackup = ctx.participants().slice();
        } catch {
          participantsBackup = [];
        }
      } else if (Array.isArray((ctx as any).participantsList)) {
        participantsBackup = (ctx as any).participantsList.slice();
      }
    }

    // Reset primary runtime containers
    ctx.state = ctx.state || {};
    ctx.state.battlefield = [];
    ctx.state.stack = [];
    // Impulse-style exile permissions must never survive a reset/replay.
    // These will be rebuilt deterministically from replayed events when appropriate.
    (ctx.state as any).playableFromExile = {};
    // Clear commandZone in place to preserve reference identity
    if (ctx.state.commandZone && typeof ctx.state.commandZone === 'object') {
      for (const key of Object.keys(ctx.state.commandZone)) {
        delete ctx.state.commandZone[key];
      }
    } else {
      ctx.state.commandZone = {};
    }
    ctx.state.zones = ctx.state.zones || {};
    ctx.libraries = ctx.libraries || new Map<string, any[]>();
    ctx.life = ctx.life || {};
    ctx.poison = ctx.poison || {};
    ctx.experience = ctx.experience || {};

    // If preserving players, keep entries for those playerIds; otherwise clear players
    if (!preservePlayers) {
      ctx.state.players = [];
      ctx.life = {};
      ctx.poison = {};
      ctx.experience = {};
    } else {
      // ensure each known player has cleared zones & libraries
      const pids = participantsBackup.length
        ? participantsBackup.map((p) => p.playerId).filter(Boolean)
        : (Object.keys(ctx.state.zones || {}) as string[]);
      for (const pid of pids) {
        ctx.state.zones[pid] = ctx.state.zones[pid] || {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
        };
        // Clear hand
        ctx.state.zones[pid].hand = [];
        ctx.state.zones[pid].handCount = 0;
        // Clear library
        if (ctx.libraries && typeof ctx.libraries.set === "function")
          ctx.libraries.set(pid, []);
        else (ctx.libraries as any)[pid] = [];
        ctx.state.zones[pid].libraryCount = 0;
        // Clear graveyard (important for undo to properly restore previous state)
        ctx.state.zones[pid].graveyard = [];
        ctx.state.zones[pid].graveyardCount = 0;
        // Clear exile if it exists
        if (ctx.state.zones[pid].exile !== undefined) {
          ctx.state.zones[pid].exile = [];
          ctx.state.zones[pid].exileCount = 0;
        }
        // Reset life and counters
        ctx.life[pid] = ctx.state.startingLife ?? ctx.life[pid] ?? 40;
        if (ctx.poison) ctx.poison[pid] = 0;
        if (ctx.experience) ctx.experience[pid] = 0;
      }
    }

    // Clear pending initial draw flags to avoid double-draws
    if (
      (ctx as any).pendingInitialDraw &&
      typeof (ctx as any).pendingInitialDraw.clear === "function"
    ) {
      (ctx as any).pendingInitialDraw.clear();
    } else {
      (ctx as any).pendingInitialDraw = new Set<string>();
    }

    // Clear RNG state so it can be properly re-initialized from rngSeed event during replay
    // This is critical for undo to work correctly - the RNG must be reset to produce
    // the same shuffle/draw sequence when events are replayed
    try {
      ctx.rngSeed = null;
      // Create a fresh RNG function that will be replaced by rngSeed event
      // Using a new random seed as fallback in case no rngSeed event exists
      const fallbackSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      ctx.rng = mulberry32(fallbackSeed);
    } catch {
      // ignore RNG reset errors
    }

    // Reset bump/seq if present
    try {
      if (ctx.seq && typeof ctx.seq === "object" && "value" in ctx.seq)
        ctx.seq.value = 0;
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {
      // ignore
    }
  } catch (err) {
    debugWarn(1, "reset fallback failed:", err);
  }
}

/* Skip / unskip / remove fallbacks (prefer module implementations) */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (typeof (ctx as any).skip === "function") {
    (ctx as any).skip(playerId);
    return;
  }
  try {
    if (!((ctx as any).inactive instanceof Set))
      (ctx as any).inactive = new Set<PlayerID>();
    (ctx as any).inactive.add(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (typeof (ctx as any).unskip === "function") {
    (ctx as any).unskip(playerId);
    return;
  }
  try {
    if ((ctx as any).inactive instanceof Set)
      (ctx as any).inactive.delete(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (typeof (ctx as any).remove === "function") {
    (ctx as any).remove(playerId);
    return;
  }
  try {
    // Remove from participants list
    if (Array.isArray((ctx as any).participantsList)) {
      const idx = (ctx as any).participantsList.findIndex(
        (p: any) => p.playerId === playerId
      );
      if (idx !== -1) (ctx as any).participantsList.splice(idx, 1);
    }
    // Remove player data from state and maps
    if (Array.isArray(ctx.state?.players)) {
      const i = (ctx.state.players as any[]).findIndex(
        (p: any) => p.id === playerId
      );
      if (i >= 0) (ctx.state.players as any[]).splice(i, 1);
    }
    if (ctx.libraries && typeof ctx.libraries.delete === "function")
      ctx.libraries.delete(playerId);
    if (ctx.state.zones && ctx.state.zones[playerId])
      delete ctx.state.zones[playerId];
    if (ctx.life && ctx.life[playerId] !== undefined) delete ctx.life[playerId];
    if (ctx.poison && ctx.poison[playerId] !== undefined)
      delete ctx.poison[playerId];
    if (ctx.experience && ctx.experience[playerId] !== undefined)
      delete ctx.experience[playerId];
    if (ctx.grants instanceof Map) {
      for (const [owner, set] of ctx.grants.entries()) {
        if (set instanceof Set && set.has(playerId)) set.delete(playerId);
      }
    }
    try {
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {}
  } catch (err) {
    debugWarn(1, "remove fallback failed:", err);
  }
}

/* -------- Core applyEvent implementation ---------- */

/**
 * Apply a single persisted game event into the provided GameContext.
 * Tolerant: unknown event types are logged and ignored.
 */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  if (!e || typeof e.type !== "string") return;

  try {
    switch (e.type) {
      case "rngSeed": {
        ctx.rngSeed = (e as any).seed >>> 0;
        try {
          (ctx.state as any).rngSeed = ctx.rngSeed;
        } catch {}
        // mulberry32 inline
        ctx.rng = (function (seed: number) {
          let t = seed >>> 0;
          return function () {
            t = (t + 0x6d2b79f5) >>> 0;
            let r = t;
            r = Math.imul(r ^ (r >>> 15), r | 1);
            r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          };
        })(ctx.rngSeed);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "setTurnDirection": {
        (ctx.state as any).turnDirection = (e as any).direction;
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "join": {
        // Rebuild roster entries when replaying from persisted events.
        // Socket join flow handles live connections; this is strictly for replay-after-restart.
        const pid = (e as any).playerId as PlayerID | undefined;
        const name = (e as any).name as string | undefined;
        const seatToken = (e as any).seatToken as string | undefined;
        const spectator = Boolean((e as any).spectator);
        const isAI = Boolean((e as any).isAI);
        const strategy = typeof (e as any).strategy === 'string' ? String((e as any).strategy) : undefined;
        const difficulty = Number.isFinite(Number((e as any).difficulty)) ? Number((e as any).difficulty) : undefined;

        if (!pid || !name) {
          break;
        }

        try {
          (ctx.state as any).players = (ctx.state as any).players || [];
          const playersArr = (ctx.state as any).players as any[];
          let existing = playersArr.find((p: any) => p.id === pid);
          if (!existing) {
            existing = {
              id: pid,
              name,
              spectator,
              seatToken,
              isAI,
              strategy,
              difficulty,
              aiStrategy: strategy,
              aiDifficulty: difficulty,
            };
            playersArr.push(existing);
          } else {
            // Ensure basic fields are set
            if (!existing.name) existing.name = name;
            if (typeof existing.spectator === "undefined")
              existing.spectator = spectator;
            if (!existing.seatToken && seatToken)
              existing.seatToken = seatToken;
            if (typeof existing.isAI === "undefined")
              existing.isAI = isAI;
            if (!existing.strategy && strategy)
              existing.strategy = strategy;
            if (typeof existing.difficulty === 'undefined' && typeof difficulty === 'number')
              existing.difficulty = difficulty;
            if (!existing.aiStrategy && strategy)
              existing.aiStrategy = strategy;
            if (typeof existing.aiDifficulty === 'undefined' && typeof difficulty === 'number')
              existing.aiDifficulty = difficulty;
          }
          
          // Set turnPlayer and priority if not already set (non-spectators only)
          // This matches the behavior in join.ts addPlayerIfMissing()
          if (!spectator) {
            if (!(ctx.state as any).turnPlayer) {
              (ctx.state as any).turnPlayer = pid;
            }
            if (!(ctx.state as any).priority) {
              (ctx.state as any).priority = pid;
            }
            
            // Initialize life, poison, experience for non-spectator players
            const startingLife = ctx.state.startingLife ?? 40;
            if (ctx.life) {
              ctx.life[pid] = ctx.life[pid] ?? startingLife;
              // Keep state + player refs in sync for consumers/tests that read player.life.
              (ctx.state as any).life = (ctx.state as any).life || {};
              (ctx.state as any).life[pid] = (ctx.state as any).life[pid] ?? ctx.life[pid];
              if (existing && typeof (existing as any).life === 'undefined') {
                (existing as any).life = ctx.life[pid];
              }
            }
            if (ctx.poison) ctx.poison[pid] = ctx.poison[pid] ?? 0;
            if (ctx.experience) ctx.experience[pid] = ctx.experience[pid] ?? 0;
            
            // Initialize zones
            const zones = ctx.state.zones = ctx.state.zones || {};
            zones[pid] = zones[pid] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            
            // Initialize landsPlayedThisTurn
            if (ctx.state.landsPlayedThisTurn) {
              ctx.state.landsPlayedThisTurn[pid] = ctx.state.landsPlayedThisTurn[pid] ?? 0;
            }

            if (isAI) {
              const stateAny = ctx.state as any;
              if (!(stateAny.autoPassPlayers instanceof Set)) {
                stateAny.autoPassPlayers = new Set();
              }
              stateAny.autoPassPlayers.add(pid);
            }
          }
          
          // Zones will be normalized by reconcileZonesConsistency after replay.
        } catch (err) {
          debugWarn(1, "applyEvent(join): failed to rebuild player", err);
        }
        break;
      }

      case "leave": {
        try {
          leaveModule(ctx as any, (e as any).playerId);
        } catch (err) {
          debugWarn(1, 'applyEvent(leave): failed', err);
        }
        break;
      }

      case "restart": {
        reset(ctx as any, Boolean((e as any).preservePlayers));
        break;
      }

      case "resetGame": {
        // historical event alias - map to the restart/reset semantics
        const preserve =
          (e as any).preservePlayers ?? (e as any).preserve ?? false;
        reset(ctx as any, Boolean(preserve));
        break;
      }

      case "removePlayer": {
        remove(ctx as any, (e as any).playerId);
        break;
      }

      case "skipPlayer": {
        skip(ctx as any, (e as any).playerId);
        break;
      }

      case "unskipPlayer": {
        unskip(ctx as any, (e as any).playerId);
        break;
      }

      case "spectatorGrant": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.add(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "spectatorRevoke": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.delete(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "deckImportResolved": {
        importDeckResolved(
          ctx as any,
          (e as any).playerId,
          (e as any).cards || []
        );
        break;
      }

      case "shuffleLibrary": {
        shuffleLibrary(ctx as any, (e as any).playerId);
        break;
      }

      case "drawCards": {
        drawCards(
          ctx as any,
          (e as any).playerId,
          (e as any).count || 1
        );
        break;
      }

      case "selectFromLibrary": {
        selectFromLibrary(
          ctx as any,
          (e as any).playerId,
          (e as any).cardIds || [],
          (e as any).moveTo
        );
        break;
      }

      case "handIntoLibrary": {
        moveHandToLibrary(ctx as any, (e as any).playerId);
        break;
      }

      case "setCommander": {
        const pid = (e as any).playerId;
        // Check hand count BEFORE calling setCommander to know if we need opening draw
        const zones = ctx.state.zones || {};
        const zonesBefore = zones[pid];
        const handCountBefore = zonesBefore
          ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
          : 0;
        
        setCommander(
          ctx as any,
          pid,
          (e as any).commanderNames || [],
          (e as any).commanderIds || [],
          (e as any).colorIdentity || []
        );
        
        // For backward compatibility with old games that don't have separate shuffle/draw events:
        // If hand was empty before and is still empty after setCommander, we need to check if
        // the next events include shuffleLibrary/drawCards. If not, we'll do it here.
        // This flag can be checked by the replay function to decide.
        // For now, mark that setCommander was called with empty hand for potential follow-up.
        if (handCountBefore === 0) {
          (ctx as any)._setCommanderCalledWithEmptyHand = pid;
        }
        break;
      }

      case "castCommander": {
        const playerId = (e as any).playerId;
        const commanderId = resolveReplayCommanderId(ctx, e);
        const commanderCard = resolveReplayCommanderCard(ctx, e, commanderId);
        debug(1, `[applyEvent] Replaying castCommander event:`, { playerId, commanderId });

        if (!(e as any).commanderId && commanderId) {
          debugWarn(1, `[applyEvent] Recovered legacy castCommander replay event without commanderId`, {
            playerId,
            commanderId,
            cardId: (e as any).cardId,
            cardName: (e as any).cardName,
          });
        }
        
        if (!commanderId) {
          debugError(1, `[applyEvent] CRITICAL: castCommander event has undefined commanderId!`, {
            event: e,
            playerId
          });
          debugWarn(1, `[applyEvent] Skipping castCommander event with undefined commanderId to prevent infinite loop`);
          break;
        }
        
        if (playerId && commanderCard) {
          pushStack(ctx as any, {
            id: generateDeterministicId(ctx as any, 'stack', commanderId),
            controller: playerId,
            source: 'command',
            fromZone: 'command',
            castSourceZone: 'command',
            card: {
              ...commanderCard,
              zone: 'stack',
              isCommander: true,
              source: 'command',
              fromZone: 'command',
              castSourceZone: 'command',
            },
            targets: [],
          } as any);
        } else {
          debugWarn(1, `[applyEvent] Unable to rebuild commander stack item during castCommander replay`, {
            playerId,
            commanderId,
            hasCardSnapshot: !!(e as any).card,
          });
        }

        castCommander(
          ctx as any,
          playerId,
          commanderId
        );
        break;
      }

      case "moveCommanderToCZ": {
        moveCommanderToCZ(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderId
        );
        break;
      }

      case "commanderZoneChoice": {
        // Handle commander zone choice (e.g., command zone vs graveyard/exile after death)
        const pid = (e as any).playerId;
        const commanderId = (e as any).commanderId;
        const moveToCommandZone = (e as any).moveToCommandZone;
        
        try {
          if (moveToCommandZone) {
            // Move commander to command zone
            moveCommanderToCZ(ctx as any, pid, commanderId);
          }
          // If not moving to command zone, the commander stays where it was going
          // (graveyard, exile, etc.) - no additional action needed
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(commanderZoneChoice): failed", err);
        }
        break;
      }

      case "updateCounters": {
        updateCounters(
          ctx as any,
          (e as any).permanentId,
          (e as any).deltas || {}
        );
        break;
      }

      case "updateCountersBulk": {
        applyUpdateCountersBulk(ctx as any, (e as any).updates || []);
        break;
      }

      case "createToken": {
        createToken(
          ctx as any,
          (e as any).controller,
          (e as any).name,
          (e as any).count,
          (e as any).basePower,
          (e as any).baseToughness
        );
        break;
      }

      case "removePermanent": {
        removePermanent(ctx as any, (e as any).permanentId);
        break;
      }

      case "dealDamage": {
        // Handle both legacy effects format and new action format
        let effects: any[] = (e as any).effects || [];
        
        // If targetPermanentId is provided, evaluate using rules engine
        const targetPermanentId = (e as any).targetPermanentId;
        const amount = (e as any).amount;
        if (targetPermanentId && amount > 0) {
          // Turn-tracking for intervening-if: creature→creature damage relationships for engine-driven damage events.
          // Best-effort: only records when the event explicitly provides a source permanent id and both are creatures.
          try {
            const stateAny = ctx.state as any;
            const sourcePermanentId = String((e as any).sourcePermanentId || (e as any).sourceCreatureId || '');
            const targetId = String(targetPermanentId);
            const dmg = Math.max(0, Number(amount ?? 0));

            if (sourcePermanentId && targetId && dmg > 0) {
              const battlefield = (ctx.state as any).battlefield || [];
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
              const targetPerm = battlefield.find((p: any) => String(p?.id) === targetId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String(targetPerm?.card?.type_line || '').toLowerCase();
              if (sourcePerm && targetPerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] =
                  stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId][targetId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          const action = {
            type: 'DEAL_DAMAGE' as const,
            targetPermanentId,
            amount,
            wither: Boolean((e as any).wither),
            infect: Boolean((e as any).infect),
          };
          effects = [...evaluateAction(ctx.state, action)];
        }
        
        try {
          applyEngineEffects(ctx as any, effects);
        } catch {}
        try {
          runSBA(ctx as any);
        } catch {}
        break;
      }

      case "resolveSpell": {
        // Execute spell effects based on spec and chosen targets
        const spec = (e as any).spec;
        const chosen = (e as any).chosen || [];
        const caster = (e as any).caster as PlayerID;
        
        // Handle COUNTER_TARGET_SPELL specially since it's not in the targeting module
        if (spec?.op === 'COUNTER_TARGET_SPELL') {
          for (const target of chosen) {
            if (target.kind === 'stack') {
              const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === target.id);
              if (stackIdx >= 0) {
                const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                // Move the countered spell to its controller's graveyard
                const controller = (countered as any).controller as PlayerID;
                const zones = ctx.state.zones = ctx.state.zones || {};
                zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                if ((countered as any).card) {
                  gy.push((countered as any).card);
                  (zones[controller] as any).graveyardCount = gy.length;
                }
              }
            }
          }
          ctx.bumpSeq();
          break;
        }
        
        if (spec && typeof resolveSpell === 'function') {
          try {
            const effects = resolveSpell(spec, chosen, ctx.state, caster);
            // Apply each effect
            for (const eff of effects) {
              switch (eff.kind) {
                case 'DestroyPermanent':
                  removePermanent(ctx as any, eff.id);
                  break;
                case 'MoveToExile':
                  movePermanentToExile(ctx as any, eff.id);
                  break;
                case 'BouncePermanent':
                  movePermanentToHand(ctx as any, (eff as any).id);
                  break;
                case 'TapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = true;
                  break;
                }
                case 'UntapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = false;
                  break;
                }
                case 'AddCountersPermanent':
                  updateCounters(ctx as any, (eff as any).id, { [(eff as any).counterType]: (eff as any).amount });
                  // Turn-tracking for intervening-if: "if you put a counter on a creature this turn".
                  // Best-effort: only marks true when the spell's caster is known and the target is a creature.
                  try {
                    const targetPerm = ctx.state.battlefield.find((p: any) => p?.id === (eff as any).id);
                    const tl = String(targetPerm?.card?.type_line || '').toLowerCase();
                    if (caster && tl.includes('creature')) {
                      const stateAny = ctx.state as any;
                      stateAny.putCounterOnCreatureThisTurn = stateAny.putCounterOnCreatureThisTurn || {};
                      stateAny.putCounterOnCreatureThisTurn[String(caster)] = true;
                    }
                  } catch {
                    // best-effort only
                  }
                  break;
                case 'DamagePermanent': {
                  // Apply damage to permanent (may kill it via SBA)
                  const perm = ctx.state.battlefield.find((p: any) => p.id === eff.id);
                  if (perm) {
                    (perm as any).damage = ((perm as any).damage || 0) + eff.amount;
                  }
                  break;
                }
                case 'DamagePlayer': {
                  const playerId = String((eff as any).playerId || '');
                  const dmg = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || dmg <= 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  (ctx as any).life = (ctx as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => String(p?.id) === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current - dmg;
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track per-turn damage/life loss for intervening-if templates.
                  try {
                    (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
                    (ctx.state as any).damageTakenThisTurnByPlayer[playerId] =
                      ((ctx.state as any).damageTakenThisTurnByPlayer[playerId] || 0) + dmg;
                  } catch {}
                  try {
                    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                    (ctx.state as any).lifeLostThisTurn[playerId] = ((ctx.state as any).lifeLostThisTurn[playerId] || 0) + dmg;
                  } catch {}

                  // Best-effort attribution: if the effect includes a source battlefield creature.
                  try {
                    const sourcePermanentId = String((eff as any).sourcePermanentId || (eff as any).sourceId || '');
                    if (sourcePermanentId) {
                      const battlefield = (ctx.state as any).battlefield || [];
                      const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
                      const tl = String(sourcePerm?.card?.type_line || '').toLowerCase();
                      if (sourcePerm && tl.includes('creature')) {
                        (ctx.state as any).creaturesThatDealtDamageToPlayer = (ctx.state as any).creaturesThatDealtDamageToPlayer || {};
                        const perPlayer = (((ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] =
                          (ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] || {}) as any);
                        perPlayer[sourcePermanentId] = {
                          creatureName: String(sourcePerm?.card?.name || sourcePermanentId),
                          totalDamage: (perPlayer[sourcePermanentId]?.totalDamage || 0) + dmg,
                          lastDamageTime: Date.now(),
                        };
                      }
                    }
                  } catch {}
                  break;
                }
                case 'GainLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, true);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current + finalAmount;
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life gained this turn.
                  try {
                    (ctx.state as any).lifeGainedThisTurn = (ctx.state as any).lifeGainedThisTurn || {};
                    (ctx.state as any).lifeGainedThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeGainedThisTurn[String(playerId)] || 0) + finalAmount;
                  } catch {}
                  break;
                }
                case 'LoseLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, false);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current - Math.abs(finalAmount);
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life lost this turn.
                  try {
                    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + Math.abs(finalAmount);
                  } catch {}
                  break;
                }
                case 'DrawCards':
                  if ((eff as any).playerId && (eff as any).count) {
                    try {
                      drawCards(ctx as any, (eff as any).playerId, Number((eff as any).count));
                    } catch {}
                  }
                  break;
                case 'RequestDiscard':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingDiscard = (ctx.state as any).pendingDiscard || {};
                    (ctx.state as any).pendingDiscard[(eff as any).playerId] = {
                      count: Number((eff as any).count),
                      source: (e as any)?.cardId || 'spell',
                      reason: 'spell_effect',
                    };
                  }
                  break;
                case 'CreateToken':
                  try {
                    createToken(
                      ctx as any,
                      (eff as any).controller,
                      (eff as any).name,
                      (eff as any).count,
                      (eff as any).basePower,
                      (eff as any).baseToughness,
                      (eff as any).options
                    );
                  } catch {}
                  break;
                case 'QueueScry':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingScry = (ctx.state as any).pendingScry || {};
                    (ctx.state as any).pendingScry[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'QueueSurveil':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingSurveil = (ctx.state as any).pendingSurveil || {};
                    (ctx.state as any).pendingSurveil[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'MillCards': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const count = Math.max(0, Number((eff as any).count ?? 0));
                  if (!playerId || count <= 0) break;

                  const lib = (ctx as any).libraries?.get?.(playerId);
                  const zones = (ctx.state as any).zones || ((ctx.state as any).zones = {});
                  const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  if (lib && Array.isArray(lib)) {
                    for (let i = 0; i < count && lib.length > 0; i++) {
                      const milled = lib.shift();
                      if (milled) {
                        z.graveyard.push({ ...milled, zone: 'graveyard' });
                        recordCardPutIntoGraveyardThisTurn(ctx as any, String(playerId), milled, { fromBattlefield: false });
                      }
                    }
                    (ctx as any).libraries?.set?.(playerId, lib);
                    z.libraryCount = lib.length;
                    z.graveyardCount = z.graveyard.length;
                  }
                  break;
                }
                case 'GoadPermanent': {
                  const id = String((eff as any).id || '');
                  const goaderId = (eff as any).goaderId as PlayerID;
                  if (!id || !goaderId) break;
                  const idx = ctx.state.battlefield.findIndex((p: any) => p.id === id);
                  if (idx < 0) break;

                  const perm = ctx.state.battlefield[idx] as any;
                  const existing = perm.goadedBy || [];
                  if (!existing.includes(goaderId)) {
                    perm.goadedBy = [...existing, goaderId];
                  }
                  const currentTurn = Number((ctx.state as any).turnNumber ?? 0) || 0;
                  const expiryTurn = currentTurn + 1;
                  perm.goadedUntil = { ...(perm.goadedUntil || {}), [goaderId]: expiryTurn };
                  break;
                }
                case 'CounterSpell': {
                  // Counter a spell on the stack
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                    // Move the countered spell to its controller's graveyard
                    const controller = (countered as any).controller as PlayerID;
                    const zones = ctx.state.zones = ctx.state.zones || {};
                    zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                    const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                    if ((countered as any).card) {
                      gy.push({ ...(countered as any).card, zone: 'graveyard' });
                      recordCardPutIntoGraveyardThisTurn(ctx as any, String(controller), (countered as any).card, { fromBattlefield: false });
                      (zones[controller] as any).graveyardCount = gy.length;
                    }
                  }
                  break;
                }
                case 'CounterAbility': {
                  // Counter an ability on the stack (just remove it)
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    ctx.state.stack.splice(stackIdx, 1);
                  }
                  break;
                }
              }
            }
            // Run state-based actions after applying effects
            runSBA(ctx as any);
            ctx.bumpSeq();
          } catch (err) {
            debugWarn(1, '[applyEvent] resolveSpell failed:', err);
          }
        }
        break;
      }

      case "pushStack": {
        pushStack(ctx as any, (e as any).item);
        break;
      }

      case "resolveTopOfStack": {
        resolveTopOfStack(ctx as any);
        break;
      }

      case "playLand": {
        // Turn-tracking: persisted events include fromZone (hand/graveyard). Use this as
        // authoritative positive evidence for intervening-if templates.
        try {
          const playerId = String((e as any).playerId);
          const fromZone = String((e as any).fromZone || '').toLowerCase();
          const stateAny = (ctx.state as any) as any;
          if (fromZone === 'graveyard') {
            stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
            stateAny.playedLandFromGraveyardThisTurn[playerId] = true;
          }
        } catch {
          // best-effort only
        }

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const cardData = (e as any).card || (e as any).cardId;

        // Defensive replay hardening: if the persisted event indicates the land
        // was played from true exile, ensure any impulse-style tags/permissions
        // are cleaned up even if playLand can't infer the source from current zones.
        try {
          const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
          if (fromZone === 'exile') {
            const cardObj = typeof cardData === 'string' ? { id: cardData } : cardData;
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        playLand(ctx as any, (e as any).playerId, cardData);
        applyRecordedPlayLandReplayState(ctx, e);
        break;
      }

      case "castSpell": {
        // Turn-tracking: "a spell was warped this turn" (702.185c) means it was cast for its warp cost.
        // Persisted events may include alternateCostId; older streams may only have it on the card object.
        try {
          const pid = String((e as any).playerId || '');
          const alt =
            (e as any).alternateCostId ??
            (e as any).alternate_cost_id ??
            (e as any).card?.alternateCostId ??
            (e as any).card?.card?.alternateCostId;
          const altLower = String(alt || '').toLowerCase().trim();
          if (pid && altLower === 'warp') {
            const stateAny = (ctx.state as any) as any;
            stateAny.spellWasWarpedThisTurn = stateAny.spellWasWarpedThisTurn || {};
            stateAny.spellWasWarpedThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        // Turn-tracking: persisted castSpell events can carry `fromZone`.
        // Use this as authoritative positive evidence during replay.
        try {
          const pid = String((e as any).playerId || '').trim();
          const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
          if (pid && fromZone === 'graveyard') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
            stateAny.castFromGraveyardThisTurn[pid] = true;
          }
          if (pid && fromZone === 'exile') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
            stateAny.castFromExileThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        const stackLengthBefore = ctx.state.stack?.length || 0;

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const spellCardData = (e as any).card || (e as any).cardId;

        // Defensive replay hardening: if the persisted event indicates the spell
        // was cast from true exile, ensure any impulse-style tags/permissions are
        // cleaned up even if castSpell can't infer the source from current zones.
        try {
          const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
          if (fromZone === 'exile') {
            const cardObj = typeof spellCardData === 'string' ? { id: spellCardData } : spellCardData;
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        castSpell(
          ctx as any,
          (e as any).playerId,
          spellCardData,
          (e as any).targets,
          (e as any).xValue
        );

        // Intervening-if support: persist replay-stable cast/payment metadata onto the new stack item.
        try {
          const stackArr = (ctx.state.stack || []) as any[];
          if (stackArr.length > stackLengthBefore && stackArr.length > 0) {
            const topStackItem = stackArr[stackArr.length - 1];

            const applyToStackItem = (key: string, value: any) => {
              (topStackItem as any)[key] = value;
              if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                (topStackItem as any).card[key] = value;
              }
            };

            // Provenance
            if (typeof (e as any).fromZone === 'string' && (e as any).fromZone) {
              const fromZone = String((e as any).fromZone);
              const fromZoneLower = fromZone.toLowerCase().trim();
              applyToStackItem('fromZone', fromZone);
              applyToStackItem('castSourceZone', fromZone);
              applyToStackItem('source', fromZone);

              if (fromZoneLower === 'hand') {
                applyToStackItem('castFromHand', true);
              }
              if (fromZoneLower === 'exile') {
                applyToStackItem('castFromExile', true);
              }
              if (fromZoneLower === 'graveyard') {
                applyToStackItem('castFromGraveyard', true);
              }
            }
            if ((e as any).castFromHand === true) {
              applyToStackItem('castFromHand', true);
              applyToStackItem('source', 'hand');
              applyToStackItem('castSourceZone', 'hand');
            }
            if ((e as any).castWithoutPayingManaCost === true) {
              applyToStackItem('castWithoutPayingManaCost', true);
            }

            // Alternate-cost identifier
            const alt =
              (e as any).alternateCostId ??
              (e as any).alternate_cost_id ??
              (e as any).card?.alternateCostId ??
              (e as any).card?.card?.alternateCostId;
            if (alt) {
              applyToStackItem('alternateCostId', alt);
              const altLower = String(alt || '').toLowerCase().trim();
              // Best-effort boolean flags for common alternate cost templates.
              applyToStackItem('prowlCostWasPaid', altLower === 'prowl');
              applyToStackItem('surgeCostWasPaid', altLower === 'surge');
              applyToStackItem('madnessCostWasPaid', altLower === 'madness');
              applyToStackItem('spectacleCostWasPaid', altLower === 'spectacle');
            }

            // Mana/payment metadata
            if (typeof (e as any).manaSpentTotal === 'number') {
              applyToStackItem('manaSpentTotal', (e as any).manaSpentTotal);
            }
            if ((e as any).manaSpentBreakdown && typeof (e as any).manaSpentBreakdown === 'object') {
              applyToStackItem('manaSpentBreakdown', { ...(e as any).manaSpentBreakdown });
            }
            if ((e as any).snowManaSpentByColor && typeof (e as any).snowManaSpentByColor === 'object') {
              applyToStackItem('snowManaSpentByColor', { ...(e as any).snowManaSpentByColor });
            }
            if (Array.isArray((e as any).snowManaColorsSpent)) {
              applyToStackItem('snowManaColorsSpent', (e as any).snowManaColorsSpent.slice());
            }
            if ((e as any).snowManaSpentKnown === true && typeof (e as any).snowManaSpent === 'boolean') {
              applyToStackItem('snowManaSpentKnown', true);
              applyToStackItem('snowManaSpent', (e as any).snowManaSpent);
            }
            if ((e as any).snowManaOfSpellColorsSpentKnown === true && typeof (e as any).snowManaOfSpellColorsSpent === 'boolean') {
              applyToStackItem('snowManaOfSpellColorsSpentKnown', true);
              applyToStackItem('snowManaOfSpellColorsSpent', (e as any).snowManaOfSpellColorsSpent);
            }
            if (typeof (e as any).convergeValue === 'number') {
              applyToStackItem('convergeValue', (e as any).convergeValue);
            }
            if (Array.isArray((e as any).manaColorsSpent)) {
              applyToStackItem('manaColorsSpent', (e as any).manaColorsSpent.slice());
            }
            if (Array.isArray((e as any).convokeTappedCreatures)) {
              applyToStackItem('convokeTappedCreatures', (e as any).convokeTappedCreatures.slice());
            }
            if (typeof (e as any).manaFromCreaturesSpent === 'number') {
              applyToStackItem('manaFromCreaturesSpent', (e as any).manaFromCreaturesSpent);
            }

            // Positive-only evidence flags
            if ((e as any).manaFromTreasureSpent === true) {
              applyToStackItem('manaFromTreasureSpent', true);
            }
            if ((e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean') {
              applyToStackItem('manaFromTreasureSpentKnown', true);
              applyToStackItem('manaFromTreasureSpent', (e as any).manaFromTreasureSpent);
            }
            // Additional cost payment metadata (deterministic when explicitly known).
            if ((e as any).additionalCostPaidKnown === true && typeof (e as any).additionalCostPaid === 'boolean') {
              const v = (e as any).additionalCostPaid;
              applyToStackItem('additionalCostPaidKnown', true);
              applyToStackItem('additionalCostPaid', v);
              // Keep legacy aliases in sync.
              applyToStackItem('additionalCostWasPaid', v);
              applyToStackItem('paidAdditionalCost', v);
            } else if ((e as any).additionalCostWasPaid === true || (e as any).paidAdditionalCost === true || (e as any).additionalCostPaid === true) {
              // Positive-only evidence.
              applyToStackItem('additionalCostWasPaid', true);
              applyToStackItem('paidAdditionalCost', true);
              applyToStackItem('additionalCostPaid', true);
            }
            if ((e as any).evidenceCollected === true || (e as any).evidenceWasCollected === true || (e as any).collectedEvidence === true) {
              applyToStackItem('evidenceCollected', true);
              applyToStackItem('evidenceWasCollected', true);
              applyToStackItem('collectedEvidence', true);
            }

            // Bargain (explicit, replay-stable boolean if present)
            const rawWasBargained =
              (e as any).wasBargained ??
              (e as any).bargained ??
              (e as any).card?.wasBargained ??
              (e as any).card?.card?.wasBargained;
            if (typeof rawWasBargained === 'boolean') {
              applyToStackItem('wasBargained', rawWasBargained);
              if ((e as any).bargainResolved === true) {
                applyToStackItem('bargainResolved', true);
              }
            }
          }
        } catch {
          // best-effort only
        }
        break;
      }

      case "crewVehicle": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const vehicleId = String((e as any).vehicleId || (e as any).sourceId || '').trim();
          const crewerIdsRaw = (e as any).crewerIds;
          const crewerIds = Array.isArray(crewerIdsRaw)
            ? crewerIdsRaw.map((id: any) => String(id ?? '')).filter((x: string) => x.length > 0)
            : [];

          const battlefield = (ctx.state.battlefield || []) as any[];
          const vehicle = battlefield.find((p: any) => p && String(p.id) === vehicleId);
          if (!vehicle) break;

          // Mark vehicle as crewed until end of turn.
          (vehicle as any).crewed = true;
          (vehicle as any).grantedTypes = Array.isArray((vehicle as any).grantedTypes) ? (vehicle as any).grantedTypes : [];
          if (!(vehicle as any).grantedTypes.includes('Creature')) {
            (vehicle as any).grantedTypes.push('Creature');
          }

          // Tap the chosen crewers and record which creature subtypes crewed it.
          const crewedTypesLower: string[] = [];
          for (const crewerId of crewerIds) {
            const crewer = battlefield.find((p: any) => p && String(p.id) === String(crewerId));
            if (!crewer) continue;
            (crewer as any).tapped = true;

            const typeLine = String((crewer as any)?.card?.type_line || '');
            const dashIndex = typeLine.indexOf('—');
            if (dashIndex >= 0) {
              const subtypes = typeLine.substring(dashIndex + 1).trim();
              for (const t of subtypes.split(/\s+/)) {
                const lower = String(t || '').toLowerCase().trim();
                if (lower) crewedTypesLower.push(lower);
              }
            }
          }

          // Intervening-if support fields (best-effort today, but now deterministic when this event exists).
          (vehicle as any).crewedByCreatureCountThisTurn = crewerIds.length;
          if (crewedTypesLower.length > 0) {
            (vehicle as any).crewedByCreatureTypesThisTurn = Array.from(new Set(crewedTypesLower));
            (vehicle as any).crewedBySubtypesThisTurn = (vehicle as any).crewedByCreatureTypesThisTurn;
          }

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(crewVehicle): failed', err);
        }
        break;
      }

      case "enlist": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const attackerId = String((e as any).attackerId || (e as any).sourceId || '').trim();
          const enlistedCreatureId = String((e as any).enlistedCreatureId || '').trim();
          if (!attackerId || !enlistedCreatureId) break;

          const battlefield = (ctx.state.battlefield || []) as any[];
          const attacker = battlefield.find((p: any) => p && String(p.id) === attackerId);
          const enlisted = battlefield.find((p: any) => p && String(p.id) === enlistedCreatureId);
          if (!attacker || !enlisted) break;

          // Tap the enlisted creature and record that enlist was used.
          (enlisted as any).tapped = true;
          (attacker as any).enlistedThisCombat = true;
          (attacker as any).enlistedCreatureThisCombat = true;
          (attacker as any).enlistedCreatureIdThisCombat = enlistedCreatureId;

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(enlist): failed', err);
        }
        break;
      }

      case "nextTurn": {
        nextTurn(ctx as any);
        break;
      }

      case "nextStep": {
        nextStep(ctx as any);
        break;
      }

      case "skipToPhase": {
        // Skip to a specific phase/step - used when player clicks on phase buttons
        // Note: This is a simplified replay that just sets the phase/step directly
        // The full skipToPhase handler in socket/game-actions.ts handles triggers, draws, etc.
        // But those effects are persisted as separate events (drawCards, etc.)
        const targetStep = String((e as any).targetStep || (e as any).to || '').trim();
        const pendingPhaseSkip = ((e as any).pendingPhaseSkip && typeof (e as any).pendingPhaseSkip === 'object')
          ? { ...((e as any).pendingPhaseSkip as any) }
          : undefined;
        const triggerOrderRequests = Array.isArray((e as any).triggerOrderRequests)
          ? ((e as any).triggerOrderRequests as any[])
          : [];
        const untappedPermanentIds = Array.isArray((e as any).untappedPermanentIds)
          ? ((e as any).untappedPermanentIds as any[])
              .map((value: any) => String(value || '').trim())
              .filter((value: string) => value.length > 0)
          : [];
        const inferPhaseFromStep = (step: string): string | undefined => {
          switch (String(step || '').trim().toUpperCase()) {
            case 'UNTAP':
            case 'UPKEEP':
            case 'DRAW':
              return 'beginning';
            case 'MAIN1':
              return 'precombatMain';
            case 'BEGIN_COMBAT':
            case 'DECLARE_ATTACKERS':
            case 'DECLARE_BLOCKERS':
            case 'COMBAT_DAMAGE':
            case 'END_COMBAT':
              return 'combat';
            case 'MAIN2':
              return 'postcombatMain';
            case 'END_STEP':
            case 'CLEANUP':
              return 'ending';
            default:
              return undefined;
          }
        };
        const targetPhase = String(
          (e as any).targetPhase ||
          pendingPhaseSkip?.targetPhase ||
          inferPhaseFromStep(targetStep) ||
          ''
        ).trim();
        try {
          if (targetPhase) {
            (ctx.state as any).phase = targetPhase;
          }
          if (targetStep) {
            (ctx.state as any).step = targetStep;
          }
          if (pendingPhaseSkip) {
            (ctx.state as any).pendingPhaseSkip = pendingPhaseSkip;
          } else {
            delete (ctx.state as any).pendingPhaseSkip;
          }
          if ((e as any).priority) {
            (ctx.state as any).priority = (e as any).priority;
          }
          if (untappedPermanentIds.length > 0) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const untappedIdSet = new Set(untappedPermanentIds);
            for (const permanent of battlefield as any[]) {
              if (!permanent) continue;
              if (!untappedIdSet.has(String(permanent.id || ''))) continue;
              (permanent as any).tapped = false;
            }
          }
          if (!pendingPhaseSkip) {
            try {
              (ctx.state as any).combat = undefined;
              const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
              for (const permanent of battlefield as any[]) {
                if (!permanent) continue;
                if ((permanent as any).attacking !== undefined) (permanent as any).attacking = undefined;
                if ((permanent as any).blocking !== undefined) (permanent as any).blocking = undefined;
                if ((permanent as any).blockedBy !== undefined) (permanent as any).blockedBy = undefined;
              }
            } catch {
              // best-effort only
            }

            if (!(e as any).priority && (ctx.state as any).turnPlayer) {
              (ctx.state as any).priority = (ctx.state as any).turnPlayer;
            }
          }
          for (const request of triggerOrderRequests) {
            if (!request || typeof request !== 'object') continue;
            const requestPlayerId = String((request as any).playerId || '').trim();
            const requestTriggers = Array.isArray((request as any).triggers)
              ? ((request as any).triggers as any[]).filter((trigger: any) => trigger && String(trigger.id || '').trim())
              : [];
            if (!requestPlayerId || requestTriggers.length === 0) continue;

            const queue = ResolutionQueueManager.getQueue(ctx.gameId);
            const requestIds = requestTriggers.map((trigger: any) => String(trigger.id || '')).filter(Boolean);
            const alreadyPresent = queue.steps.some((step: any) => {
              if (!step || String((step as any).type || '') !== String(ResolutionStepType.TRIGGER_ORDER)) {
                return false;
              }
              if (String((step as any).playerId || '') !== requestPlayerId) {
                return false;
              }
              const existingIds = Array.isArray((step as any).triggers)
                ? ((step as any).triggers as any[]).map((trigger: any) => String(trigger?.id || '')).filter(Boolean)
                : [];
              return existingIds.length === requestIds.length && existingIds.every((id: string, index: number) => id === requestIds[index]);
            });

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(ctx.gameId, {
                type: ResolutionStepType.TRIGGER_ORDER,
                playerId: requestPlayerId as any,
                description: String((request as any).description || `Choose the order to put ${requestTriggers.length} triggered abilities on the stack`),
                mandatory: true,
                triggers: requestTriggers.map((trigger: any) => ({
                  id: String(trigger.id),
                  sourceName: String(trigger.sourceName || ''),
                  effect: String(trigger.effect || ''),
                  imageUrl: trigger.imageUrl,
                })),
                requireAll: (request as any).requireAll !== false,
              } as any);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(skipToPhase): failed", err);
        }
        break;
      }

      case "reorderHand": {
        zonesReorderHand(
          ctx as any,
          (e as any).playerId,
          (e as any).order || []
        );
        break;
      }

      case "shuffleHand": {
        zonesShuffleHand(ctx as any, (e as any).playerId);
        break;
      }

      case "scryResolve": {
        applyScry(
          ctx as any,
          (e as any).playerId,
          (e as any).keepTopOrder || [],
          (e as any).bottomOrder || []
        );
        break;
      }

      case "surveilResolve": {
        applySurveil(
          ctx as any,
          (e as any).playerId,
          (e as any).toGraveyard || [],
          (e as any).keepTopOrder || []
        );
        break;
      }

      case "proliferateResolve": {
        try {
          const targetIds = Array.isArray((e as any).targetIds)
            ? ((e as any).targetIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (targetIds.length === 0) break;

          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];

          for (const targetId of targetIds) {
            const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
            if (permanent && permanent.counters && typeof permanent.counters === 'object') {
              const deltas: Record<string, number> = {};
              for (const [counterType, count] of Object.entries(permanent.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  deltas[counterType] = 1;
                  (permanent.counters as any)[counterType] = Number(count || 0) + 1;
                }
              }
              if (Object.keys(deltas).length > 0) {
                trackCountersPlacedThisTurn(ctx.state, permanent, String(targetId), deltas);
              }
              continue;
            }

            const player = players.find((entry: any) => entry && String(entry.id || '') === targetId);
            if (player && player.counters && typeof player.counters === 'object') {
              for (const [counterType, count] of Object.entries(player.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  (player.counters as any)[counterType] = Number(count || 0) + 1;
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(proliferateResolve): failed', err);
        }
        break;
      }

      case "fatesealResolve": {
        try {
          const opponentId = String((e as any).opponentId || '').trim();
          if (!opponentId) break;

          const keepTopOrder = Array.isArray((e as any).keepTopOrder) ? (e as any).keepTopOrder : [];
          const bottomOrder = Array.isArray((e as any).bottomOrder) ? (e as any).bottomOrder : [];
          const totalCards = keepTopOrder.length + bottomOrder.length;
          if (totalCards <= 0) break;

          const lib = (ctx as any).libraries?.get?.(opponentId);
          if (!Array.isArray(lib)) break;

          lib.splice(0, totalCards);
          for (let index = keepTopOrder.length - 1; index >= 0; index--) {
            lib.unshift({ ...keepTopOrder[index], zone: 'library' });
          }
          for (const card of bottomOrder) {
            lib.push({ ...card, zone: 'library' });
          }

          (ctx as any).libraries?.set?.(opponentId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[opponentId] = zones[opponentId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(fatesealResolve): failed', err);
        }
        break;
      }

      case "clashResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const revealedCard = (e as any).revealedCard;
          const putOnBottom = Boolean((e as any).putOnBottom);
          if (!playerId || !revealedCard) break;

          const lib = (ctx as any).libraries?.get?.(playerId);
          if (!Array.isArray(lib)) break;

          if (putOnBottom) {
            const revealedId = String((revealedCard as any).id || '').trim();
            const revealedIndex = lib.findIndex((card: any) => card && String(card.id || '') === revealedId);
            if (revealedIndex >= 0) {
              const [card] = lib.splice(revealedIndex, 1);
              if (card) {
                lib.push({ ...card, zone: 'library' });
              }
            }
          }

          (ctx as any).libraries?.set?.(playerId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[playerId] = zones[playerId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(clashResolve): failed', err);
        }
        break;
      }

      case "exploreResolve": {
        applyExplore(
          ctx as any,
          (e as any).playerId,
          (e as any).permanentId,
          (e as any).revealedCardId,
          (e as any).isLand || false,
          (e as any).toGraveyard || false
        );
        break;
      }

      case "passPriority": {
        const by = (e as any).by;
        try {
          if (typeof passPriority === "function")
            passPriority(ctx as any, by);
        } catch {}
        break;
      }

      case "mulligan": {
        // Mulligan: move hand to library, shuffle, draw 7
        const pid = (e as any).playerId;
        if (!pid) break;
        try {
          moveHandToLibrary(ctx as any, pid);
          shuffleLibrary(ctx as any, pid);
          drawCards(ctx as any, pid, 7);
        } catch (err) {
          debugWarn(1, "applyEvent(mulligan): failed", err);
        }
        break;
      }

      case "keepHand": {
        // Mark player as having kept their hand
        // This is important for tracking mulligan state during replay
        const pid = (e as any).playerId;
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(keepHand): failed", err);
        }
        break;
      }

      case "mulliganPutToBottom": {
        // London mulligan: move selected cards from hand to bottom of library
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid || cardIds.length === 0) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          const lib = ctx.libraries.get(pid) || [];
          
          // Move each selected card from hand to bottom of library
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              lib.push({ ...card, zone: "library" });
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.libraryCount = lib.length;
          ctx.libraries.set(pid, lib);
          
          // Mark hand as kept after putting cards on bottom
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mulliganPutToBottom): failed", err);
        }
        break;
      }

      case "setLife":
      case "adjustLife": {
        // Set or adjust a player's life total
        const pid = (e as any).playerId;
        const life = (e as any).life ?? (e as any).newLife;
        const delta = (e as any).delta;
        if (!pid) break;
        try {
          const startingLife = (ctx.state as any)?.startingLife ?? 40;
          const current = ctx.life ? (ctx.life[pid] ?? startingLife) : startingLife;

          let next: number | null = null;
          if (typeof life === 'number') {
            // Absolute set
            next = life;
          } else if (typeof delta === 'number') {
            // Relative adjustment
            next = current + delta;
          }

          if (next !== null) {
            // Apply
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx.state as any).life[pid] = next;
            if (ctx.life) ctx.life[pid] = next;

            // Track gained/lost for this turn.
            const diff = next - current;
            const stateAny = ctx.state as any;
            if (diff > 0) {
              stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
              stateAny.lifeGainedThisTurn[pid] = (stateAny.lifeGainedThisTurn[pid] || 0) + diff;
            } else if (diff < 0) {
              stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
              stateAny.lifeLostThisTurn[pid] = (stateAny.lifeLostThisTurn[pid] || 0) + Math.abs(diff);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "cleanupDiscard": {
        // Discard cards during cleanup step
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        if (!pid || cardIds.length === 0) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          
          // Move each selected card from hand to graveyard
          let discardedCount = 0;
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              graveyard.push({ ...card, zone: "graveyard" });
              recordCardPutIntoGraveyardThisTurn(ctx as any, String(pid), card, { fromBattlefield: false });
              discardedCount++;
              
              // Check for graveyard triggers (Eldrazi shuffle)
              if (checkGraveyardTrigger(ctx, card, pid)) {
                debug(2, `[applyEvent:cleanupDiscard] ${card.name} triggered graveyard shuffle for ${pid}`);
              }
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;

          // Turn-tracking for intervening-if: "if a player discarded a card this turn" / "if an opponent discarded a card this turn".
          if (discardedCount > 0) {
            const stateAny = ctx.state as any;
            stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
            stateAny.discardedCardThisTurn[String(pid)] = true;
            stateAny.anyPlayerDiscardedCardThisTurn = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cleanupDiscard): failed", err);
        }
        break;
      }

      case "mill": {
        // Mill cards from library to graveyard
        const pid = (e as any).playerId;
        const count = (e as any).count || 1;
        if (!pid) break;
        try {
          const lib = ctx.libraries.get(pid) || [];
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          
          // Mill top N cards
          const milled = lib.splice(0, Math.min(count, lib.length));
          for (const card of milled) {
            graveyard.push({ ...card, zone: "graveyard" });
            recordCardPutIntoGraveyardThisTurn(ctx as any, String(pid), card, { fromBattlefield: false });
            
            // Check for graveyard triggers (Eldrazi shuffle)
            if (checkGraveyardTrigger(ctx, card, pid)) {
              debug(2, `[applyEvent:mill] ${card.name} triggered graveyard shuffle for ${pid}`);
            }
          }
          
          // Update counts
          z.libraryCount = lib.length;
          z.graveyardCount = graveyard.length;
          ctx.libraries.set(pid, lib);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mill): failed", err);
        }
        break;
      }

      case "tapPermanent":
      case "untapPermanent": {
        // Tap or untap a permanent
        const permId = (e as any).permanentId;
        const tapped = e.type === "tapPermanent";
        const playerId = String((e as any).playerId || '').trim();
        if (!permId) break;
        try {
          const battlefield = ctx.state.battlefield || [];
          const perm = battlefield.find((p: any) => p.id === permId);
          if (tapped && playerId) {
            const stateAny = ctx.state as any;
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };

            const manaCost = String((e as any).manaCost || '').trim();
            if (manaCost) {
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
            }

            const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
            applyRecordedManaToPool(ctx, playerId, recordedMana);

            const explicitLifeLost = Number((e as any).lifeLost || 0);
            if (Number.isFinite(explicitLifeLost) && explicitLifeLost > 0) {
              applyManaAbilityLifeLoss(ctx, playerId, explicitLifeLost);
            }
          }
          if (perm) {
            (perm as any).tapped = tapped;

            // Intervening-if support: record that a player tapped a nonland permanent this turn.
            // Conservative: only set true on positive evidence when the event includes playerId.
            if (tapped) {
              try {
                const pid = playerId;
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                const isLand = tl.includes('land');
                if (pid && !isLand) {
                  const stateAny = ctx.state as any;
                  stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                  stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
                }
              } catch {
                /* ignore */
              }
            }
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "permanent_tapped":
      case "permanent_untapped": {
        // Legacy/compat: bulk tap/untap emitted by some Resolution Queue steps.
        const tapped = e.type === 'permanent_tapped';
        const idsRaw = (e as any).permanentIds;
        const ids = Array.isArray(idsRaw) ? idsRaw.map((x: any) => String(x)) : [];
        if (ids.length === 0) break;
        try {
          const battlefield = ctx.state.battlefield || [];
          for (const permId of ids) {
            const perm = battlefield.find((p: any) => p && String(p.id) === String(permId));
            if (perm) {
              (perm as any).tapped = tapped;
            }
          }

          // Intervening-if support: record that a player tapped a nonland permanent this turn.
          if (tapped) {
            try {
              const pid = String((e as any).playerId || '').trim();
              if (pid) {
                const stateAny = ctx.state as any;
                stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
              }
            } catch {
              /* ignore */
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case 'exilePermanent': {
        const permanentId = String((e as any).permanentId || '').trim();
        if (!permanentId) break;
        try {
          const sourcePermanentId = (e as any).sourcePermanentId != null ? String((e as any).sourcePermanentId) : undefined;
          const sourceName = (e as any).sourceName != null ? String((e as any).sourceName) : undefined;
          movePermanentToExile(ctx as any, permanentId, {
            exiledWithSourceId: sourcePermanentId,
            exiledWithSourceName: sourceName,
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(exilePermanent): failed', err);
        }
        break;
      }

      case "sacrificePermanent": {
        // Sacrifice a permanent (move to graveyard)
        const permId = (e as any).permanentId;
        if (!permId) break;
        try {
          try {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p?.id === permId);
            if (perm) trackPermanentSacrificedThisTurn(ctx.state, perm);
          } catch {
            // best-effort only
          }

          movePermanentToGraveyard(ctx as any, permId, true);
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificePermanent): failed", err);
        }
        break;
      }

      case "sacrificeSelected": {
        // DEPRECATED legacy event name for multiple sacrifices.
        // Kept for event replay/backward compatibility.
        const permanentIds = ((e as any).permanentIds as string[]) || ((e as any).permanentId ? [String((e as any).permanentId)] : []);
        if (!Array.isArray(permanentIds) || permanentIds.length === 0) break;
        try {
          for (const permId of permanentIds) {
            // Same Clue-sacrifice tracking as sacrificePermanent.
            try {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p?.id === permId);
              const controllerId = perm?.controller != null ? String(perm.controller) : null;
              const tl = String(perm?.card?.type_line || '').toLowerCase();
              const nm = String(perm?.card?.name || '').toLowerCase();
              const isClue = tl.includes('clue') && (tl.includes('artifact') || tl.includes('token'));
              if (controllerId && isClue && (nm === 'clue' || tl.includes('— clue') || tl.includes('- clue') || tl.includes('clue'))) {
                const stateAny = ctx.state as any;
                stateAny.sacrificedCluesThisTurn = stateAny.sacrificedCluesThisTurn || {};
                stateAny.sacrificedCluesThisTurn[controllerId] = (stateAny.sacrificedCluesThisTurn[controllerId] || 0) + 1;

                // Aliases consumed by intervening-if.
                stateAny.cluesSacrificedThisTurn = stateAny.cluesSacrificedThisTurn || {};
                stateAny.cluesSacrificedThisTurn[controllerId] = (stateAny.cluesSacrificedThisTurn[controllerId] || 0) + 1;
                stateAny.cluesSacrificedThisTurnCount = stateAny.cluesSacrificedThisTurnCount || {};
                stateAny.cluesSacrificedThisTurnCount[controllerId] = (stateAny.cluesSacrificedThisTurnCount[controllerId] || 0) + 1;
              }

              // Same generic/permanent-type sacrifice tracking as sacrificePermanent.
              if (controllerId) {
                const stateAny = ctx.state as any;
                stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
                stateAny.permanentsSacrificedThisTurn[controllerId] = (stateAny.permanentsSacrificedThisTurn[controllerId] || 0) + 1;

                const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
                if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
                  stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
                  stateAny.foodsSacrificedThisTurn[controllerId] = (stateAny.foodsSacrificedThisTurn[controllerId] || 0) + 1;
                }
              }
            } catch {
              // best-effort only
            }

            movePermanentToGraveyard(ctx as any, permId, true);
          }
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificeSelected): failed", err);
        }
        break;
      }

      case "declareAttackers":
      case "declareControlledAttackers": {
        // Set attackers for combat
        const attackers = ((e as any).attackers as any[]) || [];
        try {
          const battlefield = ctx.state.battlefield || [];

          // Best-effort combat trackers consumed by intervening-if.
          try {
            const stateAny = ctx.state as any;
            const playerId = String((e as any).playerId || "").trim();
            if (playerId) {
              stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};
              stateAny.attackedPlayersThisTurnByPlayer[playerId] = Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[playerId])
                ? stateAny.attackedPlayersThisTurnByPlayer[playerId]
                : [];

              stateAny.attackedDefendingPlayersThisCombatByPlayer = stateAny.attackedDefendingPlayersThisCombatByPlayer || {};
              // Reset per-combat (not per-turn) so extra combats are evaluated correctly.
              stateAny.attackedDefendingPlayersThisCombatByPlayer[playerId] = [];
            }
            stateAny.mustAttackThisCombatByPermanentId = {};

            // Per-combat tracker used by intervening-if templates like
            // "if this creature attacked or blocked this combat".
            stateAny.attackedOrBlockedThisCombatByPermanentId = {};

            // Per-combat snapshot used by intervening-if templates like
            // "if a Pirate and a Vehicle attacked this combat".
            {
              const players = Array.isArray((ctx.state as any)?.players) ? ((ctx.state as any).players as any[]) : [];
              const ids = players
                .map((p: any) => String(p?.id ?? p?.playerId ?? '').trim())
                .filter((id: string) => Boolean(id));

              // Reset per-combat snapshots so extra combats are evaluated correctly.
              stateAny.attackersDeclaredThisCombatByPlayer = {};
              stateAny.blockersDeclaredThisCombatByPlayer = {};
              for (const pid of ids) {
                stateAny.attackersDeclaredThisCombatByPlayer[pid] = [];
                stateAny.blockersDeclaredThisCombatByPlayer[pid] = [];
              }
              if (playerId && !stateAny.attackersDeclaredThisCombatByPlayer[playerId]) stateAny.attackersDeclaredThisCombatByPlayer[playerId] = [];
              if (playerId && !stateAny.blockersDeclaredThisCombatByPlayer[playerId]) stateAny.blockersDeclaredThisCombatByPlayer[playerId] = [];
            }

            // Per-turn tracker used by intervening-if templates like
            // "if no creatures attacked this turn".
            stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};

            for (const atk of attackers) {
              const attackerId = String(atk?.attackerId || atk?.creatureId || "").trim();
              if (!attackerId) continue;

              // Track who was attacked (player-only, not planeswalkers).
              const targetPlayerId = String(atk?.defendingPlayer || atk?.defendingPlayerId || atk?.targetPlayerId || "").trim();
              if (playerId && targetPlayerId) {
                const list: string[] = stateAny.attackedPlayersThisTurnByPlayer[playerId];
                if (Array.isArray(list) && !list.includes(targetPlayerId)) list.push(targetPlayerId);
              }

              // Track who is being attacked as the defending player for this combat.
              // Includes planeswalker/battle targets by resolving their controller.
              if (playerId) {
                const list: string[] = stateAny.attackedDefendingPlayersThisCombatByPlayer?.[playerId];
                if (Array.isArray(list)) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid && !list.includes(defendingPid)) list.push(defendingPid);
                }
              }

              const perm = battlefield.find((p: any) => p?.id === attackerId);
              if (!perm) continue;

              // Per-combat marker for this attacker.
              stateAny.attackedOrBlockedThisCombatByPermanentId[attackerId] = true;

              // Per-combat snapshot entry for this attacker.
              if (playerId && Array.isArray(stateAny.attackersDeclaredThisCombatByPlayer?.[playerId])) {
                stateAny.attackersDeclaredThisCombatByPlayer[playerId].push({
                  id: attackerId,
                  name: String((perm as any)?.card?.name ?? (perm as any)?.name ?? ''),
                  type_line: String((perm as any)?.card?.type_line ?? ''),
                });
              }

              // Track "they were attacked this turn by an Assassin you controlled".
              // Conservative: only set true on positive evidence.
              try {
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                if (tl && /\bassassin\b/i.test(tl) && playerId) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid) {
                    stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId] = stateAny.attackedByAssassinThisTurnByPlayer[playerId] || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId][defendingPid] = true;
                  }
                }
              } catch {
                // best-effort only
              }

              // Track whether this attacker was under a must-attack requirement this combat.
              // Conservative: only mark `true` on positive evidence.
              const isForced =
                Boolean((perm as any).mustAttackEachCombat) ||
                Boolean((perm as any).mustAttack) ||
                (Array.isArray((perm as any).goadedBy) && (perm as any).goadedBy.length > 0) ||
                (typeof (perm as any).goaded === 'object' && (perm as any).goaded !== null && Object.keys((perm as any).goaded).length > 0);
              if (isForced) {
                stateAny.mustAttackThisCombatByPermanentId[attackerId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          // Clear previous attackers
          for (const perm of battlefield) {
            if (perm) (perm as any).attacking = undefined;
          }
          // Set new attackers
          for (const atk of attackers) {
            const attackerId = String((atk as any)?.attackerId || (atk as any)?.creatureId || "").trim();
            if (!attackerId) continue;
            const perm = battlefield.find((p: any) => p.id === attackerId);
            if (perm) {
              const defendingPlayer = (atk as any)?.defendingPlayer || (atk as any)?.defendingPlayerId || (atk as any)?.targetPlayerId;
              const targetPermanentId = (atk as any)?.targetPermanentId;
              (perm as any).attacking = defendingPlayer || targetPermanentId || true;

              // Match live combat: mark that this permanent attacked this turn.
              (perm as any).attackedThisTurn = true;

              // Track total creatures attacked this turn for the attacking player.
              try {
                const stateAny = ctx.state as any;
                const attackerPid = String((e as any).playerId || '').trim();
                if (attackerPid) {
                  stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};
                  stateAny.creaturesAttackedThisTurn[attackerPid] = (stateAny.creaturesAttackedThisTurn[attackerPid] || 0) + 1;
                }
              } catch {
                /* ignore */
              }

              // Attacking creatures tap unless they have vigilance.
              // Keep replay deterministic and aligned with live combat logic.
              const hasVigilance = permanentHasKeyword(perm, 'vigilance');
              if (!hasVigilance) {
                (perm as any).tapped = true;
                try {
                  const attackerPid = String((e as any).playerId || '').trim();
                  if (attackerPid) {
                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[attackerPid] = true;
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareAttackers): failed", err);
        }
        break;
      }

      case "declareBlockers":
      case "declareControlledBlockers": {
        // Set blockers for combat
        const blockers = (e as any).blockers as Array<{ blockerId: string; attackerId: string }> || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          const stateAny = ctx.state as any;
          const playerId = String((e as any).playerId || '').trim();

          stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};

          // Clear previous blockers
          for (const perm of battlefield) {
            if (perm) {
              (perm as any).blocking = undefined;
              (perm as any).blockedBy = undefined;
            }
          }
          // Set new blockers
          for (const blk of blockers) {
            const blocker = battlefield.find((p: any) => p.id === blk.blockerId);
            const attacker = battlefield.find((p: any) => p.id === blk.attackerId);
            if (blocker) {
              (blocker as any).blocking = blk.attackerId;

              // Intervening-if support: blocker "blocked this turn" and "attacked or blocked this combat".
              (blocker as any).blockedThisTurn = true;
              stateAny.attackedOrBlockedThisCombatByPermanentId[String(blk.blockerId)] = true;

              // Per-combat snapshot entry for this blocker.
              if (playerId) {
                stateAny.blockersDeclaredThisCombatByPlayer = stateAny.blockersDeclaredThisCombatByPlayer || {};
                stateAny.blockersDeclaredThisCombatByPlayer[playerId] = Array.isArray(stateAny.blockersDeclaredThisCombatByPlayer[playerId])
                  ? stateAny.blockersDeclaredThisCombatByPlayer[playerId]
                  : [];
                const list = stateAny.blockersDeclaredThisCombatByPlayer[playerId];
                const bid = String(blk.blockerId || '').trim();
                if (bid && !list.some((e: any) => String(e?.id ?? e?.creatureId ?? e).trim() === bid)) {
                  list.push({
                    id: bid,
                    name: String((blocker as any)?.card?.name ?? (blocker as any)?.name ?? ''),
                    type_line: String((blocker as any)?.card?.type_line ?? ''),
                  });
                }
              }
            }
            if (attacker) {
              (attacker as any).blockedBy = (attacker as any).blockedBy || [];
              (attacker as any).blockedBy.push(blk.blockerId);

              // Intervening-if support: attacker "was blocked this turn".
              (attacker as any).wasBlockedThisTurn = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareBlockers): failed", err);
        }
        break;
      }

      case "fight": {
        // Two creatures fight - each deals damage to the other equal to their power
        const sourceId = (e as any).sourceId;
        const targetId = (e as any).targetId;
        const sourcePower = (e as any).sourcePower;
        const targetPower = (e as any).targetPower;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const source = battlefield.find((p: any) => p.id === sourceId);
          const target = battlefield.find((p: any) => p.id === targetId);
          
          if (source && target) {
            // Best-effort per-turn damage tracking for intervening-if clauses.
            try {
              const stateAny = ctx.state as any;
              const srcId = String(sourceId || '').trim();
              const tgtId = String(targetId || '').trim();
              if (srcId && tgtId) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][tgtId] = true;
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] = stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId][srcId] = true;
              }
            } catch {
              // best-effort only
            }

            // Each creature deals damage to the other equal to its power
            (source as any).damage = ((source as any).damage || 0) + targetPower;
            (target as any).damage = ((target as any).damage || 0) + sourcePower;

            const queueDamageTrigger = (perm: any, damageAmount: number) => {
              processDamageReceivedTriggers(ctx as any, perm, damageAmount, (triggerInfo) => {
                if (dispatchDamageReceivedTrigger(ctx as any, triggerInfo)) {
                  return;
                }

                const stateAny = ctx.state as any;
                stateAny.pendingDamageTriggers = stateAny.pendingDamageTriggers || {};
                stateAny.pendingDamageTriggers[triggerInfo.triggerId] = {
                  sourceId: triggerInfo.sourceId,
                  sourceName: triggerInfo.sourceName,
                  controller: triggerInfo.controller,
                  damageAmount: triggerInfo.damageAmount,
                  triggerType: 'dealt_damage',
                  targetType: triggerInfo.targetType,
                  effect: triggerInfo.effect,
                  ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
                  ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
                  ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
                };
              });
            };

            queueDamageTrigger(source, targetPower);
            queueDamageTrigger(target, sourcePower);
            
            // Run SBA to check for lethal damage
            try {
              runSBA(ctx as any);
            } catch (sbaErr) {
              // SBA may not be available during replay - this is expected
              debug(1, "applyEvent(fight): SBA skipped during replay:", sbaErr);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(fight): failed", err);
        }
        break;
      }

      case "counter_moved": {
        const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const counterType = String((e as any).counterType || '').trim();

        try {
          if (!sourcePermanentId || !targetPermanentId || !counterType) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const sourcePermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === sourcePermanentId);
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetPermanentId);
          if (!sourcePermanent || !targetPermanent) break;

          const sourceCounters = ((sourcePermanent as any).counters || {}) as Record<string, number>;
          const currentSourceCount = Number(sourceCounters[counterType] || 0);
          if (currentSourceCount <= 0) break;
          sourceCounters[counterType] = currentSourceCount - 1;
          if (sourceCounters[counterType] <= 0) {
            delete sourceCounters[counterType];
          }
          (sourcePermanent as any).counters = sourceCounters;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counter_moved): failed', err);
        }
        break;
      }

      case "activateFetchland": {
        // Fetchland activation: sacrifice land, search for land, put on battlefield
        // The actual search/put is handled when the activated ability resolves.
        // Replay must restore both the paid activation costs and the unresolved stack item.
        const playerId = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const abilityId = String((e as any).abilityId || '').trim();
        const persistedStackId = String((e as any).stackId || '').trim();
        if (permId) {
          try {
            const stateAny = ctx.state as any;
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
            const card = (permanent as any)?.card || {};
            const cardName = String((e as any).cardName || card.name || '').trim();
            const oracleText = String(card.oracle_text || '').trim();
            const persistedAbilityText = String((e as any).activatedAbilityText || '').trim();
            const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
            const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
            const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText).trim();
            const replayAbilityText = persistedAbilityText || scopedAbilityFullText || oracleText;

            if (playerId && replayAbilityText) {
              const persistedManaCost = String((e as any).manaCost || '').trim();
              const { manaCost: derivedManaCost } = extractReplayActivationCost(replayAbilityText);
              const manaCost = persistedManaCost || derivedManaCost;
              stateAny.manaPool = stateAny.manaPool || {};
              stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
                white: 0,
                blue: 0,
                black: 0,
                red: 0,
                green: 0,
                colorless: 0,
              };
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

              const persistedLifeCost = Number((e as any).lifePaidForCost || 0);
              const lifeCostMatch = replayAbilityText.match(/pay\s+(\d+)\s+life/i);
              const derivedLifeCost = lifeCostMatch ? Math.max(0, Number(lifeCostMatch[1] || 0)) : 0;
              const lifeCost = persistedLifeCost > 0 ? persistedLifeCost : derivedLifeCost;
              if (lifeCost > 0) {
                stateAny.life = stateAny.life || {};
                (ctx as any).life = (ctx as any).life || {};
                const startingLife = Number(stateAny.startingLife || (ctx as any).startingLife || 40);
                const currentLife = Number(stateAny.life?.[playerId] ?? (ctx as any).life?.[playerId] ?? startingLife);
                const nextLife = Math.max(0, currentLife - lifeCost);
                stateAny.life[playerId] = nextLife;
                (ctx as any).life[playerId] = nextLife;
                stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
                stateAny.lifeLostThisTurn[String(playerId)] = ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + lifeCost);

                const player = Array.isArray(stateAny.players)
                  ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
                  : null;
                if (player) {
                  player.life = nextLife;
                }
              }
            }

            movePermanentToGraveyard(ctx as any, permId, true);

            if (playerId && replayAbilityText) {
              const persistedSearchParams = ((e as any).searchParams || {}) as any;
              const filter = persistedSearchParams.filter || parseSearchCriteria(replayAbilityText);
              let maxSelections = Number(persistedSearchParams.maxSelections || 0);
              if (!Number.isFinite(maxSelections) || maxSelections <= 0) {
                maxSelections = 1;
                const upToMatch = replayAbilityText.match(/search your library for up to (\w+)/i);
                if (upToMatch) {
                  const num = String(upToMatch[1] || '').toLowerCase();
                  if (num === 'two') maxSelections = 2;
                  else if (num === 'three') maxSelections = 3;
                  else if (num === 'four') maxSelections = 4;
                  else {
                    const parsed = parseInt(num, 10);
                    if (!isNaN(parsed)) maxSelections = parsed;
                  }
                }
              }

              const entersTapped = persistedSearchParams.entersTapped === true || /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(replayAbilityText);

              let searchDescription = String(persistedSearchParams.searchDescription || '').trim();
              if (!searchDescription) {
                searchDescription = 'Search your library for a land card';
                if (maxSelections > 1) {
                  searchDescription = `Search your library for up to ${maxSelections} land cards`;
                }
                if (filter.subtypes && filter.subtypes.length > 0) {
                  const landTypes = filter.subtypes
                    .filter((subtype: string) => !subtype.includes('basic'))
                    .map((subtype: string) => subtype.charAt(0).toUpperCase() + subtype.slice(1));
                  if (landTypes.length > 0) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections}` : 'Search for a';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                  if (filter.subtypes.includes('basic')) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections} basic` : 'Search for a basic';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                }
              }

              const stackId = persistedStackId || generateDeterministicId(ctx, 'ability_fetch', `${permId}:${abilityId || cardName || 'fetchland'}`);
              stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
              const alreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
              if (!alreadyPresent) {
                stateAny.stack.push({
                  id: stackId,
                  type: 'ability',
                  controller: playerId,
                  source: permId,
                  sourceName: cardName,
                  description: `${searchDescription}, put ${maxSelections > 1 ? 'them' : 'it'} onto the battlefield${entersTapped ? ' tapped' : ''}, then shuffle`,
                  abilityType: 'fetch-land',
                  searchParams: {
                    filter,
                    searchDescription,
                    isTrueFetch: persistedSearchParams.isTrueFetch === true || /pay\s+1\s+life/i.test(replayAbilityText),
                    maxSelections,
                    entersTapped,
                    cardImageUrl: persistedSearchParams.cardImageUrl || card?.image_uris?.small || card?.image_uris?.normal,
                  },
                });
              }
            }
          } catch (err) {
            debugWarn(1, "applyEvent(activateFetchland): failed", err);
          }
        }
        break;
      }

      case "activateManaAbility": {
        // Mana ability activation: tap permanent, add mana
        const permId = (e as any).permanentId;
        const manaColor = (e as any).manaColor;
        const playerId = (e as any).playerId != null ? String((e as any).playerId) : '';
        try {
          // Replay-stable per-turn tracking for intervening-if templates like
          // "if you haven't added mana with this ability this turn".
          try {
            const stateAny = ctx.state as any;
            const abilityId = (e as any).abilityId;
            const playerKey = playerId;
            const permKey = permId != null ? String(permId) : '';
            const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
            if (playerKey && permKey) {
              stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
              stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};

              // Prefer an ability-specific key when available; otherwise fall back to permanent id.
              const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
              (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
            }
          } catch {
            // best-effort only
          }

          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (playerId) {
              const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
              const manaToApply = Object.keys(recordedMana).length > 0
                ? recordedMana
                : (perm ? inferLegacyManaReplay(ctx.state, perm, playerId, manaColor) : {});
              applyRecordedManaToPool(ctx, playerId, manaToApply);

              const explicitLifeLost = Number((e as any).lifeLost || 0);
              const replayLifeLost = explicitLifeLost > 0
                ? explicitLifeLost
                : (perm ? inferLegacyManaLifeLoss(perm, manaColor) : 0);
              applyManaAbilityLifeLoss(ctx, playerId, replayLifeLost);
            }

            if (perm) {
              (perm as any).tapped = true;
              
              // Yuna, Grand Summoner: "Grand Summon — {T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
              const cardName = ((perm as any).card?.name || '').toLowerCase();
              const oracleText = ((perm as any).card?.oracle_text || '').toLowerCase();
              if (cardName.includes('yuna') && cardName.includes('grand summoner') ||
                  (oracleText.includes('add one mana of any color') && 
                   oracleText.includes('next') && oracleText.includes('creature') && 
                   oracleText.includes('enters') && oracleText.includes('two additional +1/+1 counter'))) {
                // Set flag for next creature spell this turn
                const controllerId = (perm as any).controller;
                (ctx.state as any).yunaNextCreatureFlags = (ctx.state as any).yunaNextCreatureFlags || {};
                (ctx.state as any).yunaNextCreatureFlags[controllerId] = true;
                debug(2, `[activateManaAbility] Yuna, Grand Summoner's Grand Summon activated - next creature will enter with +2 counters`);
              }
            }
          }
          // Mana pool updates are typically ephemeral, but we bump seq for state sync
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateManaAbility): failed", err);
        }
        break;
      }

      case "activateAbility": {
        try {
          applyAIActivateAbilityReplay(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(activateAbility): failed', err);
        }
        break;
      }

      case "activateBattlefieldAbility": {
        // Best-effort replay hook: this event is emitted for both mana and non-mana activations.
        // We only use it for replay-stable evidence tracking.
        try {
          const stateAny = ctx.state as any;
          const playerId = (e as any).playerId;
          const permId = (e as any).permanentId;
          const abilityId = (e as any).abilityId;
          const abilityText = String((e as any).abilityText || '');
          const activatedAbilityText = String((e as any).activatedAbilityText || '');

          // If the server persisted which cards were discarded from hand to pay activation costs,
          // apply those discards during replay so zones are deterministic.
          try {
            const discarded = (e as any).discardedCardIds;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(discarded) && discarded.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                for (const cid of discarded) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.graveyard as any[]).push({ ...card, zone: 'graveyard' });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from hand to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiledFromHand = (e as any).exiledCardIdsFromHandForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiledFromHand) && exiledFromHand.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiledFromHand) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were sacrificed to pay activation costs,
          // apply those sacrifices during replay so battlefield state is deterministic.
          try {
            const sacrificed = (e as any).sacrificedPermanents;
            if (Array.isArray(sacrificed) && sacrificed.length > 0) {
              for (const sid of sacrificed) {
                const id = String(sid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                if (!bf.some((p: any) => p && String(p.id) === id)) continue;
                movePermanentToGraveyard(ctx as any, id, true);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were returned to hand to pay activation costs,
          // apply those bounces during replay so battlefield/zones are deterministic.
          try {
            const returned = (e as any).returnedPermanentsToHandForCost;
            if (Array.isArray(returned) && returned.length > 0) {
              for (const rid of returned) {
                const id = String(rid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                if (!bf.some((p: any) => p && String(p.id) === id)) continue;
                movePermanentToHand(ctx as any, id);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were tapped to pay activation costs,
          // apply those taps during replay so battlefield state is deterministic.
          try {
            const tapped = (e as any).tappedPermanents;
            if (Array.isArray(tapped) && tapped.length > 0) {
              const battlefield = ctx.state.battlefield || [];
              const tappedSet = new Set(tapped.map((x: any) => String(x)));
              const unresolvedTapped: string[] = [];

              for (const p of battlefield as any[]) {
                if (!p) continue;
                if (tappedSet.has(String(p.id))) {
                  (p as any).tapped = true;
                }
              }

              for (const targetId of tappedSet) {
                const found = (battlefield as any[]).some((permanent: any) => permanent && String(permanent.id || '') === targetId);
                if (!found) unresolvedTapped.push(targetId);
              }

              const tapCostTargetFilter = (e as any).tapCostTargetFilter;
              if (unresolvedTapped.length > 0 && tapCostTargetFilter && typeof tapCostTargetFilter === 'object') {
                const controllerFilter = String((tapCostTargetFilter as any).controller || 'any').toLowerCase();
                const tapStatus = String((tapCostTargetFilter as any).tapStatus || 'any').toLowerCase();
                const excludeSource = (tapCostTargetFilter as any).excludeSource === true;
                const requireAllTypes = (tapCostTargetFilter as any).requireAllTypes === true;
                const filterTypes = Array.isArray((tapCostTargetFilter as any).types)
                  ? (tapCostTargetFilter as any).types.map((value: any) => String(value || '').toLowerCase()).filter(Boolean)
                  : [];
                const sourcePermanentId = String(permId || '').trim();
                const preferTokens = (e as any).tapCostPreferTokens === true;
                const preferNonTokens = (e as any).tapCostPreferNonTokens === true;
                const neededCount = Math.max(
                  unresolvedTapped.length,
                  Number.isFinite(Number((e as any).tapCostTargetCount)) ? Number((e as any).tapCostTargetCount) : unresolvedTapped.length
                );

                const candidates = (battlefield as any[])
                  .filter((permanent: any) => {
                    if (!permanent) return false;
                    const permanentId = String(permanent.id || '').trim();
                    if (!permanentId) return false;
                    if (excludeSource && sourcePermanentId && permanentId === sourcePermanentId) return false;
                    if (tappedSet.has(permanentId)) return false;

                    if (controllerFilter === 'you' && String(permanent.controller || '') !== String(playerId || '')) return false;
                    if (controllerFilter === 'opponent' && String(permanent.controller || '') === String(playerId || '')) return false;
                    if (tapStatus === 'tapped' && !permanent.tapped) return false;
                    if (tapStatus === 'untapped' && permanent.tapped) return false;

                    if (filterTypes.length > 0) {
                      const typeLine = String(permanent.card?.type_line || permanent.type_line || permanent.cardType || '').toLowerCase();
                      const matches = requireAllTypes
                        ? filterTypes.every((type: string) => typeLine.includes(type))
                        : filterTypes.some((type: string) => typeLine.includes(type));
                      if (!matches) return false;
                    }

                    return true;
                  })
                  .map((permanent: any, index: number) => {
                    let score = 0;
                    if (preferTokens && permanent.isToken) score += 100;
                    if (preferNonTokens && !permanent.isToken) score += 100;
                    return { permanent, index, score };
                  })
                  .sort((left: any, right: any) => {
                    if (right.score !== left.score) return right.score - left.score;
                    return left.index - right.index;
                  })
                  .slice(0, neededCount);

                for (const candidate of candidates) {
                  if (candidate?.permanent) {
                    candidate.permanent.tapped = true;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which counters were removed to pay activation costs,
          // apply those counter removals during replay so battlefield state is deterministic.
          try {
            const removed = (e as any).removedCountersForCost;
            if (Array.isArray(removed) && removed.length > 0) {
              for (const entry of removed) {
                const permanentId = String(entry?.permanentId || '').trim();
                const counterType = String(entry?.counterType || '').trim();
                const count = Number(entry?.count || 0);
                if (!permanentId || !counterType || !Number.isFinite(count) || count <= 0) continue;
                updateCounters(ctx as any, permanentId, { [counterType]: -count });
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted life paid to activate this ability, apply it during replay.
          try {
            const paid = Number((e as any).lifePaidForCost || 0);
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Number.isFinite(paid) && paid > 0) {
              (ctx.state as any).life = (ctx.state as any).life || {};
              const cur = Number((ctx.state as any).life?.[pid] ?? 40);
              (ctx.state as any).life[pid] = Math.max(0, cur - paid);
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[pid] = ((ctx.state as any).lifeLostThisTurn[pid] || 0) + paid;

              const player = Array.isArray((ctx.state as any).players)
                ? (ctx.state as any).players.find((entry: any) => entry && String(entry.id || '') === pid)
                : null;
              if (player) {
                player.life = (ctx.state as any).life[pid];
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from the activator's graveyard to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiled = (e as any).exiledCardIdsFromGraveyardForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiled) && exiled.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiled) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.graveyard as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.graveyard as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted Blight N as an activation cost ("put N -1/-1 counters on a creature you control"),
          // apply the counters during replay so battlefield state is deterministic.
          try {
            const blightTargetId = String((e as any).blightTargetPermanentIdForCost || '').trim();
            const blightN = Number((e as any).blightNForCost || 0);
            if (blightTargetId && Number.isFinite(blightN) && blightN > 0) {
              updateCounters(ctx as any, blightTargetId, { '-1/-1': blightN });
            }
          } catch {
            // best-effort only
          }

          // If the server persisted the full activated ability text (including cost),
          // attach it to the matching ability stack item to support intervening-if inference.
          try {
            if (activatedAbilityText) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).activatedAbilityText = activatedAbilityText;
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const persistedAbilityType = String((e as any).abilityType || (e as any).abilityId || '').trim().toLowerCase();
            const isEquipActivation = persistedAbilityType === 'equip';
            const isFortifyActivation = persistedAbilityType === 'fortify';
            const isReconfigureAttachActivation = persistedAbilityType === 'reconfigure_attach';
            const isReconfigureUnattachActivation = persistedAbilityType === 'reconfigure_unattach';
            const tappedPermanentsForCost = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            const tappedOtherPermanentForCost = playerId != null && permId != null
              ? tappedPermanentsForCost.some((id: string) => id !== String(permId))
              : tappedPermanentsForCost.length > 0;
            const hasInteractiveCostEvidence =
              tappedOtherPermanentForCost ||
              Boolean(Array.isArray((e as any).discardedCardIds) && (e as any).discardedCardIds.length > 0) ||
              Boolean(Array.isArray((e as any).exiledCardIdsFromHandForCost) && (e as any).exiledCardIdsFromHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).returnedPermanentsToHandForCost) && (e as any).returnedPermanentsToHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).sacrificedPermanents) && (e as any).sacrificedPermanents.length > 0) ||
              Boolean(Array.isArray((e as any).removedCountersForCost) && (e as any).removedCountersForCost.length > 0) ||
              Boolean(Number((e as any).lifePaidForCost || 0) > 0);
            const shouldRebuildStack = Boolean(abilityText) && playerId != null && permId != null && (
              isEquipActivation ||
              isFortifyActivation ||
              isReconfigureAttachActivation ||
              isReconfigureUnattachActivation ||
              Boolean(persistedTargets && persistedTargets.length > 0) ||
              (Boolean(activatedAbilityText) && hasInteractiveCostEvidence)
            );
            const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
            if (shouldRebuildStack) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId));
              const existingStackItem = Array.isArray(stack)
                ? stack.find((item: any) =>
                    item &&
                    String(item.type || '') === 'ability' &&
                    String(item.controller || '') === String(playerId) &&
                    String(item.source || '') === String(permId) &&
                    (!abilityText || String(item.description || '') === abilityText)
                  )
                : null;

              if (!existingStackItem && permanent) {
                const manaCost = (String(activatedAbilityText || '').match(/\{[^}]+\}/g) || [])
                  .filter((symbol: string) => !/^\{[tq]\}$/i.test(symbol))
                  .join('');
                const manaPool = stateAny.manaPool?.[String(playerId)];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                const rebuiltStackItem: any = {
                  id: generateDeterministicId(ctx, 'ability_battlefield', `${String(permId)}:${persistedAbilityType || abilityText}`),
                  type: 'ability',
                  controller: String(playerId),
                  source: String(permId),
                  sourceName: String((e as any).cardName || (permanent as any)?.card?.name || 'Ability'),
                  description: abilityText,
                  activatedAbilityText: activatedAbilityText || undefined,
                  xValue: typeof (e as any).xValue === 'number' ? (e as any).xValue : undefined,
                };

                if (persistedTargets) {
                  rebuiltStackItem.targets = persistedTargets.map((id: any) => String(id));
                }
                if (retargetValidTargets) {
                  rebuiltStackItem.copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  rebuiltStackItem.copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) rebuiltStackItem.copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) rebuiltStackItem.copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) rebuiltStackItem.copyRetargetTargetDescription = retargetTargetDescription;
                }

                if (isEquipActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.equipParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'equip';
                  rebuiltStackItem.equipParams = {
                    equipmentId: String(permId || ''),
                    targetCreatureId,
                    equipmentName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.equipParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isFortifyActivation) {
                  const targetLandId = String(persistedTargets?.[0] || (e as any)?.fortifyParams?.targetLandId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetLandId);
                  rebuiltStackItem.abilityType = 'fortify';
                  rebuiltStackItem.fortifyParams = {
                    fortificationId: String(permId || ''),
                    targetLandId,
                    fortificationName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Fortification'),
                    targetLandName: String((e as any)?.fortifyParams?.targetLandName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isReconfigureAttachActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.reconfigureParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'reconfigure_attach';
                  rebuiltStackItem.reconfigureParams = {
                    reconfigureId: String(permId || ''),
                    targetCreatureId,
                    reconfigureName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.reconfigureParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isReconfigureUnattachActivation) {
                  rebuiltStackItem.abilityType = 'reconfigure_unattach';
                }

                stack.push(rebuiltStackItem);
              }
            }

            if (retargetValidTargets || persistedTargets) {
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  if (persistedTargets) {
                    (item as any).targets = persistedTargets.map((id: any) => String(id));
                  }
                  if (typeof (e as any).xValue === 'number') {
                    (item as any).xValue = (e as any).xValue;
                  }
                  if (retargetValidTargets) {
                    (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                    (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                    if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                    if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                    if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                  }
                  if (isEquipActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'equip';
                    (item as any).equipParams = {
                      equipmentId: String(permId || ''),
                      targetCreatureId,
                      equipmentName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  } else if (isFortifyActivation) {
                    const targetLandId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                      : null;
                    (item as any).abilityType = 'fortify';
                    (item as any).fortifyParams = {
                      fortificationId: String(permId || ''),
                      targetLandId,
                      fortificationName: String((e as any).cardName || item.sourceName || 'Fortification'),
                      targetLandName: String(validTarget?.name || ''),
                    };
                  } else if (isReconfigureAttachActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'reconfigure_attach';
                    (item as any).reconfigureParams = {
                      reconfigureId: String(permId || ''),
                      targetCreatureId,
                      reconfigureName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  }
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Intervening-if support: if we persisted deterministic Treasure spend metadata for this activation,
          // attach it to the matching ability stack item when present.
          try {
            const known = (e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean';
            if (known) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).manaFromTreasureSpentKnown = true;
                  (item as any).manaFromTreasureSpent = Boolean((e as any).manaFromTreasureSpent);
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Detect mana ability (mirrors socket-side checks): produces mana and doesn't target.
          const isManaAbility =
            /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) &&
            !/target/i.test(abilityText);

          if (!isManaAbility) break;

          const playerKey = playerId != null ? String(playerId) : '';
          const permKey = permId != null ? String(permId) : '';
          const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
          if (playerKey && permKey) {
            stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
            stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};
            const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
            (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
          }

          try {
            if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
          } catch {}
        } catch (err) {
          debugWarn(1, 'applyEvent(activateBattlefieldAbility): failed', err);
        }
        break;
      }

      case "activateSacrificeDrawAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const manaCost = String((e as any).manaCost || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permIndex === -1) break;

          const [permanent] = battlefield.splice(permIndex, 1);
          const zones = stateAny.zones = stateAny.zones || {};
          const zoneState = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
          };

          if (manaCost) {
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };
            consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
          }

          zoneState.graveyard = Array.isArray(zoneState.graveyard) ? zoneState.graveyard : [];
          if (permanent?.card) {
            (zoneState.graveyard as any[]).push({ ...(permanent as any).card, zone: 'graveyard' });
          }
          zoneState.graveyardCount = Array.isArray(zoneState.graveyard) ? zoneState.graveyard.length : zoneState.graveyardCount;

          const libraries = (ctx as any).libraries;
          const mapLibrary = libraries && typeof libraries.get === 'function' ? libraries.get(playerId) : undefined;
          const zoneLibrary = Array.isArray(zoneState.library) ? zoneState.library : undefined;
          const activeLibrary = Array.isArray(zoneLibrary) ? zoneLibrary : (Array.isArray(mapLibrary) ? mapLibrary : []);
          if (activeLibrary.length > 0) {
            const drawnCard = activeLibrary.shift();
            zoneState.hand = Array.isArray(zoneState.hand) ? zoneState.hand : [];
            (zoneState.hand as any[]).push({ ...drawnCard, zone: 'hand' });
            zoneState.handCount = (zoneState.hand as any[]).length;
          }
          zoneState.libraryCount = activeLibrary.length;
          if (Array.isArray(zoneLibrary)) {
            zoneState.library = activeLibrary;
          }
          if (libraries && typeof libraries.set === 'function') {
            libraries.set(playerId, activeLibrary);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateSacrificeDrawAbility): failed', err);
        }
        break;
      }

      case "activateDoublingCube": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          const manaPool = stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };

          let remaining = 3;
          const poolCopy = {
            white: Number(manaPool.white || 0),
            blue: Number(manaPool.blue || 0),
            black: Number(manaPool.black || 0),
            red: Number(manaPool.red || 0),
            green: Number(manaPool.green || 0),
            colorless: Number(manaPool.colorless || 0),
          };

          const colorlessUsed = Math.min(remaining, poolCopy.colorless);
          poolCopy.colorless -= colorlessUsed;
          remaining -= colorlessUsed;

          if (remaining > 0) {
            const colors: Array<'white' | 'blue' | 'black' | 'red' | 'green'> = ['white', 'blue', 'black', 'red', 'green'];
            for (const color of colors) {
              if (remaining <= 0) break;
              const used = Math.min(remaining, poolCopy[color]);
              poolCopy[color] -= used;
              remaining -= used;
            }
          }

          stateAny.manaPool[playerId] = {
            white: poolCopy.white * 2,
            blue: poolCopy.blue * 2,
            black: poolCopy.black * 2,
            red: poolCopy.red * 2,
            green: poolCopy.green * 2,
            colorless: poolCopy.colorless * 2,
          };

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permanent) {
            (permanent as any).tapped = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateDoublingCube): failed', err);
        }
        break;
      }

      case "activateUpgradeAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const upgradeIndexRaw = Number((e as any).upgradeIndex ?? 0);
          const upgradeIndex = Number.isFinite(upgradeIndexRaw) && upgradeIndexRaw >= 0 ? Math.floor(upgradeIndexRaw) : 0;
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const oracleText = String((permanent as any)?.card?.oracle_text || '');
          const cardName = String((permanent as any)?.card?.name || (e as any).cardName || '');
          const parsedUpgrades = parseCreatureUpgradeAbilities(oracleText, cardName);
          const upgrade = parsedUpgrades[upgradeIndex] || parsedUpgrades[0];
          if (!upgrade) break;

          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], String(upgrade.cost || '').trim());

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = generateDeterministicId(ctx, 'ability_upgrade', `${permanentId}:${upgradeIndex}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: upgrade.fullText,
              abilityType: 'creature-upgrade',
              upgradeData: {
                newTypes: upgrade.newTypes,
                newPower: upgrade.newPower,
                newToughness: upgrade.newToughness,
                keywords: upgrade.keywords,
                counterCount: upgrade.counterCount,
                counterType: upgrade.counterType,
              },
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateUpgradeAbility): failed', err);
        }
        break;
      }

      case "activateTutorAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const abilityId = String((e as any).abilityId || '').trim();
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const card = (permanent as any)?.card || {};
          const oracleText = String(card.oracle_text || '');
          const cardName = String(card.name || (e as any).cardName || '');
          const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
          const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
          const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText || '').trim();
          const tutorInfo = detectTutorEffect(scopedAbilityText || scopedAbilityFullText || oracleText);
          if (!tutorInfo.isTutor) break;

          const { requiresTap, manaCost, sacrificesSource } = extractReplayActivationCost(scopedAbilityFullText);
          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

          if (sacrificesSource) {
            movePermanentToGraveyard(ctx as any, permanentId, true);
          } else if (requiresTap) {
            (permanent as any).tapped = true;
          }

          const filter = parseSearchCriteria(String(tutorInfo.searchCriteria || ''));
          const isSplit = tutorInfo.splitDestination === true;
          const destination = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped')
            ? 'battlefield'
            : (tutorInfo.destination === 'exile')
              ? 'exile'
              : 'hand';

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'ability_tutor', `${permanentId}:${abilityId}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: scopedAbilityText || scopedAbilityFullText,
              activatedAbilityText: scopedAbilityFullText || scopedAbilityText,
              abilityType: 'tutor',
              searchParams: {
                filter,
                searchCriteria: tutorInfo.searchCriteria,
                maxSelections: tutorInfo.maxSelections || 1,
                destination: tutorInfo.destination || 'hand',
                entersTapped: tutorInfo.entersTapped,
                splitDestination: tutorInfo.splitDestination,
                toBattlefield: tutorInfo.toBattlefield,
                toHand: tutorInfo.toHand,
              },
            });
          }

          const queue = ResolutionQueueManager.getQueue(ctx.gameId);
          const queueAlreadyPresent = queue.steps.some((step: any) =>
            step &&
            String((step as any).type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
            String((step as any).playerId || '') === playerId &&
            String((step as any).sourceName || '') === cardName &&
            String((step as any).searchCriteria || '') === String(tutorInfo.searchCriteria || 'any card')
          );
          if (!queueAlreadyPresent) {
            ResolutionQueueManager.addStep(ctx.gameId, {
              type: ResolutionStepType.LIBRARY_SEARCH,
              playerId: playerId as any,
              sourceName: cardName,
              description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
              searchCriteria: tutorInfo.searchCriteria || 'any card',
              minSelections: 0,
              maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
              mandatory: false,
              destination,
              reveal: false,
              shuffleAfter: true,
              availableCards: snapshotLibraryForReplay(ctx, playerId),
              filter,
              splitDestination: isSplit,
              toBattlefield: tutorInfo.toBattlefield || 1,
              toHand: tutorInfo.toHand || 1,
              entersTapped: tutorInfo.entersTapped || false,
            } as any);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateTutorAbility): failed', err);
        }
        break;
      }

      case "activatePlaneswalkerAbility": {
        // Planeswalker ability: adjust loyalty counters
        const permId = (e as any).permanentId;
        const loyaltyCost = (e as any).loyaltyCost || 0;
        const abilityIndex = (e as any).abilityIndex;
        const playerId = String((e as any).playerId || '').trim();
        try {
          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).counters = (perm as any).counters || {};
              (perm as any).counters.loyalty = ((perm as any).counters.loyalty || 0) + loyaltyCost;
              (perm as any).loyalty = (perm as any).counters.loyalty;

              const parsed = parsePlaneswalkerAbilities((perm as any).card, perm);
              const loyaltyAbility = Number.isFinite(Number(abilityIndex))
                ? parsed?.abilities?.[Number(abilityIndex)]
                : undefined;

              const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : ((ctx.state as any).stack = []);
              const existing = stack.find((item: any) =>
                item &&
                String(item.type || '') === 'ability' &&
                String((item as any).source || '') === String(permId) &&
                String((item as any).controller || '') === playerId &&
                Number((item as any)?.planeswalker?.abilityIndex ?? -1) === Number(abilityIndex)
              );

              if (!existing && loyaltyAbility) {
                stack.push({
                  id: generateDeterministicId(ctx, 'ability_planeswalker', `${String(permId)}:${String(abilityIndex)}`),
                  type: 'ability',
                  controller: playerId || String((perm as any).controller || ''),
                  source: String(permId),
                  sourceName: String((perm as any)?.card?.name || 'Planeswalker'),
                  description: String((loyaltyAbility as any).effect || ''),
                  activatedAbilityText: `${String((loyaltyAbility as any).costDisplay || loyaltyCost)}: ${String((loyaltyAbility as any).effect || '')}`,
                  planeswalker: {
                    oracleId: (perm as any)?.card?.oracle_id,
                    abilityIndex: Number(abilityIndex),
                    loyaltyCost: Number(loyaltyCost),
                  },
                });
              }
            }
          }

          try {
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
            if (Array.isArray(stack) && stack.length > 0) {
              for (let i = stack.length - 1; i >= 0; i--) {
                const item = stack[i];
                if (!item || String(item.type || '') !== 'ability') continue;
                if (permId != null && String((item as any).source || '') !== String(permId)) continue;
                if (abilityIndex != null && Number((item as any)?.planeswalker?.abilityIndex ?? -1) !== Number(abilityIndex)) continue;
                if (persistedTargets) {
                  (item as any).targets = persistedTargets.map((id: any) => String(id));
                }
                if (retargetValidTargets) {
                  (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                }
                break;
              }
            }
          } catch {
            // best-effort only
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activatePlaneswalkerAbility): failed", err);
        }
        break;
      }

      case "activateGraveyardAbility": {
        // Graveyard ability (flashback, unearth, etc.)
        // The specific effect depends on the ability, but typically moves the card
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const abilityType = (e as any).abilityType ?? (e as any).abilityId;
        try {
          if (cardId && pid && ['flashback', 'jump-start', 'retrace', 'escape'].includes(String(abilityType))) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              try {
                const discarded = (e as any).discardedCardIds;
                if (Array.isArray(discarded) && discarded.length > 0 && Array.isArray(z.hand)) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  for (const cid of discarded) {
                    const discardId = String(cid || '').trim();
                    if (!discardId) continue;
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({ ...discardedCard, zone: 'graveyard' });
                  }

                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              } catch {
                // best-effort only
              }

              try {
                const exiledFromGraveyard = (e as any).exiledCardIdsFromGraveyardForCost;
                if (Array.isArray(exiledFromGraveyard) && exiledFromGraveyard.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];

                  for (const cid of exiledFromGraveyard) {
                    const exileId = String(cid || '').trim();
                    if (!exileId) continue;
                    const graveyardIndex = (z.graveyard as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (graveyardIndex === -1) continue;
                    const [exiledCard] = (z.graveyard as any[]).splice(graveyardIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }

                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
                }
              } catch {
                // best-effort only
              }

              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                // Turn-tracking for intervening-if: a card left your graveyard this turn.
                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                ctx.state.stack = ctx.state.stack || [];
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  controller: pid,
                  card: { ...card, zone: 'stack', castWithAbility: String(abilityType) },
                  targets: [],
                });

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;
              }
            }
          } else if (cardId && pid && abilityType === 'unearth') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];

                ctx.state.battlefield = ctx.state.battlefield || [];
                (ctx.state.battlefield as any[]).push({
                  id: createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId)),
                  controller: pid,
                  owner: pid,
                  tapped: false,
                  wasUnearthed: true,
                  unearthed: true,
                  counters: {},
                  card: { ...card, zone: 'battlefield', unearth: true, wasUnearthed: true },
                });
              }
            }
          } else if (cardId && pid && (abilityType === 'embalm' || abilityType === 'eternalize')) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];
                const cardName = String(card?.name || 'Unknown');
                const tokenName = abilityType === 'eternalize' ? `${cardName} (4/4 Zombie)` : `${cardName} (Zombie)`;
                ctx.state.battlefield = ctx.state.battlefield || [];
                (ctx.state.battlefield as any[]).push({
                  id: createdPermanentIds.shift() || generateDeterministicId(ctx, abilityType === 'eternalize' ? 'token_eternalize' : 'token_embalm', String(cardId)),
                  controller: pid,
                  owner: pid,
                  tapped: false,
                  counters: {},
                  isToken: true,
                  card: {
                    ...card,
                    name: tokenName,
                    zone: 'battlefield',
                    type_line: String(card?.type_line || '').includes('Zombie')
                      ? card.type_line
                      : `Zombie ${String(card?.type_line || '').trim()}`.trim(),
                  },
                  basePower: abilityType === 'eternalize' ? 4 : undefined,
                  baseToughness: abilityType === 'eternalize' ? 4 : undefined,
                });
              }
            }
          } else if (cardId && pid && abilityType === 'disturb') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                ctx.state.stack = ctx.state.stack || [];
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  controller: pid,
                  card: { ...card, zone: 'stack', castWithAbility: 'disturb', transformed: true },
                  targets: [],
                });
              }
            }
          } else if (cardId && pid && (abilityType === 'scavenge' || abilityType === 'encore')) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                if (abilityType === 'encore') {
                  const stateAny = ctx.state as any;
                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  const players = Array.isArray(stateAny?.players) ? stateAny.players : [];
                  const encoreTargetPlayerIds = Array.isArray((e as any).encoreTargetPlayerIds)
                    ? (e as any).encoreTargetPlayerIds.map((value: any) => String(value))
                    : players
                        .filter((player: any) => player?.id && String(player.id) !== String(pid) && !player.hasLost)
                        .map((player: any) => String(player.id));
                  const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
                  const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
                  const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
                  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
                  const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

                  ctx.state.battlefield = ctx.state.battlefield || [];
                  stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
                    ? stateAny.pendingSacrificeAtNextEndStep
                    : [];

                  const existingKeywords = Array.isArray(card?.keywords) ? [...card.keywords] : [];
                  if (!existingKeywords.some((ability: string) => String(ability).toLowerCase() === 'haste')) {
                    existingKeywords.push('Haste');
                  }
                  const power = Number.parseInt(String(card?.power ?? ''), 10);
                  const toughness = Number.parseInt(String(card?.toughness ?? ''), 10);
                  const oracleText = String(card?.oracle_text || '');
                  const oracleWithHaste = /(^|\n)haste(\n|$)/i.test(oracleText)
                    ? oracleText
                    : `${oracleText}${oracleText ? '\n' : ''}Haste`;

                  for (const targetPlayerId of encoreTargetPlayerIds) {
                    const tokenId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'token_encore', `${String(cardId)}:${String(targetPlayerId)}`);
                    (ctx.state.battlefield as any[]).push({
                      id: tokenId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      summoningSickness: false,
                      isToken: true,
                      mustAttack: true,
                      encoreAttackPlayerId: String(targetPlayerId),
                      copiedFromCardId: String(card?.id || ''),
                      ...(Number.isFinite(power) ? { basePower: power } : {}),
                      ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
                      grantedAbilities: existingKeywords,
                      card: {
                        ...card,
                        id: tokenId,
                        zone: 'battlefield',
                        oracle_text: oracleWithHaste,
                        keywords: existingKeywords,
                      },
                    });
                    stateAny.pendingSacrificeAtNextEndStep.push({
                      permanentId: tokenId,
                      fireAtTurnNumber,
                      maxManaValue: 0,
                      sourceName: String(card?.name || 'Encore'),
                      createdBy: pid,
                    });
                  }
                }
              }
            }
          } else if (cardId && pid && abilityType === 'exile-to-add-counters') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const creatureType = String((e as any).creatureType || '').trim().toLowerCase();
                if (creatureType) {
                  const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                  const creatureTypePattern = new RegExp(`\\b${creatureType}s?\\b`, 'i');
                  for (const perm of battlefield as any[]) {
                    if (!perm || String(perm.controller) !== String(pid)) continue;
                    const typeLine = String(perm.card?.type_line || '').toLowerCase();
                    if (!typeLine.includes('creature') || !creatureTypePattern.test(typeLine)) continue;
                    const counters = ((perm as any).counters || {}) as Record<string, number>;
                    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                    (perm as any).counters = counters;
                  }
                }
              }
            }
          } else if (cardId && pid && (e as any).isTutor === true) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            const gameId = (ctx as any).gameId;
            if (z && Array.isArray(z.graveyard) && gameId) {
              const graveyard = z.graveyard as any[];
              const card = graveyard.find((c: any) => c && String(c.id) === String(cardId));
              if (card) {
                const manaCost = String((e as any).manaCost || '').trim();
                  const exileSourceOnActivate = (e as any).exileSourceOnActivate === true;
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (exileSourceOnActivate) {
                    const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(cardId));
                    if (cardIndex !== -1) {
                      const [movedCard] = graveyard.splice(cardIndex, 1);
                      z.graveyardCount = graveyard.length;
                      z.exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
                      z.exile.push({ ...movedCard, zone: 'exile' });
                      z.exileCount = z.exile.length;
                      recordCardLeftGraveyardThisTurn(ctx as any, String(pid), movedCard);
                    }
                  }

                const destination = String((e as any).destination || 'hand');
                const searchCriteria = String((e as any).searchCriteria || 'any card');
                const maxSelectionsRaw = Number((e as any).maxSelections);
                const maxSelections = Number.isFinite(maxSelectionsRaw) ? maxSelectionsRaw : 1;
                const filter = ((e as any).filter && typeof (e as any).filter === 'object') ? { ...((e as any).filter as any) } : {};
                const availableCards = (ctx.libraries.get(pid) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: 'library_search' as any,
                  playerId: pid,
                  sourceId: String(cardId),
                  sourceName: String(card?.name || 'Card'),
                  description: searchCriteria ? `Search for: ${searchCriteria}` : 'Search your library',
                  searchCriteria,
                  minSelections: 0,
                  maxSelections,
                  mandatory: false,
                  destination,
                  reveal: false,
                  shuffleAfter: true,
                  availableCards,
                  filter,
                  splitDestination: (e as any).splitDestination === true,
                  toBattlefield: Number((e as any).toBattlefield || 1),
                  toHand: Number((e as any).toHand || 1),
                  entersTapped: (e as any).entersTapped === true,
                  persistLibrarySearchResolve: true,
                  persistLibrarySearchResolveReason: 'graveyard_ability',
                  persistLibrarySearchResolveAbilityId: String(abilityType || ''),
                } as any);
              }
            }
          } else if (
            cardId &&
            pid &&
            (abilityType === 'return-from-graveyard' || abilityType === 'graveyard-activated' || String(abilityType || '').includes('-return-')) &&
            (e as any).isTutor !== true
          ) {
            const destination = String((e as any).destination || '');
            const manaCost = String((e as any).manaCost || '').trim();
            const tappedCreatureIds = Array.isArray((e as any).tappedCreatureIds)
              ? ((e as any).tappedCreatureIds as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (destination === 'hand' || destination === 'battlefield') {
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                const graveyard = z.graveyard as any[];
                const idx = graveyard.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = graveyard.splice(idx, 1);
                  z.graveyardCount = graveyard.length;

                  recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                  const manaPool = (ctx.state as any).manaPool?.[pid];
                  if (manaPool && manaCost) {
                    consumeRecordedManaCostFromPool(manaPool, manaCost);
                  }
                  applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (tappedCreatureIds.length > 0) {
                    const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                    for (const permanentId of tappedCreatureIds) {
                      const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
                      if (permanent) {
                        (permanent as any).tapped = true;
                      }
                    }

                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
                  }

                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  if (destination === 'battlefield') {
                    ctx.state.battlefield = ctx.state.battlefield || [];
                    (ctx.state.battlefield as any[]).push({
                      id: createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId)),
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      card: { ...card, zone: 'battlefield' },
                    });
                  } else {
                    z.hand = z.hand || [];
                    (z.hand as any[]).push({ ...card, zone: 'hand' });
                    z.handCount = (z.hand as any[]).length;
                  }
                }
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateGraveyardAbility): failed", err);
        }
        break;
      }

      case "activateCycling": {
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const cardName = String((e as any).cardName || 'Unknown');
        const cyclingCost = String((e as any).cyclingCost || '');
        const stackId = String((e as any).stackId || generateDeterministicId(ctx, 'ability_cycling', String(cardId || cardName || 'card')));
        const abilityId = String((e as any).abilityId || 'cycling');
        try {
          const zones = (ctx.state as any)?.zones?.[pid];
          if (zones && Array.isArray(zones.hand) && cardId) {
            const hand = zones.hand as any[];
            const handIndex = hand.findIndex((card: any) => String(card?.id) === String(cardId));
            if (handIndex !== -1) {
              const [card] = hand.splice(handIndex, 1);
              zones.graveyard = zones.graveyard || [];
              (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
              zones.handCount = hand.length;
              zones.graveyardCount = (zones.graveyard as any[]).length;
              recordCardPutIntoGraveyardThisTurn(ctx as any, String(pid), card, { fromBattlefield: false });
            }
          }

          const manaPool = (ctx.state as any)?.manaPool?.[pid];
          if (manaPool && cyclingCost) {
            consumeRecordedManaCostFromPool(manaPool as Record<string, number>, cyclingCost);
          }

          const stateAny = ctx.state as any;
          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id) === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: pid,
              source: cardId,
              sourceName: cardName,
              description: 'Draw a card',
              abilityType: 'cycling',
              abilityId,
              cardId,
              cardName,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateCycling): failed', err);
        }
        break;
      }

      case "sacrificeUnlessPayChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const payMana = (e as any).payMana === true;
        const manaCost = String((e as any).manaCost || '').trim();

        try {
          if (!pid || !permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permId);

          if (payMana) {
            const manaPool = (ctx.state as any).manaPool?.[pid];
            if (manaPool && manaCost) {
              consumeRecordedManaCostFromPool(manaPool, manaCost);
            }
          } else if (permIndex !== -1) {
            const [perm] = battlefield.splice(permIndex, 1);
            const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
            const playerZones = (zones[pid] = zones[pid] || {
              hand: [],
              handCount: 0,
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            });
            playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
            if (perm?.card) {
              playerZones.graveyard.push({ ...(perm.card || {}), zone: 'graveyard' });
              playerZones.graveyardCount = playerZones.graveyard.length;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeUnlessPayChoice): failed', err);
        }
        break;
      }

      case "shockLandChoice": {
        // Shock land enters tapped or player pays 2 life
        const pid = (e as any).playerId;
        const permId = (e as any).permanentId;
        const payLife = (e as any).payLife;
        try {
          if (payLife && pid && ctx.life) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx as any).life = (ctx as any).life || {};
            const players = (ctx.state as any).players || [];
            const player = players.find((p: any) => String(p?.id) === String(pid));
            const startingLife = (ctx.state as any).startingLife ?? 40;
            const current = (ctx.state as any).life?.[pid] ?? (ctx as any).life?.[pid] ?? player?.life ?? startingLife;
            const next = Number(current) - 2;
            (ctx.state as any).life[pid] = next;
            (ctx as any).life[pid] = next;
            if (player) player.life = next;

            if (permId) {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p.id === permId);
              if (perm) {
                (perm as any).tapped = false;
              }
            }

            // Track life lost this turn.
            try {
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[String(pid)] = ((ctx.state as any).lifeLostThisTurn[String(pid)] || 0) + 2;
            } catch {}
          }
          if (!payLife && permId) {
            // Land enters tapped
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).tapped = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(shockLandChoice): failed", err);
        }
        break;
      }

      case "revealLandChoice": {
        const permId = String((e as any).permanentId || '').trim();
        const revealCardId = String((e as any).revealCardId || '').trim();

        try {
          if (!permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const perm = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
          if (perm) {
            (perm as any).tapped = !revealCardId;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(revealLandChoice): failed', err);
        }
        break;
      }

      case "counterTargetChosen": {
        const targetId = String((e as any).targetId || '').trim();
        const counterType = String((e as any).counterType || '').trim();

        try {
          if (!targetId || !counterType) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
          if (!targetPermanent) break;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counterTargetChosen): failed', err);
        }
        break;
      }

      case "moxDiamondChoice": {
        // Mox Diamond replacement effect - discard a land to enter battlefield, or go to graveyard
        const pid = (e as any).playerId;
        const discardLandId = (e as any).discardLandId;
        const stackItemId = (e as any).stackItemId;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z as any;
          ctx.state.zones = zones;
          
          // Find Mox Diamond on stack (it may already be removed by socket handler, but handle replay case)
          const stack = ctx.state.stack || [];
          const moxIdx = stack.findIndex((item: any) => item.id === stackItemId);
          let moxCard = null;
          
          if (moxIdx !== -1) {
            const [moxItem] = stack.splice(moxIdx, 1);
            moxCard = moxItem.card;
          }
          
          if (discardLandId) {
            // Discard a land and put Mox Diamond on battlefield
            const hand = z.hand as any[];
            const landIdx = hand.findIndex((c: any) => c?.id === discardLandId);
            if (landIdx !== -1) {
              const [discardedLand] = hand.splice(landIdx, 1);
              z.handCount = hand.length;
              (z.graveyard as any[]).push({ ...discardedLand, zone: 'graveyard' });
              z.graveyardCount = (z.graveyard as any[]).length;

              // Turn-tracking for intervening-if: a player discarded a card this turn.
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[String(pid)] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
            
            // Put Mox Diamond on battlefield
            if (moxCard) {
              ctx.state.battlefield = ctx.state.battlefield || [];
              ctx.state.battlefield.push({
                id: String(stackItemId || generateDeterministicId(ctx, 'perm', String(moxCard?.id || 'mox_diamond'))),
                controller: pid,
                owner: pid,
                tapped: false,
                counters: {},
                card: { ...moxCard, zone: 'battlefield' },
              } as any);
            }
          } else {
            // Put Mox Diamond in graveyard
            if (moxCard) {
              (z.graveyard as any[]).push({ ...moxCard, zone: 'graveyard' });
              z.graveyardCount = (z.graveyard as any[]).length;
            }
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(moxDiamondChoice): failed", err);
        }
        break;
      }

      case "bounceLandChoice": {
        // Bounce land: return a land to hand
        const pid = (e as any).playerId;
        const returnedLandId = (e as any).returnedLandId || (e as any).returnPermanentId;
        const destination = String((e as any).destination || 'hand').toLowerCase();
        const stackItemId = String((e as any).stackItemId || '').trim();
        try {
          if (returnedLandId && pid) {
            const battlefield = ctx.state.battlefield || [];
            const idx = battlefield.findIndex((p: any) => p.id === returnedLandId);
            if (idx !== -1) {
              const [perm] = battlefield.splice(idx, 1);
              const zones = ctx.state.zones || {};
              const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
              zones[pid] = z;
              if (perm && (perm as any).card) {
                if (destination === 'hand') {
                  z.hand = Array.isArray(z.hand) ? z.hand : [];
                  (z.hand as any[]).push({ ...(perm as any).card, zone: 'hand' });
                  z.handCount = (z.hand as any[]).length;
                }
              }
            }
          }

          if (stackItemId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === stackItemId);
            if (stackIndex !== -1) {
              (ctx.state.stack as any[]).splice(stackIndex, 1);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(bounceLandChoice): failed", err);
        }
        break;
      }

      case "librarySearchSelect": {
        // Select cards from library search (tutor effects)
        const pid = (e as any).playerId;
        // Support both field names for backward compatibility
        const cardIds = (e as any).selectedCardIds as string[] || (e as any).cardIds as string[] || [];
        const destination = (e as any).moveTo || (e as any).destination || "hand";
        try {
          if (pid && cardIds.length > 0) {
            const lib = ctx.libraries.get(pid) || [];
            const zones = ctx.state.zones || {};
            const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            zones[pid] = z;
            
            for (const cardId of cardIds) {
              const idx = lib.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = lib.splice(idx, 1);
                if (destination === "hand") {
                  (z.hand as any[]).push({ ...card, zone: "hand" });
                } else if (destination === "battlefield") {
                  ctx.state.battlefield = ctx.state.battlefield || [];
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: {},
                    card: { ...card, zone: "battlefield" },
                  } as any);
                } else if (destination === "top") {
                  lib.unshift({ ...card, zone: "library" });
                }
              }
            }
            
            z.handCount = (z.hand as any[]).length;
            z.libraryCount = lib.length;
            ctx.libraries.set(pid, lib);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(librarySearchSelect): failed", err);
        }
        break;
      }

      case "librarySearchResolve": {
        const pid = String((e as any).playerId || '').trim();
        const destination = String((e as any).destination || 'hand');
        const entersTapped = (e as any).entersTapped === true;
        const splitAssignments = (e as any).splitAssignments as { toBattlefield?: string[]; toHand?: string[] } | undefined;
        const destinationFaceDown = (e as any).destinationFaceDown === true;
        const grantPlayableFromExileToController = (e as any).grantPlayableFromExileToController === true;
        const playableFromExileTypeKey = String((e as any).playableFromExileTypeKey || '').toLowerCase();
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const selectedCards = Array.isArray((e as any).selectedCards) ? (e as any).selectedCards as any[] : [];
        const selectedCardMap = new Map(selectedCards.map((card: any) => [String(card?.id || ''), card]));
        const libraryAfter = cloneLibraryCards((e as any).libraryAfter as any[]);
        const selectedIds = Array.isArray((e as any).selectedCardIds)
          ? ((e as any).selectedCardIds as any[]).map((id: any) => String(id)).filter(Boolean)
          : selectedCards.map((card: any) => String(card?.id || '')).filter(Boolean);

        try {
          if (!pid) break;

          const zones = ctx.state.zones || {};
          const z = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          zones[pid] = z;

          (z as any).library = libraryAfter;
          z.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          const moveToBattlefield = (card: any) => {
            if (!card) return;
            const typeLine = String(card?.type_line || '').toLowerCase();
            const isCreature = typeLine.includes('creature');
            ctx.state.battlefield = ctx.state.battlefield || [];
            const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(card?.id || 'library_search'));
            (ctx.state.battlefield as any[]).push({
              id: createdPermanentId,
              controller: pid,
              owner: pid,
              tapped: entersTapped,
              counters: {},
              basePower: isCreature ? parseInt(card?.power || '0', 10) : undefined,
              baseToughness: isCreature ? parseInt(card?.toughness || '0', 10) : undefined,
              summoningSickness: isCreature,
              card: { ...card, zone: 'battlefield' },
            } as any);
          };

          const moveToHand = (card: any) => {
            if (!card) return;
            z.hand = Array.isArray(z.hand) ? z.hand : [];
            (z.hand as any[]).push({ ...card, zone: 'hand' });
            z.handCount = (z.hand as any[]).length;
          };

          const moveToGraveyardZone = (card: any) => {
            if (!card) return;
            z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
            (z.graveyard as any[]).push({ ...card, zone: 'graveyard' });
            z.graveyardCount = (z.graveyard as any[]).length;
          };

          const moveToExileZone = (card: any) => {
            if (!card) return;
            z.exile = Array.isArray(z.exile) ? z.exile : [];
            const exiledCard = { ...card, zone: 'exile', ...(destinationFaceDown ? { faceDown: true } : {}) };
            (z.exile as any[]).push(exiledCard);
            z.exileCount = (z.exile as any[]).length;

            if (grantPlayableFromExileToController) {
              const typeLine = String(exiledCard?.type_line || '').toLowerCase();
              const passesTypeGate = !playableFromExileTypeKey || typeLine.includes(playableFromExileTypeKey);
              if (passesTypeGate) {
                const stateAny = ctx.state as any;
                stateAny.playableFromExile = stateAny.playableFromExile || {};
                const entry = (stateAny.playableFromExile[pid] = stateAny.playableFromExile[pid] || {});
                entry[String(exiledCard.id)] = true;
              }
            }
          };

          if (splitAssignments) {
            for (const cardId of splitAssignments.toBattlefield || []) {
              moveToBattlefield(selectedCardMap.get(String(cardId)));
            }
            for (const cardId of splitAssignments.toHand || []) {
              moveToHand(selectedCardMap.get(String(cardId)));
            }
          } else {
            for (const cardId of selectedIds) {
              const card = selectedCardMap.get(cardId);
              if (!card) continue;
              if (destination === 'battlefield') {
                moveToBattlefield(card);
              } else if (destination === 'hand') {
                moveToHand(card);
              } else if (destination === 'graveyard') {
                moveToGraveyardZone(card);
              } else if (destination === 'exile') {
                moveToExileZone(card);
              }
            }
          }

          const lifeLoss = Number((e as any).lifeLoss || 0);
          if (Number.isFinite(lifeLoss) && lifeLoss > 0) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            const currentLife = Number((ctx.state as any).life?.[pid] ?? 40);
            (ctx.state as any).life[pid] = currentLife - lifeLoss;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(librarySearchResolve): failed', err);
        }
        break;
      }

      case "creatureTypeSelected": {
        // Creature type selection (e.g., Cavern of Souls, Metallic Mimic)
        const permId = (e as any).permanentId;
        const creatureType = (e as any).creatureType;
        try {
          if (permId && creatureType) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).chosenCreatureType = creatureType;

              const permCardName = String((perm as any)?.card?.name || '').toLowerCase();
              if (permCardName.includes('morophon')) {
                const stateAny = ctx.state as any;
                const morophonChosenType = (stateAny.morophonChosenType || {}) as Record<string, string>;
                morophonChosenType[String(permId)] = String(creatureType);
                stateAny.morophonChosenType = morophonChosenType;
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(creatureTypeSelected): failed", err);
        }
        break;
      }

      case "playOpeningHandCards": {
        // Play cards from opening hand (Leylines, Chancellor triggers)
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        try {
          if (pid && cardIds.length > 0) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.hand)) {
              const hand = z.hand as any[];
              ctx.state.battlefield = ctx.state.battlefield || [];
              
              for (const cardId of cardIds) {
                const idx = hand.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = hand.splice(idx, 1);
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: getReplayOpeningHandBattlefieldCounters(ctx.state, card, pid),
                    card: { ...card, zone: "battlefield" },
                  } as any);
                }
              }
              z.handCount = hand.length;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playOpeningHandCards): failed", err);
        }
        break;
      }

      case "skipOpeningHandActions": {
        // Player chose to skip opening hand actions
        // Just a marker event, no state change needed
        ctx.bumpSeq();
        break;
      }

      case "kynaiosChoiceInitiated":
      case "kynaiosChoiceResponse":
      case "kynaiosChoiceComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();

          if ((e as any).type === 'kynaiosChoiceInitiated') {
            const sourceController = String((e as any).sourceController || '').trim();
            const controllerDrawCount = Math.max(0, Number((e as any).controllerDrawCount ?? 1) || 0);
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            if (sourceController && controllerDrawCount > 0) {
              drawCards(ctx, sourceController as any, controllerDrawCount);
            }

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.KYNAIOS_CHOICE,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                kynaiosBatchId: String((rawStep as any).kynaiosBatchId || batchId || stepId),
                isController: (rawStep as any).isController === true,
                sourceController: (rawStep as any).sourceController ? String((rawStep as any).sourceController) : undefined,
                canPlayLand: (rawStep as any).canPlayLand !== false,
                landsInHand: Array.isArray((rawStep as any).landsInHand) ? (rawStep as any).landsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                options: Array.isArray((rawStep as any).options) ? (rawStep as any).options.map((option: any) => String(option)) : [],
                landPlayOrFallbackIsController: (rawStep as any).landPlayOrFallbackIsController === true,
                landPlayOrFallbackSourceController: (rawStep as any).landPlayOrFallbackSourceController ? String((rawStep as any).landPlayOrFallbackSourceController) : undefined,
                landPlayOrFallbackCanPlayLand: (rawStep as any).landPlayOrFallbackCanPlayLand !== false,
                landPlayOrFallbackLandsInHand: Array.isArray((rawStep as any).landPlayOrFallbackLandsInHand) ? (rawStep as any).landPlayOrFallbackLandsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                landPlayOrFallbackOptions: Array.isArray((rawStep as any).landPlayOrFallbackOptions) ? (rawStep as any).landPlayOrFallbackOptions.map((option: any) => String(option)) : [],
              } as any);
            }
          } else if ((e as any).type === 'kynaiosChoiceResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const stepId = String((e as any).stepId || '').trim();
            const choice = String((e as any).choice || 'decline').trim();
            const landCardId = String((e as any).landCardId || '').trim();
            const createdPermanentId = String((e as any).createdPermanentId || '').trim();

            if (choice === 'play_land' && playerId && landCardId) {
              moveKynaiosLandFromHandToBattlefield(ctx as any, playerId as any, landCardId, createdPermanentId || undefined);
            }

            if (gameId && stepId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
                ResolutionQueueManager.completeStep(gameId, stepId, {
                  stepId,
                  playerId: playerId as any,
                  selections: choice === 'play_land'
                    ? { choice, landCardId: landCardId || undefined }
                    : { choice },
                  cancelled: false,
                  timestamp: Date.now(),
                } as any);
              }
            }
          } else {
            const sourceController = String((e as any).sourceController || '').trim();
            const drawnPlayerIds = Array.isArray((e as any).drawnPlayerIds)
              ? ((e as any).drawnPlayerIds as any[]).map((playerId: any) => String(playerId || '').trim()).filter(Boolean)
              : [];
            const stateAny = ctx.state as any;
            stateAny.kynaiosFinalizedBatches = stateAny.kynaiosFinalizedBatches || {};
            stateAny.kynaiosFinalizedBatches[batchId] = true;

            for (const playerId of drawnPlayerIds) {
              if (playerId && playerId !== sourceController) {
                drawCards(ctx, playerId as any, 1);
              }
            }

            if (gameId && batchId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.KYNAIOS_CHOICE) &&
                String((step as any).kynaiosBatchId || '') === batchId
              );
              for (const pendingStep of pendingSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(kynaiosChoice*): failed', err);
        }
        break;
      }

      case "joinForcesInitiated":
      case "joinForcesContribution":
      case "joinForcesComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'joinForcesInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.JOIN_FORCES,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                availableMana: Number((rawStep as any).availableMana || 0),
                isInitiator: (rawStep as any).isInitiator === true,
                priority: Number((rawStep as any).priority || 0),
              } as any);
            }
          } else if ((e as any).type === 'joinForcesContribution') {
            const playerId = String((e as any).playerId || '').trim();
            const contribution = Math.max(0, Math.floor(Number((e as any).contribution || 0)));
            const stepId = String((e as any).stepId || '').trim();
            const tappedPermanentIds = Array.isArray((e as any).tappedPermanentIds)
              ? ((e as any).tappedPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];

            for (const permanentId of tappedPermanentIds) {
              const permanent = (ctx.state.battlefield || []).find((perm: any) => String(perm?.id || '') === permanentId);
              if (permanent) permanent.tapped = true;
            }

            const stateAny = ctx.state as any;
            stateAny.joinForcesContributions = stateAny.joinForcesContributions || {};
            stateAny.joinForcesContributions[cardName] = stateAny.joinForcesContributions[cardName] || {
              total: 0,
              byPlayer: {},
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            stateAny.joinForcesContributions[cardName].total += contribution;
            stateAny.joinForcesContributions[cardName].byPlayer[playerId] = contribution;

            if (gameId && stepId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
                ResolutionQueueManager.completeStep(gameId, stepId, {
                  stepId,
                  playerId: playerId as any,
                  selections: contribution,
                  cancelled: false,
                  timestamp: Date.now(),
                } as any);
              }
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const totalContributions = Math.max(0, Math.floor(Number((e as any).totalContributions || 0)));
            const byPlayer = ((e as any).byPlayer && typeof (e as any).byPlayer === 'object')
              ? { ...((e as any).byPlayer as any) }
              : {};
            const players = (ctx.state.players || []) as any[];
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingJoinForcesSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.JOIN_FORCES) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingJoinForcesSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if (cardNameLower.includes('minds aglow')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                drawCards(ctx as any, player.id, totalContributions);
              }
            } else if (cardNameLower.includes('collective voyage')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;

                const existingSearch = gameId
                  ? ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                      String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                      String(step?.playerId || '') === playerId &&
                      String(step?.sourceName || '') === 'Collective Voyage')
                  : undefined;
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: `up to ${totalContributions} basic land card(s) (enters tapped)`,
                  mandatory: false,
                  sourceName: 'Collective Voyage',
                  searchCriteria: `up to ${totalContributions} basic land card(s)`,
                  minSelections: 0,
                  maxSelections: totalContributions,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: true,
                  filter: { types: ['land'], supertypes: ['basic'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('alliance of arms')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < totalContributions; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `alliance_of_arms_${playerId}_${index}`);
                  battlefield.push({
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: true,
                    card: {
                      id: tokenId,
                      name: 'Soldier Token',
                      type_line: 'Token Creature — Soldier',
                      power: '1',
                      toughness: '1',
                      colors: ['W'],
                    },
                  });
                }
              }
            } else if (cardNameLower.includes('shared trauma')) {
              const stateAny = ctx.state as any;
              stateAny.pendingMill = stateAny.pendingMill || {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;
                stateAny.pendingMill[playerId] = (stateAny.pendingMill[playerId] || 0) + totalContributions;
              }
            }

            const stateAny = ctx.state as any;
            if (stateAny.joinForcesContributions && cardName) {
              delete stateAny.joinForcesContributions[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(joinForces*): failed', err);
        }
        break;
      }

      case "temptingOfferInitiated":
      case "temptingOfferResponse":
      case "temptingOfferComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'temptingOfferInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.TEMPTING_OFFER,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                isOpponent: (rawStep as any).isOpponent === true,
                priority: Number((rawStep as any).priority || 0),
              } as any);
            }
          } else if ((e as any).type === 'temptingOfferResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const accepted = (e as any).accepted === true;
            const stepId = String((e as any).stepId || '').trim();

            const stateAny = ctx.state as any;
            stateAny.temptingOfferResponses = stateAny.temptingOfferResponses || {};
            stateAny.temptingOfferResponses[cardName] = stateAny.temptingOfferResponses[cardName] || {
              acceptedBy: [],
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            if (accepted) {
              const acceptedBy = stateAny.temptingOfferResponses[cardName].acceptedBy;
              if (!acceptedBy.includes(playerId)) {
                acceptedBy.push(playerId);
              }
            }

            if (gameId && stepId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
                ResolutionQueueManager.completeStep(gameId, stepId, {
                  stepId,
                  playerId: playerId as any,
                  selections: accepted,
                  cancelled: false,
                  timestamp: Date.now(),
                } as any);
              }
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const acceptedBy = Array.isArray((e as any).acceptedBy)
              ? ((e as any).acceptedBy as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];
            const initiatorBonusCount = Math.max(1, Math.floor(Number((e as any).initiatorBonusCount || (1 + acceptedBy.length))));
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const players = (ctx.state.players || []) as any[];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingTemptingOfferSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.TEMPTING_OFFER) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingTemptingOfferSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if (cardNameLower.includes('discovery')) {
              const targets = [initiator, ...acceptedBy].filter(Boolean);
              for (const playerId of targets) {
                if (!gameId) continue;
                const maxSelections = playerId === initiator ? initiatorBonusCount : 1;
                const existingSearch = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                  String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                  String(step?.playerId || '') === playerId &&
                  String(step?.sourceName || '') === 'Tempt with Discovery'
                );
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: playerId === initiator ? `up to ${maxSelections} land card(s) (enters untapped)` : 'a land card (enters untapped)',
                  mandatory: false,
                  sourceName: 'Tempt with Discovery',
                  searchCriteria: playerId === initiator ? `up to ${maxSelections} land card(s)` : 'a land card',
                  minSelections: 0,
                  maxSelections,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: false,
                  filter: { types: ['land'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('glory')) {
              const initiatorCreatures = battlefield.filter((perm: any) =>
                String(perm?.controller || '') === initiator && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
              );
              for (const creature of initiatorCreatures) {
                const counters = { ...(creature.counters || {}) } as Record<string, number>;
                counters['+1/+1'] = (counters['+1/+1'] || 0) + initiatorBonusCount;
                creature.counters = counters;
              }

              for (const opponentId of acceptedBy) {
                const opponentCreatures = battlefield.filter((perm: any) =>
                  String(perm?.controller || '') === opponentId && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
                );
                for (const creature of opponentCreatures) {
                  const counters = { ...(creature.counters || {}) } as Record<string, number>;
                  counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                  creature.counters = counters;
                }
              }
            } else if (cardNameLower.includes('vengeance') || cardNameLower.includes('bunnies')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              const xValue = Math.max(1, Math.floor(Number((e as any).xValue || 3)));
              const isVengeance = cardNameLower.includes('vengeance');
              const tokenName = isVengeance ? 'Elemental' : 'Rabbit';
              const colors = isVengeance ? ['R'] : ['W'];
              const oracleText = isVengeance ? 'Haste' : '';
              const keywords = isVengeance ? ['Haste'] : undefined;
              const typeLine = isVengeance ? 'Token Creature — Elemental' : 'Token Creature — Rabbit';
              const initiatorCount = isVengeance ? xValue * initiatorBonusCount : initiatorBonusCount;

              const tokenCountsByPlayer: Record<string, number> = { [initiator]: initiatorCount };
              for (const opponentId of acceptedBy) {
                tokenCountsByPlayer[opponentId] = isVengeance ? xValue : 1;
              }

              for (const [playerId, count] of Object.entries(tokenCountsByPlayer)) {
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < count; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `${tokenName.toLowerCase()}_${playerId}_${index}`);
                  const token = {
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: !isVengeance,
                    card: {
                      id: tokenId,
                      name: tokenName,
                      type_line: typeLine,
                      power: '1',
                      toughness: '1',
                      colors,
                      oracle_text: oracleText,
                      ...(keywords ? { keywords } : {}),
                    },
                  } as any;
                  battlefield.push(token);
                  triggerETBEffectsForToken(ctx as any, token, playerId as PlayerID);
                }
              }
            }

            const stateAny = ctx.state as any;
            if (stateAny.temptingOfferResponses && cardName) {
              delete stateAny.temptingOfferResponses[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(temptingOffer*): failed', err);
        }
        break;
      }

      case "setHouseRules": {
        // Set house rules for the game
        const rules = (e as any).rules ?? (e as any).houseRules;
        try {
          if (rules && typeof rules === 'object') {
            (ctx.state as any).houseRules = { ...(ctx.state as any).houseRules, ...rules };
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(setHouseRules): failed", err);
        }
        break;
      }

      case "targetSelectionConfirm": {
        // Target selection confirmed for a spell/ability
        // The actual targeting logic is handled by the spell resolution
        ctx.bumpSeq();
        break;
      }

      case "pushTriggeredAbility": {
        // Push a triggered ability onto the stack
        // This allows triggers to be replayed correctly
        const triggerId = (e as any).triggerId;
        const sourceId = (e as any).sourceId;
        const sourceName = (e as any).sourceName;
        const controllerId = (e as any).controllerId;
        const description = (e as any).description;
        const triggerType = (e as any).triggerType;
        const effect = (e as any).effect;
        const mandatory = (e as any).mandatory;
        const value = (e as any).value;
        const permanentId = (e as any).permanentId;
        const requiresChoice = (e as any).requiresChoice;
        const requiresTarget = (e as any).requiresTarget;
        const targetType = (e as any).targetType;
        const targetConstraint = (e as any).targetConstraint;
        const needsTargetSelection = (e as any).needsTargetSelection;
        const isModal = (e as any).isModal;
        const modalOptions = (e as any).modalOptions;
        const targetPlayer = (e as any).targetPlayer;
        const defendingPlayer = (e as any).defendingPlayer;
        const triggeringPlayer = (e as any).triggeringPlayer;
        const activatedAbilityIsManaAbility = (e as any).activatedAbilityIsManaAbility;
        const triggeringStackItemId = (e as any).triggeringStackItemId;
        const triggeringPermanentId = (e as any).triggeringPermanentId;
        const effectData = (e as any).effectData;
        
        try {
          // Check if this trigger is already on the stack (idempotency for replay)
          const existingTrigger = (ctx.state.stack || []).find((s: any) => s.id === triggerId);
          if (existingTrigger) {
            debug(1, `applyEvent(pushTriggeredAbility): trigger ${triggerId} already on stack, skipping (replay idempotency)`);
            break;
          }
          
          ctx.state.stack = ctx.state.stack || [];
          ctx.state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: controllerId,
            source: sourceId,
            sourceName: sourceName,
            description: description,
            triggerType: triggerType,
            effect: effect,
            mandatory: typeof mandatory === 'boolean' ? mandatory : true,
            ...(typeof value !== 'undefined' ? { value } : null),
            ...(permanentId ? { permanentId } : null),
            ...(typeof requiresChoice === 'boolean' ? { requiresChoice } : null),
            ...(typeof requiresTarget === 'boolean' ? { requiresTarget } : null),
            ...(targetType ? { targetType } : null),
            ...(targetConstraint ? { targetConstraint } : null),
            ...(typeof needsTargetSelection === 'boolean' ? { needsTargetSelection } : null),
            ...(typeof isModal === 'boolean' ? { isModal } : null),
            ...(Array.isArray(modalOptions) ? { modalOptions } : null),
            ...(targetPlayer ? { targetPlayer } : null),
            ...(defendingPlayer ? { defendingPlayer } : null),
            ...(triggeringPlayer != null ? { triggeringPlayer } : null),
            ...(typeof activatedAbilityIsManaAbility === 'boolean' ? { activatedAbilityIsManaAbility } : null),
            ...(triggeringStackItemId ? { triggeringStackItemId } : null),
            ...(triggeringPermanentId ? { triggeringPermanentId } : null),
            ...(effectData && typeof effectData === 'object' ? { effectData } : null),
          } as any);
          
          debug(2, `[applyEvent] Pushed triggered ability: ${sourceName} - ${description}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(pushTriggeredAbility): failed", err);
        }
        break;
      }

      case "sacrificeWhenYouDoResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability');
          const sourcePermanentId = (e as any).sourcePermanentId;
          const sacrificedPermanentId = String((e as any).sacrificedPermanentId || '').trim();
          const damage = Number((e as any).damage || 0);
          const lifeGain = Number((e as any).lifeGain || 0);
          const triggerId = String((e as any).triggerId || '').trim();
          const description = String((e as any).description || `${sourceName} deals ${damage} damage to any target and you gain ${lifeGain} life.`).trim();

          if (sacrificedPermanentId) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const stillOnBattlefield = battlefield.some((perm: any) => perm && String(perm.id || '') === sacrificedPermanentId);
            if (stillOnBattlefield) {
              sacrificePermanent({ ...(ctx as any), zones: ctx.state?.zones } as any, sacrificedPermanentId, playerId);
            }
          }

          if (triggerId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const existingTrigger = (ctx.state.stack as any[]).find((item: any) => item && String(item.id || '') === triggerId);
            if (!existingTrigger) {
              (ctx.state.stack as any[]).push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: sourcePermanentId || null,
                ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
                sourceName,
                description,
                effect: description,
                mandatory: true,
                requiresTarget: true,
                targetType: 'any_target',
              } as any);
            }

            if ((ctx as any).gameId) {
              const queue = ResolutionQueueManager.getQueue((ctx as any).gameId);
              const existingTargetStep = queue.steps.find((step: any) =>
                step &&
                String((step as any).type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                String((step as any).sourceId || '') === triggerId &&
                Array.isArray((step as any).targetTypes) &&
                (step as any).targetTypes.includes('any_target')
              );

              if (!existingTargetStep) {
                const validAnyTarget = [
                  ...((ctx.state.players || []) as any[]).map((player: any) => ({
                    id: player.id,
                    label: player.name || player.id,
                    description: 'player',
                  })),
                  ...((ctx.state.battlefield || []) as any[]).map((perm: any) => ({
                    id: perm.id,
                    label: perm.card?.name || 'Permanent',
                    description: perm.card?.type_line || 'permanent',
                    imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
                  })),
                ];

                ResolutionQueueManager.addStep((ctx as any).gameId, {
                  type: ResolutionStepType.TARGET_SELECTION,
                  playerId: playerId as any,
                  description: `Choose any target for ${sourceName}`,
                  mandatory: true,
                  sourceId: triggerId,
                  sourceName,
                  validTargets: validAnyTarget,
                  targetTypes: ['any_target'],
                  minTargets: 1,
                  maxTargets: 1,
                  targetDescription: 'any target',
                } as any);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeWhenYouDoResolve): failed', err);
        }
        break;
      }

      case "resolveTriggeredAbility": {
        // Resolve a triggered ability - execute its effect
        const triggerId = (e as any).triggerId;
        const effect = (e as any).effect;
        const controllerId = (e as any).controllerId;
        const sourceName = (e as any).sourceName;
        
        try {
          // The actual effect execution is handled by resolveTopOfStack
          // This event just records that the trigger was resolved
          debug(2, `[applyEvent] Resolved triggered ability: ${sourceName} - ${effect}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(resolveTriggeredAbility): failed", err);
        }
        break;
      }

      case "executeEffect": {
        // Execute a game effect (token creation, life change, draw, mill, etc.)
        const effectType = (e as any).effectType;
        const controllerId = (e as any).controllerId;
        const targetId = (e as any).targetId;
        const amount = (e as any).amount;
        const tokenData = (e as any).tokenData;
        
        try {
          switch (effectType) {
            case 'createToken': {
              if (tokenData) {
                ctx.state.battlefield = ctx.state.battlefield || [];
                const tokenId = tokenData.id || `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const typeLine = String(tokenData.typeLine || '');
                const isCreature = typeLine.toLowerCase().includes('creature');
                
                // Check if token already exists (replay idempotency)
                const existingToken = ctx.state.battlefield.find((p: any) => p.id === tokenId);
                if (existingToken) {
                  debug(1, `applyEvent(executeEffect/createToken): token ${tokenId} already exists, skipping`);
                  break;
                }
                
                ctx.state.battlefield.push({
                  id: tokenId,
                  controller: controllerId,
                  owner: controllerId,
                  tapped: false,
                  counters: {},
                  basePower: tokenData.power,
                  baseToughness: tokenData.toughness,
                  summoningSickness: isCreature && !tokenData.hasHaste,
                  isToken: true,
                  card: {
                    id: tokenId,
                    name: tokenData.name,
                    type_line: typeLine,
                    power: String(tokenData.power),
                    toughness: String(tokenData.toughness),
                    colors: tokenData.colors || [],
                    oracle_text: tokenData.abilities?.join(', ') || '',
                    keywords: tokenData.abilities || [],
                    zone: 'battlefield',
                  },
                } as any);
                debug(2, `[applyEvent] Created token: ${tokenData.name} for ${controllerId}`);
              }
              break;
            }
            case 'gainLife':
            case 'loseLife': {
              const player = (ctx.state.players || []).find((p: any) => p.id === targetId);
              if (player) {
                const delta = effectType === 'gainLife' ? amount : -amount;
                ctx.state.life = ctx.state.life || {};
                ctx.state.life[targetId] = (ctx.state.life[targetId] ?? 40) + delta;
                player.life = ctx.state.life[targetId];
                debug(1, `[applyEvent] ${targetId} ${effectType === 'gainLife' ? 'gained' : 'lost'} ${amount} life`);
              }
              break;
            }
            case 'drawCard': {
              // Draw is handled by drawCards, just bump seq
              break;
            }
            case 'mill': {
              const zones = ctx.state.zones?.[targetId] as any;
              if (zones?.library && Array.isArray(zones.library)) {
                for (let i = 0; i < amount && zones.library.length > 0; i++) {
                  const milledCard = zones.library.shift();
                  if (milledCard) {
                    zones.graveyard = zones.graveyard || [];
                    milledCard.zone = 'graveyard';
                    zones.graveyard.push(milledCard);
                    recordCardPutIntoGraveyardThisTurn(ctx as any, String(targetId), milledCard, { fromBattlefield: false });
                  }
                }
                zones.libraryCount = zones.library.length;
                zones.graveyardCount = (zones.graveyard || []).length;
                debug(2, `[applyEvent] ${targetId} milled ${amount} card(s)`);
              }
              break;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(executeEffect): failed", err);
        }
        break;
      }

      case "foretellCard": {
        // Foretell: exile a card from hand face-down
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const foretoldCardData = (e as any).card;
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          // Remove card from hand
          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;
          
          // Add to exile with foretell data
          z.exile = z.exile || [];
          if (foretoldCardData) {
            (z.exile as any[]).push(foretoldCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(foretellCard): failed", err);
        }
        break;
      }

      case "phaseOutPermanents": {
        // Phase out multiple permanents
        const pid = (e as any).playerId;
        const permanentIds = (e as any).permanentIds as string[] || [];
        
        try {
          const battlefield = ctx.state.battlefield || [];
          for (const permId of permanentIds) {
            const permanent = battlefield.find((p: any) => p?.id === permId);
            if (permanent && permanent.controller === pid && !permanent.phasedOut) {
              (permanent as any).phasedOut = true;
              (permanent as any).phaseOutController = pid;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(phaseOutPermanents): failed", err);
        }
        break;
      }

      case "setTriggerShortcut": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const cardName = String((e as any).cardName || '').trim().toLowerCase();
          const preference = String((e as any).preference || '').trim();
          const triggerDescriptionRaw = (e as any).triggerDescription;
          const triggerDescription = typeof triggerDescriptionRaw === 'string' ? triggerDescriptionRaw : undefined;

          if (!playerId || !cardName || !preference) break;

          const stateAny = ctx.state as any;
          stateAny.triggerShortcuts = stateAny.triggerShortcuts || {};
          stateAny.triggerShortcuts[playerId] = Array.isArray(stateAny.triggerShortcuts[playerId])
            ? stateAny.triggerShortcuts[playerId]
            : [];

          const shortcuts = stateAny.triggerShortcuts[playerId] as any[];
          const existingIndex = shortcuts.findIndex((entry: any) =>
            String(entry?.cardName || '').trim().toLowerCase() === cardName &&
            (!triggerDescription || entry?.triggerDescription === triggerDescription)
          );

          if (preference === 'ask_each_time') {
            if (existingIndex >= 0) {
              shortcuts.splice(existingIndex, 1);
            }
          } else {
            const shortcut = {
              cardName,
              playerId,
              preference,
              triggerDescription,
            };

            if (existingIndex >= 0) {
              shortcuts[existingIndex] = shortcut;
            } else {
              shortcuts.push(shortcut);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setTriggerShortcut): failed', err);
        }
        break;
      }

      case "triggerOrderResponse": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const stepId = String((e as any).stepId || '').trim();
          const orderedTriggerIds = Array.isArray((e as any).orderedTriggerIds)
            ? ((e as any).orderedTriggerIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];

          if (stepId && ctx.gameId) {
            const queue = ResolutionQueueManager.getQueue(ctx.gameId);
            if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
              ResolutionQueueManager.completeStep(ctx.gameId, stepId, {
                stepId,
                playerId: playerId as any,
                selections: orderedTriggerIds,
                cancelled: false,
                timestamp: Date.now(),
              } as any);
            }
          }

          applyTriggerOrderToStack(ctx.state, orderedTriggerIds);

          if (playerId && (ctx.state as any).pendingTriggerOrdering?.[playerId]) {
            delete (ctx.state as any).pendingTriggerOrdering[playerId];
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(triggerOrderResponse): failed', err);
        }
        break;
      }

      case "equipPermanent": {
        // Attach equipment to a creature
        const pid = (e as any).playerId;
        const equipmentId = (e as any).equipmentId;
        const targetCreatureId = (e as any).targetCreatureId;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === equipmentId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);
          
          if (equipment && targetCreature) {
            // Detach from previous creature if attached
            if (equipment.attachedTo) {
              const prevCreature = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevCreature) {
                (prevCreature as any).attachedEquipment = ((prevCreature as any).attachedEquipment || []).filter((id: string) => id !== equipmentId);
              }
            }
            
            // Attach to new creature
            equipment.attachedTo = targetCreatureId;
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
              (targetCreature as any).attachedEquipment.push(equipmentId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(equipPermanent): failed", err);
        }
        break;
      }

      case "concede": {
        // Mark player as having conceded
        const pid = (e as any).playerId;
        
        try {
          const players = ctx.state.players || [];
          const player = players.find((p: any) => p.id === pid);
          
          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Date.now();
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(concede): failed", err);
        }
        break;
      }

      case "additionalCostConfirm": {
        // Handle additional costs (discard, sacrifice) for spell casting
        const pid = (e as any).playerId;
        const costType = (e as any).costType;
        const selectedCards = (e as any).selectedCards as string[] || [];
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          if (costType === 'discard') {
            // Move cards from hand to graveyard
            let discardedCount = 0;
            for (const cardId of selectedCards) {
              const hand = Array.isArray(z.hand) ? z.hand : [];
              const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
              if (cardIndex !== -1) {
                const [card] = hand.splice(cardIndex, 1);
                z.graveyard = z.graveyard || [];
                if (card && typeof card === 'object') {
                  (z.graveyard as any[]).push({ ...card, zone: 'graveyard' });
                  discardedCount++;
                }
              }
            }
            z.handCount = Array.isArray(z.hand) ? z.hand.length : 0;
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;

            // Turn-tracking for intervening-if: a player discarded a card this turn.
            if (discardedCount > 0) {
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[String(pid)] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
          } else if (costType === 'sacrifice') {
            // Move permanents from battlefield to graveyard
            const battlefield = ctx.state.battlefield || [];
            for (const permId of selectedCards) {
              const permIndex = battlefield.findIndex((p: any) => p?.id === permId);
              if (permIndex !== -1) {
                const [perm] = battlefield.splice(permIndex, 1);
                z.graveyard = z.graveyard || [];
                if (perm && (perm as any).card) {
                  (z.graveyard as any[]).push({ ...(perm as any).card, zone: 'graveyard' });
                }
              }
            }
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(additionalCostConfirm): failed", err);
        }
        break;
      }

      case "confirmGraveyardTargets": {
        // Move cards from graveyard to another zone
        const pid = (e as any).playerId;
        const selectedCardIds = (e as any).selectedCardIds as string[] || [];
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim())
          : [];
        const destination = (e as any).destination;
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];

          let movedAny = false;
          let movedCreatureCard: any | undefined;
          
          for (const cardId of selectedCardIds) {
            const cardIndex = graveyard.findIndex((c: any) => c?.id === cardId);
            if (cardIndex === -1) continue;
            
            const [card] = graveyard.splice(cardIndex, 1);
            movedAny = true;
            const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
            if (!movedCreatureCard && tl.includes('creature')) movedCreatureCard = card;
            
            switch (destination) {
              case 'hand':
                z.hand = z.hand || [];
                (z.hand as any[]).push({ ...card, zone: 'hand' });
                z.handCount = (z.hand as any[]).length;
                break;
              case 'battlefield':
                ctx.state.battlefield = ctx.state.battlefield || [];
                const typeLine = (card.type_line || '').toLowerCase();
                const isCreature = typeLine.includes('creature');
                const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', cardId);
                ctx.state.battlefield.push({
                  id: createdPermanentId,
                  controller: pid,
                  owner: pid,
                  tapped: false,
                  counters: {},
                  basePower: isCreature ? parseInt(card.power || '0', 10) : undefined,
                  baseToughness: isCreature ? parseInt(card.toughness || '0', 10) : undefined,
                  summoningSickness: isCreature,
                  card: { ...card, zone: 'battlefield' },
                } as any);
                break;
              case 'library_top':
                const lib = ctx.libraries.get(pid) || [];
                lib.unshift({ ...card, zone: 'library' });
                ctx.libraries.set(pid, lib);
                z.libraryCount = lib.length;
                break;
              case 'library_bottom':
                const libBottom = ctx.libraries.get(pid) || [];
                libBottom.push({ ...card, zone: 'library' });
                ctx.libraries.set(pid, libBottom);
                z.libraryCount = libBottom.length;
                break;
              case 'exile':
                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;
                break;
            }
          }
          
          z.graveyardCount = graveyard.length;

          // Turn-tracking for intervening-if: a card left your graveyard this turn.
          if (movedAny) {
            try {
              recordCardLeftGraveyardThisTurn(ctx as any, String(pid), movedCreatureCard);

              const stateAny = ctx.state as any;

              // Turn-tracking for intervening-if: evidence was collected this turn.
              // Only set true on explicit positive evidence from persisted events.
              const evidenceCollected = (e as any)?.evidenceCollected === true;
              const purpose = String((e as any)?.purpose || '').toLowerCase();
              if (evidenceCollected || (purpose === 'collectevidence' && String(destination).toLowerCase() === 'exile')) {
                stateAny.evidenceCollectedThisTurn = stateAny.evidenceCollectedThisTurn || {};
                stateAny.evidenceCollectedThisTurnByPlayer = stateAny.evidenceCollectedThisTurnByPlayer || {};
                stateAny.evidenceCollectedThisTurnByPlayerCounts = stateAny.evidenceCollectedThisTurnByPlayerCounts || {};
                stateAny.evidenceCollectedThisTurn[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayer[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] = (stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmGraveyardTargets): failed", err);
        }
        break;
      }

      case "confirmForbiddenOrchardTarget": {
        try {
          const targetOpponentId = String((e as any).targetOpponentId || '').trim();
          const permanentId = String((e as any).permanentId || 'forbidden_orchard').trim() || 'forbidden_orchard';
          if (!targetOpponentId) break;

          ctx.state.battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const tokenId = generateDeterministicId(ctx, 'token_forbidden_orchard', `${permanentId}:${targetOpponentId}`);
          const spiritToken = {
            id: tokenId,
            controller: targetOpponentId,
            owner: targetOpponentId,
            tapped: false,
            summoningSickness: true,
            counters: {},
            card: {
              id: tokenId,
              name: 'Spirit',
              type_line: 'Token Creature — Spirit',
              oracle_text: '',
              mana_cost: '',
              cmc: 0,
              colors: [],
            },
            basePower: 1,
            baseToughness: 1,
            isToken: true,
          };
          (ctx.state.battlefield as any[]).push(spiritToken);
          triggerETBEffectsForToken(ctx as any, spiritToken as any, targetOpponentId as PlayerID);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmForbiddenOrchardTarget): failed", err);
        }
        break;
      }

      case "opponentMayPayResolve": {
        try {
          applyOpponentMayPayResolve(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(opponentMayPayResolve): failed', err);
        }
        break;
      }
      
      case "colorChoice": {
        // Player chose a color for a permanent or spell (e.g., Brave the Elements)
        try {
          const { permanentId, spellId, color } = e as any;
          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const stackItem = stack.find((item: any) =>
            item && (String(item.id || '') === String(spellId || '') || String(item.cardId || '') === String(spellId || ''))
          );

          if (stackItem && color) {
            (stackItem as any).chosenColor = color;
            debug(2, `[applyEvent] Applied spell color choice: ${stackItem.card?.name || stackItem.sourceName || spellId} -> ${color}`);
            ctx.bumpSeq();
            break;
          }

          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            (permanent as any).chosenColor = color;
            debug(2, `[applyEvent] Applied color choice: ${permanent.card?.name} -> ${color}`);
          } else {
            debugWarn(2, `[applyEvent] colorChoice: target not found (permanent=${permanentId}, spell=${spellId})`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(colorChoice): failed", err);
        }
        break;
      }
      
      case "cardNameChoice": {
        // Player chose a card name for a permanent (e.g., Pithing Needle, Runed Halo)
        try {
          const { playerId, permanentId, chosenName } = e as any;
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            (permanent as any).chosenCardName = chosenName;
            debug(2, `[applyEvent] Applied card name choice: ${permanent.card?.name} -> ${chosenName}`);
          } else {
            debugWarn(2, `[applyEvent] cardNameChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cardNameChoice): failed", err);
        }
        break;
      }
      
      case "playerChoice": {
        // Player chose a player for a permanent (e.g., Xantcha, Curses)
        try {
          const { playerId, permanentId, chosenPlayer } = e as any;
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            (permanent as any).chosenPlayer = chosenPlayer;
            debug(2, `[applyEvent] Applied player choice: ${permanent.card?.name} -> ${chosenPlayer}`);
          } else {
            debugWarn(2, `[applyEvent] playerChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playerChoice): failed", err);
        }
        break;
      }

      case "playerSelection": {
        try {
          const choosingPlayerId = String((e as any).choosingPlayerId || '');
          const selectedPlayerId = String((e as any).selectedPlayerId || '');
          const effectType = String((e as any).effectType || (e as any).effectData?.type || '');
          const permanentId = String((e as any).permanentId || (e as any).effectData?.permanentId || '');
          const effectData = ((e as any).effectData || {}) as any;
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);

          if (effectType === 'set_chosen_player') {
            if (permanent) {
              (permanent as any).chosenPlayer = selectedPlayerId;
            } else {
              debugWarn(2, `[applyEvent] playerSelection(set_chosen_player): permanent ${permanentId} not found`);
            }
            ctx.bumpSeq();
            break;
          }

          if (effectType === 'control_change') {
            if (permanent) {
              permanent.controller = selectedPlayerId;
              delete (permanent as any).pendingPlayerSelection;

              if (effectData.goadsOnChange === true && choosingPlayerId) {
                const goadedBy = (permanent as any).goadedBy || [];
                const goadedUntil = (permanent as any).goadedUntil || {};
                if (!goadedBy.includes(choosingPlayerId)) {
                  (permanent as any).goadedBy = [...goadedBy, choosingPlayerId];
                }
                const persistedGoadExpiryTurn = Number((e as any).goadExpiryTurn ?? 0);
                if (persistedGoadExpiryTurn > 0) {
                  (permanent as any).goadedUntil = {
                    ...goadedUntil,
                    [choosingPlayerId]: persistedGoadExpiryTurn,
                  };
                }
              }

              if (effectData.mustAttackEachCombat === true) {
                (permanent as any).mustAttackEachCombat = true;
              }
              if (effectData.cantAttackOwner === true) {
                (permanent as any).cantAttackOwner = true;
                (permanent as any).ownerId = choosingPlayerId;
              }
            } else {
              debugWarn(2, `[applyEvent] playerSelection(control_change): permanent ${permanentId} not found`);
            }

            const drawCount = Number(effectData.drawCards || 0);
            if (choosingPlayerId && drawCount > 0) {
              drawCards(ctx as any, choosingPlayerId as any, drawCount);
            }

            ctx.bumpSeq();
            break;
          }

          debugWarn(2, `[applyEvent] playerSelection: unsupported effectType ${effectType}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(playerSelection): failed', err);
        }
        break;
      }

      case "exchangeTextBoxes": {
        try {
          const battlefield = ctx.state.battlefield || [];
          const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
          const targetPermanentId = String((e as any).targetPermanentId || '').trim();
          const exchanged = exchangePermanentOracleText(battlefield as any, sourcePermanentId, targetPermanentId);
          if (!exchanged) {
            debugWarn(2, `[applyEvent] exchangeTextBoxes: permanent(s) not found (${sourcePermanentId}, ${targetPermanentId})`);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(exchangeTextBoxes): failed', err);
        }
        break;
      }

      case "voteSubmit": {
        try {
          const voteId = String((e as any).voteId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const choice = String((e as any).choice || '').trim();
          const voteCountRaw = Number((e as any).voteCount ?? 1);
          const voteCount = Number.isFinite(voteCountRaw) && voteCountRaw > 0 ? Math.floor(voteCountRaw) : 1;
          const persistedChoices = Array.isArray((e as any).choices)
            ? ((e as any).choices as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (!voteId || !playerId || !choice) {
            debugWarn(2, `[applyEvent] voteSubmit: invalid payload voteId=${voteId} playerId=${playerId} choice=${choice}`);
            break;
          }

          const stateAny = ctx.state as any;
          stateAny.activeVotes = stateAny.activeVotes || {};

          if (!stateAny.activeVotes[voteId]) {
            stateAny.activeVotes[voteId] = {
              choices: persistedChoices.length > 0 ? [...persistedChoices] : [],
              votes: [],
            };
          }

          const activeVote = stateAny.activeVotes[voteId];
          if (!Array.isArray(activeVote.choices)) {
            activeVote.choices = [];
          }
          if (persistedChoices.length > 0) {
            activeVote.choices = [...persistedChoices];
          }
          if (!activeVote.choices.includes(choice)) {
            activeVote.choices.push(choice);
          }
          if (!Array.isArray(activeVote.votes)) {
            activeVote.votes = [];
          }

          activeVote.votes.push({
            playerId,
            choice,
            voteCount,
          });

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(voteSubmit): failed', err);
        }
        break;
      }
      
      case "optionChoice": {
        // Player chose an option for a permanent (e.g., "flying or first strike")
        try {
          const { permanentId, chosenOption } = e as any;
          const chosenOptions = Array.isArray((e as any).chosenOptions)
            ? ((e as any).chosenOptions as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            if (chosenOptions.length > 1) {
              delete (permanent as any).chosenOption;
              (permanent as any).chosenOptions = chosenOptions;
              debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${chosenOptions.join(', ')}`);
            } else {
              const resolvedChoice = chosenOptions[0] || String(chosenOption || '').trim();
              if (resolvedChoice) {
                delete (permanent as any).chosenOptions;
                (permanent as any).chosenOption = resolvedChoice;
                debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${resolvedChoice}`);
              }
            }
          } else {
            debugWarn(2, `[applyEvent] optionChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(optionChoice): failed", err);
        }
        break;
      }

      default: {
        // Log unknown events but don't fail - they may be newer events not yet supported
        // or events that don't affect core game state
        break;
      }
    }
  } catch (err) {
    debugWarn(1, "applyEvent: failed to apply event", (e as any).type, err);
  }
}

/**
 * Replay a sequence of persisted events into ctx.
 * Special-case passPriority events to call passPriority directly for safety.
 * 
 * Also handles backward compatibility for old games that don't have explicit
 * shuffleLibrary/drawCards events after setCommander.
 */
export function replay(ctx: GameContext, events: GameEvent[]) {
  if (!Array.isArray(events)) return;
  
  // Set replay mode flag to prevent side effects in functions like nextStep
  // This ensures that actions like drawing cards during draw step aren't duplicated
  // when explicit drawCards events are also in the event log
  (ctx as any).isReplaying = true;
  
  try {
    // Ensure any stale per-game resolution steps are cleared before rebuilding state.
    // The queue is not persisted in the event log, so it must not leak across reset/replay.
    try {
      if (ctx?.gameId) {
        ResolutionQueueManager.clearAllSteps(ctx.gameId);
      }
    } catch {
      // best-effort only
    }

    // Track which players have shuffle/draw events anywhere in the event list
    // This is used to detect old-style games that don't have explicit shuffle/draw events
    // and need backward compatibility handling
    const playersWithShuffleEvent = new Set<string>();
    const playersWithDrawEvent = new Set<string>();
    const playersWithSetCommander = new Set<string>();
    
    // First pass: detect which players have which event types
    for (const e of events) {
      if (!e || typeof e.type !== "string") continue;
      
      const pid = (e as any).playerId as string | undefined;
      if (!pid) continue;
      
      if (e.type === "setCommander") {
        playersWithSetCommander.add(pid);
      } else if (e.type === "shuffleLibrary") {
        playersWithShuffleEvent.add(pid);
      } else if (e.type === "drawCards") {
        playersWithDrawEvent.add(pid);
      }
    }
    
    // Second pass: apply events
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.type !== "string") continue;

      // Provide a small amount of lookahead context for replay-only behaviors.
      // This is used to avoid double-applying implicit state transitions when
      // an explicit event follows (e.g., nextStep calling nextTurn vs a nextTurn event).
      try {
        (ctx as any)._replayCurrentEventType = e.type;
        (ctx as any)._replayNextEventType = (events[i + 1] as any)?.type;
      } catch {
        // ignore
      }

      if (e.type === "passPriority") {
        try {
          if (typeof passPriority === "function")
            passPriority(ctx as any, (e as any).by);
        } catch (err) {
          debugWarn(1, "replay: passPriority failed", err);
        }
        continue;
      }
      applyEvent(ctx, e);
      
      // Backward compatibility: if setCommander was called and there are no
      // shuffleLibrary/drawCards events FOR THIS PLAYER in the event list, do them now
      // This handles old games that don't have explicit shuffle/draw events after setCommander
      if (e.type === "setCommander") {
        const pid = (e as any).playerId;
        const needsShuffle = !playersWithShuffleEvent.has(pid);
        const needsDraw = !playersWithDrawEvent.has(pid);
        
        if (needsShuffle || needsDraw) {
          // Check if hand is empty (meaning opening draw hasn't happened)
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          const handCount = z
            ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0))
            : 0;
          
          if (handCount === 0) {
            debug(1, "[replay] Backward compat: performing opening draw after setCommander for", pid);
            try {
              if (needsShuffle) {
                shuffleLibrary(ctx as any, pid);
              }
              if (needsDraw) {
                drawCards(ctx as any, pid, 7);
              }
            } catch (err) {
              debugWarn(1, "[replay] Backward compat: opening draw failed for", pid, err);
            }
          }
        }
      }
    }

    try {
      reconcileZonesConsistency(ctx as any);
    } catch (err) {
      /* swallow */
    }
  } finally {
    // Clear replay mode flag when done
    (ctx as any).isReplaying = false;
    try {
      delete (ctx as any)._replayCurrentEventType;
      delete (ctx as any)._replayNextEventType;
    } catch {
      // ignore
    }
  }
}


