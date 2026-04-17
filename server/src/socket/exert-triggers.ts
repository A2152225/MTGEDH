import { appendEvent } from '../db/index.js';
import { inferTriggeredAbilityTargetMetadata } from '../state/modules/stack.js';
import { uid } from '../state/utils.js';
import { debugWarn } from '../utils/debug.js';

function cloneExertTriggerPermanentSnapshot(permanent: any): any {
  if (!permanent || typeof permanent !== 'object') {
    return undefined;
  }

  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object'
      ? { card: { ...permanent.card } }
      : null),
    ...(permanent.counters && typeof permanent.counters === 'object'
      ? { counters: { ...permanent.counters } }
      : null),
  };
}

export function getWheneverYouExertTriggerEffects(card: any): string[] {
  const oracleText = String(card?.oracle_text || '');
  if (!oracleText) {
    return [];
  }

  return oracleText
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^whenever you exert a creature,\s*(.+)$/i);
      if (!match) {
        return [];
      }

      const effectText = String(match[1] || '')
        .replace(/\s*\([^)]*\)\s*$/i, '')
        .trim();
      return effectText ? [effectText] : [];
    });
}

export function pushWheneverYouExertTriggersOntoStack(
  game: any,
  gameId: string,
  controllerId: string,
): void {
  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== controllerId) {
      continue;
    }

    const effectTexts = getWheneverYouExertTriggerEffects((permanent as any).card);
    if (effectTexts.length === 0) {
      continue;
    }

    const sourceSnapshot = cloneExertTriggerPermanentSnapshot(permanent);
    const sourceName = String(permanent?.card?.name || sourceSnapshot?.card?.name || 'Triggered Ability').trim() || 'Triggered Ability';

    for (const effectText of effectTexts) {
      const metadata = inferTriggeredAbilityTargetMetadata(effectText, {
        gameState: game.state,
        controllerId,
        sourceName,
        sourcePermanent: permanent,
      });
      const payload = {
        triggerId: uid('trigger'),
        sourceId: String(permanent?.id || sourceSnapshot?.id || ''),
        ...(permanent?.id || sourceSnapshot?.id ? { permanentId: String(permanent?.id || sourceSnapshot?.id || '') } : null),
        sourceName,
        controllerId,
        description: effectText,
        triggerType: 'whenever_you_exert',
        effect: effectText,
        mandatory: true,
        ...(typeof metadata.requiresTarget === 'boolean' ? { requiresTarget: metadata.requiresTarget } : null),
        ...(metadata.targetType ? { targetType: metadata.targetType } : null),
        ...(metadata.targetConstraint ? { targetConstraint: metadata.targetConstraint } : null),
        ...(metadata.requiresTarget === true ? { needsTargetSelection: true } : null),
        ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
        ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
        ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
        ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
        ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
        ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
        ...(metadata.targetAction ? { targetAction: metadata.targetAction } : null),
        ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
        ...(Array.isArray(metadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: metadata.targetFilterRequiredTypeWords } : null),
        ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
        ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
        ...(typeof metadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: metadata.targetFilterExactManaValue } : null),
        ...(typeof metadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: metadata.targetFilterMinManaValue } : null),
        ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
        ...(typeof metadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: metadata.targetTotalPowerLimit } : null),
        ...(metadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
        ...(metadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
        ...(typeof metadata.minTargets === 'number' ? { minTargets: metadata.minTargets } : null),
        ...(typeof metadata.maxTargets === 'number' ? { maxTargets: metadata.maxTargets } : null),
        ...(permanent?.card && typeof permanent.card === 'object' ? { card: { ...permanent.card } } : null),
        ...(sourceSnapshot && typeof sourceSnapshot === 'object' ? { sourcePermanentSnapshot: sourceSnapshot } : null),
      } as any;

      if (typeof (game as any).applyEvent === 'function') {
        (game as any).applyEvent({
          type: 'pushTriggeredAbility',
          ...payload,
        });
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', payload);
      } catch (err) {
        debugWarn(1, '[exert-triggers] Failed to persist whenever-you-exert trigger pushTriggeredAbility:', err);
      }
    }
  }
}