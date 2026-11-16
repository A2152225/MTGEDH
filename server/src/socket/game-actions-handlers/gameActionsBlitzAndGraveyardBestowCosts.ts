// server/src/socket/game-actions-handlers/gameActionsBlitzAndGraveyardBestowCosts.ts
// On-cast extras for blitz (pay life / discard) and Detective's Phoenix
// graveyard bestow (collect evidence 6). Queues existing
// ADDITIONAL_COST_PAYMENT / collect-evidence prompts.
// Public: getBlitzOrGraveyardBestowAdditionalCosts,
//   takeFirstBlitzOrGraveyardBestowAdditionalCost.

import {
  parseBlitzAdditionalCosts,
  parseGraveyardBestowCollectEvidence,
  cardHasGraveyardBestow,
  type BlitzAdditionalCost,
} from "../../state/modules/blitzAdditionalCosts.js";

export type CollectEvidenceAdditionalCost = {
  type: 'collect_evidence';
  required: number;
  mandatory: true;
  label: string;
};

export type BlitzOrBestowAdditionalCost = BlitzAdditionalCost | CollectEvidenceAdditionalCost;

export function getBlitzOrGraveyardBestowAdditionalCosts(args: {
  oracleText?: string;
  alternateCostId?: string;
  sourceZone?: string;
}): BlitzOrBestowAdditionalCost[] {
  const oracleText = String(args.oracleText || '');
  const alternate = String(args.alternateCostId || '').trim().toLowerCase();
  const sourceZone = String(args.sourceZone || '').trim().toLowerCase();
  const out: BlitzOrBestowAdditionalCost[] = [];

  if (alternate === 'blitz') {
    out.push(...parseBlitzAdditionalCosts(oracleText));
  }

  const bestowFromGraveyard = sourceZone === 'graveyard' && (alternate === 'bestow' || (!alternate && cardHasGraveyardBestow(oracleText)));
  if (bestowFromGraveyard) {
    const evidence = parseGraveyardBestowCollectEvidence(oracleText);
    if (evidence) {
      out.push({
        type: 'collect_evidence',
        required: evidence.required,
        mandatory: true,
        label: `Collect evidence ${evidence.required}`,
      });
    }
  }

  return out;
}

export function takeFirstBlitzOrGraveyardBestowAdditionalCost(args: {
  oracleText?: string;
  alternateCostId?: string;
  sourceZone?: string;
}): BlitzOrBestowAdditionalCost | null {
  return getBlitzOrGraveyardBestowAdditionalCosts(args)[0] || null;
}
