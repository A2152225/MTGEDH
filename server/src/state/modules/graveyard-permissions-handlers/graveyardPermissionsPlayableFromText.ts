// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: applyPlayableFromGraveyardPermissionFromText.
// Public entry symbols: applyPlayableFromGraveyardPermissionFromText.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/index.js";
import type {
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionDuration,
  GraveyardCastingPermissionReplacement,
} from "./graveyardPermissionsTypes.js";
import { getCardId, getTypeLine, isPlayersTurn } from "./graveyardPermissionsCardUtils.js";
import { qualifierMatchesCard } from "./graveyardPermissionsQualifierMatch.js";
import { findCardInPlayerGraveyard, getPlayerGraveyardCollections } from "./graveyardPermissionsZoneAccess.js";
import { markSourceCardPlayableFromGraveyardThisTurn } from "./graveyardPermissionsMarkSourcePlayable.js";
import { addTemporaryPlayableFromGraveyardPermission } from "./graveyardPermissionsTemporaryPlayable.js";

export function applyPlayableFromGraveyardPermissionFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  try {
    const state = (ctx as any)?.state;
    if (!state || !playerId) return 0;

    const text = String(description || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !/\bgraveyard\b/i.test(text)) return 0;

    const hasTemporaryWindow = /\bthis turn\b/i.test(text)
      || /\buntil end of turn\b/i.test(text)
      || /\buntil (?:the )?end of your next turn\b/i.test(text);

    if (/\bit'?s your turn\b/i.test(text) && !isPlayersTurn(state, playerId)) {
      return 0;
    }

    // Mosswood Dreadknight / Hildibrand: cast from GY as an Adventure until end of next turn.
    const grantsAdventureCastPermission = /\byou may cast (?:it|this card) from your graveyard as an Adventure until (?:the )?end of your next turn\b/i.test(text);
    const grantsCastPermission = grantsAdventureCastPermission
      || /\byou may cast (?:it|this card) from your graveyard this turn\b/i.test(text)
      || /\byou may cast (?:it|this card) from your graveyard until (?:the )?end of (?:turn|your next turn)\b/i.test(text);
    const grantsPlayPermission = !grantsCastPermission
      && /\byou may play (?:it|this card) from your graveyard this turn\b/i.test(text);
    const grantsTurnLongGraveyardExileReplacement =
      /\bif\s+a\s+card\s+would\s+be\s+put\s+into\s+your\s+graveyard\s+from\s+anywhere\s+this\s+turn\s*,?\s*exile\s+(?:that\s+card|it)\s+instead\b/i.test(text);
    const costMode: GraveyardCastingPermissionCostMode = /\bwithout paying (?:its|their|that spell's) mana cost\b/i.test(text)
      ? 'without_paying_mana_cost'
      : 'normal';
    const spellReplacement = grantsTurnLongGraveyardExileReplacement
      ? { exileAfterResolution: true }
      : undefined;

    const sourceCardId = String(
      triggerItem?.interveningIfSubjectSnapshot?.id
      || triggerItem?.card?.id
      || triggerItem?.sourceId
      || triggerItem?.source
      || ''
    ).trim();
    const sourceCardName = String(
      triggerItem?.interveningIfSubjectSnapshot?.name
      || triggerItem?.card?.name
      || sourceName
      || ''
    ).trim();

    const addQualifierPermission = (
      permission: 'play' | 'cast',
      qualifier: string,
      limiterText?: string,
      replacement?: GraveyardCastingPermissionReplacement,
    ): number => {
      const normalizedQualifier = String(qualifier || '').trim();
      if (!normalizedQualifier || /^(?:it|this card)$/i.test(normalizedQualifier)) {
        return 0;
      }

      const normalizedLimiterText = String(limiterText || '').trim().toLowerCase();
      const usageLimit = /^(?:a|an|one)$/.test(normalizedLimiterText)
        ? { type: 'once' as const, maxUses: 1 }
        : undefined;

      return addTemporaryPlayableFromGraveyardPermission(
        state,
        playerId,
        normalizedQualifier,
        permission,
        {
          ...(sourceCardId ? { sourceId: sourceCardId } : {}),
          ...(sourceCardName ? { sourceName: sourceCardName } : {}),
          sourceText: text,
          costMode,
          ...(usageLimit ? { usageLimit } : {}),
          ...(replacement ? { replacement } : {}),
        },
      ) ? 1 : 0;
    };

    if (grantsCastPermission || grantsPlayPermission) {
      // During replay the graveyard may be empty if the initial state wasn't
      // re-seeded before replay (reset + replay pattern). Fall back to the
      // snapshot embedded in the trigger item so the permission is still applied.
      const snapshotCard = (triggerItem?.interveningIfSubjectSnapshot && sourceCardId
        ? triggerItem.interveningIfSubjectSnapshot
        : undefined)
        || (triggerItem?.card && sourceCardId ? triggerItem.card : undefined)
        || (triggerItem?.sourceCard && sourceCardId ? triggerItem.sourceCard : undefined);
      let sourceCard = findCardInPlayerGraveyard(state, playerId, {
        cardId: sourceCardId,
        cardName: sourceCardName,
      });
      if (!sourceCard && snapshotCard) {
        // Re-seed the card into the graveyard so getCastableSpellCandidates can find it.
        // This handles the reset+replay pattern where the graveyard was cleared by reset()
        // but the card's existence in graveyard is implied by the replayed trigger event.
        const playerId2 = String(playerId);
        const zones = state.zones = state.zones || {};
        const pz = zones[playerId2] = zones[playerId2] || { graveyard: [], graveyardCount: 0 };
        pz.graveyard = Array.isArray(pz.graveyard) ? pz.graveyard : [];
        if (!pz.graveyard.some((c: any) => String(c?.id || '') === String(snapshotCard?.id || ''))) {
          pz.graveyard.push({ ...snapshotCard, zone: 'graveyard' });
          pz.graveyardCount = pz.graveyard.length;
        }
        sourceCard = snapshotCard;
      }
      if (!sourceCard) return 0;

      const duration: GraveyardCastingPermissionDuration = grantsAdventureCastPermission
        || /\buntil (?:the )?end of your next turn\b/i.test(text)
        ? 'until_end_of_next_turn'
        : 'this_turn';

      return markSourceCardPlayableFromGraveyardThisTurn(
        state,
        playerId,
        sourceCard,
        grantsPlayPermission ? 'play' : 'cast',
        {
          ...(sourceCardId ? { sourceId: sourceCardId } : {}),
          ...(sourceCardName ? { sourceName: sourceCardName } : {}),
          sourceText: text,
          costMode,
          duration,
          ...(grantsAdventureCastPermission ? { castAsAdventureOnly: true } : {}),
          ...((grantsCastPermission && spellReplacement) ? { replacement: spellReplacement } : {}),
        },
      );
    }

    const grantedSelfPermissionMatch = hasTemporaryWindow
      ? text.match(/\beach\s+(.+?)\s+cards?\s+in\s+your\s+graveyard\s+gains?\s+["“]?you\s+may\s+(play|cast)\s+this\s+card\s+from\s+your\s+graveyard(?:\s+without\s+paying\s+(?:its|their|that\s+spell's|this\s+spell's)\s+mana\s+cost)?\.?["”]?/i)
      : undefined;
    if (grantedSelfPermissionMatch) {
      const qualifier = String(grantedSelfPermissionMatch[1] || '').trim();
      const grantedAction = String(grantedSelfPermissionMatch[2] || '').trim().toLowerCase();
      const grantedPermissionCostMode: GraveyardCastingPermissionCostMode = /\bwithout\s+paying\s+(?:its|their|that\s+spell's|this\s+spell's)\s+mana\s+cost\b/i.test(String(grantedSelfPermissionMatch[0] || ''))
        ? 'without_paying_mana_cost'
        : costMode;
      const seenCardIds = new Set<string>();
      let added = 0;

      for (const graveyard of getPlayerGraveyardCollections(state, playerId)) {
        for (const graveyardCard of graveyard) {
          const cardId = getCardId(graveyardCard);
          if (!cardId || seenCardIds.has(cardId)) continue;
          if (!qualifierMatchesCard(qualifier, graveyardCard)) continue;

          const typeLine = getTypeLine(graveyardCard);
          const grantedPermission: 'play' | 'cast' = grantedAction === 'cast'
            ? 'cast'
            : /\bland\b/.test(typeLine)
              ? 'play'
              : 'cast';

          if (grantedPermission === 'cast' && /\bland\b/.test(typeLine)) {
            continue;
          }

          added += markSourceCardPlayableFromGraveyardThisTurn(
            state,
            playerId,
            graveyardCard,
            grantedPermission,
            {
              ...(sourceCardId ? { sourceId: sourceCardId } : {}),
              ...(sourceCardName ? { sourceName: sourceCardName } : {}),
              sourceText: text,
              costMode: grantedPermission === 'cast' ? grantedPermissionCostMode : 'normal',
              ...((grantedPermission === 'cast' && spellReplacement) ? { replacement: spellReplacement } : {}),
            },
          );
          seenCardIds.add(cardId);
        }
      }

      return added;
    }

    const mixedPlayCastMatch = hasTemporaryWindow
      ? text.match(/\byou may play\s+((?:an?|one)\s+)?(.+?)\s+and cast\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
      : undefined;
    if (mixedPlayCastMatch) {
      return addQualifierPermission('play', String(mixedPlayCastMatch[2] || '').trim(), String(mixedPlayCastMatch[1] || '').trim())
        + addQualifierPermission(
          'cast',
          String(mixedPlayCastMatch[4] || '').trim(),
          String(mixedPlayCastMatch[3] || '').trim(),
          spellReplacement,
        );
    }

    const castQualifierMatch = hasTemporaryWindow
      ? text.match(/\byou may cast\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
      : undefined;
    const playQualifierMatch = !castQualifierMatch
      ? (hasTemporaryWindow
          ? text.match(/\byou may play\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
          : undefined)
      : undefined;
    const qualifier = String(castQualifierMatch?.[2] || playQualifierMatch?.[2] || '').trim();
    if (!qualifier) return 0;

    return addQualifierPermission(
      castQualifierMatch ? 'cast' : 'play',
      qualifier,
      String(castQualifierMatch?.[1] || playQualifierMatch?.[1] || '').trim(),
      castQualifierMatch ? spellReplacement : undefined,
    );
  } catch {
    return 0;
  }
}

