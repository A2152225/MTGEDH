import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getAmountOfManaSpent } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { splitCardMatchesName } from './splitCards';

type ConditionalCondition = Extract<OracleEffectStep, { kind: 'conditional' }>['condition'];

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
} | null;

function parseSmallNumberWord(raw: string): number | null {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const lookup: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[text]) ? lookup[text] : null;
}

export function evaluateConditionalWrapperCondition(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  controllerId: PlayerID;
  ctx: OracleIRExecutionContext;
  lastActionOutcome: LastActionOutcome;
}): boolean | null {
  const { condition, nextState, controllerId, ctx, lastActionOutcome } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const generic = evaluateModifyPtCondition(nextState, controllerId, condition.raw);
  if (generic !== null) return generic;

  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
  if (!sourceRef) return null;

  const raw = String(condition.raw || '').trim().toLowerCase();

  if (/^you (?:don't|do not)\b/i.test(raw)) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied') return false;
    return null;
  }

  if (raw === "you can't" || raw === 'you cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied' || lastActionOutcome?.kind === 'choice_required') return false;
    return null;
  }

  if (raw === 'you win the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? ctx.wonCoinFlip : null;
  }

  {
    const voteWinnerMatch = raw.match(/^([a-z0-9][a-z0-9' -]*) gets more votes$/i);
    if (voteWinnerMatch) {
      const expected = String(voteWinnerMatch[1] || '').trim().toLowerCase();
      const actual = String(ctx.winningVoteChoice || '').trim().toLowerCase();
      if (!expected || !actual) return null;
      return actual === expected;
    }
  }

  if (raw === 'that card has the chosen name') {
    const chosenName = String((sourceRef as any)?.chosenCardName || (sourceRef as any)?.card?.chosenCardName || '').trim();
    if (!chosenName) return null;

    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
    const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
    if (!topCard) return null;

    const normalizedChosenName = chosenName.toLowerCase();
    const topCardNames = new Set<string>();
    const pushName = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) topCardNames.add(normalized);
    };
    pushName((topCard as any)?.name);
    for (const face of Array.isArray((topCard as any)?.card_faces) ? (topCard as any).card_faces : []) {
      pushName((face as any)?.name);
    }
    if (topCardNames.has(normalizedChosenName)) return true;

    const leftName = String((topCard as any)?.leftHalf?.name || '').trim();
    const rightName = String((topCard as any)?.rightHalf?.name || '').trim();
    if (leftName && rightName) {
      try {
        return splitCardMatchesName(
          {
            type: 'split-card',
            leftHalf: {
              name: leftName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            rightHalf: {
              name: rightName,
              manaCost: '',
              types: [],
              subtypes: [],
              supertypes: [],
              text: '',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
            },
            hasSharedTypeLine: false,
          },
          chosenName
        );
      } catch {
        return null;
      }
    }
    return false;
  }

  if (raw === 'all five types on this permanent have counters over them') {
    const counters = ((sourceRef as any)?.counters || (sourceRef as any)?.card?.counters || {}) as Record<string, unknown>;
    const requiredKeys = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery'];
    return requiredKeys.every(key => Number((counters as any)[key]) > 0);
  }

  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    if (!Number.isFinite(rolled)) return null;
    const manaValue = getCardManaValue((sourceRef as any)?.card || sourceRef);
    if (manaValue === null) return null;
    return rolled === manaValue;
  }

  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (manaSpentMatch) {
    const threshold = parseSmallNumberWord(String(manaSpentMatch[1] || ''));
    if (threshold === null) return null;
    const spent = getAmountOfManaSpent(sourceRef);
    if (spent === null) return null;
    return spent >= threshold;
  }

  return null;
}

export function resolveConditionalReferenceAmount(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  ctx: OracleIRExecutionContext;
}): number | null {
  const { condition, nextState, ctx } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
  if (!sourceRef) return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (!manaSpentMatch) return null;

  return getAmountOfManaSpent(sourceRef);
}

export function applyConditionalReferenceAmount(step: OracleEffectStep, resolvedAmount: number | null): OracleEffectStep {
  if (resolvedAmount === null || !('amount' in (step as any))) return step;

  const amount = (step as any).amount;
  const raw = String(amount?.raw || '').trim().toLowerCase();
  if (amount?.kind !== 'unknown' || raw !== 'that much') return step;

  return {
    ...(step as any),
    amount: { kind: 'number', value: Math.max(0, resolvedAmount) },
  } as OracleEffectStep;
}
