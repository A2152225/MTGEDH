/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: casting from somewhere other than hand at a cost other than
 * the printed one - command zone commander candidates and their tax-adjusted
 * cost, the payment fields a pending cast carries, the payment extras built for
 * keyword alternate costs (WUBRG, mutate, warp, sneak, web-slinging, free
 * commander casts), and library cast access.
 *
 * Public entry symbols: findCommandZoneCommanderCandidate,
 * buildCommandZoneCastManaCost, buildCommandZonePaymentCostAdjustment,
 * getPendingCastPaymentFields, buildAlternateCostPaymentExtrasForCast,
 * validateLibrarySpellCastAccess.
 */
import type { PlayerID } from "../../../../shared/src/index.js";
import { parseEvokeExileColor, EVOKE_EXILE_ALTERNATE_COST_ID } from "../../state/modules/evokeKeyword.js";
import { FACE_DOWN_CAST_COST, getFaceDownCastKinds } from "../../state/modules/faceDownCasting.js";
import {
  buildCommanderFreeCastPaymentExtras,
  getExternalWUBRGSource,
  hasMutateAlternateCost,
  hasSelfWUBRGAlternateCost,
  parseKeywordAlternateManaCost,
  parseWarpCost,
  parseImpendingInfo,
} from "../../state/modules/alternate-costs.js";
import {
  getCommandZoneCommanderCandidates,
  type SharedCommanderAvailabilityCandidate,
} from "../../state/modules/can-respond.js";
import { buildCostAdjustmentPlan, buildLiveSpellCostAdjustment } from "../../state/modules/cost-adjustments.js";
import { canCastFromTop } from "../../state/modules/game-state-effects";
import { calculateWebSlingingOptions } from "../../state/modules/keywordCastMechanics.js";
import { buildNormalizedManaPaymentModel } from "../../state/modules/mana-check.js";
import { canCastWithSneakAtCurrentTiming, parseSneakCost } from "../../state/modules/sneakCastUtils.js";
import { parseManaCost } from "../util";
import {
  buildPaymentCostAdjustmentPayload,
  formatManaCostWithCostAdjustment,
} from "./gameActionsCastCostFormatting.js";
import type {
  PaymentStepCostAdjustment,
  PendingCastCostMetadata,
  SpellCastSourceZone,
} from "./gameActionsCastCostReduction.js";
import { WUBRG_ALTERNATE_MANA_COST } from "./gameActionsCastFaceAndMiracleSelection.js";
import { getPlayerLibraryCards } from "./gameActionsPlayerZoneCards.js";
import { buildManaCostStringFromParsedCost } from "./gameActionsRequestedSpellCastCandidate.js";

export function findCommandZoneCommanderCandidate(
  game: any,
  playerId: string,
  commanderId: string,
): SharedCommanderAvailabilityCandidate | undefined {
  const normalizedCommanderId = String(commanderId || '').trim();
  if (!normalizedCommanderId) return undefined;

  return getCommandZoneCommanderCandidates({
    state: game?.state,
    libraries: game?.libraries,
  } as any, playerId as any).find((candidate) => String(candidate.commanderId || '').trim() === normalizedCommanderId);
}

export function buildCommandZoneCastManaCost(card: any, candidate?: SharedCommanderAvailabilityCandidate): string {
  if (!candidate) {
    return String(card?.mana_cost || '').trim();
  }

  if (candidate.cost) {
    return buildManaCostStringFromParsedCost(candidate.cost);
  }

  const baseManaCost = String(card?.mana_cost || candidate.manaCost || '').trim();
  if (!baseManaCost) return '';

  const parsedCost = parseManaCost(baseManaCost);
  return buildManaCostStringFromParsedCost({
    ...parsedCost,
    generic: parsedCost.generic + candidate.commanderTax + candidate.costAdjustment,
  });
}

export function buildCommandZonePaymentCostAdjustment(
  game: any,
  playerId: string,
  card: any,
  candidate: SharedCommanderAvailabilityCandidate | undefined,
  adjustedManaCost: string,
): PaymentStepCostAdjustment | undefined {
  if (!candidate) return undefined;

  const originalManaCost = String(card?.mana_cost || candidate.manaCost || '').trim();
  const commanderTax = Math.max(0, Number(candidate.commanderTax || 0));
  const staticAdjustment = buildLiveSpellCostAdjustment(buildCostAdjustmentPlan(game?.state, playerId, card));
  const taxMessages = [
    ...staticAdjustment.taxMessages,
    ...(commanderTax > 0 ? [`Commander tax: +{${commanderTax}}`] : []),
  ];
  const reduction = {
    generic: staticAdjustment.genericReduction,
    colors: { ...staticAdjustment.coloredReductions },
    messages: [...staticAdjustment.reductionMessages],
  };

  return buildPaymentCostAdjustmentPayload(
    originalManaCost,
    adjustedManaCost,
    reduction,
    staticAdjustment.genericTax + commanderTax,
    taxMessages,
  );
}

export function getPendingCastPaymentFields(
  metadata: PendingCastCostMetadata,
  paymentCostAdjustment?: PaymentStepCostAdjustment,
): Record<string, any> {
  const costMetadata: PendingCastCostMetadata = {
    ...metadata,
    ...(paymentCostAdjustment ? { paymentCostAdjustment } : {}),
    ...(paymentCostAdjustment && metadata.paymentModel
      ? {
          paymentModel: buildNormalizedManaPaymentModel({
            originalManaCost: metadata.paymentModel.originalManaCost,
            effectiveManaCost: paymentCostAdjustment.adjustedManaCost,
            castWithoutPayingManaCost: metadata.paymentModel.castWithoutPayingManaCost,
            forcedAlternateCostId: metadata.paymentModel.forcedAlternateCostId,
            additionalCosts: metadata.paymentModel.additionalCosts,
          }),
        }
      : {}),
  };

  return { costMetadata };
}

export function buildAlternateCostPaymentExtrasForCast(
  oracleText: string,
  castSourceZone: SpellCastSourceZone,
  paymentMetadata: PendingCastCostMetadata,
  chosenXValue?: number,
  timingContext?: { game?: any; playerId?: string },
): {
  oracleText: string;
  extraAlternateCosts?: Array<{ id: string; label: string; description: string; manaCost: string }>;
  preferredAlternateCostId?: string;
} {
  const normalizedOracleText = String(oracleText || '').trim();
  if (!normalizedOracleText) {
    return { oracleText: undefined as any };
  }

  if (castSourceZone !== 'hand') {
    return { oracleText: normalizedOracleText };
  }

  const handKeywordAlternateCosts: Array<{
    id: string;
    label: string;
    description: string;
    rawCost: string;
  }> = [];

  const warpCost = parseWarpCost(normalizedOracleText);
  if (warpCost) {
    handKeywordAlternateCosts.push({
      id: 'warp',
      label: 'Warp',
      description: 'Cast for warp cost; exile at the beginning of the next end step',
      rawCost: warpCost,
    });
  }

  const impendingInfo = parseImpendingInfo(normalizedOracleText);
  if (impendingInfo) {
    handKeywordAlternateCosts.push({
      id: 'impending',
      label: `Impending ${impendingInfo.timeCounters}`,
      description: `Cast for impending cost; enters with ${impendingInfo.timeCounters} time counters and isn't a creature until the last is removed`,
      rawCost: impendingInfo.cost,
    });
  }

  // Hand-cast payment extras only. Graveyard-only keywords (flashback, disturb,
  // escape, retrace, harmonize, jump-start) must not appear here � those are
  // offered when casting from the graveyard via the shared GY cast path.
  const genericKeywordIds = [
    'dash', 'blitz', 'mutate', 'surge', 'spectacle', 'prowl', 'bestow', 'emerge', 'evoke',
    'overload', 'craft', 'cleave', 'ninjutsu', 'miracle',
  ] as const;

  const genericLabels: Record<string, { label: string; description: string }> = {
    dash: { label: 'Dash', description: 'Cast for dash cost; return to hand at the beginning of the next end step' },
    blitz: { label: 'Blitz', description: 'Cast for blitz cost; sacrifice at the beginning of the next end step' },
    mutate: { label: 'Mutate', description: 'Cast for mutate cost' },
    surge: { label: 'Surge', description: 'Cast for surge cost' },
    spectacle: { label: 'Spectacle', description: 'Cast for spectacle cost' },
    prowl: { label: 'Prowl', description: 'Cast for prowl cost' },
    bestow: { label: 'Bestow', description: 'Cast for bestow cost' },
    emerge: { label: 'Emerge', description: 'Cast for emerge cost' },
    evoke: { label: 'Evoke', description: 'Cast for evoke cost' },
    overload: { label: 'Overload', description: 'Cast for overload cost' },
    craft: { label: 'Craft', description: 'Cast for craft cost' },
    cleave: { label: 'Cleave', description: 'Cast for cleave cost' },
    ninjutsu: { label: 'Ninjutsu', description: 'Cast for ninjutsu cost' },
    miracle: { label: 'Miracle', description: 'Cast for miracle cost' },
  };

  for (const keywordId of genericKeywordIds) {
    if (keywordId === 'mutate') {
      if (!timingContext?.game || !timingContext?.playerId) continue;
      const mutateCtx: any = { state: timingContext.game.state };
      if (!hasMutateAlternateCost(mutateCtx, timingContext.playerId as PlayerID, { oracle_text: normalizedOracleText })) {
        continue;
      }
    }
    const rawCost = parseKeywordAlternateManaCost(normalizedOracleText, keywordId);
    if (!rawCost) continue;
    const meta = genericLabels[keywordId] || { label: keywordId, description: `Cast for ${keywordId} cost` };
    handKeywordAlternateCosts.push({
      id: keywordId,
      label: meta.label,
      description: meta.description,
      rawCost,
    });
  }

  const sneakCost = parseSneakCost(normalizedOracleText);
  if (
    sneakCost
    && timingContext?.game
    && timingContext?.playerId
    && canCastWithSneakAtCurrentTiming(timingContext.game, timingContext.playerId, { oracle_text: normalizedOracleText })
  ) {
    handKeywordAlternateCosts.push({
      id: 'sneak',
      label: 'Sneak',
      description: 'Declare blockers step: return an unblocked attacker to hand',
      rawCost: sneakCost,
    });
  }

  const webSlinging = timingContext?.game && timingContext?.playerId
    ? calculateWebSlingingOptions(timingContext.game.state, timingContext.playerId, { oracle_text: normalizedOracleText })
    : undefined;
  if (webSlinging?.cost && webSlinging.availableCreatures.length > 0) {
    handKeywordAlternateCosts.push({
      id: 'web_slinging',
      label: 'Web-slinging',
      description: 'Return a tapped creature you control to its owner�s hand',
      rawCost: webSlinging.cost,
    });
  }

  if (hasSelfWUBRGAlternateCost({ oracle_text: normalizedOracleText })) {
    handKeywordAlternateCosts.push({
      id: 'wubrg_self',
      label: 'WUBRG Cost',
      description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
      rawCost: WUBRG_ALTERNATE_MANA_COST,
    });
  }

  for (const faceDownKind of getFaceDownCastKinds(normalizedOracleText)) {
    const faceDownLabel = faceDownKind === 'megamorph' ? 'Megamorph' : faceDownKind === 'disguise' ? 'Disguise' : 'Morph';
    handKeywordAlternateCosts.push({
      id: faceDownKind,
      label: `${faceDownLabel} (cast face down)`,
      description: faceDownKind === 'disguise' ? 'Cast face down as a 2/2 creature with ward {2}' : 'Cast face down as a 2/2 creature',
      rawCost: FACE_DOWN_CAST_COST,
    });
  }

  const evokeExileColor = parseEvokeExileColor(normalizedOracleText);
  if (evokeExileColor) {
    handKeywordAlternateCosts.push({
      id: EVOKE_EXILE_ALTERNATE_COST_ID,
      label: 'Evoke (exile a card)',
      description: `Exile a ${evokeExileColor.word} card from your hand; sacrifice it when it enters`,
      rawCost: '{0}',
    });
  }

  if (timingContext?.game && timingContext?.playerId) {
    const wubrgSource = getExternalWUBRGSource(
      { state: timingContext.game.state } as any,
      timingContext.playerId as PlayerID,
    );
    if (wubrgSource) {
      handKeywordAlternateCosts.push({
        id: 'wubrg_external',
        label: 'WUBRG Alternative',
        description: `Pay {W}{U}{B}{R}{G} via ${wubrgSource.sourceName}`,
        rawCost: WUBRG_ALTERNATE_MANA_COST,
      });
    }
  }

  const extraAlternateCosts = handKeywordAlternateCosts.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    manaCost: formatManaCostWithCostAdjustment(
      entry.rawCost,
      paymentMetadata.costReduction,
      chosenXValue,
      paymentMetadata.genericCostTax,
    ),
  }));

  let preferredAlternateCostId: string | undefined;
  if (timingContext?.game && timingContext?.playerId) {
    const commanderFree = buildCommanderFreeCastPaymentExtras(
      {
        state: timingContext.game.state,
        commandZone: timingContext.game.commandZone ?? timingContext.game.state?.commandZone ?? {},
      } as any,
      timingContext.playerId as PlayerID,
      { oracle_text: normalizedOracleText },
    );
    if (commanderFree) {
      preferredAlternateCostId = commanderFree.preferredAlternateCostId;
      const existingIds = new Set(extraAlternateCosts.map((c) => c.id));
      for (const extra of commanderFree.extraAlternateCosts) {
        if (existingIds.has(extra.id)) {
          const idx = extraAlternateCosts.findIndex((c) => c.id === extra.id);
          if (idx >= 0) extraAlternateCosts[idx] = { ...extraAlternateCosts[idx], ...extra };
        } else {
          extraAlternateCosts.push(extra);
          existingIds.add(extra.id);
        }
      }
    }
  }

  return {
    oracleText: normalizedOracleText,
    ...(extraAlternateCosts.length > 0 ? { extraAlternateCosts } : {}),
    ...(preferredAlternateCostId ? { preferredAlternateCostId } : {}),
  };
}

export function validateLibrarySpellCastAccess(
  game: any,
  playerId: string,
  cardId: string,
  spellCard: any,
  allowLibrarySearchCast: boolean,
): { ok: true } | { ok: false; code: string; message: string } {
  const library = getPlayerLibraryCards(game, playerId);
  const cardInLibrary = library.find((card: any) => String(card?.id || '') === String(cardId || ''));
  if (!cardInLibrary) {
    return {
      ok: false,
      code: 'CARD_NOT_IN_LIBRARY',
      message: 'Card not found in library.',
    };
  }

  if (allowLibrarySearchCast) {
    return { ok: true };
  }

  const topCard = library[0];
  if (!topCard || String(topCard?.id || '') !== String(cardId || '')) {
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: 'Only the top card of your library can be cast this way.',
    };
  }

  const spellCardForPermission = typeof spellCard === 'string'
    ? { ...cardInLibrary, type_line: spellCard, typeLine: spellCard }
    : spellCard;
  const topSpellPermission = canCastFromTop({ state: game.state } as any, playerId, spellCardForPermission);
  if (!topSpellPermission.canCast) {
    return {
      ok: false,
      code: 'NO_PERMISSION',
      message: topSpellPermission.restrictions[0] || "You don't have permission to cast that card from the top of your library.",
    };
  }

  return { ok: true };
}
