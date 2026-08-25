/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: requestCastSpellForSocket timing / candidate / zone resolution
 * (payload parse, priority, split second, source-zone lookup, face selection,
 * graveyard/exile/library gates) before modes and target compute (CR 601.2a).
 *
 * Public entry symbols: tryResolveRequestCastSpellCandidateZone.
 */
import type { Server, Socket } from "socket.io";
import { hydrateCardOracleInPlace, hydrateGameStateOracleText } from "../../state/modules/cardOracleHydration.js";
import { isFreeCastIntent, resolveCastPermissionId } from "../../state/modules/castIntent.js";
import { canCastFromTop } from "../../state/modules/game-state-effects";
import {
  cardAllowsPlayerToPlayFromExile,
  cardMeetsPlayFromExileConditions,
  cleanupCardLeavingExile,
  findPlayableExileCardForPlayer,
  getPlayableFromExileDurablePermissionForCard,
} from "../../state/modules/playable-from-exile.js";
import { isPreparedCopyActive } from "../../state/modules/prepared.js";
import { debug } from "../../utils/debug.js";
import { continueCastFromGraveyardAbility } from "../interaction";
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
  applySharedCandidateFreeCastIntent,
  applySharedGraveyardCandidateMetadata,
  getDelegatedGraveyardCastAbilityId,
  getRequestedSpellCastCandidate,
} from "./gameActionsRequestedSpellCastCandidate.js";
import { normalizeSpellCastSourceZone } from "./gameActionsSpellCastTriggerDetection.js";

export type RequestCastSpellCandidateZoneArgs = {
  io: Server;
  socket: Socket;
  payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    fromZone?: unknown;
    castPermissionId?: unknown;
    permissionId?: unknown;
    graveyardPermissionId?: unknown;
  };
  options?: {
    skipPriorityCheck?: boolean;
    forcedAlternateCostId?: string;
    skipMutateModePrompt?: boolean;
    castWithoutPayingManaCost?: boolean;
    exileAfterResolution?: boolean;
    bypassExilePermissionCheck?: boolean;
    ignoreTimingRestrictions?: boolean;
    xValue?: number;
    timesKicked?: number;
    librarySearchStepToResume?: any;
  };
};

export type RequestCastSpellCandidateZoneContinue = {
  kind: "continue";
  gameId: string;
  cardId: string;
  game: any;
  playerId: string;
  phaseStr: string;
  hand: any[];
  isFreeCast: boolean;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  castSourceZone: SpellCastSourceZone;
  commanderCandidate: any;
  cardInHand: any;
  typeLine: string;
  cardForCast: any;
  selectedFaceIndex: number | undefined;
  effectiveTypeLine: string;
  topLibraryPermission: ReturnType<typeof canCastFromTop> | undefined;
  oracleTextRaw: string;
  manaCost: string;
  cardName: string;
  faceTypeLine: string;
  options: RequestCastSpellCandidateZoneArgs["options"];
};

export function tryResolveRequestCastSpellCandidateZone(
  args: RequestCastSpellCandidateZoneArgs,
): RequestCastSpellCandidateZoneContinue | void {
  const { io, socket, payload } = args;
  let { options } = args;
    const gameId = payload?.gameId;
    const cardId = payload?.cardId;
    const faceIndex = typeof payload?.faceIndex === 'number' && Number.isFinite(payload.faceIndex)
      ? payload.faceIndex
      : undefined;
    const fromZone = normalizeSpellCastSourceZone(payload?.fromZone);
    const requestedCastPermissionId = resolveCastPermissionId(payload as any) || undefined;
    if (!gameId || typeof gameId !== 'string') return;
    if (!cardId || typeof cardId !== 'string') return;

    debug(2, `[requestCastSpell] ======== REQUEST START ========`);
    debug(2, `[requestCastSpell] gameId: ${gameId}, cardId: ${cardId}, faceIndex: ${faceIndex}`);

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) {
      debug(1, `[requestCastSpell] ERROR: game or playerId not found`);
      return;
    }

    debug(2, `[requestCastSpell] playerId: ${playerId}, priority: ${game.state.priority}`);

    // Basic validation (same as castSpellFromHand)
    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    if (phaseStr === "" || phaseStr === "PRE_GAME") {
      socket.emit("error", {
        code: "PREGAME_NO_CAST",
        message: "Cannot cast spells during pre-game.",
      });
      return;
    }

    if (options?.skipPriorityCheck !== true && game.state.priority !== playerId) {
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
      socket.emit("error", { code: "NO_ZONES", message: "Zones not found" });
      return;
    }

    const hand = Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : ((zones as any).hand = []);
    const exile = Array.isArray((zones as any).exile) ? ((zones as any).exile as any[]) : ((zones as any).exile = []);
    const graveyard = Array.isArray((zones as any).graveyard) ? ((zones as any).graveyard as any[]) : ((zones as any).graveyard = []);
    const library = Array.isArray((game.libraries as any)?.get?.(playerId))
      ? ((game.libraries as any).get(playerId) as any[])
      : (Array.isArray((game.libraries as any)?.[playerId]) ? ((game.libraries as any)[playerId] as any[]) : []);

    let isFreeCast = options?.castWithoutPayingManaCost === true || options?.forcedAlternateCostId === 'free';
    const bypassExilePermissionCheck = options?.bypassExilePermissionCheck === true;
    let ignoreTimingRestrictions = options?.ignoreTimingRestrictions === true;

    let castSourceZone: SpellCastSourceZone = fromZone || 'hand';
    let commanderCandidate = castSourceZone === 'command'
      ? findCommandZoneCommanderCandidate(game, String(playerId), String(cardId))
      : undefined;

    // After reload, CZ stubs may lack mana_cost so getCommandZoneCommanderCandidates
    // excludes them. Repair oracle/cast fields and retry before failing the cast.
    if (castSourceZone === 'command' && !commanderCandidate) {
      try {
        hydrateGameStateOracleText(game.state, (game as any).libraries);
      } catch { /* best-effort */ }
      const cz = (game.state as any)?.commandZone?.[String(playerId)];
      const cards = Array.isArray(cz?.commanderCards) ? cz.commanderCards : [];
      for (const card of cards) {
        try { hydrateCardOracleInPlace(card); } catch { /* best-effort */ }
      }
      commanderCandidate = findCommandZoneCommanderCandidate(game, String(playerId), String(cardId));
      if (!commanderCandidate) {
        const bf = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        const wanted = String(cardId);
        debug(1, `[requestCastSpell] COMMAND zone cast failed after hydrate repair`, {
          cardId: wanted,
          playerId: String(playerId),
          inCommandZone: Array.isArray(cz?.inCommandZone) ? cz.inCommandZone : [],
          commanderCardIds: cards.map((c: any) => String(c?.id || '')),
          commanderManaCosts: cards.map((c: any) => String(c?.mana_cost || c?.manaCost || '')),
          stackSize: stack.length,
          stackSummary: stack.map((s: any) => ({
            type: s?.type,
            id: s?.id,
            cardId: s?.card?.id || s?.spell?.card?.id,
            sourceCardId: s?.sourceCard?.id || s?.source?.card?.id,
            name: s?.card?.name || s?.spell?.card?.name || s?.sourceCard?.name || s?.sourceName,
          })),
          bfHits: bf
            .filter((p: any) => {
              const ids = [String(p?.id || ''), String(p?.card?.id || '')];
              const name = String(p?.card?.name || '');
              const czName = String(cards.find((c: any) => String(c?.id || '') === wanted)?.name || '');
              return ids.includes(wanted) || (czName && name === czName) || p?.isCommander === true;
            })
            .map((p: any) => ({
              id: p?.id,
              cardId: p?.card?.id,
              name: p?.card?.name,
              isCommander: p?.isCommander === true,
              isToken: p?.isToken === true,
              controller: p?.controller,
            })),
        });
      }
    }

    let cardInHand: any = castSourceZone === 'command'
      ? commanderCandidate?.card
      : getPlayerSpellSourceCards(game, String(playerId), castSourceZone).find((c: any) => c && c.id === cardId);

    if (castSourceZone === 'command' && cardInHand && commanderCandidate) {
      if (commanderCandidate.commandZonePermissionCostMode) {
        (cardInHand as any).commandZonePermissionCostMode = commanderCandidate.commandZonePermissionCostMode;
      }
      if (commanderCandidate.spendManaAsThoughAnyType === true) {
        (cardInHand as any).spendManaAsThoughAnyType = true;
      }
    }

    // Allow starting the cast pipeline from exile for impulse-style effects.
    if (!cardInHand && !fromZone) {
      const exiled = findPlayableExileCardForPlayer(game.state, String(playerId) as any, String(cardId));
      if (exiled) {
        cardInHand = exiled;
        castSourceZone = 'exile';
      }
    }

    if (!cardInHand && !fromZone) {
      const graveyardCard = graveyard.find((c: any) => c && c.id === cardId);
      if (graveyardCard) {
        cardInHand = graveyardCard;
        castSourceZone = 'graveyard';
      }
    }

    if (!cardInHand) {
      debug(1, `[requestCastSpell] card not found`, {
        cardId: String(cardId),
        playerId: String(playerId),
        castSourceZone,
        fromZone: fromZone || null,
        hasCommanderCandidate: Boolean(commanderCandidate),
      });
      socket.emit("error", {
        code: castSourceZone === 'command'
          ? 'COMMANDER_NOT_IN_CZ'
          : castSourceZone === 'exile'
          ? 'CARD_NOT_IN_EXILE'
          : (castSourceZone === 'graveyard'
              ? 'CARD_NOT_IN_GRAVEYARD'
              : (castSourceZone === 'library' ? 'CARD_NOT_IN_LIBRARY' : 'CARD_NOT_FOUND')),
        message: castSourceZone === 'command'
          ? 'Commander not found in the command zone (card data may be incomplete after reload).'
          : `Card not found in ${castSourceZone}`,
      });
      return;
    }

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

      if (String((cardInHand as any)?.preparedSourcePermanentId || '').trim()) {
        if (!isPreparedCopyActive(game.state as any, cardInHand, String(playerId))) {
          const staleExileIndex = exile.findIndex((card: any) => String(card?.id || '') === String((cardInHand as any)?.id || ''));
          if (staleExileIndex !== -1) {
            const [removedCard] = exile.splice(staleExileIndex, 1);
            (zones as any).exileCount = exile.length;
            cleanupCardLeavingExile(game.state as any, removedCard);
          }

          socket.emit("error", {
            code: "PREPARED_COPY_EXPIRED",
            message: "That prepared copy is no longer available to cast.",
          });
          return;
        }
      }

      if (!bypassExilePermissionCheck && !pfeAllows && !cardAllows && !durableAllows) {
        socket.emit("error", { code: "NO_PERMISSION", message: "You don't have permission to cast that card from exile." });
        return;
      }
    }

    const typeLine = (cardInHand.type_line || "").toLowerCase();
    const layout = (cardInHand.layout || "").toLowerCase();
    const cardFaces = cardInHand.card_faces;

    if (layout === 'prepare' && Array.isArray(cardFaces) && cardFaces.length >= 2 && faceIndex === 1) {
      socket.emit("error", {
        code: "PREPARE_BACK_FACE",
        message: `${cardFaces[1]?.name || "This spell"} can't be cast directly from ${castSourceZone}. Cast the creature face first, or cast a prepared copy from exile.`,
      });
      return;
    }

    // Transform cards: only front face can be cast.
    if (layout === 'transform' && Array.isArray(cardFaces) && cardFaces.length >= 2) {
      if (faceIndex === 1) {
        socket.emit("error", {
          code: "TRANSFORM_BACK_FACE",
          message: `${cardFaces[1]?.name || "This card"} is a transform back face and cannot be cast from hand. Cast the front face (${cardFaces[0]?.name || "the card"}) instead.`,
        });
        return;
      }

      const frontFaceTypeLine = (cardFaces[0]?.type_line || "").toLowerCase();
      if (frontFaceTypeLine.includes("land")) {
        socket.emit("error", {
          code: "CANNOT_CAST_LAND",
          message: `${cardFaces[0]?.name || "This card"} is a land and cannot be cast as a spell. Use "Play Land" instead.`,
        });
        return;
      }
    }

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

    if (effectiveFaceIndex !== undefined && (!Array.isArray(cardFaces) || effectiveFaceIndex < 0 || effectiveFaceIndex >= cardFaces.length)) {
      socket.emit("error", {
        code: "INVALID_FACE_INDEX",
        message: `Invalid face index: ${effectiveFaceIndex}`,
      });
      return;
    }

    const selectedSpell = resolveSelectedSpellCard(cardInHand, effectiveFaceIndex);
    const cardForCast = selectedSpell.card;
    const selectedFaceIndex = selectedSpell.faceIndex;
    if (Number.isFinite(Number((cardInHand as any)?.squadTimesPaid))) {
      (cardForCast as any).squadTimesPaid = getRecordedSquadTimesPaid(cardInHand);
    }
    if (options?.exileAfterResolution === true) {
      (cardInHand as any).exileAfterResolution = true;
      (cardForCast as any).exileAfterResolution = true;
    }
    if (
      !isFreeCast
      && ((cardInHand as any).castWithoutPayingManaCost === true || (cardForCast as any).castWithoutPayingManaCost === true)
    ) {
      options = {
        ...options,
        castWithoutPayingManaCost: true,
        forcedAlternateCostId: options?.forcedAlternateCostId || 'free',
      };
      isFreeCast = true;
    }
    const effectiveTypeLine = String(cardForCast?.type_line || typeLine || '').toLowerCase();
    const sharedGraveyardCandidate = castSourceZone === 'graveyard' && !ignoreTimingRestrictions
      ? getRequestedSpellCastCandidate(
        game,
        String(playerId),
        String(cardId),
        cardForCast,
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

      applySharedGraveyardCandidateMetadata(cardInHand, cardForCast, sharedGraveyardCandidate);

      if (isFreeCastIntent(sharedGraveyardCandidate as any)) {
        options = {
          ...options,
          castWithoutPayingManaCost: true,
          forcedAlternateCostId: options?.forcedAlternateCostId || 'free',
        };
        isFreeCast = true;
      }

      const delegatedGraveyardCastAbilityId = getDelegatedGraveyardCastAbilityId(sharedGraveyardCandidate);
      if (delegatedGraveyardCastAbilityId) {
        continueCastFromGraveyardAbility({
          gameId,
          game,
          io,
          playerId,
          cardId,
          abilityId: delegatedGraveyardCastAbilityId,
          emitError: (payload) => socket.emit('error', payload),
        });
        return;
      }
    }

    if (effectiveTypeLine.includes("land")) {
      socket.emit("error", { code: "CANNOT_CAST_LAND", message: "Lands cannot be cast as spells." });
      return;
    }

    let topLibraryPermission: ReturnType<typeof canCastFromTop> | undefined;
    if (castSourceZone === 'library') {
      const validation = validateLibrarySpellCastAccess(
        game,
        String(playerId),
        String(cardId),
        effectiveTypeLine,
        Boolean(options?.librarySearchStepToResume),
      );
      if (validation.ok === false) {
        socket.emit('error', {
          code: validation.code,
          message: validation.message,
        });
        return;
      }

      topLibraryPermission = canCastFromTop({ state: game.state } as any, String(playerId), cardForCast);
      const sharedLibraryCandidate = getRequestedSpellCastCandidate(
        game,
        String(playerId),
        String(cardId),
        cardForCast,
        selectedFaceIndex,
        requestedCastPermissionId,
        'library',
      );
      if (
        applySharedCandidateFreeCastIntent(cardInHand, cardForCast, sharedLibraryCandidate)
        || String((topLibraryPermission as any)?.costMode || '') === 'without_paying_mana_cost'
      ) {
        (cardInHand as any).castWithoutPayingManaCost = true;
        (cardForCast as any).castWithoutPayingManaCost = true;
        options = {
          ...options,
          castWithoutPayingManaCost: true,
          forcedAlternateCostId: options?.forcedAlternateCostId || 'free',
        };
        isFreeCast = true;
      }
      if ((topLibraryPermission as any)?.spendManaAsThoughAnyType === true) {
        (cardInHand as any).spendManaAsThoughAnyType = true;
        (cardForCast as any).spendManaAsThoughAnyType = true;
      }
    }

    // Get oracle text (possibly from card face if split/adventure)
    let oracleTextRaw = cardForCast.oracle_text || "";
    const sharedGraveyardManaCost = castSourceZone === 'graveyard'
      ? String((cardForCast as any).graveyardCastManaCost || '')
      : '';
    let manaCost = isFreeCast
      ? '{0}'
      : castSourceZone === 'command'
        ? buildCommandZoneCastManaCost(cardForCast, commanderCandidate)
        : (sharedGraveyardManaCost || cardForCast.mana_cost || "");
    let cardName = cardForCast.name || "Card";
    let faceTypeLine = effectiveTypeLine;

  return {
    kind: "continue",
    gameId,
    cardId,
    game,
    playerId,
    phaseStr,
    hand,
    isFreeCast,
    bypassExilePermissionCheck,
    ignoreTimingRestrictions,
    castSourceZone,
    commanderCandidate,
    cardInHand,
    typeLine,
    cardForCast,
    selectedFaceIndex,
    effectiveTypeLine,
    topLibraryPermission,
    oracleTextRaw,
    manaCost,
    cardName,
    faceTypeLine,
    options,
  };
}
