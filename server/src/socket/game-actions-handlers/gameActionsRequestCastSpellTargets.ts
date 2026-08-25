/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: requestCastSpellForSocket Aura / target compute plus forced
 * Mutate target selection, then the with-targets TARGET_SELECTION queue
 * (CR 601.2c). Returns a continue-token for the no-target payment queue.
 *
 * Public entry symbols: tryComputeRequestCastSpellTargets.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { getValidMutateTargets } from "../../state/modules/alternate-costs.js";
import { calculateWebSlingingOptions } from "../../state/modules/keywordCastMechanics.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { calculateSneakOptions } from "../../state/modules/sneakCastUtils.js";
import {
  canPermanentBeTargetedByPlayer,
  categorizeSpellWithoutPrimaryRetirement,
  evaluateTargeting,
  parseTargetRequirements,
} from "../../rules-engine/targeting";
import { debug } from "../../utils/debug.js";
import { getPlayerName } from "../util";
import { calculateHarmonizeOptions } from "./gameActionsAdditionalCastCosts.js";
import { calculateConvokeOptions } from "./gameActionsCastCostReduction.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { buildPendingCastCostMetadata } from "./gameActionsCastCostFormatting.js";
import {
  buildCommandZonePaymentCostAdjustment,
  getPendingCastPaymentFields,
} from "./gameActionsCommandZoneAndAlternateCastCosts.js";
import type { RequestCastSpellCandidateZoneArgs } from "./gameActionsRequestCastSpellCandidateZone.js";
import { tryQueueRequestCastSpellWithTargets } from "./gameActionsRequestCastSpellWithTargets.js";
import {
  buildGroupedSpellTargetMetadata,
  buildSpellTargetListFromRequirements,
  buildSpellTargetSelectionClauses,
  mapSpellTargetRefToDisplay,
  resolveTargetCount,
  shouldPreferParsedTargetReqs,
} from "./gameActionsSpellTargetSelection.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type RequestCastSpellTargetsArgs = {
  io: Server;
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  cardInHand: any;
  cardForCast: any;
  oracleText: string;
  oracleTextRaw: string;
  resolvedManaCost: string;
  manaCost: string;
  entwineCost: string | undefined;
  spellModeAdditionalCost: string | undefined;
  chosenXValue: number | undefined;
  chosenTimesKicked: number | undefined;
  selectedFaceIndex: number | undefined;
  castSourceZone: SpellCastSourceZone;
  commanderCandidate: any;
  isFreeCast: boolean;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  options: RequestCastSpellCandidateZoneArgs["options"];
  hand: any[];
  giftInfo: any;
  giftPromised: boolean;
  giftRecipient: string | undefined;
  giftType: string | undefined;
  spellTypeLine: string;
  isInstantOrSorcery: boolean;
  isForcedMutate: boolean;
};

export type RequestCastSpellTargetsContinue = {
  kind: "continue";
  effectId: string;
};

export function tryComputeRequestCastSpellTargets(
  args: RequestCastSpellTargetsArgs,
): RequestCastSpellTargetsContinue | void {
  const {
    io,
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardName,
    cardInHand,
    cardForCast,
    oracleText,
    oracleTextRaw,
    resolvedManaCost,
    manaCost,
    entwineCost,
    spellModeAdditionalCost,
    chosenXValue,
    chosenTimesKicked,
    selectedFaceIndex,
    castSourceZone,
    commanderCandidate,
    isFreeCast,
    bypassExilePermissionCheck,
    ignoreTimingRestrictions,
    options,
    hand,
    giftInfo,
    giftPromised,
    giftRecipient,
    giftType,
    spellTypeLine,
    isInstantOrSorcery,
    isForcedMutate,
  } = args;
    // Check if this spell requires targets
    const isAura = spellTypeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
    const spellSpec = (isInstantOrSorcery && !isAura) ? categorizeSpellWithoutPrimaryRetirement(cardName, oracleText) : null;
    const targetReqs = (isInstantOrSorcery && !isAura) ? parseTargetRequirements(oracleText, {
      xValue: chosenXValue,
      gameState: game.state,
      controllerId: String(playerId),
      sourceName: cardName,
    }) : null;
    const preferParsedTargetReqs = shouldPreferParsedTargetReqs(targetReqs);

    // Auras always choose exactly one host when cast (CR 303.4). Do not derive
    // counts from instant/sorcery targetReqs � those are null for Auras and would
    // emit minTargets/maxTargets 0, which makes the client show not-allowed on every
    // host and blocks selection (Fertile Ground / Enchant land, etc.).
    const requiredMinTargets = isAura
      ? 1
      : spellSpec && !preferParsedTargetReqs
        ? resolveTargetCount(spellSpec.minTargets, (spellSpec as any).minTargetsIsX === true, chosenXValue)
        : resolveTargetCount(targetReqs?.minTargets, (targetReqs as any)?.minTargetsIsX === true, chosenXValue);
    const requiredMaxTargets = isAura
      ? 1
      : spellSpec && !preferParsedTargetReqs
        ? resolveTargetCount(spellSpec.maxTargets, (spellSpec as any).maxTargetsIsX === true, chosenXValue)
        : resolveTargetCount(targetReqs?.maxTargets, (targetReqs as any)?.maxTargetsIsX === true, chosenXValue);

    const needsTargets = isAura || requiredMaxTargets > 0;

    const effectId = `cast_${cardId}_${Date.now()}`;

    // Forced Mutate: use dedicated mutate target selection regardless of card type.
    if (isForcedMutate) {
      const effectId = `cast_${cardId}_${Date.now()}`;
      const ctx: any = { state: game.state };
      const valid = getValidMutateTargets(ctx, playerId as any);

      if (valid.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `No valid mutate targets for ${cardName}`,
        });
        return;
      }

      const paymentMetadata = buildPendingCastCostMetadata(game, playerId, cardForCast, castSourceZone);
      const paymentCostAdjustment = castSourceZone === 'command'
        ? buildCommandZonePaymentCostAdjustment(game, playerId, cardForCast, commanderCandidate, resolvedManaCost)
        : undefined;
      const convokeOptions = calculateConvokeOptions(game, playerId, cardForCast, castSourceZone);
      const harmonizeOptions = calculateHarmonizeOptions(game, playerId, cardForCast);
      const sneakOptions = calculateSneakOptions(game, playerId, cardForCast);
      const webSlingingOptions = calculateWebSlingingOptions(game.state, playerId, cardForCast);

      (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
      (game.state as any).pendingSpellCasts[effectId] = {
        cardId,
        cardName,
        manaCost: resolvedManaCost,
        rawManaCost: manaCost,
        fromZone: castSourceZone,
        playerId,
        faceIndex: selectedFaceIndex,
        xValue: chosenXValue,
        validTargetIds: valid.map((t: any) => String(t.permanentId)),
        card: { ...cardForCast },
        forcedAlternateCostId: 'mutate',
        mutateCost: manaCost,
        ...getPendingCastPaymentFields(paymentMetadata, paymentCostAdjustment),
        convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
        harmonizeOptions: harmonizeOptions.availableCreatures.length > 0 ? harmonizeOptions.availableCreatures : undefined,
        sneakOptions: sneakOptions.availableCreatures.length > 0 ? sneakOptions : undefined,
        webSlingingOptions: webSlingingOptions.availableCreatures.length > 0 ? webSlingingOptions : undefined,
        ignoreTimingRestrictions,
        ...(giftInfo.hasGift
          ? {
              giftPromised,
              giftRecipient,
              giftType,
            }
          : {}),
        ...(options?.librarySearchStepToResume ? { librarySearchStepToResume: options.librarySearchStepToResume } : {}),
      };

      const mutateTargetStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MUTATE_TARGET_SELECTION,
        playerId: playerId as any,
        sourceId: effectId,
        sourceName: cardName,
        sourceImage: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        description: `Choose a creature to mutate onto for ${cardName}.`,
        mandatory: true,

        effectId,
        cardId,
        cardName,
        mutateCost: manaCost,
        imageUrl: cardForCast.image_uris?.small || cardForCast.image_uris?.normal || cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        validTargets: valid.map((t: any) => {
          const perm: any = (game.state.battlefield || []).find((p: any) => p && String(p.id) === String(t.permanentId));
          return {
            id: String(t.permanentId),
            name: String(t.cardName || 'Creature'),
            typeLine: String(t.typeLine || ''),
            power: t.power,
            toughness: t.toughness,
            imageUrl: t.imageUrl,
            controller: String(t.controller || ''),
            owner: String(t.owner || ''),
            isAlreadyMutated: Boolean((perm as any)?.mutatedStack),
            mutationCount: Number((perm as any)?.mutatedStack?.length || 0),
          };
        }),
      } as any);

      persistQueuedSpellCastStepContinuation(gameId, game, {
        playerId,
        cardId,
        effectId,
        pendingSpellCast: {
          ...((game.state as any).pendingSpellCasts?.[effectId] || {}),
        },
        queuedResolutionStep: {
          ...(mutateTargetStep as any),
        },
      });

      debug(2, `[requestCastSpell] Added MUTATE_TARGET_SELECTION step to Resolution Queue for ${cardName} (effectId: ${effectId}, ${valid.length} valid targets)`);
      return;
    }

    if (needsTargets) {
      const multiTargetClauses = !isAura
        ? buildSpellTargetSelectionClauses(game, String(playerId), cardName, oracleText, chosenXValue)
        : [];
      let validTargetList: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];

      if (multiTargetClauses.length > 1) {
        const failingClause = multiTargetClauses.find((clause) => clause.validTargetList.length < clause.minTargets);
        if (failingClause) {
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardName} (${failingClause.targetDescription})`,
          });
          return;
        }

        validTargetList = multiTargetClauses
          .flatMap((clause) => clause.validTargetList)
          .filter((target, index, all) => all.findIndex((candidate) => String(candidate.id) === String(target.id)) === index);
      } else if (isAura) {
        const auraMatch = oracleText.match(/enchant\s+(creature|permanent|player|artifact|land|opponent|enchantment)/i);
        const auraTargetType = auraMatch ? auraMatch[1].toLowerCase() : 'creature';

        if (auraTargetType === 'player' || auraTargetType === 'opponent') {
          validTargetList = (game.state.players || [])
            .filter((p: any) => auraTargetType !== 'opponent' || p.id !== playerId)
            .map((p: any) => ({
              id: p.id,
              kind: 'player',
              name: p.name || p.id,
              isOpponent: p.id !== playerId,
            }));
        } else {
          validTargetList = (game.state.battlefield || [])
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              if (auraTargetType === 'permanent') {
                // keep all permanents
              } else if (!tl.includes(auraTargetType)) {
                return false;
              }
              return canPermanentBeTargetedByPlayer(p, game.state, playerId as PlayerID);
            })
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              typeLine: p.card?.type_line,
            }));
        }
      } else if (spellSpec && !preferParsedTargetReqs) {
        const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
        validTargetList = validRefs.map((t: any) => mapSpellTargetRefToDisplay(game, String(playerId), t));
      } else if (targetReqs) {
        validTargetList = buildSpellTargetListFromRequirements(game, String(playerId), targetReqs);
      }

      const groupedTargetResult = buildGroupedSpellTargetMetadata(
        game,
        String(playerId),
        targetReqs,
        validTargetList,
      );
      const targetGrouping = groupedTargetResult.metadata;
      if (groupedTargetResult.missingRequiredPlayerIds.length > 0) {
        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: `Cannot cast ${cardName}: no legal target for ${groupedTargetResult.missingRequiredPlayerIds
            .map((id) => getPlayerName(game, id))
            .join(', ')}`,
        });
        return;
      }
      const groupedMinTargets = targetGrouping
        ? targetGrouping.groups.reduce((sum: number, group: any) => sum + Number(group.minTargets || 0), 0)
        : requiredMinTargets;
      const groupedMaxTargets = targetGrouping
        ? targetGrouping.groups.reduce((sum: number, group: any) => sum + Math.min(Number(group.maxTargets || 0), group.targets.length), 0)
        : requiredMaxTargets;

      if (validTargetList.length === 0) {
        if (groupedMinTargets > 0) {
          if ((game.state as any).pendingSpellCasts?.[effectId]) {
            delete (game.state as any).pendingSpellCasts[effectId];
          }

          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardName}`,
          });
          return;
        }

        debug(2, `[requestCastSpell] ${cardName} has only optional targets and none are currently legal; continuing without target selection`);
      }

      if (!tryQueueRequestCastSpellWithTargets({
        io,
        socket,
        game,
        gameId,
        playerId,
        cardId,
        cardName,
        cardInHand,
        cardForCast,
        oracleText,
        oracleTextRaw,
        effectId,
        resolvedManaCost,
        manaCost,
        entwineCost,
        chosenXValue,
        selectedFaceIndex,
        castSourceZone,
        commanderCandidate,
        isFreeCast,
        bypassExilePermissionCheck,
        ignoreTimingRestrictions,
        options,
        hand,
        giftInfo,
        giftPromised,
        giftRecipient,
        giftType,
        validTargetList,
        targetGrouping,
        groupedMinTargets,
        groupedMaxTargets,
        isAura,
        preferParsedTargetReqs,
        targetReqs,
        spellSpec,
        multiTargetClauses,
      })) return;

    }

  return {
    kind: "continue",
    effectId,
  };
}
