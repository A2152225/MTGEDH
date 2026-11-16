/**
 * Trigger effect riders: intervening-if, reflexive "When you do", and delayed "next end step"
 * tails. Split from parseFamilies.ts with no behavior change; parseFamilies.ts re-exports these.
 */

import type { TriggerConditionIR } from './types.js';

export interface TriggerReflexiveRider {
  readonly actor: 'you' | 'they';
  readonly effect: string;
  readonly delayed?: TriggerDelayedRider;
}

export interface TriggerDelayedRider {
  readonly timing: 'next_end_step' | 'your_next_end_step' | 'end_step_on_your_next_turn' | 'that_player_next_end_step';
  readonly effect: string;
}

export interface ParsedTriggerClause {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
  readonly interveningIf?: string;
  readonly reflexive?: TriggerReflexiveRider;
  readonly delayed?: TriggerDelayedRider;
}

function splitDelayedTail(effect: string): { effect: string; delayed?: TriggerDelayedRider } {
  const delayedMatch = /\bat the beginning of (your next|the next) end step,\s+([\s\S]+)$/i.exec(effect);
  if (!delayedMatch || delayedMatch.index === undefined) return { effect };
  return {
    effect: effect.slice(0, delayedMatch.index).replace(/[.\s]+$/, '').trim(),
    delayed: {
      timing: delayedMatch[1].toLowerCase().startsWith('your') ? 'your_next_end_step' : 'next_end_step',
      effect: delayedMatch[2].trim(),
    },
  };
}

/** Pull intervening-if, "when you do", and "next end step" off a trigger effect. */
export function splitTriggerEffectRiders(effect: string): Omit<ParsedTriggerClause, 'condition'> {
  let text = String(effect || '').trim();
  let interveningIf: string | undefined;
  const ifMatch = /^if\s+(.+?),\s+([\s\S]+)$/i.exec(text);
  if (ifMatch && !/^(?:you|they)\s+do\b/i.test(ifMatch[1])) {
    interveningIf = ifMatch[1].trim();
    text = ifMatch[2].trim();
  }

  let delayed: TriggerDelayedRider | undefined;
  let reflexive: TriggerReflexiveRider | undefined;
  const reflex = /\b(?:when|if)\s+(you|they)\s+do,\s+([\s\S]+)$/i.exec(text);
  if (reflex && reflex.index !== undefined) {
    const rider = splitDelayedTail(reflex[2].trim());
    reflexive = {
      actor: reflex[1].toLowerCase() === 'they' ? 'they' : 'you',
      effect: rider.effect,
      ...(rider.delayed ? { delayed: rider.delayed } : {}),
    };
    text = text.slice(0, reflex.index).replace(/[.\s]+$/, '').trim();
  } else {
    const mainTail = splitDelayedTail(text);
    delayed = mainTail.delayed;
    text = mainTail.effect;
  }

  return {
    effect: text,
    ...(interveningIf ? { interveningIf } : {}),
    ...(reflexive ? { reflexive } : {}),
    ...(delayed ? { delayed } : {}),
  };
}
