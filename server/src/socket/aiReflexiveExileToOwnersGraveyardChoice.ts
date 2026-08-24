/**
 * Origin: socket/ai.ts (`chooseAIOptionSelectionsForStep`)
 * Cluster: AI ask-stage routing for “You may put N cards from exile into owners’ graveyards. If/When you do, …”
 * Public: chooseAIReflexiveExileToOwnersGraveyardSelection
 */

import type { PlayerID } from '../../../shared/src/types.js';

export function chooseAIReflexiveExileToOwnersGraveyardSelection(
  _game: any,
  _playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const optionIds = options.map(resolveOptionId).filter(Boolean);
  const putId = optionIds.find((id) => /^(?:put|yes|pay)$/i.test(id)) || 'put';
  const declineId = optionIds.find((id) => /^decline$/i.test(id))
    || optionIds.find((id) => /^(?:no|cancel|dont)$/i.test(id))
    || 'decline';
  const putCount = Math.max(1, Math.floor(Number(step?.reflexiveExileToOwnersGraveyardWhenYouDoCount || 1)));
  const validTargets = Array.isArray(step?.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets)
    ? step.reflexiveExileToOwnersGraveyardWhenYouDoValidTargets
    : [];
  if (validTargets.length < putCount) {
    return { selections: [declineId], cancelled: true };
  }

  const followupText = String(step?.reflexiveExileToOwnersGraveyardWhenYouDoFollowupDescription || '').toLowerCase();
  const looksBeneficial = /(damage|destroy|exile|counter|draw|create|gain|return|can't block|cant block|put .*counter|each opponent|target opponent|any target)/i.test(followupText);
  const looksSelfPunishing = /(you lose|damage to you|you sacrifice|you discard|you mill)/i.test(followupText);
  if (!looksBeneficial || looksSelfPunishing) {
    return { selections: [declineId], cancelled: true };
  }

  return { selections: [putId], cancelled: false };
}
