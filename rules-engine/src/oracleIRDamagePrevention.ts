import type { DamagePreventionEffect, GameState, PlayerID } from '../../shared/src';
import { cardHasCreatureType } from '../../shared/src/creatureTypes';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { getStackItems } from './stackOperations';
import { protectionPreventsDamageToPermanent } from './oracleIRDamageProtection';

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

  // Resolving spells: ctx.sourceId is often the card id (stack item keyed differently, or the
  // card already moved to its destination zone while the effect finishes).
  const stackCardMatch = getStackItems((state as any)?.stack).find(
    (item: any) => String((item as any)?.card?.id || '').trim() === normalizedSourceId
  );
  if (stackCardMatch) return stackCardMatch;
  const zones = (state as any)?.zones;
  if (zones && typeof zones === 'object') {
    for (const zone of Object.values(zones) as any[]) {
      for (const key of ['graveyard', 'exile', 'hand']) {
        const list = Array.isArray(zone?.[key]) ? zone[key] : [];
        const card = list.find((entry: any) => String(entry?.id || '').trim() === normalizedSourceId);
        if (card) return card;
      }
    }
  }

  return null;
}

export function isUnblockedAttacker(state: GameState, sourceId: string): boolean {
  const source = findDamageSourceObject(state, sourceId);
  if (!source) return false;
  const attacking = (source as { attacking?: unknown }).attacking;
  if (!attacking) return false;
  const blockedBy = (source as { blockedBy?: unknown }).blockedBy;
  return !Array.isArray(blockedBy) || blockedBy.length === 0;
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
  combatOnly?: boolean;
  unblockedOnly?: boolean;
  capTo?: number;
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
    combatOnly: params.combatOnly,
    unblockedOnly: params.unblockedOnly,
    capTo: params.capTo,
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

  // Protection (rule 702.16e) prevents all damage from sources with the protected quality.
  if (normalizedTargetPermanentId) {
    const targetPermanent = (state.battlefield || []).find(
      (permanent: any) => String((permanent as any)?.id || '').trim() === normalizedTargetPermanentId
    );
    const protectionSource = findDamageSourceObject(state, normalizedSourceId);
    if (targetPermanent && protectionSource && protectionPreventsDamageToPermanent(state, protectionSource, targetPermanent)) {
      return {
        prevented: initialAmount,
        remainingDamage: 0,
        log: [`Protection prevented ${initialAmount} damage from ${normalizedSourceId || 'the source'} to ${normalizedTargetPermanentId}`],
      };
    }
  }

  const staticCap = capDamageFromStaticPreventAllBut(
    state,
    initialAmount,
    normalizedTargetPermanentId,
    normalizedTargetPlayerId,
  );
  const amountToApply = staticCap.remaining;
  const staticLog = staticCap.log;
  if (amountToApply <= 0) {
    return {
      prevented: initialAmount,
      remainingDamage: 0,
      log: staticLog,
    };
  }

  const activeEffects = Array.isArray((state as any)?.damagePreventionEffects)
    ? ((state as any).damagePreventionEffects as DamagePreventionEffect[])
    : [];
  if (activeEffects.length === 0) {
    return {
      prevented: initialAmount - amountToApply,
      remainingDamage: amountToApply,
      log: staticLog,
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
    if (effect?.unblockedOnly === true && !isUnblockedAttacker(state, normalizedSourceId)) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color) => sourceColors.includes(color))) continue;

    const capTo = Number(effect?.capTo);
    const hasCap = Number.isFinite(capTo);
    const numericRemainingAmount = Number(effect?.remainingAmount);
    const remainingShieldAmount = Number.isFinite(numericRemainingAmount)
      ? Math.max(0, numericRemainingAmount)
      : null;
    const prevented = hasCap
      ? Math.max(0, amountToApply - Math.min(amountToApply, Math.max(0, capTo)))
      : remainingShieldAmount === null ? amountToApply : Math.min(amountToApply, remainingShieldAmount);
    if (!hasCap && prevented <= 0) continue;

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

    const staticPrevented = initialAmount - amountToApply;
    return {
      prevented: staticPrevented + prevented,
      remainingDamage: Math.max(0, amountToApply - prevented),
      log: [
        ...staticLog,
        effect?.combatOnly === true
          ? `Prevented ${prevented} combat damage from ${normalizedSourceId || 'the source'}`
          : `Prevented ${prevented} damage from ${normalizedSourceId || 'the source'}`,
      ],
      ...(nextState ? { state: nextState } : {}),
    };
  }

  return {
    prevented: initialAmount - amountToApply,
    remainingDamage: amountToApply,
    log: staticLog,
  };
}

const PREVENT_ALL_BUT_ANOTHER_TYPE_RE =
  /if a source would deal damage to another ([a-z][a-z0-9\s/-]*?) you control,?\s*prevent all but (\d+) of that damage/;

const PREVENT_ALL_BUT_YOU_OR_TYPE_RE =
  /if a source would deal damage to you or an? ([a-z][a-z0-9\s/-]*?) you control,?\s*prevent all but (\d+) of that damage/;

const DAMAGE_RECIPIENT_CARD_TYPES = new Set([
  'creature',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
  'kindred',
  'legendary',
  'snow',
  'token',
]);

function normalizeDamageOracle(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function preventAllButTypeTokens(raw: string): string[] {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token !== 'a' && token !== 'an' && token !== 'the');
}

function permanentMatchesPreventTokens(permanent: any, tokens: string[]): boolean {
  if (!permanent || tokens.length === 0) return false;
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '');
  const oracle = String(permanent?.card?.oracle_text || permanent?.oracle_text || '');
  const lower = typeLine.toLowerCase();
  for (const token of tokens) {
    const wanted = token.toLowerCase();
    if (DAMAGE_RECIPIENT_CARD_TYPES.has(wanted)) {
      if (!lower.includes(wanted)) return false;
      continue;
    }
    if (!cardHasCreatureType(typeLine, oracle, wanted)) return false;
  }
  return true;
}

function tightenCap(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  if (current === null) return next;
  return Math.min(current, next);
}

function capFromPreventAllButOracle(
  oracle: string,
  shieldId: string,
  shieldController: string,
  targetPermanent: any,
  targetPermanentId: string,
  targetPlayerId: string,
): number | null {
  const text = normalizeDamageOracle(oracle);
  if (!text) return null;
  let cap: number | null = null;
  const another = text.match(PREVENT_ALL_BUT_ANOTHER_TYPE_RE);
  if (another && targetPermanent) {
    const tokens = preventAllButTypeTokens(another[1]);
    const capValue = Math.max(0, Math.floor(Number(another[2]) || 0));
    const targetController = String(targetPermanent?.controller || '').trim();
    if (
      shieldController
      && shieldController === targetController
      && shieldId !== targetPermanentId
      && permanentMatchesPreventTokens(targetPermanent, tokens)
    ) {
      cap = tightenCap(cap, capValue);
    }
  }
  if (!/you get an emblem with/.test(text)) {
    const youOr = text.match(PREVENT_ALL_BUT_YOU_OR_TYPE_RE);
    if (youOr) {
      const tokens = preventAllButTypeTokens(youOr[1]);
      const capValue = Math.max(0, Math.floor(Number(youOr[2]) || 0));
      const targetController = String(targetPermanent?.controller || targetPlayerId || '').trim();
      const playerHit = !targetPermanentId && Boolean(targetPlayerId) && targetPlayerId === shieldController;
      const permanentHit = Boolean(targetPermanent)
        && targetController === shieldController
        && permanentMatchesPreventTokens(targetPermanent, tokens);
      if (playerHit || permanentHit) cap = tightenCap(cap, capValue);
    }
  }
  return cap;
}

function emblemOracleSources(state: GameState): Array<{ id: string; controller: string; oracle: string }> {
  const sources: Array<{ id: string; controller: string; oracle: string }> = [];
  const push = (emblem: any, fallbackController: string) => {
    if (!emblem || typeof emblem !== 'object') return;
    const abilities = Array.isArray(emblem.abilities)
      ? emblem.abilities.map((entry: unknown) => String(entry || '')).join(' ')
      : '';
    const oracle = String(emblem.effect || emblem.oracle_text || emblem.oracleText || abilities || emblem.card?.oracle_text || '');
    if (!oracle.trim()) return;
    sources.push({
      id: String(emblem.id || `emblem-${sources.length}`).trim(),
      controller: String(emblem.controller || emblem.owner || fallbackController || '').trim(),
      oracle,
    });
  };
  const root = Array.isArray((state as any)?.emblems) ? (state as any).emblems : [];
  for (const emblem of root) push(emblem, '');
  const players = Array.isArray((state as any)?.players) ? (state as any).players : [];
  for (const player of players) {
    const list = Array.isArray(player?.emblems) ? player.emblems : [];
    for (const emblem of list) push(emblem, String(player?.id || ''));
  }
  return sources;
}

function capDamageFromStaticPreventAllBut(
  state: GameState,
  amount: number,
  targetPermanentId: string,
  targetPlayerId: string,
): { remaining: number; log: string[] } {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const targetPermanent = targetPermanentId
    ? battlefield.find((permanent: any) => String(permanent?.id || '').trim() === targetPermanentId)
    : undefined;
  let cap: number | null = null;
  for (const permanent of battlefield) {
    const shieldId = String((permanent as any)?.id || '').trim();
    const shieldController = String((permanent as any)?.controller || '').trim();
    const oracle = String((permanent as any)?.card?.oracle_text || (permanent as any)?.oracle_text || '');
    cap = tightenCap(cap, capFromPreventAllButOracle(oracle, shieldId, shieldController, targetPermanent, targetPermanentId, targetPlayerId));
  }
  for (const emblem of emblemOracleSources(state)) {
    cap = tightenCap(cap, capFromPreventAllButOracle(emblem.oracle, emblem.id, emblem.controller, targetPermanent, targetPermanentId, targetPlayerId));
  }
  if (cap === null) return { remaining: amount, log: [] };
  const remaining = Math.min(amount, Math.max(0, cap));
  if (remaining >= amount) return { remaining: amount, log: [] };
  return {
    remaining,
    log: [`Prevented ${amount - remaining} damage (prevent all but ${cap})`],
  };
}
