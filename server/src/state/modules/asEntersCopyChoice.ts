/**
 * asEntersCopyChoice.ts
 *
 * As-this-enters replacement: "You may have this land/creature enter (tapped)
 * as a copy of any land/creature on the battlefield" (Vesuva, Clone).
 *
 * Queues optional TARGET_SELECTION onto the existing self-become-copy handler.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { getAsEntersChoiceRequirements } from './asEntersChoiceRequirements.js';

export function checkAsEntersCopyChoiceForNewPermanents(game: any, gameId: string): void {
  if (!game || !gameId) return;
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const queue = ResolutionQueueManager.getQueue(gameId);

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (String(permanent.copiedFromPermanentId || '').trim()) continue;

    const copyReq = getAsEntersChoiceRequirements(permanent.card).find((req) => req.kind === 'copy_permanent');
    if (!copyReq) continue;

    const permanentId = String(permanent.id || '').trim();
    if (!permanentId) continue;
    const alreadyQueued = queue.steps.some(
      (step: any) =>
        step.type === ResolutionStepType.TARGET_SELECTION
        && String(step.selfBecomeCopySourcePermanentId || step.sourceId || '').trim() === permanentId
        && (step.action === 'self_become_copy_of_creature' || step.asEntersCopyChoice === true),
    );
    if (alreadyQueued) continue;

    const copyType = copyReq.copyType || 'permanent';
    const copyTypes: string[] = Array.isArray(copyReq.copyTypes) && copyReq.copyTypes.length
      ? copyReq.copyTypes
      : (copyType === 'artifact-or-enchantment' ? ['artifact', 'enchantment'] : [copyType]);
    const controllerOnly = copyReq.controllerOnly === true;
    const validTargets = battlefield
      .filter((candidate: any) => {
        const candidateId = String(candidate?.id || '').trim();
        if (!candidateId || candidateId === permanentId) return false;
        if (controllerOnly && String(candidate?.controller || '') !== String(permanent.controller || '')) return false;
        const typeLine = String(candidate?.card?.type_line || candidate?.type_line || '').toLowerCase();
        if (copyTypes.includes('permanent')) return Boolean(typeLine);
        return copyTypes.some((type) => typeLine.includes(type));
      })
      .map((candidate: any) => ({
        id: String(candidate.id),
        label: String(candidate.card?.name || 'Permanent'),
        description: String(candidate.card?.type_line || candidate.type_line || ''),
        image: candidate.card?.image_uris?.small || candidate.card?.image_uris?.normal,
      }));
    if (validTargets.length === 0) continue;

    const controller = String(permanent.controller || permanent.controllerId || permanent.owner || '').trim() as PlayerID;
    if (!controller) continue;
    const cardName = String(permanent.card?.name || 'Permanent');
    const copyNoun = copyTypes.includes('permanent') ? 'permanent' : copyTypes.join(' or ');

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controller,
      description: copyReq.reason || `You may have ${cardName} enter as a copy of any ${copyNoun} on the battlefield (cancel to skip)`,
      mandatory: false,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      validTargets,
      targetTypes: copyTypes.includes('permanent') ? ['creature', 'artifact', 'enchantment', 'land', 'planeswalker'] : copyTypes.filter((type) => type !== 'artifact-or-enchantment'),
      minTargets: 0,
      maxTargets: 1,
      targetDescription: `any ${copyNoun} on the battlefield`,
      action: 'self_become_copy_of_creature',
      selfBecomeCopySourcePermanentId: permanentId,
      asEntersCopyChoice: true,
      enterTappedIfCopied: copyReq.enterTappedIfCopied === true,
      permanentId,
    } as any);
  }
}
