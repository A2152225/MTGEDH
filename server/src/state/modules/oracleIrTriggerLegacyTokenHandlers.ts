import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import {
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';

export function createEquippedCreatureCopyTokenFromEquipment(
  ctx: GameContext,
  controller: PlayerID,
  equipmentPermanentId: string,
  triggerDescription: string,
  grantsHasteFromStep = false,
): number {
  const state = (ctx as any).state;
  if (!state) return 0;

  const sourcePerm = (state.battlefield || []).find((p: any) => p?.id === equipmentPermanentId);
  if (!sourcePerm) {
    debug(2, `[executeTriggerEffect] Equipment source not found on battlefield - trigger fizzles`);
    return 0;
  }

  const attachedTo = sourcePerm.attachedTo;
  if (!attachedTo) {
    debug(2, `[executeTriggerEffect] Equipment ${sourcePerm.card?.name || 'equipment'} is not attached to anything - trigger fizzles`);
    return 0;
  }

  const equippedCreature = (state.battlefield || []).find((p: any) => p?.id === attachedTo);
  if (!equippedCreature?.card) {
    debug(2, `[executeTriggerEffect] No equipped creature found for copy token creation - trigger fizzles`);
    return 0;
  }

  const desc = String(triggerDescription || '').toLowerCase();
  const tokenId = uid('token');
  const originalCard = equippedCreature.card;
  const originalTypeLine = (originalCard.type_line || '').toLowerCase();

  let tokenTypeLine = originalCard.type_line || 'Token';
  tokenTypeLine = tokenTypeLine.replace(/\bLegendary\s+/i, '').replace(/\s+Legendary\b/i, '').trim();

  const originalHasHaste = (originalCard.oracle_text || '').toLowerCase().includes('haste') ||
    (Array.isArray(originalCard.keywords) &&
      originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste'));
  const triggerGrantsHaste = grantsHasteFromStep || /(?:gains|has|with)\s+haste/i.test(desc);
  const hasHaste = originalHasHaste || triggerGrantsHaste;
  const isCreature = originalTypeLine.includes('creature');

  const tokenCopy = {
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: { ...equippedCreature.counters },
    basePower: equippedCreature.basePower,
    baseToughness: equippedCreature.baseToughness,
    summoningSickness: isCreature && !hasHaste,
    isToken: true,
    card: {
      ...originalCard,
      id: tokenId,
      type_line: tokenTypeLine,
      zone: 'battlefield',
      oracle_text: triggerGrantsHaste && !originalHasHaste
        ? (originalCard.oracle_text || '') + (originalCard.oracle_text ? '\n' : '') + 'Haste'
        : originalCard.oracle_text,
      keywords: triggerGrantsHaste && Array.isArray(originalCard.keywords) && !originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')
        ? [...originalCard.keywords, 'Haste']
        : originalCard.keywords,
    },
  } as any;

  state.battlefield = state.battlefield || [];
  state.battlefield.push(tokenCopy);

  debug(2, `[executeTriggerEffect] Created token copy of ${originalCard.name || 'creature'} (not legendary${hasHaste ? ', with haste' : ''})`);
  queueSelfETBTriggersForPermanent(ctx, tokenCopy, controller as any);
  triggerETBEffectsForToken(ctx, tokenCopy, controller);
  return 1;
}
