import type { DamagePreventionEffect, GameState } from '../../shared/src';
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

export function previewPreventedDamage(state: GameState, amount: number, damageSourceId?: string): {
  readonly prevented: number;
  readonly remainingDamage: number;
  readonly log: readonly string[];
} {
  const normalizedSourceId = String(damageSourceId || '').trim();
  const initialAmount = Math.max(0, Number(amount) || 0);
  if (!normalizedSourceId || initialAmount <= 0) {
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
    if (String(effect?.targetSourceId || '').trim() !== normalizedSourceId) continue;
    const expiresAtTurn = Number((effect as any)?.expiresAtTurn);
    if (Number.isFinite(expiresAtTurn) && expiresAtTurn !== currentTurn) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color) => sourceColors.includes(color))) continue;

    return {
      prevented: initialAmount,
      remainingDamage: 0,
      log: [`Prevented ${initialAmount} damage from ${normalizedSourceId}`],
    };
  }

  return {
    prevented: 0,
    remainingDamage: initialAmount,
    log: [],
  };
}
