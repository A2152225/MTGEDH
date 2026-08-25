// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: calculateModifiedDamage, combat-damage mill replacement detect,
// millSpecifiedPlayers, applyCombatDamageReplacement, opponent-directed damage.
// Public entry symbols: calculateModifiedDamage, detectCombatDamageReplacement,
// millSpecifiedPlayers, applyCombatDamageReplacement, canDamageBePrevented,
// resolveCombatDamageToOpponent, resolveOpponentDirectedDamage.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import { cardHasCreatureType, permanentHasCreatureTypeNow } from "../../creatureTypeNow.js";
import { getActivePermanents } from "./gameStateEffectsBattlefieldQueries.js";
import {
  getReplacementEffectMode,
  getReplacementEffectPreference,
  sortEffectsByCustomOrder,
  applyDamageReplacementsMinimized,
  applyDamageReplacementsMaximized,
  applyReplacementsCustomOrder,
  detectDamageReplacementEffects,
  applyCounterReplacements,
} from "./gameStateEffectsReplacementApply.js";

/**
 * Calculate modified damage amount based on battlefield effects
 * Handles Gisela, Furnace of Rath, etc.
 * 
 * @param ctx - Game context
 * @param damageAmount - Base damage amount
 * @param damageDealer - Player ID dealing the damage (controller of damage source)
 * @param damageReceiver - Player ID receiving the damage
 * @returns Modified damage amount
 */
export function calculateModifiedDamage(
  ctx: GameContext,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  isCombatDamage?: boolean,
  targetPermanentId?: string,
): { amount: number; modifiers: string[] } {
  const isToOpponent = damageDealer !== damageReceiver;
  
  // Detect all replacement effects that apply
  const effects = detectDamageReplacementEffects(
    ctx,
    damageDealer,
    damageReceiver,
    isToOpponent,
    damageSourcePermanentId,
    isCombatDamage,
    targetPermanentId,
  );
  
  if (effects.length === 0) {
    return { amount: damageAmount, modifiers: [] };
  }

  // MTG Rule 616.1: if multiple replacement effects apply to a damage event,
  // the affected player chooses the order to apply them.
  const pref = getReplacementEffectPreference(ctx, damageReceiver, 'damage');
  const mode = getReplacementEffectMode(pref, 'damage');

  if (mode === 'custom' && Array.isArray(pref?.customOrder) && pref.customOrder.length > 0) {
    const ordered = sortEffectsByCustomOrder(effects, pref.customOrder);
    const customResult = applyReplacementsCustomOrder(damageAmount, ordered);
    return { amount: Math.max(0, customResult.finalAmount), modifiers: customResult.appliedEffects };
  }

  if (mode === 'maximize') {
    const maxResult = applyDamageReplacementsMaximized(damageAmount, effects);
    return { amount: Math.max(0, maxResult.finalAmount), modifiers: maxResult.appliedEffects };
  }

  const minResult = applyDamageReplacementsMinimized(damageAmount, effects);
  return { amount: Math.max(0, minResult.finalAmount), modifiers: minResult.appliedEffects };
}

/**
 * Combat damage replacement effects
 * These effects prevent combat damage and apply a different effect instead
 * 
 * Key: lowercase card name (partial match)
 * Value: replacement effect configuration
 */
export interface CombatDamageReplacementEffect {
  /** Description of the effect */
  description: string;
  /** If true, prevents the combat damage from being dealt */
  preventsDamage: boolean;
  /** Mill effect: all opponents mill cards equal to damage amount */
  millAllOpponents?: boolean;
  /** Mill only the player who would have been damaged */
  millDamagedPlayer?: boolean;
  /** Put that many +1/+1 counters on the damage source instead */
  putPlusOneCountersOnSource?: boolean;
  /** Only the source permanent's own combat damage is replaced (not other sources you control) */
  sourceSelfOnly?: boolean;
  /** Attacking source must have this creature type (e.g. zombie). */
  appliesToCreatureType?: string;
  /** Controller and damaged player each draw half that many cards, rounded down */
  drawHalfForControllerAndDamagedPlayer?: boolean;
  /** Damage to player effect: deal damage to target player instead */
  damageToPlayer?: boolean;
  /** Only applies when damage would be dealt to a player (not creatures) */
  onlyToPlayers?: boolean;
  /** True for "would deal damage to an opponent" (Mindskinner) — applies outside combat too */
  appliesToNonCombatDamage?: boolean;
}

export type OpponentDamageReplacementResult = {
  damageDealt: number;
  prevented: boolean;
  effectsApplied: string[];
  millAmount?: number;
  millTargets?: string[];
  drawAmount?: number;
  drawTargets?: string[];
  plusOneCountersOnSource?: number;
};

export type DetectedPreventDamageMillReplacement = {
  effect: CombatDamageReplacementEffect;
  sourceName: string;
};

function collectCombatDamageReplacementTexts(attackerCard: any, attackerPermanent: any): string[] {
  const collected: string[] = [];
  const printedOracle = String(attackerCard?.oracle_text || '').trim().toLowerCase();
  if (printedOracle) {
    collected.push(printedOracle);
  }

  const abilitySources = [
    ...(Array.isArray(attackerPermanent?.grantedAbilities) ? attackerPermanent.grantedAbilities : []),
    ...(Array.isArray(attackerPermanent?.tempAbilities) ? attackerPermanent.tempAbilities : []),
    ...(Array.isArray(attackerPermanent?.temporaryAbilities) ? attackerPermanent.temporaryAbilities : []),
  ];

  for (const entry of abilitySources) {
    if (typeof entry === 'string' && entry.trim()) {
      collected.push(entry.trim().toLowerCase());
      continue;
    }

    if (entry && typeof entry === 'object' && typeof (entry as any).ability === 'string' && (entry as any).ability.trim()) {
      collected.push(String((entry as any).ability).trim().toLowerCase());
    }
  }

  return [...new Set(collected.filter(Boolean))];
}

function parsePreventDamageMillFromOracle(replacementText: string): CombatDamageReplacementEffect | null {
  if (!replacementText.includes('prevent that damage')) {
    return null;
  }

  const wouldDealCombatDamage =
    replacementText.includes('would deal combat damage') ||
    replacementText.includes('would deal combat damage to a player');
  const wouldDealDamageToOpponent = replacementText.includes('would deal damage to an opponent');
  if (!wouldDealCombatDamage && !wouldDealDamageToOpponent) {
    return null;
  }

  if (
    replacementText.includes("this creature's controller and that player each draw half that many cards") ||
    replacementText.includes('this creature’s controller and that player each draw half that many cards')
  ) {
    return {
      description: 'Prevent combat damage, controller and damaged player each draw half that many cards',
      preventsDamage: true,
      drawHalfForControllerAndDamagedPlayer: true,
      onlyToPlayers: true,
      appliesToNonCombatDamage: false,
    };
  }

  if (replacementText.includes('mills') || replacementText.includes('mill cards equal')) {
    const millsAllOpponents =
      replacementText.includes('each opponent mills') ||
      replacementText.includes('each opponent mills cards');
    return {
      description: wouldDealDamageToOpponent
        ? 'Prevent damage to an opponent, each opponent mills that many cards'
        : 'Prevent combat damage, mill effect',
      preventsDamage: true,
      millAllOpponents: millsAllOpponents,
      onlyToPlayers: !wouldDealDamageToOpponent,
      appliesToNonCombatDamage: wouldDealDamageToOpponent,
    };
  }

  return null;
}

function parseSourceSelfCombatDamageReplacementFromOracle(replacementText: string): CombatDamageReplacementEffect | null {
  if (!replacementText.includes('would deal combat damage to a player')) return null;
  if (!replacementText.includes('instead')) return null;
  if (!replacementText.includes('+1/+1 counter')) return null;
  if (!replacementText.includes('put that many')) return null;
  if (!replacementText.includes('that player mills') && !replacementText.includes('that player mill')) {
    return null;
  }

  return {
    description: 'Instead put that many +1/+1 counters on source and that player mills that many',
    preventsDamage: true,
    millDamagedPlayer: true,
    putPlusOneCountersOnSource: true,
    sourceSelfOnly: true,
    onlyToPlayers: true,
    appliesToNonCombatDamage: false,
  };
}

function parseTypeRestrictedCombatMillFromOracle(replacementText: string): CombatDamageReplacementEffect | null {
  if (!replacementText.includes('would deal combat damage to a player')) return null;
  if (!replacementText.includes('instead')) return null;
  if (!replacementText.includes('you control')) return null;
  if (replacementText.includes('prevent that damage')) return null;
  if (replacementText.includes('+1/+1 counter')) return null;
  if (!replacementText.includes('that player mills') && !replacementText.includes('that player mill')) {
    return null;
  }

  const match = replacementText.match(
    /if an? ([a-z][a-z0-9'-]*) you control would deal combat damage to a player/,
  );
  if (!match) return null;
  const creatureType = String(match[1] || '').trim().toLowerCase();
  if (!creatureType || creatureType === 'source' || creatureType === 'this' || creatureType === 'card') {
    return null;
  }

  return {
    description: `Instead a ${creatureType} you control mills the damaged player that many`,
    preventsDamage: true,
    millDamagedPlayer: true,
    appliesToCreatureType: creatureType,
    onlyToPlayers: true,
    appliesToNonCombatDamage: false,
  };
}

function attackerMatchesRestrictedCreatureType(
  attackerCard: any,
  attackerPermanent: any,
  creatureType: string,
): boolean {
  const wanted = String(creatureType || '').trim();
  if (!wanted) return false;
  if (attackerPermanent && permanentHasCreatureTypeNow(attackerPermanent, wanted)) return true;
  if (cardHasCreatureType(attackerCard, wanted)) return true;
  if (cardHasCreatureType(attackerPermanent?.card, wanted)) return true;
  return false;
}

function detectTypeRestrictedCombatMillFromPermanent(
  perm: any,
): DetectedPreventDamageMillReplacement | null {
  const replacementTexts = collectCombatDamageReplacementTexts(perm?.card, perm);
  for (const replacementText of replacementTexts) {
    const parsed = parseTypeRestrictedCombatMillFromOracle(replacementText);
    if (parsed) {
      return { effect: parsed, sourceName: String(perm?.card?.name || 'Effect') };
    }
  }
  return null;
}

/**
 * Scan the battlefield for "if a [type] you control would deal combat damage to a player, instead mill".
 * Applies to any matching-type attacker the controller controls (not source-self only).
 */
export function detectTypeRestrictedCombatMillReplacement(
  ctx: GameContext,
  sourceControllerId: string,
  attackerCard?: any,
  attackerPermanent?: any,
): DetectedPreventDamageMillReplacement | null {
  const controllerId = String(sourceControllerId || '').trim();
  if (!controllerId) return null;

  const battlefield = getActivePermanents(ctx);
  for (const perm of battlefield) {
    if (String(perm?.controller || '') !== controllerId) continue;
    const detected = detectTypeRestrictedCombatMillFromPermanent(perm);
    const creatureType = detected?.effect.appliesToCreatureType;
    if (!detected || !creatureType) continue;
    if (!attackerMatchesRestrictedCreatureType(attackerCard, attackerPermanent, creatureType)) continue;
    return detected;
  }

  return null;
}

function detectSourceSelfCombatDamageReplacement(
  attackerCard: any,
  attackerPermanent: any,
): DetectedPreventDamageMillReplacement | null {
  const replacementTexts = collectCombatDamageReplacementTexts(attackerCard, attackerPermanent);
  for (const replacementText of replacementTexts) {
    const parsed = parseSourceSelfCombatDamageReplacementFromOracle(replacementText);
    if (parsed) {
      return { effect: parsed, sourceName: String(attackerCard?.name || attackerPermanent?.card?.name || 'Effect') };
    }
  }
  return null;
}

function detectPreventDamageMillFromPermanent(
  perm: any
): DetectedPreventDamageMillReplacement | null {
  const replacementTexts = collectCombatDamageReplacementTexts(perm?.card, perm);
  for (const replacementText of replacementTexts) {
    const parsed = parsePreventDamageMillFromOracle(replacementText);
    if (parsed) {
      return { effect: parsed, sourceName: String(perm?.card?.name || 'Effect') };
    }
  }

  return null;
}

/**
 * Scan the battlefield for static "prevent that damage and mill" effects controlled by a player.
 * Mindskinner applies here even when another creature is dealing the damage.
 */
export function detectPreventDamageMillReplacementForController(
  ctx: GameContext,
  sourceControllerId: string,
  options?: { nonCombatOnly?: boolean }
): DetectedPreventDamageMillReplacement | null {
  const controllerId = String(sourceControllerId || '').trim();
  if (!controllerId) return null;

  const battlefield = getActivePermanents(ctx);
  for (const perm of battlefield) {
    if (String(perm?.controller || '') !== controllerId) continue;
    const detected = detectPreventDamageMillFromPermanent(perm);
    if (!detected) continue;

    if (options?.nonCombatOnly && !detected.effect.appliesToNonCombatDamage) {
      continue;
    }

    return detected;
  }

  return null;
}

function parseAnotherCreaturePreventDamagePlusOneFromOracle(replacementText: string): boolean {
  if (!replacementText.includes('if damage would be dealt to another creature you control')) return false;
  if (!replacementText.includes('prevent that damage')) return false;
  if (!replacementText.includes('+1/+1 counter')) return false;
  return replacementText.includes('for each 1 damage prevented');
}

/**
 * "If damage would be dealt to another creature you control, prevent that damage.
 * Put a +1/+1 counter on that creature for each 1 damage prevented this way."
 */
export function detectAnotherCreaturePreventDamagePlusOneReplacement(
  ctx: GameContext,
  damagedPermanent: any,
): { sourceName: string; sourcePermanentId: string } | null {
  if (!damagedPermanent) return null;
  const typeLine = String(damagedPermanent?.card?.type_line || damagedPermanent?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return null;

  const controllerId = String(damagedPermanent?.controller || '').trim();
  const damagedId = String(damagedPermanent?.id || '').trim();
  if (!controllerId || !damagedId) return null;

  for (const perm of getActivePermanents(ctx)) {
    if (String(perm?.controller || '') !== controllerId) continue;
    if (String(perm?.id || '') === damagedId) continue;
    const texts = collectCombatDamageReplacementTexts(perm?.card, perm);
    if (!texts.some((text) => parseAnotherCreaturePreventDamagePlusOneFromOracle(text))) continue;
    return {
      sourceName: String(perm?.card?.name || 'Effect'),
      sourcePermanentId: String(perm.id || ''),
    };
  }

  return null;
}

function isOpponentOfController(
  ctx: GameContext,
  controllerId: string,
  targetPlayerId: string
): boolean {
  const players = (ctx.state?.players as any[]) || [];
  return players.some(
    (p: any) =>
      p &&
      String(p.id) === String(targetPlayerId) &&
      String(p.id) !== String(controllerId) &&
      !p.hasLost
  );
}

/**
 * @deprecated Prefer detectPreventDamageMillReplacementForController — scans the whole battlefield.
 */
export function detectCombatDamageReplacement(
  ctx: GameContext,
  attackerCard: any,
  attackerPermanent: any
): CombatDamageReplacementEffect | null {
  const sourceSelf = detectSourceSelfCombatDamageReplacement(attackerCard, attackerPermanent);
  if (sourceSelf) return sourceSelf.effect;

  const controllerId = String(attackerPermanent?.controller || attackerCard?.controller || '').trim();
  if (controllerId) {
    const typeRestricted = detectTypeRestrictedCombatMillReplacement(
      ctx,
      controllerId,
      attackerCard,
      attackerPermanent,
    );
    if (typeRestricted) return typeRestricted.effect;
    const fromBattlefield = detectPreventDamageMillReplacementForController(ctx, controllerId);
    if (fromBattlefield) return fromBattlefield.effect;
  }

  const replacementTexts = collectCombatDamageReplacementTexts(attackerCard, attackerPermanent);
  for (const replacementText of replacementTexts) {
    const sourceSelf = parseSourceSelfCombatDamageReplacementFromOracle(replacementText);
    if (sourceSelf) return sourceSelf;
    const typeRestricted = parseTypeRestrictedCombatMillFromOracle(replacementText);
    if (typeRestricted && attackerMatchesRestrictedCreatureType(attackerCard, attackerPermanent, typeRestricted.appliesToCreatureType || '')) {
      return typeRestricted;
    }
    const parsed = parsePreventDamageMillFromOracle(replacementText);
    if (parsed) return parsed;
  }

  return null;
}

export function millSpecifiedPlayers(
  ctx: GameContext,
  playerIds: readonly string[],
  count: number
): { opponentId: string; milled: number }[] {
  const millCount = Math.max(0, Math.floor(Number(count) || 0));
  if (millCount <= 0) return [];

  const results: { opponentId: string; milled: number }[] = [];
  const seen = new Set<string>();

  for (const rawId of playerIds) {
    const opponentId = String(rawId || '').trim();
    if (!opponentId || seen.has(opponentId)) continue;
    seen.add(opponentId);
    let milled = 0;

    const zones = (ctx as any).state?.zones || {};
    const playerRow = ((ctx as any).state?.players || []).find((p: any) => String(p?.id || '') === opponentId);
    const lib = ctx.libraries?.get?.(opponentId)
      || (Array.isArray(playerRow?.library) ? playerRow.library : null)
      || (Array.isArray(zones?.[opponentId]?.library) ? zones[opponentId].library : null);
    if (lib && Array.isArray(lib)) {
      const milledCards: any[] = [];
      for (let i = 0; i < millCount && lib.length > 0; i += 1) {
        const card = lib.pop();
        if (card) milledCards.push(card);
      }
      ctx.libraries?.set(opponentId, lib);
      milled = milledCards.length;

      const zones = (ctx as any).state?.zones || {};
      const oppZones = (zones[opponentId] = zones[opponentId] || {
        hand: [],
        graveyard: [],
        library: [],
        libraryCount: 0,
        graveyardCount: 0,
      });
      oppZones.graveyard = oppZones.graveyard || [];
      for (const card of milledCards) {
        pushCardToPlayerGraveyardWithReplacements(ctx, opponentId, card, oppZones.graveyard);
      }
      oppZones.libraryCount = lib.length;
      oppZones.graveyardCount = (oppZones.graveyard || []).length;
    } else {
      const zones = (ctx as any).state?.zones?.[opponentId];
      if (zones && Array.isArray(zones.library)) {
        for (let i = 0; i < millCount && zones.library.length > 0; i += 1) {
          const card = zones.library.shift();
          if (!card) break;
          zones.graveyard = zones.graveyard || [];
          pushCardToPlayerGraveyardWithReplacements(ctx, opponentId, card, zones.graveyard);
          milled += 1;
        }
        zones.libraryCount = zones.library.length;
        zones.graveyardCount = (zones.graveyard || []).length;
      }
    }

    if (milled > 0) {
      results.push({ opponentId, milled });
    }
  }

  return results;
}

export function millAllOpponentsForController(
  ctx: GameContext,
  sourceControllerId: string,
  count: number
): { opponentId: string; milled: number }[] {
  const players = (ctx.state?.players as any[]) || [];
  const opponents = players
    .filter((p: any) => p?.id && String(p.id) !== String(sourceControllerId) && !p.hasLost)
    .map((p: any) => String(p.id));
  return millSpecifiedPlayers(ctx, opponents, count);
}

function putPlusOneCountersOnPermanent(
  ctx: GameContext,
  permanent: any,
  amount: number,
  controllerId: string,
): void {
  const count = Math.max(0, Math.floor(Number(amount) || 0));
  if (!permanent || count <= 0) return;
  const { finalCount } = applyCounterReplacements(ctx, count, controllerId, '+1/+1');
  if (finalCount <= 0) return;
  permanent.counters = { ...(permanent.counters || {}) };
  permanent.counters['+1/+1'] = Number(permanent.counters['+1/+1'] || 0) + finalCount;
}

function buildPreventDamageMillReplacementResult(
  ctx: GameContext,
  args: {
    sourceControllerId: string;
    targetPlayerId: string;
    damageAmount: number;
    replacement: CombatDamageReplacementEffect;
    replacementSourceName: string;
    sourceCard?: any;
  }
): OpponentDamageReplacementResult {
  const result: OpponentDamageReplacementResult = {
    damageDealt: args.damageAmount,
    prevented: false,
    effectsApplied: [],
  };

  const canPrevent = canDamageBePrevented(ctx, args.sourceCard || {}, args.targetPlayerId);

  if (args.replacement.preventsDamage && canPrevent) {
    result.damageDealt = 0;
    result.prevented = true;
    result.effectsApplied.push(`${args.replacementSourceName}: damage prevented`);
  } else if (args.replacement.preventsDamage && !canPrevent) {
    result.effectsApplied.push(`${args.replacementSourceName}: damage could not be prevented`);
  }

  if (args.replacement.millAllOpponents && args.damageAmount > 0) {
    const players = (ctx.state?.players as any[]) || [];
    result.millAmount = args.damageAmount;
    result.millTargets = players
      .filter((p: any) => p?.id && String(p.id) !== String(args.sourceControllerId) && !p.hasLost)
      .map((p: any) => String(p.id));
    result.effectsApplied.push(`Each opponent mills ${args.damageAmount} cards`);
  } else if (args.replacement.millDamagedPlayer && args.damageAmount > 0 && args.targetPlayerId) {
    result.millAmount = args.damageAmount;
    result.millTargets = [String(args.targetPlayerId)];
    result.effectsApplied.push(`${args.targetPlayerId} mills ${args.damageAmount} cards`);
  }

  if (args.replacement.putPlusOneCountersOnSource && args.damageAmount > 0) {
    result.plusOneCountersOnSource = args.damageAmount;
    result.effectsApplied.push(`Put ${args.damageAmount} +1/+1 counter(s) on source`);
  }

  if (args.replacement.drawHalfForControllerAndDamagedPlayer && args.damageAmount > 0) {
    const drawAmount = Math.floor(args.damageAmount / 2);
    if (drawAmount > 0) {
      result.drawAmount = drawAmount;
      result.drawTargets = [...new Set([args.sourceControllerId, args.targetPlayerId].filter(Boolean))];
      result.effectsApplied.push(
        `Controller and damaged player each draw ${drawAmount} card(s)`
      );
    }
  }

  return result;
}

/**
 * Applies Mindskinner-style "prevent damage to an opponent, each opponent mills" replacements
 * for any damage from sources controlled by sourceControllerId.
 */
export type ResolvedOpponentDirectedDamage = OpponentDamageReplacementResult & {
  readonly preReplacementAmount: number;
  readonly damageModifiers: string[];
};

/**
 * Applies 616.1-ordered damage modifiers (Gisela, etc.) then prevent-and-mill replacements
 * (Mindskinner) for damage directed at a player.
 */
export function resolveOpponentDirectedDamage(
  ctx: GameContext,
  args: {
    sourceControllerId: string;
    targetPlayerId: string;
    damageAmount: number;
    sourceCard?: any;
    sourcePermanentId?: string;
    executeMills?: boolean;
  }
): ResolvedOpponentDirectedDamage {
  const { amount, modifiers } = calculateModifiedDamage(
    ctx,
    Math.max(0, Number(args.damageAmount) || 0),
    String(args.sourceControllerId || ''),
    String(args.targetPlayerId || ''),
    args.sourcePermanentId
  );
  const replacement = applyOpponentDamageReplacement(ctx, {
    ...args,
    damageAmount: amount,
  });
  return {
    ...replacement,
    preReplacementAmount: amount,
    damageModifiers: modifiers,
  };
}

export function applyOpponentDamageReplacement(
  ctx: GameContext,
  args: {
    sourceControllerId: string;
    targetPlayerId: string;
    damageAmount: number;
    sourceCard?: any;
    executeMills?: boolean;
  }
): OpponentDamageReplacementResult {
  const empty: OpponentDamageReplacementResult = {
    damageDealt: args.damageAmount,
    prevented: false,
    effectsApplied: [],
  };

  const sourceControllerId = String(args.sourceControllerId || '').trim();
  const targetPlayerId = String(args.targetPlayerId || '').trim();
  const damageAmount = Math.max(0, Number(args.damageAmount) || 0);
  if (!sourceControllerId || !targetPlayerId || damageAmount <= 0) {
    return empty;
  }

  if (!isOpponentOfController(ctx, sourceControllerId, targetPlayerId)) {
    return empty;
  }

  const detected = detectPreventDamageMillReplacementForController(ctx, sourceControllerId, {
    nonCombatOnly: true,
  });
  if (!detected) {
    return empty;
  }

  const result = buildPreventDamageMillReplacementResult(ctx, {
    sourceControllerId,
    targetPlayerId,
    damageAmount,
    replacement: detected.effect,
    replacementSourceName: detected.sourceName,
    sourceCard: args.sourceCard,
  });

  if (args.executeMills !== false && result.millAmount && result.millTargets) {
    millSpecifiedPlayers(ctx, result.millTargets, result.millAmount);
  }

  return result;
}

/**
 * Applies combat damage modifiers then prevent-and-mill replacements for damage to a player.
 */
export function resolveCombatDamageToOpponent(
  ctx: GameContext,
  args: {
    attackerCard: any;
    attackerPermanent: any;
    attackerController: string;
    damageAmount: number;
    defendingPlayerId: string;
    executeMills?: boolean;
  }
): ResolvedOpponentDirectedDamage {
  const { amount, modifiers } = calculateModifiedDamage(
    ctx,
    Math.max(0, Number(args.damageAmount) || 0),
    String(args.attackerController || ''),
    String(args.defendingPlayerId || ''),
    String(args.attackerPermanent?.id || ''),
    true
  );

  const replacement = applyCombatDamageReplacement(
    ctx,
    args.attackerCard,
    args.attackerPermanent,
    args.attackerController,
    amount,
    args.defendingPlayerId
  );

  if (args.executeMills !== false && replacement.millAmount && replacement.millTargets) {
    millSpecifiedPlayers(ctx, replacement.millTargets, replacement.millAmount);
  }

  if (replacement.plusOneCountersOnSource && args.attackerPermanent) {
    putPlusOneCountersOnPermanent(
      ctx,
      args.attackerPermanent,
      replacement.plusOneCountersOnSource,
      String(args.attackerController || ''),
    );
  }

  return {
    ...replacement,
    preReplacementAmount: amount,
    damageModifiers: modifiers,
  };
}

/**
 * Check if damage prevention is being blocked by an effect
 * Returns true if damage cannot be prevented
 */
export function canDamageBePrevented(
  ctx: GameContext,
  damageSource: any,
  damageTarget: string
): boolean {
  const battlefield = getActivePermanents(ctx);
  const oracleText = (damageSource?.oracle_text || "").toLowerCase();
  
  // Check if the source itself says damage can't be prevented
  if (oracleText.includes("damage can't be prevented") ||
      oracleText.includes("damage that would be dealt by") && oracleText.includes("can't be prevented")) {
    return false;
  }
  
  // Check for battlefield effects that prevent damage prevention
  for (const perm of battlefield) {
    const permOracle = (perm.card?.oracle_text || "").toLowerCase();
    const permName = (perm.card?.name || "").toLowerCase();
    
    // Leyline of Punishment: "Players can't gain life. Damage can't be prevented."
    if (permName.includes("leyline of punishment")) {
      return false;
    }
    
    // Skullcrack effect (instant) - check if there's a persistent effect
    // Everlasting Torment: "Players can't gain life. Damage can't be prevented."
    if (permName.includes("everlasting torment")) {
      return false;
    }
    
    // Stigma Lasher - "Damage can't be prevented" for players it damaged
    // This would need special tracking
    
    // Quakebringer - "Damage... can't be prevented"
    if (permOracle.includes("damage can't be prevented")) {
      return false;
    }
  }
  
  return true;
}

/**
 * Apply combat damage replacement effect for The Mindskinner and similar cards
 * 
 * @param ctx - Game context
 * @param attackerCard - The attacking creature's card data
 * @param attackerPermanent - The attacking creature permanent
 * @param attackerController - Player ID of the attacker's controller
 * @param damageAmount - Original damage amount
 * @param defendingPlayerId - Player who would receive the damage
 * @returns Object with prevented damage and applied effects
 */
export function applyCombatDamageReplacement(
  ctx: GameContext,
  attackerCard: any,
  attackerPermanent: any,
  attackerController: string,
  damageAmount: number,
  defendingPlayerId: string
): OpponentDamageReplacementResult {
  const empty: OpponentDamageReplacementResult = {
    damageDealt: damageAmount,
    prevented: false,
    effectsApplied: [],
  };

  const effect = detectCombatDamageReplacement(ctx, attackerCard, attackerPermanent);
  if (!effect) {
    return empty;
  }

  const result = buildPreventDamageMillReplacementResult(ctx, {
    sourceControllerId: attackerController,
    targetPlayerId: defendingPlayerId,
    damageAmount,
    replacement: effect,
    replacementSourceName: String(attackerCard?.name || attackerPermanent?.card?.name || 'Replacement'),
    sourceCard: attackerCard,
  });

  return result;
}
