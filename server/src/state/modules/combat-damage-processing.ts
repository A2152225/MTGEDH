import type { GameContext } from '../context.js';
import {
  createDamageSourceFromPermanent,
  parseDamageAbilities,
  processDamageToPlayer,
  DamageRecipientType,
  type DamageSourceCharacteristics,
} from '../../../../rules-engine/src/damageProcessing.js';
import {
  applyDamageToPermanentWithCounterEffects,
  getCounterGrantedAbilities,
} from './counter-common-effects.js';
import { updateCounters } from './counters_tokens.js';

export function applyPoisonCountersToPlayer(ctx: GameContext, playerId: string, amount: number): void {
  const normalized = Math.max(0, Number(amount || 0));
  if (!playerId || normalized <= 0) return;

  const ctxAny = ctx as any;
  ctxAny.poison = ctxAny.poison || {};
  ctxAny.poison[playerId] = (ctxAny.poison[playerId] || 0) + normalized;

  const state = ctxAny.state;
  if (!state) return;

  state.poisonCounters = state.poisonCounters || {};
  state.poisonCounters[playerId] = (state.poisonCounters[playerId] || 0) + normalized;

  const player = (state.players || []).find((entry: any) => entry?.id === playerId);
  if (player) {
    player.poisonCounters = state.poisonCounters[playerId];
    player.counters = player.counters || {};
    player.counters.poison = state.poisonCounters[playerId];
  }
}

export function getCombatDamageSourceCharacteristics(
  sourcePermanent: any,
  state: any,
): DamageSourceCharacteristics {
  const base = createDamageSourceFromPermanent(sourcePermanent);
  const granted = getCounterGrantedAbilities(state, sourcePermanent);
  if (!granted.length) return base;

  const grantedData = parseDamageAbilities(granted.join(' '), sourcePermanent?.card?.type_line);
  return mergeDamageCharacteristics(base, grantedData);
}

function mergeDamageCharacteristics(
  base: DamageSourceCharacteristics,
  extra: Partial<DamageSourceCharacteristics>,
): DamageSourceCharacteristics {
  return {
    ...base,
    hasInfect: Boolean(base.hasInfect || extra.hasInfect),
    hasWither: Boolean(base.hasWither || extra.hasWither),
    hasToxic: Boolean(base.hasToxic || extra.hasToxic),
    toxicValue: Math.max(base.toxicValue || 0, extra.toxicValue || 0),
    hasPoisonous: Boolean(base.hasPoisonous || extra.hasPoisonous),
    poisonousValue: Math.max(base.poisonousValue || 0, extra.poisonousValue || 0),
    hasLifelink: Boolean(base.hasLifelink || extra.hasLifelink),
    hasDeathtouch: Boolean(base.hasDeathtouch || extra.hasDeathtouch),
  };
}

export function getDamageSourceCharacteristicsFromCard(
  sourceCard: any,
  state?: any,
  sourcePermanent?: any,
): DamageSourceCharacteristics {
  if (sourcePermanent) {
    return getCombatDamageSourceCharacteristics(sourcePermanent, state);
  }

  const abilities = parseDamageAbilities(sourceCard?.oracle_text, sourceCard?.type_line);
  return {
    hasInfect: Boolean(abilities.hasInfect),
    hasWither: Boolean(abilities.hasWither),
    hasToxic: Boolean(abilities.hasToxic),
    toxicValue: abilities.toxicValue || 0,
    hasPoisonous: Boolean(abilities.hasPoisonous),
    poisonousValue: abilities.poisonousValue || 0,
    hasLifelink: Boolean(abilities.hasLifelink),
    hasDeathtouch: Boolean(abilities.hasDeathtouch),
    sourceId: String(sourceCard?.id || ''),
    sourceName: String(sourceCard?.name || 'Unknown'),
    controllerId: String(sourceCard?.controller || ''),
  };
}

export function findBattlefieldPermanent(ctx: GameContext, permanentId: string): any | null {
  const id = String(permanentId || '').trim();
  if (!id) return null;
  const battlefield = (ctx as any).state?.battlefield;
  if (!Array.isArray(battlefield)) return null;
  return battlefield.find((perm: any) => perm && String(perm.id || '') === id) || null;
}

export function inferInfectWitherFlags(
  ctx: GameContext,
  options: {
    sourcePermanentId?: string;
    sourcePermanent?: any;
    infect?: boolean;
    wither?: boolean;
  },
): { infect: boolean; wither: boolean; sourcePermanent: any | null } {
  const explicitInfect = Boolean(options.infect);
  const explicitWither = Boolean(options.wither);
  const sourcePermanent =
    options.sourcePermanent ||
    (options.sourcePermanentId ? findBattlefieldPermanent(ctx, options.sourcePermanentId) : null);

  if (!sourcePermanent) {
    return { infect: explicitInfect, wither: explicitWither, sourcePermanent: null };
  }

  const characteristics = getCombatDamageSourceCharacteristics(sourcePermanent, (ctx as any).state);
  return {
    infect: explicitInfect || characteristics.hasInfect,
    wither: explicitWither || characteristics.hasInfect || characteristics.hasWither,
    sourcePermanent,
  };
}

export interface ResolvedPlayerDamage {
  lifeLost: number;
  poisonAdded: number;
  damageDealt: number;
}

export function resolvePlayerDamage(
  ctx: GameContext,
  options: {
    targetPlayerId: string;
    amount: number;
    isCombatDamage?: boolean;
    sourcePermanent?: any;
    sourceCard?: any;
  },
): ResolvedPlayerDamage {
  const damageDealt = Math.max(0, Number(options.amount || 0));
  const targetPlayerId = String(options.targetPlayerId || '').trim();
  if (!targetPlayerId || damageDealt <= 0) {
    return { lifeLost: 0, poisonAdded: 0, damageDealt: 0 };
  }

  const characteristics = options.sourcePermanent
    ? getCombatDamageSourceCharacteristics(options.sourcePermanent, (ctx as any).state)
    : getDamageSourceCharacteristicsFromCard(options.sourceCard, (ctx as any).state, options.sourcePermanent);

  const processed = processDamageToPlayer({
    sourceId: String(options.sourcePermanent?.id || characteristics.sourceId || ''),
    sourceName: characteristics.sourceName,
    sourceControllerId: String(options.sourcePermanent?.controller || characteristics.controllerId || ''),
    recipientId: targetPlayerId,
    recipientType: DamageRecipientType.PLAYER,
    amount: damageDealt,
    isCombatDamage: options.isCombatDamage === true,
    characteristics,
  });

  const lifeLost = Math.max(0, -processed.lifeChange);
  if (lifeLost > 0) {
    const state = (ctx as any).state;
    const startingLife = state?.startingLife || 40;
    const life = state.life = state.life || {};
    (ctx as any).life = (ctx as any).life || life;
    const currentLife = life[targetPlayerId] ?? (ctx as any).life?.[targetPlayerId] ?? startingLife;
    const nextLife = currentLife - lifeLost;
    life[targetPlayerId] = nextLife;
    (ctx as any).life[targetPlayerId] = nextLife;
    const player = (state.players || []).find((entry: any) => entry?.id === targetPlayerId);
    if (player) player.life = nextLife;
  }

  if (processed.poisonCounters > 0) {
    applyPoisonCountersToPlayer(ctx, targetPlayerId, processed.poisonCounters);
  }

  return {
    lifeLost,
    poisonAdded: processed.poisonCounters,
    damageDealt,
  };
}

export function resolvePlayerCombatDamage(
  ctx: GameContext,
  sourcePermanent: any,
  defendingPlayerId: string,
  amount: number,
): ResolvedPlayerDamage {
  return resolvePlayerDamage(ctx, {
    targetPlayerId: defendingPlayerId,
    amount,
    isCombatDamage: true,
    sourcePermanent,
  });
}

export function sourceHasInfectOrWither(sourcePermanent: any, state: any): boolean {
  const characteristics = getCombatDamageSourceCharacteristics(sourcePermanent, state);
  return characteristics.hasInfect || characteristics.hasWither;
}

export function applyCreatureDamageFromSource(
  ctx: GameContext,
  sourcePermanent: any,
  targetPermanent: any,
  amount: number,
  damageField: 'damage' | 'markedDamage' | 'damageMarked' = 'markedDamage',
): { prevented: boolean; appliedAmount: number; usedMinusCounters: boolean } {
  const normalizedAmount = Math.max(0, Number(amount || 0));
  if (!targetPermanent || normalizedAmount <= 0) {
    return { prevented: false, appliedAmount: 0, usedMinusCounters: false };
  }

  const sourceCard = sourcePermanent?.card || {};
  const sourceId = String(sourcePermanent?.id || '');

  if (sourcePermanent && sourceHasInfectOrWither(sourcePermanent, (ctx as any).state)) {
    updateCounters(ctx, String(targetPermanent.id || ''), { '-1/-1': normalizedAmount });
    return { prevented: false, appliedAmount: normalizedAmount, usedMinusCounters: true };
  }

  const sourceCharacteristics = sourcePermanent
    ? getCombatDamageSourceCharacteristics(sourcePermanent, (ctx as any).state)
    : null;
  const damageResult = applyDamageToPermanentWithCounterEffects(
    targetPermanent,
    normalizedAmount,
    damageField,
    {
      state: (ctx as any).state,
      source: sourceCard,
      sourceId,
      fromDeathtouch: Boolean(sourceCharacteristics?.hasDeathtouch),
    },
  );

  return {
    prevented: damageResult.prevented,
    appliedAmount: damageResult.appliedAmount,
    usedMinusCounters: false,
  };
}

export const applyCreatureCombatDamageFromSource = applyCreatureDamageFromSource;

export function applyFightDamageBetweenCreatures(
  ctx: GameContext,
  creatureA: any,
  damageAToB: number,
  creatureB: any,
  damageBToA: number,
  damageField: 'damage' | 'markedDamage' | 'damageMarked' = 'damageMarked',
): void {
  if (creatureA && creatureB && damageAToB > 0) {
    applyCreatureDamageFromSource(ctx, creatureA, creatureB, damageAToB, damageField);
  }
  if (creatureB && creatureA && damageBToA > 0) {
    applyCreatureDamageFromSource(ctx, creatureB, creatureA, damageBToA, damageField);
  }
}

export function creatureDiesFromCombatDamage(
  ctx: GameContext,
  permanent: any,
  markedDamage: number,
  deathtouch: boolean,
  usedMinusCounters: boolean,
  combatToughness?: number,
): boolean {
  if (usedMinusCounters) {
    return getEffectiveToughnessForDeathCheck(ctx, permanent) <= 0;
  }

  const damageOnCreature = Math.max(0, Number(markedDamage || 0));
  if (deathtouch && damageOnCreature > 0) return true;

  const toughness = Number.isFinite(combatToughness)
    ? Number(combatToughness)
    : getEffectiveToughnessForDeathCheck(ctx, permanent);
  return damageOnCreature >= toughness;
}

function getEffectiveToughnessForDeathCheck(ctx: GameContext, permanent: any): number {
  const card = permanent?.card || {};
  let baseToughness = Number(permanent?.baseToughness);
  if (!Number.isFinite(baseToughness)) {
    const parsed = Number(card?.toughness);
    baseToughness = Number.isFinite(parsed) ? parsed : 0;
  }

  const plusCounters = Number(permanent?.counters?.['+1/+1'] || 0);
  const minusCounters = Number(permanent?.counters?.['-1/-1'] || 0);
  return baseToughness + plusCounters - minusCounters;
}
