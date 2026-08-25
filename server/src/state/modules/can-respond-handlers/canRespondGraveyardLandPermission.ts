// server/src/state/modules/can-respond-handlers/canRespondGraveyardLandPermission.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: getSpecificLandFromGraveyardPermission and the
// canPlaySpecificLandFromGraveyard wrapper.
// Public entry symbols: getSpecificLandFromGraveyardPermission,
// canPlaySpecificLandFromGraveyard.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { getPrintedSelfCastPermissionInfo } from '../graveyard-permissions.js';
import { debugWarn } from '../../../utils/debug.js';
import { playerHasDurableLandPlayPermission } from '../durable-permissions.js';
import {
  normalizeRuleText,
  findMatchingFirstClassGraveyardPermission,
  firstClassPermissionLeaveBattlefieldDestination,
  firstClassPermissionLeaveBattlefieldLifeGain,
  buildSyntheticGraveyardPermissionMetadata,
  hasMarkedGraveyardPermission,
  isPlayersTurnForPermission,
  getGraveyardPermissionTextSources,
  isStaticGraveyardPermissionLine,
  landQualifierMatchesCard,
} from './canRespondGraveyardPermissionMatching.js';
import {
  sourceLeaveBattlefieldReplacementDestination,
  sourceLeaveBattlefieldLifeGain,
} from './canRespondGraveyardSpellPermission.js';

export function getSpecificLandFromGraveyardPermission(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): {
  allowed: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
} {
  try {
    const state = ctx?.state as any;
    if (!state || !card || typeof card === 'string') return { allowed: false };

    const firstClassPermission = findMatchingFirstClassGraveyardPermission(state, playerId, card, 'play');
    const firstClassLeaveBattlefieldDestination = firstClassPermissionLeaveBattlefieldDestination(firstClassPermission);
    const firstClassLeaveBattlefieldLifeGain = firstClassPermissionLeaveBattlefieldLifeGain(firstClassPermission);
    if (firstClassPermission) {
      return {
        allowed: true,
        ...(firstClassLeaveBattlefieldDestination ? { leaveBattlefieldReplacementDestination: firstClassLeaveBattlefieldDestination } : {}),
        ...(firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName
          ? { leaveBattlefieldReplacementSourceName: firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName }
          : {}),
        ...(firstClassLeaveBattlefieldLifeGain ? { leaveBattlefieldReplacementLifeGain: firstClassLeaveBattlefieldLifeGain } : {}),
        graveyardPermissionId: firstClassPermission.id,
        ...(firstClassPermission.sourceName ? { graveyardPermissionSourceName: firstClassPermission.sourceName } : {}),
      };
    }

    const printedSelfPermissionInfo = getPrintedSelfCastPermissionInfo(state, playerId, card, 'graveyard');
    if (printedSelfPermissionInfo.hasIt) {
      return { allowed: true };
    }

    if (hasMarkedGraveyardPermission(state, playerId, card)) {
      return { allowed: true };
    }

    const alreadyPlayedLandFromGraveyard = Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId]);

    for (const source of getGraveyardPermissionTextSources(state, playerId)) {
      const oracleText = source.oracleText;
      const leaveBattlefieldReplacementDestination = sourceLeaveBattlefieldReplacementDestination(oracleText);
      const leaveBattlefieldReplacementLifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
      const lines = oracleText.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = normalizeRuleText(rawLine);
        if (!isStaticGraveyardPermissionLine(line)) continue;
        if (/\bduring(?:\s+each\s+of)?\s+your\s+turns?\b/.test(line) && !isPlayersTurnForPermission(state, playerId)) continue;

        for (const match of line.matchAll(/you may play ([^.]+?) from your graveyard/gi)) {
          const qualifier = String(match[1] || '').trim();
          if (!qualifier) continue;

          const oncePerTurn = /\bonce during each of your turns\b/.test(line) || /^\s*(?:a|an)\b/i.test(qualifier);
          const eachPermanentTypePermission = /\bpermanent cards? of each permanent type\b/.test(qualifier);
          if (oncePerTurn && alreadyPlayedLandFromGraveyard) continue;
          if (eachPermanentTypePermission && alreadyPlayedLandFromGraveyard) continue;
          if (landQualifierMatchesCard(card, qualifier)) {
            const syntheticPermission = buildSyntheticGraveyardPermissionMetadata(playerId, 'play', {
              sourceId: source.sourceId,
              sourceName: source.sourceName,
              cardId: String(card?.id || '').trim(),
              qualifier,
              ...(leaveBattlefieldReplacementDestination
                ? {
                    replacement: {
                      leaveBattlefieldDestination: leaveBattlefieldReplacementDestination,
                      ...(source.sourceName ? { sourceName: source.sourceName } : {}),
                      ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                    },
                  }
                : {}),
            });
            return {
              allowed: true,
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName
                ? { leaveBattlefieldReplacementSourceName: source.sourceName }
                : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              graveyardPermissionId: syntheticPermission.graveyardPermissionId,
              ...(syntheticPermission.graveyardPermissionSourceName
                ? { graveyardPermissionSourceName: syntheticPermission.graveyardPermissionSourceName }
                : {}),
            };
          }
        }
      }
    }

    if (
      (Array.isArray(state?.landPlayPermissions?.[playerId]) && state.landPlayPermissions[playerId].includes('graveyard'))
      || playerHasDurableLandPlayPermission(state, playerId, 'graveyard')
    ) {
      return { allowed: true };
    }

    return { allowed: false };
  } catch (err) {
    debugWarn(1, '[getSpecificLandFromGraveyardPermission] Error:', err);
    return { allowed: false };
  }
}

export function canPlaySpecificLandFromGraveyard(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  return getSpecificLandFromGraveyardPermission(ctx, playerId, card).allowed;
}
