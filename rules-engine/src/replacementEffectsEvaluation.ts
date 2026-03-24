import type { KnownCardRef } from '../../shared/src';
import type {
  ETBConditionCheck,
  ParsedReplacementEffect,
  ReplacementResult,
} from './replacementEffectsTypes';
import { ReplacementEffectType } from './replacementEffectsTypes';

/**
 * Evaluate conditional ETB replacement effects
 * Examples:
 * - "unless you control two or fewer other lands" (fast lands)
 * - "unless you control a [type]" (check lands)
 * - "you may pay 2 life" (shock lands)
 */
export function evaluateETBCondition(
  card: KnownCardRef,
  controlledLandCount: number,
  controlledLandTypes: string[],
  paidLife?: boolean
): ETBConditionCheck {
  const text = (card.oracle_text || '').toLowerCase();

  if (text.includes('enters the battlefield tapped') && !text.includes('unless')) {
    return { entersTapped: true, reason: 'Always enters tapped' };
  }

  if (text.includes('pay 2 life') && text.includes('enters') && text.includes('tapped')) {
    if (paidLife === true) {
      return { entersTapped: false, reason: 'Paid 2 life', playerChoice: true };
    }
    return { entersTapped: true, reason: 'Did not pay life', playerChoice: true };
  }

  const fastLandMatch = text.match(/enters the battlefield tapped unless you control two or fewer other lands/i);
  if (fastLandMatch) {
    const entersTapped = controlledLandCount > 2;
    return {
      entersTapped,
      reason: entersTapped ? 'Control more than 2 other lands' : 'Control 2 or fewer other lands',
    };
  }

  const slowLandMatch = text.match(/enters the battlefield tapped unless you control two or more other lands/i);
  if (slowLandMatch) {
    const entersTapped = controlledLandCount < 2;
    return {
      entersTapped,
      reason: entersTapped ? 'Control fewer than 2 other lands' : 'Control 2 or more other lands',
    };
  }

  const checkLandMatch = text.match(/enters the battlefield tapped unless you control (?:a|an) ([\w\s]+)/i);
  if (checkLandMatch) {
    const requiredType = checkLandMatch[1].trim().toLowerCase();
    const requiredTypes = requiredType.split(/\s+or\s+/).map(t => t.trim());

    const hasRequiredType = requiredTypes.some(reqType =>
      controlledLandTypes.some(controlled => controlled.toLowerCase().includes(reqType))
    );

    return {
      entersTapped: !hasRequiredType,
      reason: hasRequiredType ? `Control a ${requiredType}` : `Don't control a ${requiredType}`,
    };
  }

  return { entersTapped: false };
}

/**
 * Apply replacement effect to an event
 */
export function applyReplacementEffect(
  effect: ParsedReplacementEffect,
  event: any
): ReplacementResult {
  const logs: string[] = [];

  switch (effect.type) {
    case ReplacementEffectType.ENTERS_TAPPED:
      logs.push(`${effect.sourceId} enters tapped (replacement effect)`);
      return {
        applied: true,
        modifiedEvent: { ...event, entersTapped: true },
        log: logs,
      };

    case ReplacementEffectType.ENTERS_WITH_COUNTERS:
      if (effect.value) {
        const [count, counterType] = (effect.value as string).split(':');
        logs.push(`${effect.sourceId} enters with ${count} ${counterType} counter(s)`);
        return {
          applied: true,
          modifiedEvent: { ...event, counters: { [counterType]: parseInt(count) } },
          log: logs,
        };
      }
      return { applied: false, log: logs };

    case ReplacementEffectType.PREVENT_DAMAGE: {
      const preventAmount = effect.value as number | undefined;
      if (preventAmount !== undefined) {
        const actualPrevented = Math.min(preventAmount, event.damage || 0);
        logs.push(`Prevented ${actualPrevented} damage`);
        return {
          applied: true,
          modifiedEvent: { ...event, damage: (event.damage || 0) - actualPrevented },
          log: logs,
        };
      }

      logs.push('Prevented all damage');
      return {
        applied: true,
        modifiedEvent: { ...event, damage: 0 },
        preventedEvent: true,
        log: logs,
      };
    }

    case ReplacementEffectType.EXTRA_TOKENS: {
      const tokenCount = event.tokenCount || 1;
      logs.push(`Token doubling: creating ${tokenCount * 2} tokens instead of ${tokenCount}`);
      return {
        applied: true,
        modifiedEvent: { ...event, tokenCount: tokenCount * 2 },
        log: logs,
      };
    }

    case ReplacementEffectType.EXTRA_COUNTERS: {
      const counterCount = event.counterCount || 1;
      logs.push(`Counter doubling: placing ${counterCount * 2} counters instead of ${counterCount}`);
      return {
        applied: true,
        modifiedEvent: { ...event, counterCount: counterCount * 2 },
        log: logs,
      };
    }

    case ReplacementEffectType.MODIFIED_COUNTERS: {
      const baseCounterCount = event.counterCount || 1;
      let modifiedCount = baseCounterCount;
      if (effect.value === '+1') {
        modifiedCount = baseCounterCount + 1;
        logs.push(`Counter modification: placing ${modifiedCount} counters instead of ${baseCounterCount} (Hardened Scales effect)`);
      } else if (typeof effect.value === 'number') {
        modifiedCount = baseCounterCount + effect.value;
        logs.push(`Counter modification: placing ${modifiedCount} counters instead of ${baseCounterCount}`);
      }
      return {
        applied: true,
        modifiedEvent: { ...event, counterCount: modifiedCount },
        log: logs,
      };
    }

    case ReplacementEffectType.ENTERS_CONDITIONAL:
      if (event.playerMadeChoice === true) {
        logs.push(`${effect.sourceId} enters the battlefield (player performed ${effect.requiredAction})`);
        return {
          applied: true,
          modifiedEvent: { ...event, enters: true, performedAction: effect.requiredAction },
          log: logs,
        };
      }
      if (event.playerMadeChoice === false) {
        logs.push(`${effect.sourceId} is put into graveyard (player did not ${effect.requiredAction})`);
        return {
          applied: true,
          modifiedEvent: { ...event, enters: false, goesToGraveyard: true },
          preventedEvent: true,
          log: logs,
        };
      }
      logs.push(`${effect.sourceId} awaiting player choice: ${effect.requiredAction}`);
      return {
        applied: false,
        modifiedEvent: { ...event, awaitingChoice: true, requiredAction: effect.requiredAction, elseEffect: effect.elseEffect },
        log: logs,
      };

    case ReplacementEffectType.COMBAT_DAMAGE_TO_MILL: {
      const damageAmount = event.damage || 0;
      if (damageAmount > 0) {
        if (effect.appliesToTypes && effect.appliesToTypes.length > 0) {
          const creatureTypes = event.attackerTypes || [];
          const typeMatches = effect.appliesToTypes.some(t =>
            creatureTypes.some((ct: string) => ct.toLowerCase() === t.toLowerCase())
          );
          if (!typeMatches) {
            return { applied: false, log: logs };
          }
        }
        logs.push(`Combat damage replaced with mill: player mills ${damageAmount} cards instead`);
        return {
          applied: true,
          modifiedEvent: {
            ...event,
            damage: 0,
            millAmount: damageAmount,
            replacedByMill: true,
          },
          preventedEvent: true,
          log: logs,
        };
      }
      return { applied: false, log: logs };
    }

    case ReplacementEffectType.GRAVEYARD_TO_EXILE:
      logs.push(`Card would go to graveyard - exiled instead by ${effect.sourceId}`);
      return {
        applied: true,
        modifiedEvent: {
          ...event,
          destination: 'exile',
          originalDestination: 'graveyard',
          replacedByExile: true,
        },
        log: logs,
      };

    case ReplacementEffectType.MILL_TO_EXILE: {
      const millCount = typeof effect.value === 'string' && effect.value === 'X'
        ? (event.xValue || 0)
        : (typeof effect.value === 'number' ? effect.value : parseInt(effect.value as string) || 0);
      logs.push(`Milling ${millCount} cards to exile instead of graveyard`);
      return {
        applied: true,
        modifiedEvent: {
          ...event,
          millCount,
          destination: 'exile',
          exiledFromLibrary: true,
        },
        log: logs,
      };
    }

    default:
      return { applied: false, log: logs };
  }
}
