/**
 * Madness offer helpers: parse mana + pay-life halves, build the
 * existing OPTION_CHOICE cast-from-exile prompt, and flag a pay_life
 * additional cost for Shadowgrange Archfiend-style madness costs.
 */
import { parseMadnessCost } from '../state/modules/alternate-costs.js';
import { parseMadnessCostParts } from '../state/modules/batch98CombatAndKeywords.js';
import { ResolutionStepType } from '../state/resolution/index.js';

export type MadnessOfferParts = {
  mana: string;
  life: number;
  label: string;
};

export function formatMadnessCostLabel(mana: string, life: number): string {
  const trimmed = String(mana || '').trim();
  const amount = Math.max(0, Math.floor(Number(life) || 0));
  if (amount > 0 && trimmed) return `${trimmed}, Pay ${amount} life`;
  if (amount > 0) return `Pay ${amount} life`;
  return trimmed;
}

export function parseMadnessOffer(oracleText: string): MadnessOfferParts | null {
  const parts = parseMadnessCostParts(oracleText);
  if (parts && String(parts.mana || '').trim()) {
    const mana = String(parts.mana).replace(/\s+/g, '').trim();
    const life = Math.max(0, Math.floor(Number(parts.life) || 0));
    return { mana, life, label: formatMadnessCostLabel(mana, life) };
  }
  const mana = parseMadnessCost(oracleText);
  if (!mana) return null;
  return { mana, life: 0, label: mana };
}

export function madnessPayLifeAdditionalCost(
  oracleText: string,
  alternateCostId?: string,
): { type: 'pay_life'; amount: number } | null {
  if (String(alternateCostId || '') !== 'madness') return null;
  const offer = parseMadnessOffer(oracleText);
  if (!offer || offer.life <= 0) return null;
  return { type: 'pay_life', amount: offer.life };
}

export function buildMadnessOptionChoiceStep(args: {
  playerId: string;
  exiledCard: any;
  discarded?: any;
  resumeCleanupAfterPrompt?: boolean;
}): any {
  const card = args.exiledCard || args.discarded || {};
  const fallback = args.discarded || {};
  const offer = parseMadnessOffer(String(card?.oracle_text || fallback?.oracle_text || ''));
  const label = offer?.label;
  const imageUrl = card?.image_uris?.small
    || card?.image_uris?.normal
    || fallback?.image_uris?.small
    || fallback?.image_uris?.normal;
  const cardId = String(card?.id || fallback?.id || '');
  const step: any = {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: args.playerId as any,
    sourceId: cardId,
    sourceName: 'Madness',
    sourceImage: imageUrl,
    description: `Madness: You may cast ${card?.name || fallback?.name || 'that card'} for ${label || 'its madness cost'}.`,
    mandatory: false,
    options: [
      { id: 'cast', label: label ? `Cast for Madness (${label})` : 'Cast for Madness' },
      { id: 'decline', label: 'Decline' },
    ],
    minSelections: 1,
    maxSelections: 1,
    madnessPrompt: true,
    madnessCardId: cardId,
    madnessCost: label || offer?.mana,
    madnessLife: offer?.life || 0,
    castFromExileCardId: cardId,
    castFromExileCard: { ...card },
    castFromExileDeclineDestination: 'graveyard',
    castFromExileForcedAlternateCostId: 'madness',
    castFromExileCastWithoutPayingManaCost: false,
    castFromExileBypassExilePermissionCheck: true,
    castFromExileIgnoreTimingRestrictions: true,
  };
  if (args.resumeCleanupAfterPrompt) step.resumeCleanupAfterPrompt = true;
  return step;
}
