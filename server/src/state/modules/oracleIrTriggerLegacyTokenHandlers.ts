import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import {
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';
import {
  hydrateCardOracleInPlace,
  hydratePermanentCardOracleInPlace,
} from './cardOracleHydration.js';
import {
  applyCopyTokenOverrides,
  parseCopyTokenOverridesFromEffect,
  type CopyTokenOverrides,
} from '../../../../shared/src/copyTokenOverrides.js';

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

  hydratePermanentCardOracleInPlace(equippedCreature);

  const effectText = String(triggerDescription || '');
  let copyOverrides: CopyTokenOverrides = parseCopyTokenOverridesFromEffect(effectText);
  if (grantsHasteFromStep) {
    const abilities = new Set(
      (copyOverrides.addAbilities || []).map((entry) => String(entry)),
    );
    abilities.add('Haste');
    copyOverrides = { ...copyOverrides, addAbilities: [...abilities] };
  }

  const tokenId = uid('token');
  const originalCard = { ...equippedCreature.card };
  hydrateCardOracleInPlace(originalCard, { isToken: false });

  const originalTypeLine = String(originalCard.type_line || '').toLowerCase();
  const originalHasHaste =
    (String(originalCard.oracle_text || '').toLowerCase().includes('haste') ||
      (Array.isArray(originalCard.keywords) &&
        originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')));
  const hasHaste =
    originalHasHaste ||
    (copyOverrides.addAbilities || []).some((ability) => ability.toLowerCase() === 'haste');
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
    isCopyToken: true,
    copiedFromPermanentId: String(equippedCreature.id || ''),
    copyTokenOverrides: copyOverrides,
    card: {
      ...originalCard,
      id: tokenId,
      zone: 'battlefield',
      isToken: true,
      isCopyOfPrintedCard: true,
    },
  } as any;

  hydratePermanentCardOracleInPlace(tokenCopy);
  applyCopyTokenOverrides(tokenCopy.card, copyOverrides, tokenCopy);

  state.battlefield = state.battlefield || [];
  state.battlefield.push(tokenCopy);

  debug(
    2,
    `[executeTriggerEffect] Created token copy of ${originalCard.name || 'creature'} with copy overrides`,
  );
  queueSelfETBTriggersForPermanent(ctx, tokenCopy, controller as any);
  triggerETBEffectsForToken(ctx, tokenCopy, controller);
  return 1;
}
