/**
 * Origin parent: server/src/socket/game-actions-handlers/gameActionsRequestCastSpellModes.ts
 * Cluster: optional Offspring {N} payment before the spell's mana cost is locked in.
 * Public entry symbols: queueOffspringCastPrompt.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { ResolutionStepType } from '../../state/resolution/index.js';
import { queueResolveTopOfStackPrompt } from '../../state/modules/resolutionPromptEvents.js';
import { debug } from '../../utils/debug.js';

export function queueOffspringCastPrompt(params: {
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  cardForCast: any;
  cardInHand: any;
  offspringCost: string;
  selectedFaceIndex: number | undefined;
  castSourceZone: string;
  isFreeCast: boolean;
  bypassExilePermissionCheck: boolean;
  ignoreTimingRestrictions: boolean;
  forcedAlternateCostId?: string;
  chosenXValue: number | undefined;
  chosenTimesKicked: number | undefined;
  chosenReplicateCount: number | undefined;
}): boolean {
  const image = params.cardForCast?.image_uris?.small
    || params.cardForCast?.image_uris?.normal
    || params.cardInHand?.image_uris?.small
    || params.cardInHand?.image_uris?.normal;
  queueResolveTopOfStackPrompt(
    { ...(params.game || {}), gameId: params.gameId, state: params.game?.state },
    {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.playerId as PlayerID,
      sourceId: String(params.cardId),
      sourceName: params.cardName,
      sourceImage: image,
      description: `${params.cardName}: You may pay Offspring ${params.offspringCost}. If you do, when this creature enters, create a 1/1 token copy of it.`,
      mandatory: false,
      options: [
        { id: 'decline', label: 'Cast without offspring' },
        { id: 'pay', label: `Pay Offspring ${params.offspringCost}` },
      ],
      minSelections: 1,
      maxSelections: 1,
      offspringCastChoice: true,
      offspringCost: params.offspringCost,
      spellCardId: String(params.cardId),
      spellFaceIndex: params.selectedFaceIndex,
      spellFromZone: params.castSourceZone,
      spellForcedAlternateCostId: params.forcedAlternateCostId,
      spellCastWithoutPayingManaCost: params.isFreeCast,
      spellBypassExilePermissionCheck: params.bypassExilePermissionCheck,
      spellIgnoreTimingRestrictions: params.ignoreTimingRestrictions,
      spellXValue: params.chosenXValue,
      spellTimesKicked: params.chosenTimesKicked,
      spellReplicateCount: params.chosenReplicateCount,
    } as any,
  );
  debug(2, `[requestCastSpell] Queued offspring choice for ${params.cardName} (${params.offspringCost})`);
  return true;
}
