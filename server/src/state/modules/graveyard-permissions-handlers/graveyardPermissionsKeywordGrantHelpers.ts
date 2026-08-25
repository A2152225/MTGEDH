// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: getTemporaryGraveyardKeywordGrants, findTemporaryGrantedKeywordInfo,
//   normalizeGrantKeyword, extractKeywordGrantFromAbilityText,
//   getGraveyardCardsForTemporaryGrant.
// Public entry symbols: getTemporaryGraveyardKeywordGrants, findTemporaryGrantedKeywordInfo,
//   normalizeGrantKeyword, extractKeywordGrantFromAbilityText,
//   getGraveyardCardsForTemporaryGrant.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type {
  GrantedGraveyardKeywordInfo,
  GraveyardGrantKeyword,
  TemporaryGraveyardKeywordGrant,
} from "./graveyardPermissionsTypes.js";
import { getCardId, normalizeText } from "./graveyardPermissionsCardUtils.js";
import { qualifierMatchesCard } from "./graveyardPermissionsQualifierMatch.js";

export function getTemporaryGraveyardKeywordGrants(state: any): TemporaryGraveyardKeywordGrant[] {
  return Array.isArray(state?.temporaryGraveyardKeywordGrants)
    ? state.temporaryGraveyardKeywordGrants
    : [];
}



export function findTemporaryGrantedKeywordInfo(
  state: any,
  playerId: PlayerID,
  card: any,
  keyword: GraveyardGrantKeyword,
): GrantedGraveyardKeywordInfo {
  const cardId = getCardId(card);
  if (!state || !cardId) return { hasIt: false };

  const grant = getTemporaryGraveyardKeywordGrants(state).find((entry) =>
    entry
    && String(entry.playerId || '') === String(playerId || '')
    && String(entry.cardId || '') === cardId
    && String(entry.keyword || '') === keyword
  );

  if (!grant) return { hasIt: false };

  return {
    hasIt: true,
    cost: grant.cost,
    additionalExileCount: grant.additionalExileCount,
    sourceId: grant.sourceId,
    sourceName: grant.sourceName,
  };
}

export function normalizeGrantKeyword(value: string): GraveyardGrantKeyword | undefined {
  const normalized = normalizeText(value).replace(/\s+/g, '-');
  if (['flashback', 'unearth', 'jump-start', 'retrace', 'escape', 'harmonize', 'embalm'].includes(normalized)) {
    return normalized as GraveyardGrantKeyword;
  }
  return undefined;
}

export function extractKeywordGrantFromAbilityText(rawAbilityText: string): { keyword?: GraveyardGrantKeyword; remainder: string } {
  const text = String(rawAbilityText || '').trim();
  if (!text) return { remainder: '' };

  const match = text.match(/\b(flashback|unearth|jump-start|retrace|escape|harmonize|embalm)\b\s*[—-]?\s*([^.]*)/i);
  const keyword = match?.[1] ? normalizeGrantKeyword(match[1]) : undefined;
  return {
    keyword,
    remainder: String(match?.[2] || text).trim(),
  };
}

export function getGraveyardCardsForTemporaryGrant(state: any, playerId: PlayerID, qualifier: string, targetIds?: string[]): any[] {
  const graveyard = state?.zones?.[playerId]?.graveyard;
  if (!Array.isArray(graveyard)) return [];

  const targetIdSet = Array.isArray(targetIds) && targetIds.length > 0
    ? new Set(targetIds.map((id) => String(id || '').trim()).filter(Boolean))
    : null;

  if (targetIdSet) {
    return graveyard.filter((card: any) => card && typeof card !== 'string' && targetIdSet.has(getCardId(card)));
  }

  return graveyard.filter((card: any) => {
    if (!card || typeof card === 'string') return false;
    return qualifierMatchesCard(qualifier, card);
  });
}
