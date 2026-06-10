import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { createBeastToken } from './oracleIrSpellLegacyTokenUtils.js';
import {
  computeRemovalTargetPowerBeforeRemoval,
  shouldCaptureRemovalTargetControllerMetadata,
  shouldCaptureRemovalTargetPower,
} from './oracleIrSpellLegacyRemovalRiderUtils.js';
import type {
  InstantSorceryRemovalTargetMetadata,
  InstantSorceryRemovalTargetMetadataOptions,
} from './stackResolveSharedTypes.js';

export type { InstantSorceryRemovalTargetMetadata } from './stackResolveSharedTypes.js';

export function captureInstantSorceryRemovalTargetMetadata(
  ctx: GameContext,
  options: InstantSorceryRemovalTargetMetadataOptions,
): InstantSorceryRemovalTargetMetadata {
  const state = (ctx as any).state;
  const targets = options.targets;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = options.oracleTextLower;

  const metadata: InstantSorceryRemovalTargetMetadata = {
    targetControllerForTokenCreation: null,
    targetControllerForRemovalEffects: null,
    targetPowerBeforeRemoval: 0,
    targetSpellControllerForSupplemental: null,
    targetSpellNameForSupplemental: '',
  };

  if (targets.length === 0 || targets[0] === undefined) {
    return metadata;
  }

  const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
  const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
  const targetStackItem = Array.isArray(state.stack)
    ? state.stack.find((stackItem: any) => String(stackItem?.id || '') === String(targetId || ''))
    : null;

  if (targetStackItem) {
    metadata.targetSpellControllerForSupplemental = String(targetStackItem.controller || '') as PlayerID;
    metadata.targetSpellNameForSupplemental = String(targetStackItem.card?.name || '');
  }

  if (!targetPerm) {
    return metadata;
  }

  if (oracleTextLower.includes('its controller creates')) {
    metadata.targetControllerForTokenCreation = targetPerm.controller as PlayerID;
    debug(2, `[captureInstantSorceryRemovalTargetMetadata] Captured target controller ${metadata.targetControllerForTokenCreation} for token creation`);
  }

  if (shouldCaptureRemovalTargetControllerMetadata(effectiveCard?.name || '', oracleTextLower)) {
    metadata.targetControllerForRemovalEffects = targetPerm.controller as PlayerID;

    if (shouldCaptureRemovalTargetPower(effectiveCard?.name || '', oracleTextLower)) {
      metadata.targetPowerBeforeRemoval = computeRemovalTargetPowerBeforeRemoval(targetPerm);
    }

    debug(
      2,
      `[captureInstantSorceryRemovalTargetMetadata] Captured target controller ${metadata.targetControllerForRemovalEffects} for removal spell effects (power: ${metadata.targetPowerBeforeRemoval})`,
    );
  }

  return metadata;
}

export function applyInstantSorceryItsControllerCreatesToken(
  ctx: GameContext,
  options: {
    effectiveCard: any;
    oracleText: string;
    targetControllerForTokenCreation: PlayerID | null;
  },
): void {
  const targetControllerForTokenCreation = options.targetControllerForTokenCreation;
  if (!targetControllerForTokenCreation) {
    return;
  }

  const effectiveCard = options.effectiveCard;
  const oracleText = String(options.oracleText || '');
  const tokenMatch = oracleText.match(/creates?\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+(?:(\w+)\s+)?(?:(\w+)\s+)?creature\s+token/i);
  if (!tokenMatch) {
    return;
  }

  const power = parseInt(tokenMatch[1], 10);
  const toughness = parseInt(tokenMatch[2], 10);
  const color = tokenMatch[3]?.toLowerCase() || 'green';
  const type1 = tokenMatch[4] || '';
  const type2 = tokenMatch[5] || '';
  const tokenType = type2 || type1 || 'Beast';
  const tokenName = `${tokenType} Token`;

  createBeastToken(ctx, targetControllerForTokenCreation, tokenName, power, toughness, color);
  debug(2, `[applyInstantSorceryItsControllerCreatesToken] ${effectiveCard?.name} created ${power}/${toughness} ${tokenName} for ${targetControllerForTokenCreation}`);
}
