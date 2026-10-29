/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: requestCastSpellForSocket sorcery-speed gate, Gift choice,
 * mode / overload / X / Miracle / Madness / Mutate cost overrides, then
 * modal and additional-cost mode prompts (CR 601.2b).
 *
 * Public entry symbols: tryPromptRequestCastSpellModes.
 */
import { opponentTurnCastProhibitionReason, zoneCastProhibitionReason } from "../../state/modules/batch31CastLocks.js"; // B31
import { isCastingLimitedToSorceryTiming } from "../../state/modules/opponentSorceryTimingLock.js"; // B31
import type { Socket } from "socket.io";
import { extractAdditionalCostModesFromOracleText } from "../../state/modules/additionalCostModeOracleText.js";
import { parseKeywordAlternateManaCost, parseMadnessCost, parseMutateCost } from "../../state/modules/alternate-costs.js";
import { spellOracleUsesTeamworkChooseBoth } from "../../state/modules/marvelMechanicsHelpers.js";
import {
  expandManaCostWithMultikicker,
  getMultikickerChargeEntryCounters,
  parseMultikickerManaCost,
} from "../../state/modules/multikickerCastUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { canCastWithSneakAtCurrentTiming } from "../../state/modules/sneakCastUtils.js";
import { extractGiftInfo, resolveGiftAwareOracleText } from "../../utils/gift.js";
import { extractModalModesForSpellCast } from "../../utils/oraclePromptContext.js";
import { debug } from "../../utils/debug.js";
import { requestCastSpellGrantsFlash } from "../requestCastSpellTimingGate.js";
import { getRecordedSquadTimesPaid, getSquadAdditionalManaCost } from "./gameActionsAdditionalCastCosts.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import {
  countXManaSymbols,
  expandManaCostWithChosenX,
} from "./gameActionsCastCostFormatting.js";
import { checkMiracle } from "./gameActionsCastFaceAndMiracleSelection.js";
import {
  adjustModalSpellInfoForCurrentCast,
  appendManaCost,
  getEntwineCostForSelectedModes,
  getOracleTextForCastMode,
  getSpellModeAdditionalCost,
} from "./gameActionsModalCastModeCosts.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";
import { computeSpellCastXUpperBound } from "./spellCastXUpperBound.js";
import type { RequestCastSpellCandidateZoneArgs } from "./gameActionsRequestCastSpellCandidateZone.js";

export type RequestCastSpellModesArgs = {
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  cardForCast: any;
  cardName: string;
  selectedFaceIndex: number | undefined;
  castSourceZone: SpellCastSourceZone;
  commanderCandidate: any;
  ignoreTimingRestrictions: boolean;
  isFreeCast: boolean;
  options: RequestCastSpellCandidateZoneArgs["options"];
  oracleTextRaw: string;
  manaCost: string;
  faceTypeLine: string;
  effectiveTypeLine: string;
  typeLine: string;
  topLibraryPermission: any;
  bypassExilePermissionCheck: boolean;
  phaseStr: string;
};

export type RequestCastSpellModesContinue = {
  kind: "continue";
  giftInfo: ReturnType<typeof extractGiftInfo>;
  giftPromised: boolean;
  giftRecipient: string | undefined;
  giftType: string | undefined;
  oracleText: string;
  spellModeAdditionalCost: string | undefined;
  entwineCost: string | undefined;
  chosenXValue: number | undefined;
  chosenTimesKicked: number | undefined;
  manaCost: string;
  isForcedMutate: boolean;
  spellTypeLine: string;
  isInstantOrSorcery: boolean;
  resolvedManaCost: string;
};

export function tryPromptRequestCastSpellModes(
  args: RequestCastSpellModesArgs,
): RequestCastSpellModesContinue | void {
  const {
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    cardForCast,
    cardName,
    selectedFaceIndex,
    castSourceZone,
    commanderCandidate,
    ignoreTimingRestrictions,
    isFreeCast,
    options,
    oracleTextRaw,
    faceTypeLine,
    effectiveTypeLine,
    typeLine,
    topLibraryPermission,
    bypassExilePermissionCheck,
    phaseStr,
  } = args;
  let { manaCost } = args;
    // B31: absolute cast locks (Grand Abolisher on the locker's turn; Grafdigger's Cage for graveyard/library casts).
    {
      const zoneForLock = String(castSourceZone || '').toLowerCase();
      const b31CastLock = opponentTurnCastProhibitionReason(game.state, String(playerId))
        || (zoneForLock.includes('graveyard') ? zoneCastProhibitionReason(game.state, String(playerId), 'graveyard') : null)
        || (zoneForLock.includes('library') ? zoneCastProhibitionReason(game.state, String(playerId), 'library') : null);
      if (b31CastLock) {
        socket.emit('error', { code: 'CAST_PROHIBITED', message: b31CastLock });
        return;
      }
    }
    // Sorcery-speed gate for requestCastSpell (hand/command/etc). Without this, payment can be
    // queued while the stack is non-empty and completeCastSpell then fails with SORCERY_TIMING
    // after the player already paid (see Anointed Procession / deferred-finalize races).
    {
      const typeForTiming = String(faceTypeLine || effectiveTypeLine || typeLine || '').toLowerCase();
      const oracleForTiming = String(cardForCast?.oracle_text || cardInHand?.oracle_text || '').toLowerCase();
      const grantsFlash = requestCastSpellGrantsFlash({
        castSourceZone,
        commanderGrantsFlash: commanderCandidate?.grantsFlash === true,
        ignoreTimingRestrictions,
        typeLine: typeForTiming,
        oracleText: oracleForTiming,
        sneakGrantsTiming: canCastWithSneakAtCurrentTiming(game, playerId, cardForCast),
        topLibraryGrantsFlash: topLibraryPermission?.grantsFlash === true,
      });
      if (!grantsFlash || (!ignoreTimingRestrictions && isCastingLimitedToSorceryTiming(game.state, String(playerId)))) { // B31 Teferi
        const stepStr = String(game.state?.step || '').toUpperCase().trim();
        const isMainPhase = phaseStr.includes('MAIN') || stepStr.includes('MAIN');
        const isYourTurn = game.state.turnPlayer === playerId;
        const stackEmpty = !game.state.stack || game.state.stack.length === 0;

        if (!isMainPhase) {
          socket.emit('error', {
            code: 'SORCERY_TIMING',
            message: "This spell can only be cast during a main phase (it doesn't have flash).",
          });
          return;
        }

        if (!isYourTurn) {
          socket.emit('error', {
            code: 'SORCERY_TIMING',
            message: "This spell can only be cast during your turn (it doesn't have flash).",
          });
          return;
        }

        if (!stackEmpty) {
          socket.emit('error', {
            code: 'SORCERY_TIMING',
            message: "This spell can only be cast when the stack is empty (it doesn't have flash).",
          });
          return;
        }
      }
    }

    const giftInfo = extractGiftInfo(oracleTextRaw);
    const transientGiftChoiceResolved = giftInfo.hasGift && (cardInHand as any).giftChoiceResolved === true;
    const transientGiftPromised = giftInfo.hasGift && (cardInHand as any).giftPromised === true;
    const transientGiftRecipient = giftInfo.hasGift ? String((cardInHand as any).giftRecipient || '').trim() : '';
    const transientGiftType = giftInfo.hasGift ? String((cardInHand as any).giftType || giftInfo.giftType || '').trim() : '';

    if (giftInfo.hasGift && !transientGiftChoiceResolved) {
      const opponents = ((game.state?.players || []) as any[])
        .filter((entry: any) => entry && String(entry.id || '') !== String(playerId))
        .filter((entry: any) => !entry.hasLost && !entry.spectator && !entry.isSpectator)
        .map((entry: any) => ({
          id: String(entry.id),
          label: `Promise ${giftInfo.giftType || 'a gift'} to ${String(entry.name || entry.id)}`,
          description: String(entry.name || entry.id),
        }));

      if (opponents.length > 0) {
        const existingGiftChoice = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((step: any) => step?.type === ResolutionStepType.OPTION_CHOICE && step?.giftCastChoice === true && String(step?.giftCardId || '') === String(cardId));

        if (!existingGiftChoice) {
          const giftChoiceStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceId: String(cardId),
            sourceName: cardName,
            sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `Choose whether to promise ${giftInfo.giftType || 'a gift'} as you cast ${cardName}.`,
            mandatory: true,
            options: [
              { id: 'gift:none', label: 'Cast without promising a gift' },
              ...opponents.map((entry) => ({
                id: `gift:${entry.id}`,
                label: entry.label,
                description: entry.description,
              })),
            ],
            minSelections: 1,
            maxSelections: 1,
            giftCastChoice: true,
            giftCardId: String(cardId),
            giftCardName: cardName,
            giftType: giftInfo.giftType,
            giftFaceIndex: selectedFaceIndex,
            giftFromZone: castSourceZone,
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(giftChoiceStep as any),
            },
          });
        }

        debug(2, `[requestCastSpell] Queued Gift choice for ${cardName}`);
        return;
      }
    }

    const giftPromised = giftInfo.hasGift ? transientGiftPromised : false;
    const giftRecipient = giftInfo.hasGift && transientGiftRecipient ? transientGiftRecipient : undefined;
    const giftType = giftInfo.hasGift ? (transientGiftType || giftInfo.giftType || undefined) : undefined;
    if (giftInfo.hasGift) {
      delete (cardInHand as any).giftChoiceResolved;
      delete (cardInHand as any).giftPromised;
      delete (cardInHand as any).giftRecipient;
      delete (cardInHand as any).giftType;
    }

    const selectedModes = Array.isArray((cardInHand as any).selectedModes)
      ? (cardInHand as any).selectedModes
      : undefined;
    const selectedAdditionalCostModes = Array.isArray((cardInHand as any).selectedAdditionalCostModes)
      ? (cardInHand as any).selectedAdditionalCostModes
      : (Array.isArray((cardInHand as any).selectedSpreeModes)
        ? (cardInHand as any).selectedSpreeModes
        : undefined);
    const baseOracleText = resolveGiftAwareOracleText(oracleTextRaw, giftInfo.hasGift ? giftPromised : undefined);
    const spellModeAdditionalCost = getSpellModeAdditionalCost(baseOracleText, selectedModes, selectedAdditionalCostModes);
    const entwineCost = getEntwineCostForSelectedModes(baseOracleText, selectedModes, cardName)
      || (((cardInHand as any).castWithEntwine === true && String((cardInHand as any).entwineCost || '').trim())
        ? String((cardInHand as any).entwineCost).trim()
        : undefined);
    // Only this request's forced alternate cost means Overload was already chosen.
    // A leftover castWithOverload on the hand card is an abandoned earlier attempt
    // (the spell never left the hand) and must not skip the Normal / Overload prompt.
    const overloadRequested = options?.forcedAlternateCostId === 'overload';
    const overloadCost = parseKeywordAlternateManaCost(baseOracleText, 'overload') || null;
    const oracleText = getOracleTextForCastMode(baseOracleText, overloadRequested, selectedModes, selectedAdditionalCostModes, cardName).toLowerCase();
    const chosenXValue = Number.isFinite(options?.xValue) ? Math.max(0, Math.floor(Number(options?.xValue))) : undefined;
    const multikickerCost = parseMultikickerManaCost(String(cardInHand?.oracle_text || oracleTextRaw || ''));
    const chosenTimesKicked = Number.isFinite(options?.timesKicked)
      ? Math.max(0, Math.floor(Number(options?.timesKicked)))
      : (Number.isFinite((cardInHand as any)?.timesKicked)
        ? Math.max(0, Math.floor(Number((cardInHand as any).timesKicked)))
        : undefined);
    if (multikickerCost && chosenTimesKicked != null && chosenTimesKicked > 0) {
      const stampMultikickerCast = (card: any) => {
        if (!card || typeof card !== 'object') return;
        card.timesKicked = chosenTimesKicked;
        card.kickerPaidCount = chosenTimesKicked;
        card.wasKicked = true;
        const entryCounters = getMultikickerChargeEntryCounters(String(card?.oracle_text || cardInHand?.oracle_text || ''), chosenTimesKicked);
        if (entryCounters) {
          card.entersBattlefieldWithCounters = {
            ...(card.entersBattlefieldWithCounters || {}),
            ...entryCounters,
          };
        }
      };
      stampMultikickerCast(cardInHand);
      stampMultikickerCast(cardForCast);
    }

    if (overloadCost && !overloadRequested) {
      if ((cardInHand as any).castWithOverload === true || (cardInHand as any).overloadCost) {
        delete (cardInHand as any).castWithOverload;
        delete (cardInHand as any).overloadCost;
        if (cardForCast && cardForCast !== cardInHand) {
          delete (cardForCast as any).castWithOverload;
          delete (cardForCast as any).overloadCost;
        }
        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          cardUpdates: {
            castWithOverload: null,
            overloadCost: null,
          },
        });
      }
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'overload');

      if (!existing) {
        const overloadModeStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODE_SELECTION,
          playerId: playerId as any,
          sourceId: cardId,
          sourceName: cardName,
          sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          description: `Choose casting mode for ${cardName}`,
          mandatory: true,
          modes: [
            {
              id: 'normal',
              label: 'Normal',
              description: `Cast ${cardName} normally.`,
            },
            {
              id: 'overload',
              label: 'Overload',
              description: `Cast ${cardName} with Overload (replaces "target" with "each").`,
            },
          ],
          minModes: 1,
          maxModes: 1,
          allowDuplicates: false,
          modeSelectionPurpose: 'overload',
          castSpellFromHandArgs: {
            cardId,
            faceIndex: selectedFaceIndex,
            fromZone: castSourceZone,
            xValue: chosenXValue,
            skipPriorityCheck: true,
          },
        } as any);

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          queuedResolutionStep: {
            ...(overloadModeStep as any),
          },
        });
      }

      debug(2, `[requestCastSpell] Queued overload mode selection for ${cardName}`);
      return;
    }

    if (overloadRequested && overloadCost) {
      manaCost = overloadCost;
    }

    // Forced alternate cost (Miracle / Madness / Mutate)
    if (options?.forcedAlternateCostId === 'miracle') {
      if (!cardInHand.isFirstDrawnThisTurn) {
        socket.emit('error', {
          code: 'NOT_FIRST_DRAWN',
          message: 'Miracle can only be cast on the first card drawn this turn',
        });
        return;
      }

      const miracleInfo = checkMiracle(cardInHand, game, playerId);
      if (!miracleInfo.hasMiracle || !miracleInfo.miracleCost) {
        socket.emit('error', {
          code: 'NO_MIRACLE',
          message: 'This card does not have miracle',
        });
        return;
      }

      manaCost = miracleInfo.miracleCost;
    }

    if (options?.forcedAlternateCostId === 'madness') {
      const madnessCost = parseMadnessCost(oracleText) || parseMadnessCost(cardInHand.oracle_text || '');
      if (!madnessCost) {
        socket.emit('error', {
          code: 'NO_MADNESS',
          message: 'This card does not have madness.',
        });
        return;
      }

      manaCost = madnessCost;
    }

    // Mutate alternate cost: override mana cost now; target selection is handled via a dedicated step.
    const isForcedMutate = options?.forcedAlternateCostId === 'mutate';
    if (isForcedMutate) {
      const mutateCost = parseMutateCost(oracleText) || parseMutateCost(cardInHand.oracle_text || '');
      if (!mutateCost) {
        socket.emit('error', { code: 'NO_MUTATE', message: 'This card does not have mutate.' });
        return;
      }
      manaCost = mutateCost;
    }

    // Effective type line for the face being cast (used by several downstream checks)
    const spellTypeLine = faceTypeLine || effectiveTypeLine || typeLine;
    const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');

    // Mutate cast mode (normal vs mutate) is chosen in the unified mana payment step via
    // extraAlternateCosts; target selection is deferred when the player picks mutate there.

    const xCount = countXManaSymbols(manaCost);

    if (xCount > 0 && chosenXValue === undefined) {
      const existingXStep = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((step: any) => step?.type === ResolutionStepType.X_VALUE_SELECTION && step?.spellCastXSelection === true && String(step?.spellCardId || '') === String(cardId));

      if (!existingXStep) {
        const xSelectionStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.X_VALUE_SELECTION,
          playerId: playerId as any,
          description: `Choose X for ${cardName}.`,
          mandatory: true,
          sourceId: String(cardId),
          sourceName: cardName,
          sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          minValue: 0,
          maxValue: computeSpellCastXUpperBound(game, String(playerId), cardForCast, manaCost, xCount, castSourceZone),
          xCount,
          spellCastXSelection: true,
          spellCardId: String(cardId),
          spellFaceIndex: selectedFaceIndex,
          spellFromZone: castSourceZone,
          spellForcedAlternateCostId: options?.forcedAlternateCostId,
          spellCastWithoutPayingManaCost: isFreeCast,
          spellBypassExilePermissionCheck: bypassExilePermissionCheck,
          spellIgnoreTimingRestrictions: ignoreTimingRestrictions,
        } as any);

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          queuedResolutionStep: {
            ...(xSelectionStep as any),
          },
        });
      }

      debug(2, `[requestCastSpell] Queued X_VALUE_SELECTION for ${cardName}`);
      return;
    }

    const additionalCostModeInfo = isInstantOrSorcery ? extractAdditionalCostModesFromOracleText(baseOracleText) : undefined;
    if (additionalCostModeInfo && (!Array.isArray(selectedAdditionalCostModes) || selectedAdditionalCostModes.length === 0)) {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) =>
          s?.type === ResolutionStepType.MODE_SELECTION &&
          String((s as any)?.sourceId || '') === String(cardId) &&
          String((s as any)?.modeSelectionPurpose || '') === additionalCostModeInfo.purpose
        );

      if (!existing) {
        const additionalCostModeStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODE_SELECTION,
          playerId: playerId as any,
          sourceId: cardId,
          sourceName: cardName,
          sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          description: baseOracleText,
          mandatory: true,
          modes: additionalCostModeInfo.options.map((mode) => ({
            id: mode.id,
            label: mode.label,
            description: `${mode.effect}${mode.cost ? ` (${mode.cost})` : ''}`,
          })),
          minModes: additionalCostModeInfo.minModes,
          maxModes: additionalCostModeInfo.maxModes,
          allowDuplicates: false,
          modeSelectionPurpose: additionalCostModeInfo.purpose,
          castSpellFromHandArgs: {
            cardId,
            faceIndex: selectedFaceIndex,
            fromZone: castSourceZone,
            xValue: chosenXValue,
            skipPriorityCheck: true,
          },
        } as any);

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          queuedResolutionStep: {
            ...(additionalCostModeStep as any),
          },
        });
      }

      debug(2, `[requestCastSpell] Queued ${additionalCostModeInfo.purpose} selection for ${cardName}`);
      return;
    }

    const modalSpellInfo = isInstantOrSorcery && !spellOracleUsesTeamworkChooseBoth(baseOracleText)
      ? adjustModalSpellInfoForCurrentCast(extractModalModesForSpellCast(baseOracleText, cardName), game.state, String(playerId), baseOracleText)
      : undefined;
    if (modalSpellInfo && (!Array.isArray(selectedModes) || selectedModes.length === 0)) {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'modalSpell');

      if (!existing) {
        const modalSpellStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODE_SELECTION,
          playerId: playerId as any,
          sourceId: cardId,
          sourceName: cardName,
          sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          description: baseOracleText,
          mandatory: true,
          modes: modalSpellInfo.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            ...(Number.isFinite(Number(option.pCost)) && Number(option.pCost) > 0
              ? { pCost: Math.floor(Number(option.pCost)) }
              : {}),
          })),
          minModes: modalSpellInfo.minModes,
          maxModes: modalSpellInfo.maxModes,
          normalMinModes: modalSpellInfo.normalMinModes,
          normalMaxModes: modalSpellInfo.normalMaxModes,
          entwineCost: modalSpellInfo.entwineCost,
          allowDuplicates: Boolean(modalSpellInfo.canRepeatModes),
          ...(Number.isFinite(Number(modalSpellInfo.pBudget)) && Number(modalSpellInfo.pBudget) > 0
            ? { pBudget: Math.floor(Number(modalSpellInfo.pBudget)), canRepeatModes: Boolean(modalSpellInfo.canRepeatModes) }
            : {}),
          modeSelectionPurpose: 'modalSpell',
          castSpellFromHandArgs: {
            cardId,
            faceIndex: selectedFaceIndex,
            fromZone: castSourceZone,
            xValue: chosenXValue,
            skipPriorityCheck: true,
          },
        } as any);

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId,
          cardId,
          queuedResolutionStep: {
            ...(modalSpellStep as any),
          },
        });
      }

      debug(2, `[requestCastSpell] Queued modal selection for ${cardName}`);
      return;
    }

    const resolvedManaCost = appendManaCost(
      expandManaCostWithMultikicker(
        expandManaCostWithChosenX(manaCost, chosenXValue),
        multikickerCost,
        chosenTimesKicked ?? 0,
      ),
      getSquadAdditionalManaCost(String(cardInHand?.oracle_text || oracleTextRaw || ''), getRecordedSquadTimesPaid(cardInHand)),
    );

  return {
    kind: "continue",
    giftInfo,
    giftPromised,
    giftRecipient,
    giftType,
    oracleText,
    spellModeAdditionalCost,
    entwineCost,
    chosenXValue,
    chosenTimesKicked,
    manaCost,
    isForcedMutate,
    spellTypeLine,
    isInstantOrSorcery,
    resolvedManaCost,
  };
}
