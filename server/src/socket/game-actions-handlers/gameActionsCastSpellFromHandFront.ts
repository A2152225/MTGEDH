/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand payload parse, priority, split second,
 * source-zone lookup, face/kicker stamps, graveyard/exile/library gates, and
 * land / chosen-name rejection (CR 601.2a).
 *
 * Public entry symbols: tryResolveCastSpellFromHandFront.
 */
import type { Socket } from "socket.io";
import type { PaymentItem } from "../../../../shared/src/index.js";
import { isFreeCastIntent, resolveCastPermissionId } from "../../state/modules/castIntent.js";
import { isSpellCastingProhibitedByChosenName } from "../../state/modules/chosen-name-restrictions.js";
import { canCastFromTop } from "../../state/modules/game-state-effects";
import { normalizeKickerManaCost, parseKickerCostOptions } from "../../state/modules/kickerCostUtils.js";
import { getMultikickerChargeEntryCounters } from "../../state/modules/multikickerCastUtils.js";
import {
  cardAllowsPlayerToPlayFromExile,
  cardMeetsPlayFromExileConditions,
  findPlayableExileCardForPlayer,
  getPlayableFromExileDurablePermissionForCard,
} from "../../state/modules/playable-from-exile.js";
import { debug } from "../../utils/debug.js";
import { ensureGame } from "../util";
import { getRecordedSquadTimesPaid } from "./gameActionsAdditionalCastCosts.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import {
  resolveAdventureAwareFaceIndex,
  resolveSelectedSpellCard,
} from "./gameActionsCastFaceAndMiracleSelection.js";
import {
  buildCommandZoneCastManaCost,
  findCommandZoneCommanderCandidate,
  validateLibrarySpellCastAccess,
} from "./gameActionsCommandZoneAndAlternateCastCosts.js";
import { getPlayerSpellSourceCards } from "./gameActionsPlayerZoneCards.js";
import {
  applySharedGraveyardCandidateMetadata,
  getRequestedSpellCastCandidate,
} from "./gameActionsRequestedSpellCastCandidate.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";
import { normalizeSpellCastSourceZone } from "./gameActionsSpellCastTriggerDetection.js";

export type CastSpellFromHandFrontArgs = {
  socket: Socket;
  ensureInGameRoom: EnsureInGameRoom;
  payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    targets?: unknown;
    payment?: unknown;
    skipInteractivePrompts?: unknown;
    skipPriorityCheck?: unknown;
    xValue?: unknown;
    timesKicked?: unknown;
    alternateCostId?: unknown;
    selectedCastMode?: unknown;
    convokeTappedCreatures?: unknown;
    harmonizeTappedCreatureId?: unknown;
    sneakReturnedCreatureId?: unknown;
    webSlingingReturnedCreatureId?: unknown;
    fromZone?: unknown;
    bypassExilePermissionCheck?: unknown;
    ignoreTimingRestrictions?: unknown;
    allowLibrarySearchCast?: unknown;
    castPermissionId?: unknown;
    permissionId?: unknown;
    graveyardPermissionId?: unknown;
  };
};

export type CastSpellFromHandFrontContinue = {
  kind: "continue";
  gameId: string;
  cardId: string;
  targets: any;
  payment: PaymentItem[] | undefined;
  skipInteractivePrompts: boolean;
  skipPriorityCheck: boolean;
  xValue: number | undefined;
  alternateCostId: string | undefined;
  selectedCastMode: "normal" | "overload" | undefined;
  convokeTappedCreatures: string[] | undefined;
  harmonizeTappedCreatureId: string | undefined;
  sneakReturnedCreatureId: string | undefined;
  webSlingingReturnedCreatureId: string | undefined;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  game: any;
  playerId: string;
  delayedSpellCopiesSnapshot: any[];
  phaseStr: string;
  zones: any;
  hand: any[];
  exile: any[];
  graveyard: any[];
  castSourceZone: SpellCastSourceZone;
  sourceArr: any[];
  commandZoneCandidate: any;
  cardInHand: any;
  selectedFaceIndex: number | undefined;
  castAsAdventure: boolean | undefined;
  resolvedTimesKicked: number | undefined;
  commandZoneManaCost: string | undefined;
  typeLine: string;
};

export function tryResolveCastSpellFromHandFront(
  args: CastSpellFromHandFrontArgs,
): CastSpellFromHandFrontContinue | void {
  const { socket, ensureInGameRoom, payload } = args;
      const gameId = payload?.gameId;
      const cardId = payload?.cardId;
      const faceIndex = typeof payload?.faceIndex === 'number' && Number.isFinite(payload.faceIndex)
        ? payload.faceIndex
        : undefined;
      let targets: any = payload?.targets as any;
      const payment = Array.isArray(payload?.payment) ? (payload?.payment as PaymentItem[]) : undefined;
      const skipInteractivePrompts = payload?.skipInteractivePrompts === true;
        const skipPriorityCheck = payload?.skipPriorityCheck === true;
      const xValue = typeof payload?.xValue === 'number' && Number.isFinite(payload.xValue) ? payload.xValue : undefined;
      const timesKickedFromPayload = typeof payload?.timesKicked === 'number' && Number.isFinite(payload.timesKicked)
        ? Math.max(0, Math.floor(payload.timesKicked))
        : undefined;
      const alternateCostId = typeof payload?.alternateCostId === 'string' ? payload.alternateCostId : undefined;
      const selectedCastMode = payload?.selectedCastMode === 'normal' || payload?.selectedCastMode === 'overload'
        ? payload.selectedCastMode
        : undefined;
      const convokeTappedCreatures = Array.isArray(payload?.convokeTappedCreatures)
        ? (payload.convokeTappedCreatures.filter((id): id is string => typeof id === 'string'))
        : undefined;
      const harmonizeTappedCreatureId = typeof payload?.harmonizeTappedCreatureId === 'string'
        ? String(payload.harmonizeTappedCreatureId)
        : undefined;
      const sneakReturnedCreatureId = typeof payload?.sneakReturnedCreatureId === 'string'
        ? String(payload.sneakReturnedCreatureId)
        : undefined;
      const webSlingingReturnedCreatureId = typeof payload?.webSlingingReturnedCreatureId === 'string'
        ? String(payload.webSlingingReturnedCreatureId)
        : undefined;
      const fromZone = normalizeSpellCastSourceZone(payload?.fromZone);
      const bypassExilePermissionCheck = payload?.bypassExilePermissionCheck === true;
      let ignoreTimingRestrictions = payload?.ignoreTimingRestrictions === true;
      const allowLibrarySearchCast = payload?.allowLibrarySearchCast === true;
      const requestedCastPermissionId = resolveCastPermissionId(payload as any) || undefined;

      if (!gameId || typeof gameId !== 'string') return;
      if (!cardId || typeof cardId !== 'string') return;
      if (!ensureInGameRoom(gameId)) return;

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;
      const delayedSpellCopiesSnapshot = Array.isArray((game.state as any)?.delayedSpellCopiesThisTurn)
        ? [...(game.state as any).delayedSpellCopiesThisTurn]
        : Array.isArray((game as any).delayedSpellCopiesThisTurn)
        ? [...(game as any).delayedSpellCopiesThisTurn]
        : [];

      // DEBUG: Log incoming parameters to trace targeting loop
      debug(2, `[handleCastSpellFromHand] ======== DEBUG START ========`);
      debug(2, `[handleCastSpellFromHand] cardId: ${cardId}`);
      if (typeof faceIndex === 'number') debug(2, `[handleCastSpellFromHand] faceIndex: ${faceIndex}`);
      debug(2, `[handleCastSpellFromHand] targets: ${targets ? JSON.stringify(targets) : 'undefined'}`);
      debug(2, `[handleCastSpellFromHand] payment: ${payment ? JSON.stringify(payment) : 'undefined'}`);
      debug(2, `[handleCastSpellFromHand] skipInteractivePrompts: ${skipInteractivePrompts}`);
      debug(2, `[handleCastSpellFromHand] playerId: ${playerId}`);
      if (fromZone) debug(2, `[handleCastSpellFromHand] fromZone: ${fromZone}`);
      if (bypassExilePermissionCheck) debug(2, `[handleCastSpellFromHand] bypassExilePermissionCheck: true`);
      if (alternateCostId) debug(2, `[handleCastSpellFromHand] alternateCostId: ${alternateCostId}`);
      if (selectedCastMode) debug(2, `[handleCastSpellFromHand] selectedCastMode: ${selectedCastMode}`);
      if (convokeTappedCreatures && convokeTappedCreatures.length > 0) {
        debug(2, `[handleCastSpellFromHand] convokeTappedCreatures: ${JSON.stringify(convokeTappedCreatures)}`);
      }
      if (harmonizeTappedCreatureId) {
        debug(2, `[handleCastSpellFromHand] harmonizeTappedCreatureId: ${harmonizeTappedCreatureId}`);
      }
      if (sneakReturnedCreatureId) {
        debug(2, `[handleCastSpellFromHand] sneakReturnedCreatureId: ${sneakReturnedCreatureId}`);
      }
      if (webSlingingReturnedCreatureId) {
        debug(2, `[handleCastSpellFromHand] webSlingingReturnedCreatureId: ${webSlingingReturnedCreatureId}`);
      }
      debug(2, `[handleCastSpellFromHand] priority: ${game.state.priority}`);

      // Check if we're in PRE_GAME phase - spells cannot be cast during pre-game
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr === "" || phaseStr === "PRE_GAME") {
        socket.emit("error", {
          code: "PREGAME_NO_CAST",
          message: "Cannot cast spells during pre-game. Start the game first by claiming turn and advancing to main phase.",
        });
        return;
      }

      // Check priority - only player with priority can cast spells
      if (!skipPriorityCheck && game.state.priority !== playerId) {
        socket.emit("error", {
          code: "NO_PRIORITY",
          message: "You don't have priority",
        });
        return;
      }

      // Split Second: players can't cast spells while a split-second spell is on the stack.
      const splitSecondLockActive = Array.isArray((game.state as any)?.stack) && (game.state as any).stack.some((item: any) => {
        const c = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
        const keywords = Array.isArray(c?.keywords) ? c.keywords : [];
        const ot = String(c?.oracle_text || '').toLowerCase();
        return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || ot.includes('split second');
      });
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't cast spells while a spell with split second is on the stack.",
        });
        return;
      }

      const zones = game.state.zones?.[playerId];
      if (!zones) {
        socket.emit("error", {
          code: "NO_ZONES",
          message: "Zones not found",
        });
        return;
      }

      const hand: any[] = Array.isArray((zones as any).hand) ? (zones as any).hand : ((zones as any).hand = []);
      const exile: any[] = Array.isArray((zones as any).exile) ? (zones as any).exile : ((zones as any).exile = []);
      const graveyard: any[] = Array.isArray((zones as any).graveyard) ? (zones as any).graveyard : ((zones as any).graveyard = []);
      const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
        ? (game.libraries as any).get(playerId)
        : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);

      let castSourceZone: SpellCastSourceZone = fromZone || 'hand';
      let sourceArr: any[] = getPlayerSpellSourceCards(game, String(playerId), castSourceZone);
      let commandZoneCandidate = castSourceZone === 'command'
        ? findCommandZoneCommanderCandidate(game, String(playerId), String(cardId))
        : undefined;

      let cardInHand: any = castSourceZone === 'command'
        ? commandZoneCandidate?.card
        : sourceArr.find((c: any) => c && c.id === cardId);

      if (castSourceZone === 'command' && cardInHand && commandZoneCandidate) {
        if (commandZoneCandidate.commandZonePermissionCostMode) {
          (cardInHand as any).commandZonePermissionCostMode = commandZoneCandidate.commandZonePermissionCostMode;
        }
        if (commandZoneCandidate.spendManaAsThoughAnyType === true) {
          (cardInHand as any).spendManaAsThoughAnyType = true;
        }
      }

      if (!cardInHand && castSourceZone === 'exile') {
        const exiled = findPlayableExileCardForPlayer(game.state, String(playerId) as any, String(cardId));
        if (exiled) {
          cardInHand = exiled;
        }
      }

      // If no fromZone was specified, allow auto-detection (hand -> exile -> graveyard)
      if (!cardInHand && !fromZone) {
        const inHand = hand.find((c: any) => c && c.id === cardId);
        if (inHand) {
          cardInHand = inHand;
          castSourceZone = 'hand';
          sourceArr = hand;
        } else {
          const inExile = exile.find((c: any) => c && c.id === cardId);
          if (inExile) {
            cardInHand = inExile;
            castSourceZone = 'exile';
            sourceArr = exile;
          } else {
            const inGy = graveyard.find((c: any) => c && c.id === cardId);
            if (inGy) {
              cardInHand = inGy;
              castSourceZone = 'graveyard';
              sourceArr = graveyard;
            }
          }
        }
      }

      if (!cardInHand) {
        socket.emit("error", {
          code: castSourceZone === 'command'
            ? 'COMMANDER_NOT_IN_CZ'
            : castSourceZone === 'exile'
            ? "CARD_NOT_IN_EXILE"
            : (castSourceZone === 'graveyard'
                ? "CARD_NOT_IN_GRAVEYARD"
                : (castSourceZone === 'library' ? "CARD_NOT_IN_LIBRARY" : "CARD_NOT_IN_HAND")),
          message: castSourceZone === 'command'
            ? 'Commander not found in the command zone.'
            : `Card not found in ${castSourceZone}`,
        });
        return;
      }

      // Exile-cast permission gate (impulse draw, etc.)
      if (castSourceZone === 'exile') {
        const stateAny: any = game.state as any;
        const turnNumber = Number(stateAny?.turnNumber ?? 0);
        const pfe = stateAny?.playableFromExile?.[playerId];
        const entry = Array.isArray(pfe) ? (pfe.includes(cardId) ? true : undefined) : pfe?.[cardId];
        const pfeAllows = (typeof entry === 'number' ? entry >= turnNumber : Boolean(entry))
          && cardMeetsPlayFromExileConditions(game.state, cardInHand, String(playerId) as any);

        const cardAllows = cardAllowsPlayerToPlayFromExile(cardInHand, String(playerId) as any, turnNumber, game.state);
        const durablePermission = getPlayableFromExileDurablePermissionForCard(game.state, String(playerId) as any, cardInHand, 'cast');
        const durableAllows = Boolean(durablePermission);

        if (durableAllows && String(durablePermission?.costMode || '') === 'without_paying_mana_cost') {
          (cardInHand as any).castWithoutPayingManaCost = true;
        }
        if (durableAllows && (durablePermission?.metadata as any)?.spendManaAsThoughAnyType === true) {
          (cardInHand as any).spendManaAsThoughAnyType = true;
        }
        if (durableAllows && (
          durablePermission?.timingOverride?.asThoughFlash === true
          || durablePermission?.timingOverride?.ignoreTiming === true
        )) {
          ignoreTimingRestrictions = true;
        }

        const isForetold = Boolean((cardInHand as any)?.foretold)
          || Boolean((cardInHand as any)?.foretellCost)
          || (Boolean((cardInHand as any)?.faceDown) && /\bforetell\b/i.test(String((cardInHand as any)?.oracle_text || '')));
        if (isForetold) {
          socket.emit("error", { code: "USE_CAST_FORETOLD", message: "Use the foretell cast action for this card." });
          return;
        }

        if (!bypassExilePermissionCheck && !pfeAllows && !cardAllows && !durableAllows) {
          socket.emit("error", { code: "NO_PERMISSION", message: "You don't have permission to cast that card from exile." });
          return;
        }
      }

      const rawCardFaces = Array.isArray((cardInHand as any)?.card_faces) ? (cardInHand as any).card_faces : [];
      const adventureFace = resolveAdventureAwareFaceIndex(
        game,
        String(playerId),
        cardInHand,
        castSourceZone,
        faceIndex,
      );
      if (adventureFace.error) {
        socket.emit('error', adventureFace.error);
        return;
      }
      const effectiveFaceIndex = adventureFace.faceIndex;
      if (effectiveFaceIndex !== undefined && (!Array.isArray(rawCardFaces) || effectiveFaceIndex < 0 || effectiveFaceIndex >= rawCardFaces.length)) {
        socket.emit("error", {
          code: "INVALID_FACE_INDEX",
          message: `Invalid face index: ${effectiveFaceIndex}`,
        });
        return;
      }

      const selectedSpell = resolveSelectedSpellCard(cardInHand, effectiveFaceIndex);
      const selectedFaceIndex = selectedSpell.faceIndex;
      const castAsAdventure = selectedSpell.castAsAdventure;
      const squadTimesPaidBeforeFace = Number.isFinite(Number((cardInHand as any)?.squadTimesPaid))
        ? getRecordedSquadTimesPaid(cardInHand)
        : undefined;
      cardInHand = selectedSpell.card;
      if (squadTimesPaidBeforeFace != null) {
        (cardInHand as any).squadTimesPaid = squadTimesPaidBeforeFace;
      }
      const resolvedTimesKicked = timesKickedFromPayload != null
        ? timesKickedFromPayload
        : (Number.isFinite((cardInHand as any)?.timesKicked)
          ? Math.max(0, Math.floor(Number((cardInHand as any).timesKicked)))
          : undefined);
      if (resolvedTimesKicked != null && resolvedTimesKicked > 0) {
        (cardInHand as any).timesKicked = resolvedTimesKicked;
        (cardInHand as any).kickerPaidCount = resolvedTimesKicked;
        (cardInHand as any).wasKicked = true;
        const entryCounters = getMultikickerChargeEntryCounters(
          String(cardInHand?.oracle_text || ''),
          resolvedTimesKicked,
        );
        if (entryCounters) {
          (cardInHand as any).entersBattlefieldWithCounters = {
            ...((cardInHand as any).entersBattlefieldWithCounters || {}),
            ...entryCounters,
          };
        }
      }

      // Regular (non-multi) kicker alternate cost: stamp kicked ledger for on-cast intervening-if.
      if (alternateCostId === 'kicker' || (cardInHand as any).castWithKicker === true || (cardInHand as any).wasKicked === true) {
        (cardInHand as any).wasKicked = true;
        if (!Array.isArray((cardInHand as any).paidKickerCosts) || (cardInHand as any).paidKickerCosts.length === 0) {
          const fromPayload = Array.isArray((payload as any)?.paidKickerCosts)
            ? (payload as any).paidKickerCosts
            : Array.isArray((cardInHand as any).paidKickerCosts)
              ? (cardInHand as any).paidKickerCosts
              : parseKickerCostOptions(String(cardInHand?.oracle_text || ''));
          (cardInHand as any).paidKickerCosts = fromPayload
            .map((cost: unknown) => normalizeKickerManaCost(String(cost || '')))
            .filter(Boolean);
        }
        if (!(Number((cardInHand as any).kickerPaidCount) > 0)) {
          (cardInHand as any).kickerPaidCount = Math.max(1, ((cardInHand as any).paidKickerCosts || []).length || 1);
        }
      } else if ((cardInHand as any).wasKicked !== true && !(Number((cardInHand as any).kickerPaidCount) > 0) && !(Number((cardInHand as any).timesKicked) > 0)) {
        // Explicit unkicked so intervening-if "if it was kicked..." can return false (not null).
        (cardInHand as any).wasKicked = false;
      }
      const sharedGraveyardCandidate = castSourceZone === 'graveyard' && !ignoreTimingRestrictions
        ? getRequestedSpellCastCandidate(
          game,
          String(playerId),
          String(cardId),
          cardInHand,
          selectedFaceIndex,
          requestedCastPermissionId,
          'graveyard',
        )
        : undefined;

      if (castSourceZone === 'graveyard' && !ignoreTimingRestrictions) {
        if (!sharedGraveyardCandidate) {
          socket.emit('error', {
            code: 'NO_PERMISSION',
            message: "You don't have permission to cast that card from your graveyard.",
          });
          return;
        }

        applySharedGraveyardCandidateMetadata(cardInHand, undefined, sharedGraveyardCandidate);
        // Free intent comes from the authoritative shared candidate, not a client-supplied
        // alternateCostId='free' that previously skipped permission validation.
        if (alternateCostId === 'free' && !isFreeCastIntent(sharedGraveyardCandidate as any) && !isFreeCastIntent(cardInHand as any)) {
          socket.emit('error', {
            code: 'NO_PERMISSION',
            message: "That card cannot be cast for free from your graveyard.",
          });
          return;
        }
      }

      const commandZoneManaCost = castSourceZone === 'command'
        ? buildCommandZoneCastManaCost(cardInHand, commandZoneCandidate)
        : undefined;

      // Validate card is castable (not a land)
      const typeLine = (cardInHand.type_line || "").toLowerCase();
      if (typeLine.includes("land")) {
        socket.emit("error", {
          code: "CANNOT_CAST_LAND",
          message: "Lands cannot be cast as spells. Use playLand instead.",
        });
        return;
      }

      if (castSourceZone === 'library') {
        const validation = validateLibrarySpellCastAccess(
          game,
          String(playerId),
          String(cardId),
          cardInHand,
          allowLibrarySearchCast,
        );
        if (validation.ok === false) {
          socket.emit('error', {
            code: validation.code,
            message: validation.message,
          });
          return;
        }

        const topLibraryPermission = canCastFromTop({ state: game.state } as any, String(playerId), cardInHand);
        if (String((topLibraryPermission as any)?.costMode || '') === 'without_paying_mana_cost') {
          (cardInHand as any).castWithoutPayingManaCost = true;
        }
        if ((topLibraryPermission as any)?.spendManaAsThoughAnyType === true) {
          (cardInHand as any).spendManaAsThoughAnyType = true;
        }
      }

      // Chosen-name cast restrictions (e.g., Meddling Mage / Nevermore)
      const castRestriction = isSpellCastingProhibitedByChosenName(game.state, playerId, cardInHand.name || '');
      if (castRestriction.prohibited) {
        const blocker = castRestriction.by?.sourceName || 'an effect';
        socket.emit('error', {
          code: 'CANNOT_CAST_CHOSEN_NAME',
          message: `Spells named "${cardInHand.name || 'that card'}" can't be cast (${blocker} chose that name).`,
        });
        return;
      }

  return {
    kind: "continue",
    gameId,
    cardId,
    targets,
    payment,
    skipInteractivePrompts,
    skipPriorityCheck,
    xValue,
    alternateCostId,
    selectedCastMode,
    convokeTappedCreatures,
    harmonizeTappedCreatureId,
    sneakReturnedCreatureId,
    webSlingingReturnedCreatureId,
    bypassExilePermissionCheck,
    ignoreTimingRestrictions,
    game,
    playerId,
    delayedSpellCopiesSnapshot,
    phaseStr,
    zones,
    hand,
    exile,
    graveyard,
    castSourceZone,
    sourceArr,
    commandZoneCandidate,
    cardInHand,
    selectedFaceIndex,
    castAsAdventure,
    resolvedTimesKicked,
    commandZoneManaCost,
    typeLine,
  };
}
