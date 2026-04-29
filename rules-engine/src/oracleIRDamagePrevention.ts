import type { DamagePreventionEffect, GameState, PlayerID } from '../../shared/src';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { getStackItems } from './stackOperations';

function getCurrentTurnNumber(state: GameState): number {
  const turnNumber = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0);
  return Number.isFinite(turnNumber) ? turnNumber : 0;
}

function findDamageSourceObject(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  const battlefieldMatch = (state.battlefield || []).find(
    (permanent: any) => String((permanent as any)?.id || '').trim() === normalizedSourceId
  );
  if (battlefieldMatch) return battlefieldMatch;

  const stackMatch = getStackItems((state as any)?.stack).find(
    (item: any) => String((item as any)?.id || '').trim() === normalizedSourceId
  );
  if (stackMatch) return stackMatch;

  return null;
}

export function createSourceColorDamagePreventionEffect(params: {
  state: GameState;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  targetSourceId: string;
  colors: readonly string[];
  description: string;
}): DamagePreventionEffect {
  const currentTurn = getCurrentTurnNumber(params.state);
  return {
    id: `${String(params.sourceId || 'oracle-ir').trim() || 'oracle-ir'}:prevent:${String(params.targetSourceId || '').trim()}:${currentTurn}`,
    description: params.description,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    controllerId: params.controllerId as any,
    targetSourceId: params.targetSourceId,
    colors: [...params.colors],
    expiresAtTurn: currentTurn,
  };
}

export function createGlobalCombatDamagePreventionEffect(params: {
  state: GameState;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  description: string;
}): DamagePreventionEffect {
  const currentTurn = getCurrentTurnNumber(params.state);
  return {
    id: `${String(params.sourceId || 'oracle-ir').trim() || 'oracle-ir'}:prevent:combat:${currentTurn}`,
    description: params.description,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    controllerId: params.controllerId as any,
    targetSourceId: '*',
    combatOnly: true,
    expiresAtTurn: currentTurn,
  };
}

export function createTargetDamagePreventionEffect(params: {
  state: GameState;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  amount: number;
  description: string;
}): DamagePreventionEffect {
  const currentTurn = getCurrentTurnNumber(params.state);
  const targetRef = String(params.targetPlayerId || params.targetPermanentId || 'target').trim() || 'target';
  return {
    id: `${String(params.sourceId || 'oracle-ir').trim() || 'oracle-ir'}:prevent:shield:${targetRef}:${currentTurn}`,
    description: params.description,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    controllerId: params.controllerId as any,
    targetSourceId: '*',
    targetPlayerId: params.targetPlayerId,
    targetPermanentId: params.targetPermanentId,
    remainingAmount: Math.max(0, Number(params.amount) || 0),
    expiresAtTurn: currentTurn,
  };
}

export function createTargetAllDamagePreventionEffect(params: {
  state: GameState;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  description: string;
}): DamagePreventionEffect {
  const currentTurn = getCurrentTurnNumber(params.state);
  const targetRef = String(params.targetPlayerId || params.targetPermanentId || 'target').trim() || 'target';
  return {
    id: `${String(params.sourceId || 'oracle-ir').trim() || 'oracle-ir'}:prevent:all-shield:${targetRef}:${currentTurn}`,
    description: params.description,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    controllerId: params.controllerId as any,
    targetSourceId: '*',
    targetPlayerId: params.targetPlayerId,
    targetPermanentId: params.targetPermanentId,
    expiresAtTurn: currentTurn,
  };
}

export function createSourceChoiceDamagePreventionEffect(params: {
  state: GameState;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  targetSourceId: string;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  description: string;
}): DamagePreventionEffect {
  const currentTurn = getCurrentTurnNumber(params.state);
  const targetRef = String(params.targetPlayerId || params.targetPermanentId || 'target').trim() || 'target';
  return {
    id: `${String(params.sourceId || 'oracle-ir').trim() || 'oracle-ir'}:prevent:source-choice:${String(params.targetSourceId || '').trim()}:${targetRef}:${currentTurn}`,
    description: params.description,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    controllerId: params.controllerId as any,
    targetSourceId: params.targetSourceId,
    targetPlayerId: params.targetPlayerId,
    targetPermanentId: params.targetPermanentId,
    consumeOnUse: true,
    expiresAtTurn: currentTurn,
  };
}

export function registerDamagePreventionEffect(
  state: GameState,
  effect: DamagePreventionEffect
): GameState {
  const existing = Array.isArray((state as any)?.damagePreventionEffects)
    ? [ ...((state as any).damagePreventionEffects as DamagePreventionEffect[]) ]
    : [];

  const nextEffects = existing.filter((entry) => String(entry?.id || '').trim() !== String(effect.id || '').trim());
  nextEffects.push(effect);

  return {
    ...(state as any),
    damagePreventionEffects: nextEffects,
  } as GameState;
}

export function registerDamageCantBePreventedThisTurn(state: GameState): GameState {
  const currentTurn = getCurrentTurnNumber(state);
  return {
    ...(state as any),
    damageCantBePreventedUntilTurn: currentTurn,
  } as GameState;
}

export function previewPreventedDamage(
  state: GameState,
  amount: number,
  damageSourceId?: string,
  options?: {
    readonly combatDamage?: boolean;
    readonly targetPlayerId?: PlayerID;
    readonly targetPermanentId?: string;
  }
): {
  readonly prevented: number;
  readonly remainingDamage: number;
  readonly log: readonly string[];
  readonly state?: GameState;
} {
  const normalizedSourceId = String(damageSourceId || '').trim();
  const initialAmount = Math.max(0, Number(amount) || 0);
  const normalizedTargetPlayerId = String(options?.targetPlayerId || '').trim() as PlayerID;
  const normalizedTargetPermanentId = String(options?.targetPermanentId || '').trim();
  const preventionLockedTurn = Number((state as any)?.damageCantBePreventedUntilTurn);
  if (Number.isFinite(preventionLockedTurn) && preventionLockedTurn === getCurrentTurnNumber(state)) {
    return {
      prevented: 0,
      remainingDamage: initialAmount,
      log: [],
    };
  }
  if (initialAmount <= 0) {
    return {
      prevented: 0,
      remainingDamage: initialAmount,
      log: [],
    };
  }

  const activeEffects = Array.isArray((state as any)?.damagePreventionEffects)
    ? ((state as any).damagePreventionEffects as DamagePreventionEffect[])
    : [];
  if (activeEffects.length === 0) {
    return {
      prevented: 0,
      remainingDamage: initialAmount,
      log: [],
    };
  }

  const currentTurn = getCurrentTurnNumber(state);
  const sourceObject = findDamageSourceObject(state, normalizedSourceId);
  const sourceColors = sourceObject ? getColorsFromObject(sourceObject).map((color) => String(color || '').trim().toUpperCase()) : [];

  for (const effect of activeEffects) {
    const targetSourceId = String(effect?.targetSourceId || '').trim();
    if (targetSourceId !== '*' && targetSourceId !== normalizedSourceId) continue;
    const effectTargetPlayerId = String(effect?.targetPlayerId || '').trim() as PlayerID;
    if (effectTargetPlayerId && effectTargetPlayerId !== normalizedTargetPlayerId) continue;
    const effectTargetPermanentId = String(effect?.targetPermanentId || '').trim();
    if (effectTargetPermanentId && effectTargetPermanentId !== normalizedTargetPermanentId) continue;
    const expiresAtTurn = Number((effect as any)?.expiresAtTurn);
    if (Number.isFinite(expiresAtTurn) && expiresAtTurn !== currentTurn) continue;
    if (effect?.combatOnly === true && options?.combatDamage !== true) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color) => sourceColors.includes(color))) continue;

    const numericRemainingAmount = Number(effect?.remainingAmount);
    const remainingShieldAmount = Number.isFinite(numericRemainingAmount)
      ? Math.max(0, numericRemainingAmount)
      : null;
    const prevented = remainingShieldAmount === null ? initialAmount : Math.min(initialAmount, remainingShieldAmount);
    if (prevented <= 0) continue;

    let nextState: GameState | undefined;
    if ((effect as any)?.consumeOnUse === true) {
      const nextEffects = activeEffects.filter((entry) => String(entry?.id || '').trim() !== String(effect?.id || '').trim());
      nextState = {
        ...(state as any),
        damagePreventionEffects: nextEffects,
      } as GameState;
    } else if (remainingShieldAmount !== null) {
      const nextRemainingAmount = remainingShieldAmount - prevented;
      const nextEffects = activeEffects.flatMap((entry) => {
        if (String(entry?.id || '').trim() !== String(effect?.id || '').trim()) {
          return [entry];
        }
        if (nextRemainingAmount <= 0) {
          return [];
        }
        return [{
          ...entry,
          remainingAmount: nextRemainingAmount,
        }];
      });
      nextState = {
        ...(state as any),
        damagePreventionEffects: nextEffects,
      } as GameState;
    }

    return {
      prevented,
      remainingDamage: Math.max(0, initialAmount - prevented),
      log: [
        effect?.combatOnly === true
          ? `Prevented ${prevented} combat damage from ${normalizedSourceId || 'the source'}`
          : `Prevented ${prevented} damage from ${normalizedSourceId || 'the source'}`,
      ],
      ...(nextState ? { state: nextState } : {}),
    };
  }

  return {
    prevented: 0,
    remainingDamage: initialAmount,
    log: [],
  };
}
