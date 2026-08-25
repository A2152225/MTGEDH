// server/src/socket/util-handlers/getGraveyardAbilityHints.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: getGraveyardAbilityHints plus granted jump-start/retrace/escape
//   playability helpers used by broadcast.
// Public entry symbols: getGraveyardAbilityHints.

import type { InMemoryGame } from "../../state/types.js";
import type { PlayerID } from "../../../../shared/src/index.js";
import type { SharedSpellCastCandidate } from "../../state/modules/can-respond.js";
import { canPayManaCostWithAvailableSources, parseManaCost as parseManaFromString } from "../../state/modules/mana-check.js";
import { getCastableSpellCandidates } from "../../state/modules/can-respond.js";
import {
  getGrantedCastFromGraveyardKeywordInfo,
  getGrantedEmbalmInfo,
  getGrantedFlashbackInfo,
  getGrantedUnearthInfo,
  getPrintedUnearthInfo,
} from "../../state/modules/graveyard-permissions.js";
import { hasValidTargetsForSpell } from "../../rules-engine/target-availability.js";
import { debugWarn } from "../../utils/debug.js";
import { isInMainPhase } from "./utilMainPhaseCheck.js";

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
    ...(String(candidate?.castPermissionId || candidate?.graveyardPermissionId || '').trim()
      ? { permissionId: String(candidate?.castPermissionId || candidate?.graveyardPermissionId || '').trim() }
      : {}),
    ...(sourceName ? { sourceName } : {}),
    costMode,
  };
}

export function getGraveyardAbilityHints(game: InMemoryGame, playerId: PlayerID): Record<string, any[]> {
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
