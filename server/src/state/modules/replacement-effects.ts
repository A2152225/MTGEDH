import { evaluateDeclarativeReplacementEvent, collectReplacementEffectSpecsFromState, overlaySpecsMatchLibrarySearch, summarizeTokenAmountReplacements } from './replacementEffectSpec.js';
import { summarizeLifeLossAmountReplacements } from './replacementEffectSpec-handlers/replacementEffectSpecLifeLossOracleTemplates.js';
import type { GameContext } from '../context.js';
import {
  applyBeneficialReplacements,
  detectMillReplacementEffects,
  type ReplacementEffect,
} from './game-state-effects.js';
import { computeCounterPlacementModifiedDeltas } from './replacementCounterPlacementUtils.js';
import { applyPlayerDamageLifeFloorCaps } from './replacementEffectsDamageLifeFloor.js';
import { inferLeaveBattlefieldExileReplacement } from './leaveBattlefieldReplacementStamp.js';

export type ReplacementZone = 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library' | 'command' | 'stack';

export type ReplacementEvent = ZoneChangeReplacementEvent | BattlefieldEntryReplacementEvent | DamageReplacementEvent | LifeGainReplacementEvent | LifeLossReplacementEvent | LibrarySearchReplacementEvent | TokenCreationReplacementEvent | CounterPlacementReplacementEvent | CardDrawReplacementEvent | MillReplacementEvent;

export interface ZoneChangeReplacementEvent {
  type: 'zone-change';
  state?: any;
  object?: any;
  objectId?: string;
  sourceZone?: ReplacementZone;
  destinationZone: ReplacementZone;
  controller?: string;
  owner?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface BattlefieldEntryReplacementEvent {
  type: 'battlefield-entry';
  state?: any;
  card?: any;
  permanent?: any;
  controllerId: string;
  entersTapped?: boolean;
  entryCounters?: Record<string, number>;
  entersTransformed?: boolean;
  entersFaceDown?: boolean;
  copySourceId?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface DamageReplacementEvent {
  type: 'damage';
  state?: any;
  amount: number;
  replacementAmount?: number;
  source?: any;
  sourceId?: string;
  target?: any;
  targetId?: string;
  targetPlayerId?: string;
  combatDamage?: boolean;
  damageKind?: 'combat' | 'noncombat';
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface CardDrawReplacementEvent {
  type: 'card-draw';
  state?: any;
  playerId: string;
  count: number;
  drawIndex?: number;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface LifeGainReplacementEvent {
  type: 'life-gain';
  state?: any;
  playerId: string;
  amount: number;
  source?: any;
  sourceId?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface LifeLossReplacementEvent {
  type: 'life-loss';
  state?: any;
  playerId: string;
  amount: number;
  source?: any;
  sourceId?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface LibrarySearchReplacementEvent {
  type: 'library-search';
  game?: any;
  state?: any;
  searchingPlayerId: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenCreationReplacementEvent {
  type: 'token-creation';
  state?: any;
  controllerId: string;
  count: number;
  tokenName?: string;
  tokenTypeLine?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface CounterPlacementReplacementEvent {
  type: 'counter-placement';
  state?: any;
  targetPermanentId: string;
  controllerId?: string;
  deltas: Record<string, number>;
  modifiedDeltas?: Record<string, number>;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface MillReplacementEvent {
  type: 'mill';
  state?: any;
  ctx?: GameContext;
  millingPlayerId: string;
  targetPlayerId: string;
  count: number;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface ReplacementEffectResult {
  applied: boolean;
  choiceRequired?: boolean;
  eventType: ReplacementEvent['type'];
  effectId?: string;
  sourceName?: string;
  originalDestination?: ReplacementZone;
  replacementDestination?: ReplacementZone;
  replacementOptions?: ReplacementZone[];
  originalAmount?: number;
  replacementAmount?: number;
  preventedAmount?: number;
  lifeGain?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type ReplacementEffectEvaluator = (event: ReplacementEvent) => ReplacementEffectResult | null;

const lastingLifeGainPreventionEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'life-gain') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const lastingEffects = Array.isArray(event.state?.lastingEffects) ? event.state.lastingEffects : [];
  for (const effect of lastingEffects) {
    if (effect?.type === 'preventLifeGain' && String(effect?.targetPlayer || '') === String(event.playerId || '')) {
      return {
        applied: true,
        eventType: event.type,
        effectId: 'life-gain-prevented',
        sourceName: String(effect?.source || '').trim() || undefined,
        originalAmount,
        replacementAmount: 0,
        preventedAmount: originalAmount,
        reason: 'lasting_life_gain_prevention',
        metadata: {
          playerId: String(event.playerId || ''),
        },
      };
    }
  }

  return null;
};

function normalizeDeltas(deltas: Record<string, number> | undefined): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(deltas || {})) {
    const amount = Math.floor(Number(value || 0));
    if (amount !== 0) normalized[key] = amount;
  }
  return normalized;
}

function deltasDiffer(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Number(left[key] || 0) !== Number(right[key] || 0)) return true;
  }
  return false;
}

function sumPositiveDeltas(deltas: Record<string, number>): number {
  return Object.values(deltas).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function hasPositiveDeltas(deltas: Record<string, number> | undefined): boolean {
  return Object.values(deltas || {}).some((value) => Number(value || 0) > 0);
}

function getCardName(card: any): string {
  return String(card?.name || '').trim();
}

function getCardTypeLine(card: any): string {
  return normalizeReplacementText(card?.type_line || card?.type || '');
}

function getCardOracleText(card: any): string {
  return normalizeReplacementText(card?.oracle_text || card?.text || '');
}

function getEventStateBattlefield(event: { state?: any; metadata?: Record<string, unknown> }): any[] {
  const stateBattlefield = Array.isArray(event.state?.battlefield) ? event.state.battlefield : [];
  if (stateBattlefield.length > 0) return stateBattlefield;
  const metadataBattlefield = Array.isArray(event.metadata?.battlefield) ? event.metadata?.battlefield : [];
  return metadataBattlefield;
}

function getDamageSourceColors(source: any): string[] {
  const rawColors = Array.isArray(source?.colors)
    ? source.colors
    : Array.isArray(source?.color_identity)
      ? source.color_identity
      : [];
  return rawColors.map((color: any) => String(color || '').trim().toUpperCase()).filter(Boolean);
}

function damageCannotBePrevented(event: DamageReplacementEvent): { sourceName?: string; reason: string } | null {
  if (event.metadata?.damageCanBePrevented === false) {
    return { reason: 'damage_prevention_disallowed' };
  }

  const sourceOracle = getCardOracleText(event.source?.card || event.source);
  if (sourceOracle.includes("damage can't be prevented")
    || (sourceOracle.includes("damage that would be dealt by") && sourceOracle.includes("can't be prevented"))) {
    return {
      sourceName: getCardName(event.source?.card || event.source),
      reason: 'source_damage_prevention_disallowed',
    };
  }

  for (const permanent of getEventStateBattlefield(event)) {
    const oracle = getCardOracleText(permanent?.card || permanent);
    if (!oracle.includes("damage can't be prevented")) continue;
    return {
      sourceName: getCardName(permanent?.card || permanent),
      reason: 'static_damage_prevention_disallowed',
    };
  }

  return null;
}

function replacementEffectModifiedAmount(originalAmount: number, rawEffects: unknown): { finalAmount: number; appliedEffects: string[] } | null {
  if (!Array.isArray(rawEffects) || rawEffects.length === 0) return null;

  let amount = originalAmount;
  const appliedEffects: string[] = [];
  for (const effect of rawEffects as any[]) {
    const type = normalizeReplacementText(effect?.type || effect?.kind || '');
    const source = String(effect?.source || effect?.sourceName || 'Damage replacement').trim();
    const before = amount;
    if (type === 'prevent') {
      amount = 0;
    } else if (type === 'double') {
      amount *= 2;
    } else if (type === 'triple') {
      amount *= 3;
    } else if (type === 'halve') {
      amount = Math.floor(amount / 2);
    } else if (type === 'halve_round_up' || type === 'halve round up') {
      amount = Math.ceil(amount / 2);
    } else if (type === 'add_flat' || type === 'add flat') {
      amount += Number(effect?.value || 1);
    } else if (type === 'cap') {
      amount = Math.min(amount, Math.max(0, Number(effect?.value ?? 1)));
    } else {
      continue;
    }
    amount = Math.max(0, amount);
    appliedEffects.push(`${source}: ${type} (${before} -> ${amount})`);
  }

  return appliedEffects.length > 0 ? { finalAmount: amount, appliedEffects } : null;
}

function normalizeReplacementText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCounterName(value: unknown): string {
  return normalizeReplacementText(value)
    .replace(/ counters?$/i, '')
    .replace(/^an?\s+/i, '')
    .trim();
}

function permanentHasCounter(permanent: any, counterName: string): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;
  const target = normalizeCounterName(counterName);
  for (const [name, amountRaw] of Object.entries(counters as Record<string, unknown>)) {
    if (normalizeCounterName(name) === target && Number(amountRaw || 0) > 0) {
      return true;
    }
  }
  return false;
}

function getReplacementSourceName(permanent: any): string | undefined {
  const value = String(permanent?.leaveBattlefieldReplacementSourceName || permanent?.card?.leaveBattlefieldReplacementSourceName || '').trim();
  return value || undefined;
}

function getReplacementLifeGain(permanent: any): number | undefined {
  const value = Number(permanent?.leaveBattlefieldReplacementLifeGain || permanent?.card?.leaveBattlefieldReplacementLifeGain || 0);
  return value > 0 ? value : undefined;
}

const leaveBattlefieldExileEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change' || event.sourceZone !== 'battlefield') return null;
  if (event.destinationZone === 'exile') return null;

  const permanent = event.object;
  const destination = event.destinationZone;
  const explicitDestination = normalizeReplacementText(
    permanent?.leaveBattlefieldReplacementDestination || permanent?.card?.leaveBattlefieldReplacementDestination || ''
  );
  const inferredStamp = explicitDestination === 'exile'
    ? undefined
    : inferLeaveBattlefieldExileReplacement(permanent, event.state);
  const exileInstead = explicitDestination === 'exile'
    || inferredStamp?.leaveBattlefieldReplacementDestination === 'exile';

  if (exileInstead) {
    return {
      applied: true,
      eventType: event.type,
      effectId: 'leave-battlefield-exile-instead',
      sourceName: getReplacementSourceName(permanent) || inferredStamp?.leaveBattlefieldReplacementSourceName,
      originalDestination: destination,
      replacementDestination: 'exile',
      lifeGain: getReplacementLifeGain(permanent) ?? inferredStamp?.leaveBattlefieldReplacementLifeGain,
      reason: 'explicit_leave_battlefield_replacement',
    };
  }

  if (destination !== 'graveyard') return null;

  const typeLine = normalizeReplacementText(permanent?.card?.type_line || permanent?.type_line || '');
  if (typeLine.includes('creature') && permanentHasCounter(permanent, 'finality')) {
    return {
      applied: true,
      eventType: event.type,
      effectId: 'finality-counter-exile-instead',
      originalDestination: destination,
      replacementDestination: 'exile',
      reason: 'finality_counter',
    };
  }

  return null;
};

const tokenLeaveBattlefieldEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change' || event.sourceZone !== 'battlefield') return null;
  if (event.destinationZone === 'battlefield') return null;
  if (event.object?.isToken !== true && event.object?.card?.isToken !== true) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'token-ceases-to-exist',
    originalDestination: event.destinationZone,
    reason: 'token_left_battlefield',
    metadata: {
      ceasesToExist: true,
    },
  };
};

const battlefieldEntryReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'battlefield-entry') return null;

  const entryCounters = normalizeDeltas(event.entryCounters);
  const entersTapped = event.entersTapped === true;
  const entersTransformed = event.entersTransformed === true;
  const entersFaceDown = event.entersFaceDown === true;
  const copySourceId = String(event.copySourceId || '').trim();
  const hasEntryReplacement = entersTapped || hasPositiveDeltas(entryCounters) || entersTransformed || entersFaceDown || Boolean(copySourceId);
  if (!hasEntryReplacement) return null;

  const effects: string[] = [];
  if (entersTapped) effects.push('entersTapped');
  if (hasPositiveDeltas(entryCounters)) effects.push('entryCounters');
  if (entersTransformed) effects.push('entersTransformed');
  if (entersFaceDown) effects.push('entersFaceDown');
  if (copySourceId) effects.push('copy');

  return {
    applied: true,
    eventType: event.type,
    effectId: effects.length === 1 ? `battlefield-entry-${effects[0]}` : 'battlefield-entry-modified',
    sourceName: getCardName(event.card || event.permanent?.card) || undefined,
    reason: 'battlefield_entry_replacement',
    metadata: {
      controllerId: String(event.controllerId || ''),
      effects,
      entersTapped,
      entryCounters,
      entersTransformed,
      entersFaceDown,
      ...(copySourceId ? { copySourceId } : {}),
    },
  };
};

const damagePreventionDisallowedEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;
  const disallowed = damageCannotBePrevented(event);
  if (!disallowed) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'damage-prevention-disallowed',
    sourceName: disallowed.sourceName,
    originalAmount,
    replacementAmount: originalAmount,
    preventedAmount: 0,
    reason: disallowed.reason,
    metadata: {
      damageCanBePrevented: false,
      targetId: String(event.targetId || event.target?.id || event.targetPlayerId || '').trim(),
    },
  };
};

const shieldCounterDamagePreventionEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0 || !permanentHasCounter(event.target, 'shield')) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'shield-counter-prevent-damage',
    sourceName: String(event.target?.card?.name || event.target?.name || '').trim() || undefined,
    originalAmount,
    replacementAmount: 0,
    preventedAmount: originalAmount,
    reason: 'shield_counter',
    metadata: {
      targetId: String(event.targetId || event.target?.id || '').trim(),
    },
  };
};

const damagePreventionEffectEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const targetPlayerId = String(event.targetPlayerId || '').trim();
  const targetPermanentId = String(event.targetId || event.target?.id || '').trim();
  const normalizedSourceId = String(event.sourceId || event.source?.id || '').trim();
  const sourceColors = getDamageSourceColors(event.source?.card || event.source);
  const currentTurn = Number(event.state?.turnNumber ?? event.state?.turn ?? 0) || 0;
  const effects = Array.isArray(event.state?.damagePreventionEffects)
    ? event.state.damagePreventionEffects
    : Array.isArray(event.metadata?.damagePreventionEffects)
      ? event.metadata?.damagePreventionEffects
      : [];

  for (const effect of effects) {
    const targetSourceId = String(effect?.targetSourceId || '*').trim() || '*';
    if (targetSourceId !== '*' && targetSourceId !== normalizedSourceId) continue;

    const effectTargetPlayerId = String(effect?.targetPlayerId || '').trim();
    if (effectTargetPlayerId && effectTargetPlayerId !== targetPlayerId) continue;

    const effectTargetPermanentId = String(effect?.targetPermanentId || '').trim();
    if (effectTargetPermanentId && effectTargetPermanentId !== targetPermanentId) continue;

    const expiresAtTurn = Number(effect?.expiresAtTurn);
    if (Number.isFinite(expiresAtTurn) && expiresAtTurn !== currentTurn) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color: any) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color: string) => sourceColors.includes(color))) continue;
    if (effect?.combatOnly === true && event.metadata?.isCombatDamage !== true) continue;
    if (effect?.unblockedOnly === true) {
      const sourcePermanent = (Array.isArray(event.state?.battlefield) ? event.state.battlefield : []).find(
        (perm: any) => String(perm?.id || '').trim() === normalizedSourceId,
      );
      const attacking = sourcePermanent?.attacking;
      const blockedBy = sourcePermanent?.blockedBy;
      if (!attacking || (Array.isArray(blockedBy) && blockedBy.length > 0)) continue;
    }

    const capTo = Number(effect?.capTo);
    const hasCap = Number.isFinite(capTo);
    const remainingAmount = Number(effect?.remainingAmount);
    const preventedAmount = hasCap
      ? Math.max(0, originalAmount - Math.min(originalAmount, Math.max(0, capTo)))
      : Number.isFinite(remainingAmount)
        ? Math.min(originalAmount, Math.max(0, remainingAmount))
        : originalAmount;
    if (!hasCap && preventedAmount <= 0) continue;

    return {
      applied: true,
      eventType: event.type,
      effectId: 'damage-prevented-by-effect',
      sourceName: String(effect?.sourceName || effect?.source || '').trim() || undefined,
      originalAmount,
      replacementAmount: Math.max(0, originalAmount - preventedAmount),
      preventedAmount,
      reason: 'damage_prevention_effect',
      metadata: {
        effectId: String(effect?.id || '').trim(),
        targetId: targetPlayerId || targetPermanentId,
      },
    };
  }

  return null;
};

const damageAmountReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const explicitReplacementAmount = Number(event.replacementAmount);
  if (Number.isFinite(explicitReplacementAmount) && Math.max(0, explicitReplacementAmount) !== originalAmount) {
    const replacementAmount = Math.max(0, explicitReplacementAmount);
    return {
      applied: true,
      eventType: event.type,
      effectId: replacementAmount === 0 ? 'damage-prevented' : 'damage-amount-modified',
      originalAmount,
      replacementAmount,
      preventedAmount: Math.max(0, originalAmount - replacementAmount),
      reason: 'damage_amount_replacement',
      metadata: { ...(event.metadata || {}) },
    };
  }

  const replacement = replacementEffectModifiedAmount(originalAmount, event.metadata?.replacementEffects);
  if (replacement && replacement.finalAmount !== originalAmount) {
    return {
      applied: true,
      eventType: event.type,
      effectId: replacement.finalAmount === 0 ? 'damage-prevented' : 'damage-amount-modified',
      originalAmount,
      replacementAmount: replacement.finalAmount,
      preventedAmount: Math.max(0, originalAmount - replacement.finalAmount),
      reason: 'damage_amount_replacement',
      metadata: {
        appliedEffects: replacement.appliedEffects,
      },
    };
  }

  // Cap-only: Worship / Fortune Thief floorLifeAt. Do not fold Furnace/Gisela here —
  // combat already ran calculateModifiedDamage before this evaluator.
  const floor = applyPlayerDamageLifeFloorCaps(event);
  if (!floor || floor.finalAmount === originalAmount) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: floor.finalAmount === 0 ? 'damage-prevented' : 'damage-life-floor',
    originalAmount,
    replacementAmount: floor.finalAmount,
    preventedAmount: Math.max(0, originalAmount - floor.finalAmount),
    reason: 'damage_life_floor_replacement',
    metadata: {
      appliedEffects: floor.appliedEffects,
    },
  };
};

const lifeGainPreventionEvaluator: ReplacementEffectEvaluator = lastingLifeGainPreventionEvaluator;

const librarySearchReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'library-search') return null;

  const state = event.state || event.game?.state || {};
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;

  for (const spec of collectReplacementEffectSpecsFromState(state)) {
    if (spec.event !== 'library-search') continue;
    if (!overlaySpecsMatchLibrarySearch(spec, event)) continue;

    const sourceName = String(spec.sourceName || 'Replacement effect').trim();
    const controllerId = String(spec.sourceController || '');

    if (spec.instead.preventSearch) {
      canSearch = false;
      reason = `${sourceName} prevents library searching`;
    }
    if (spec.instead.paymentToIgnore) {
      paymentRequired = { cardName: sourceName, amount: String(spec.instead.paymentToIgnore) };
    }
    if (typeof spec.instead.limitToTop === 'number') {
      const limit = Math.max(0, Math.floor(spec.instead.limitToTop));
      if (limitToTop === undefined || limit < limitToTop) {
        limitToTop = limit;
      }
    }
    if (spec.instead.controlSearch) {
      controlledBy = controllerId;
    }
    if (spec.instead.triggerEffect) {
      triggerEffects.push({
        cardName: sourceName,
        effect: String(spec.instead.triggerEffect),
        controllerId,
      });
    }
  }

  const metadata = {
    canSearch,
    ...(limitToTop !== undefined ? { limitToTop } : {}),
    triggerEffects,
    ...(controlledBy ? { controlledBy } : {}),
    ...(reason ? { reason } : {}),
    ...(paymentRequired ? { paymentRequired } : {}),
  };

  if (!canSearch || limitToTop !== undefined || triggerEffects.length > 0 || controlledBy || paymentRequired) {
    return {
      applied: true,
      eventType: event.type,
      effectId: !canSearch
        ? 'library-search-prevented'
        : limitToTop !== undefined
          ? 'library-search-limited'
          : controlledBy
            ? 'library-search-controlled'
            : paymentRequired
              ? 'library-search-payment-required'
              : 'library-search-triggered',
      reason: reason || 'library_search_restriction',
      metadata,
    };
  }

  return null;
};

const tokenCreationReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'token-creation') return null;

  const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
  if (originalAmount <= 0) return null;

  const summary = summarizeTokenAmountReplacements(event.state, String(event.controllerId || ''), {
    tokenName: event.tokenName,
    tokenTypeLine: event.tokenTypeLine,
    metadata: event.metadata,
  });
  if (summary.multiplier <= 1 && summary.extraTokens === 0) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'token-creation-multiplied',
    originalAmount,
    replacementAmount: (originalAmount + summary.extraTokens) * summary.multiplier,
    reason: 'token_creation_replacement',
    metadata: {
      controllerId: String(event.controllerId || ''),
      multiplier: summary.multiplier,
      sources: [...summary.extraSources, ...summary.doubleSources],
      ...(event.tokenName ? { tokenName: event.tokenName } : {}),
    },
  };
};

const counterPlacementReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'counter-placement') return null;

  const originalDeltas = normalizeDeltas(event.deltas);
  const overlaySpecs = collectReplacementEffectSpecsFromState(event.state);
  const modifiedDeltas = normalizeDeltas(
    event.modifiedDeltas
      || computeCounterPlacementModifiedDeltas(
        event.state,
        String(event.targetPermanentId || ''),
        originalDeltas,
        overlaySpecs,
      ),
  );
  if (!deltasDiffer(originalDeltas, modifiedDeltas)) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'counter-placement-modified',
    originalAmount: sumPositiveDeltas(originalDeltas),
    replacementAmount: sumPositiveDeltas(modifiedDeltas),
    reason: 'counter_placement_replacement',
    metadata: {
      targetPermanentId: String(event.targetPermanentId || ''),
      ...(event.controllerId ? { controllerId: String(event.controllerId) } : {}),
      originalDeltas,
      modifiedDeltas,
    },
  };
};

function collectMillReplacementEffects(event: MillReplacementEvent): ReplacementEffect[] {
  const state = event.state ?? (event.ctx as { state?: unknown } | undefined)?.state;
  return detectMillReplacementEffects(
    { state } as GameContext,
    String(event.millingPlayerId || ''),
    String(event.targetPlayerId || ''),
  );
}

const lifeLossAmountReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'life-loss') return null;

  const originalAmount = Math.max(0, Math.floor(Number(event.amount || 0)));
  if (originalAmount <= 0) return null;

  const summary = summarizeLifeLossAmountReplacements(event.state, String(event.playerId || ''));
  if (summary.multiplier <= 1 && summary.extraLife === 0) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'life-loss-modified',
    originalAmount,
    replacementAmount: (originalAmount + summary.extraLife) * summary.multiplier,
    reason: 'life_loss_replacement',
    metadata: {
      playerId: String(event.playerId || ''),
      multiplier: summary.multiplier,
      sources: [...summary.extraSources, ...summary.doubleSources],
    },
  };
};

const millReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'mill') return null;

  const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
  if (originalAmount <= 0) return null;

  const effects = collectMillReplacementEffects(event);
  if (effects.length === 0) return null;

  const result = applyBeneficialReplacements(originalAmount, effects);
  if (result.finalAmount === originalAmount) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'mill-replacement-modified',
    originalAmount,
    replacementAmount: result.finalAmount,
    reason: 'mill_replacement',
    metadata: {
      millingPlayerId: String(event.millingPlayerId || ''),
      targetPlayerId: String(event.targetPlayerId || ''),
      appliedEffects: result.appliedEffects,
    },
  };
};

const replacementEffectEvaluators: ReplacementEffectEvaluator[] = [
  leaveBattlefieldExileEvaluator,
  tokenLeaveBattlefieldEvaluator,
  battlefieldEntryReplacementEvaluator,
  damagePreventionDisallowedEvaluator,
  shieldCounterDamagePreventionEvaluator,
  damagePreventionEffectEvaluator,
  damageAmountReplacementEvaluator,
  lifeGainPreventionEvaluator,
  lifeLossAmountReplacementEvaluator,
  librarySearchReplacementEvaluator,
  tokenCreationReplacementEvaluator,
  millReplacementEvaluator,
  counterPlacementReplacementEvaluator,
];

export function evaluateReplacementEvent(event: ReplacementEvent): ReplacementEffectResult {
  const declarative = evaluateDeclarativeReplacementEvent(event, (event as any)?.state);
  if (declarative) {
    return declarative;
  }

  for (const evaluator of replacementEffectEvaluators) {
    const result = evaluator(event);
    if (result && (result.applied || result.choiceRequired)) {
      return result;
    }
  }

  if (event.type === 'zone-change') {
    return {
      applied: false,
      eventType: event.type,
      originalDestination: event.destinationZone,
      replacementDestination: event.destinationZone,
    };
  }

  if (event.type === 'library-search') {
    return {
      applied: false,
      eventType: event.type,
      metadata: { canSearch: true, triggerEffects: [] },
    };
  }

  if (event.type === 'battlefield-entry') {
    return {
      applied: false,
      eventType: event.type,
      metadata: {
        controllerId: String(event.controllerId || ''),
        entersTapped: false,
        entryCounters: {},
        entersTransformed: false,
        entersFaceDown: false,
      },
    };
  }

  if (event.type === 'card-draw') {
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    return {
      applied: false,
      eventType: event.type,
      originalAmount,
      replacementAmount: originalAmount,
      metadata: { playerId: String(event.playerId || '') },
    };
  }

  if (event.type === 'token-creation') {
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    return {
      applied: false,
      eventType: event.type,
      originalAmount,
      replacementAmount: originalAmount,
      metadata: { controllerId: String(event.controllerId || '') },
    };
  }

  if (event.type === 'counter-placement') {
    const originalDeltas = normalizeDeltas(event.deltas);
    return {
      applied: false,
      eventType: event.type,
      originalAmount: sumPositiveDeltas(originalDeltas),
      replacementAmount: sumPositiveDeltas(originalDeltas),
      metadata: {
        targetPermanentId: String(event.targetPermanentId || ''),
        originalDeltas,
        modifiedDeltas: originalDeltas,
      },
    };
  }

  if (event.type === 'mill') {
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    return {
      applied: false,
      eventType: event.type,
      originalAmount,
      replacementAmount: originalAmount,
      metadata: {
        millingPlayerId: String(event.millingPlayerId || ''),
        targetPlayerId: String(event.targetPlayerId || ''),
      },
    };
  }

  const originalAmount = Math.max(0, Number(event.amount || 0));

  return {
    applied: false,
    eventType: event.type,
    originalAmount,
    replacementAmount: originalAmount,
    preventedAmount: 0,
  };
}

export function evaluateLeaveBattlefieldDestinationReplacement(
  permanent: any,
  destination: Extract<ReplacementZone, 'graveyard' | 'exile' | 'hand' | 'library'>,
  metadata?: Record<string, unknown>,
): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'zone-change',
    object: permanent,
    objectId: String(permanent?.id || permanent?.card?.id || ''),
    sourceZone: 'battlefield',
    destinationZone: destination,
    controller: permanent?.controller,
    owner: permanent?.owner,
    metadata,
  });
}

export function evaluateStackGraveyardDestinationReplacement(stackItem: any): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'zone-change',
    object: stackItem,
    objectId: String(stackItem?.id || stackItem?.card?.id || ''),
    sourceZone: 'stack',
    destinationZone: 'graveyard',
    controller: stackItem?.controller || stackItem?.playerId,
    owner: stackItem?.owner || stackItem?.card?.owner,
    cause: 'spell_resolution',
  });
}

export function evaluateDamageReplacementEvent(event: Omit<DamageReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'damage',
    ...event,
  });
}

export function evaluateBattlefieldEntryReplacementEvent(event: Omit<BattlefieldEntryReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'battlefield-entry',
    ...event,
  });
}

export function evaluateLifeGainReplacementEvent(event: Omit<LifeGainReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'life-gain',
    ...event,
  });
}

export function evaluateLifeLossReplacementEvent(event: Omit<LifeLossReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'life-loss',
    ...event,
  });
}

export function evaluateLibrarySearchReplacementEvent(event: Omit<LibrarySearchReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'library-search',
    ...event,
  });
}

export function evaluateTokenCreationReplacementEvent(event: Omit<TokenCreationReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'token-creation',
    ...event,
  });
}

export function evaluateCounterPlacementReplacementEvent(event: Omit<CounterPlacementReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'counter-placement',
    ...event,
  });
}

export function evaluateMillReplacementEvent(event: Omit<MillReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'mill',
    ...event,
  });
}

export function evaluateDrawReplacementEvent(event: Omit<CardDrawReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'card-draw',
    ...event,
  });
}