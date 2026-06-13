import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import {
  resolveGreatestManaValueExiledThisWay,
  resolveGreatestPowerExiledThisWay,
  resolveCreatureCountExiledThisWay,
  resolveNonlandCountDiscardedThisWay,
  resolveSnapshotCountAtAntecedent,
} from './oracleIRThisWayResolver';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import type { OracleEffectStep } from './oracleIR';

type CountCardsExiledWithSource = (
  state: GameState,
  sourceId: string,
  typeFilter?: string
) => number;
type FindObjectByName = (name: string) => unknown | null;
type GreatestPowerAmongCreatureCards = (cards: readonly unknown[]) => number;
type GreatestManaValueAmongCards = (cards: readonly unknown[]) => number;

function resolveDiscardedAntecedentStepIndex(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): number | null {
  if (!ctx) return null;
  if (step) {
    const fromStep = resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'discard');
    if (fromStep !== null) return fromStep;
  }
  if (ctx.currentStepIndex == null) return null;
  return findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex);
}

function resolveExileAntecedentStepIndex(
  ctx: OracleIRExecutionContext | undefined,
  explicitAntecedentStepIndex: number | null | undefined,
  step?: OracleEffectStep,
): number | null {
  if (typeof explicitAntecedentStepIndex === 'number' && explicitAntecedentStepIndex >= 0) {
    return explicitAntecedentStepIndex;
  }
  if (step) {
    const fromStep = resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'exile');
    if (fromStep !== null) return fromStep;
  }
  if (ctx?.currentStepIndex == null) return null;
  return findAntecedentStepIndex(ctx.appliedStepKinds, 'exile', ctx.currentStepIndex);
}

export function tryEvaluateModifyPtWhereExileAndCardStats(args: {
  state: GameState;
  raw: string;
  battlefield: readonly unknown[];
  controllerId: string;
  ctx?: OracleIRExecutionContext;
  antecedentStepIndex?: number | null;
  step?: OracleEffectStep;
  countCardsExiledWithSource: CountCardsExiledWithSource;
  findObjectByName: FindObjectByName;
  greatestPowerAmongCreatureCards: GreatestPowerAmongCreatureCards;
  greatestManaValueAmongCards: GreatestManaValueAmongCards;
}): number | null {
  const {
    state,
    raw,
    controllerId,
    ctx,
    countCardsExiledWithSource,
    findObjectByName,
    greatestPowerAmongCreatureCards,
    greatestManaValueAmongCards,
  } = args;

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with this (?:permanent|creature|artifact|enchantment|planeswalker|card)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return countCardsExiledWithSource(state, sourceId, m[1]);
    }
  }

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with (?!this\b)([a-z][a-z0-9 ,.'\u2019-]*)$/i);
    if (m) {
      const namedPermanent = findObjectByName(String(m[2] || '')) as any;
      const namedId = String((namedPermanent as any)?.id || '').trim();
      if (!namedId) return null;

      return countCardsExiledWithSource(state, namedId, m[1]);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? in (?:your graveyard|all graveyards|(?:your opponents?|their) graveyard)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      const allGy = /all graveyards/.test(clause);
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (!allGy && pid !== controllerId) continue;
        const gy = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
        cards.push(...gy);
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? exiled this way$/i);
    if (m) {
      const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, args.antecedentStepIndex, args.step);
      if (antecedentStepIndex != null && ctx?.stepLedger?.size) {
        const fromLedger = resolveGreatestPowerExiledThisWay(ctx, antecedentStepIndex);
        if (fromLedger !== null) return fromLedger;
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
        for (const card of exile as any[]) {
          if (sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among cards? (?:in your graveyard|discarded this way|exiled this way)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      if (/exiled this way/.test(clause)) {
        const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, args.antecedentStepIndex, args.step);
        if (antecedentStepIndex != null && ctx?.stepLedger?.size) {
          const fromLedger = resolveGreatestManaValueExiledThisWay(ctx, antecedentStepIndex);
          if (fromLedger !== null) return fromLedger;
        }
      }
      if (/discarded this way/.test(clause)) {
        const antecedentStepIndex = resolveDiscardedAntecedentStepIndex(ctx, args.step);
        if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
          return resolveNonlandCountDiscardedThisWay(ctx, antecedentStepIndex);
        }
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (pid !== controllerId) continue;
        const isExile = /exiled this way/.test(clause);
        const zone: readonly any[] = isExile
          ? (Array.isArray((player as any)?.exile) ? (player as any).exile : [])
          : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
        for (const card of zone as any[]) {
          if (isExile && sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestManaValueAmongCards(cards);
    }
  }

  {
    const m = raw.match(/^x is the number of nonland cards discarded this way$/i);
    if (m && ctx?.stepLedger?.size) {
      const antecedentStepIndex = resolveDiscardedAntecedentStepIndex(ctx, args.step);
      if (antecedentStepIndex != null) {
        return resolveNonlandCountDiscardedThisWay(ctx, antecedentStepIndex);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of creatures exiled this way$/i);
    if (m && ctx?.stepLedger?.size) {
      const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, args.antecedentStepIndex, args.step);
      if (antecedentStepIndex != null) {
        return resolveCreatureCountExiledThisWay(ctx, antecedentStepIndex);
      }
    }
  }

  {
    const m = raw.match(/^x is the number of cards exiled this way$/i);
    if (m && ctx?.stepLedger?.size) {
      const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, args.antecedentStepIndex, args.step);
      if (antecedentStepIndex != null) {
        return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
      }
    }
  }

  return null;
}
