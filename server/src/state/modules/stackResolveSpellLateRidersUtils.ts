import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applySpellLegacyRemovalRiders } from './oracleIrSpellLegacyRemovalRiderUtils.js';
import { applySpellLegacySpecialSpellRiders } from './oracleIrSpellLegacySpecialSpellRiderUtils.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';

export function applyInstantSorcerySpecialAndRemovalRiders(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    oracleTextLower: string;
    targets: any[];
    targetControllerForRemovalEffects: PlayerID | undefined;
    targetPowerBeforeRemoval: number | undefined;
  },
): { shouldEarlyReturn: boolean } {
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const spellName = String(effectiveCard?.name || 'spell');

  if (skipRetiredSpellLegacyHandler(options.oracleTextLower, spellName)) {
    return { shouldEarlyReturn: false };
  }

  const specialSpellRiderResult = applySpellLegacySpecialSpellRiders(ctx, {
    cardName: effectiveCard.name,
    oracleTextLower: options.oracleTextLower,
    spellController: controller,
    targets: options.targets,
  });
  if (specialSpellRiderResult.shouldEarlyReturn) {
    return { shouldEarlyReturn: true };
  }

  applySpellLegacyRemovalRiders(ctx, {
    cardName: effectiveCard.name,
    oracleTextLower: options.oracleTextLower,
    targetController: options.targetControllerForRemovalEffects as PlayerID,
    targetPowerBeforeRemoval: options.targetPowerBeforeRemoval,
    spellController: controller,
    stackItemId: String(options.item.id || ''),
    targets: options.targets,
    sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
  });

  return { shouldEarlyReturn: false };
}
