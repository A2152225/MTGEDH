/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: planAttackWatcherQueue + attack-watcher helpers
 * Public: planAttackWatcherQueue, isAttackWatcherTriggerType
 */

import { permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import { getActualPowerToughness } from "../../utils.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";
import { isEnchantedByAuraYouControl } from "./enchanted-by-aura.js";

/** Watcher types that fire from other permanents, not as self-attack abilities. */
const ATTACK_WATCHER_TRIGGER_TYPES = new Set([
  'creature_attacks',
  'typed_creature_attacks',
  'typed_subtype_attacks',
  'another_typed_creature_attacks',
  'another_creature_attacks',
  'opponent_creature_attacks',
  'any_creature_attacks',
  'any_creature_attacks_or_blocks',
  'creature_attacks_alone',
  'typed_attacks_alone',
  'modified_creature_attacks',
  'counter_creature_attacks',
  'low_power_creature_attacks',
  'equipped_creature_attacks',
  'nontoken_creature_attacks',
  'one_or_more_enchanted_by_aura_you_control_attack',
  'player_attacks_your_opponent',
  'enchanted_player_attacked',
  'curse_attack',
  'opponents_two_or_more_creatures_attack',
  'chosen_type_creature_etb_or_attack',
  'exalted',
  'you_attack',
  'you_attack_with_commander',
  'commander_attacks',
]);

export function isAttackWatcherTriggerType(triggerType: string | undefined): boolean {
  return ATTACK_WATCHER_TRIGGER_TYPES.has(String(triggerType || ''));
}

function isTokenPermanent(permanent: any): boolean {
  if (permanent?.isToken === true || permanent?.token === true) return true;
  return /\btoken\b/i.test(String(permanent?.card?.type_line || ''));
}

function hasPlusOnePlusOneCounter(permanent: any): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return false;
  const n = Number((counters as any)['+1/+1'] ?? (counters as any).p1p1 ?? 0);
  return Number.isFinite(n) && n > 0;
}

function isCreatureEquipped(battlefield: readonly any[], creature: any): boolean {
  if (creature?.isEquipped === true) return true;
  if (Array.isArray(creature?.attachedEquipment) && creature.attachedEquipment.length > 0) return true;
  const id = String(creature?.id || '').trim();
  if (!id) return false;
  return (battlefield || []).some((perm: any) => {
    if (String(perm?.attachedTo || '').trim() !== id) return false;
    return /\bequipment\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
  });
}

function isAttackingCreatureModified(battlefield: readonly any[], creature: any): boolean {
  const counters = creature?.counters;
  if (counters && typeof counters === 'object') {
    for (const value of Object.values(counters)) {
      if (typeof value === 'number' && value > 0) return true;
    }
  }
  if (isCreatureEquipped(battlefield, creature)) return true;
  const id = String(creature?.id || '').trim();
  if (!id) return false;
  return (battlefield || []).some((perm: any) => {
    if (String(perm?.attachedTo || perm?.enchanting || '').trim() !== id) return false;
    return /\baura\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
  });
}

const ATTACK_COLOR_NAMES = new Set(['white', 'blue', 'black', 'red', 'green']);
const ATTACK_COLOR_LETTER: Record<string, string> = {
  white: 'w',
  blue: 'u',
  black: 'b',
  red: 'r',
  green: 'g',
};

function attackerHasColor(attacker: any, colorName: string): boolean {
  const color = String(colorName || '').trim().toLowerCase();
  if (!ATTACK_COLOR_NAMES.has(color)) return false;
  const card = attacker?.card || attacker || {};
  const colors = Array.isArray(card.colors)
    ? card.colors.map((entry: any) => String(entry || '').toLowerCase())
    : [];
  const letter = ATTACK_COLOR_LETTER[color];
  if (colors.includes(color) || (letter && colors.includes(letter))) return true;
  const identity = Array.isArray(card.color_identity)
    ? card.color_identity.map((entry: any) => String(entry || '').toLowerCase())
    : [];
  if (letter && identity.includes(letter)) return true;
  const manaCost = String(card.mana_cost || attacker?.mana_cost || '');
  if (letter && manaCost.toLowerCase().includes(`{${letter}}`)) return true;
  return false;
}

function attackerMatchesSingleTypeToken(attacker: any, token: string): boolean {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return false;
  if (ATTACK_COLOR_NAMES.has(t)) return attackerHasColor(attacker, t);
  if (t === 'token') return isTokenPermanent(attacker);
  if (t === 'nontoken') return !isTokenPermanent(attacker);
  const typeLine = String(attacker?.card?.type_line || '').toLowerCase();
  if (['artifact', 'enchantment', 'legendary', 'vehicle', 'creature'].includes(t)) {
    return typeLine.includes(t);
  }
  return permanentHasCreatureType(attacker, t);
}

function attackerMatchesTypePhrase(attacker: any, phrase: string): boolean {
  const parts = String(phrase || '')
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.some((part) => attackerMatchesSingleTypeToken(attacker, part));
}

type AttackWatcherQueuePlan =
  | { kind: 'skip' }
  | { kind: 'once' }
  | { kind: 'per_attacker'; attackers: any[] }
  | { kind: 'per_attacked_player'; playerIds: string[] };

export function planAttackWatcherQueue(
  trigger: CombatTriggeredAbility,
  sourcePermanent: any,
  attackingCreatures: any[],
  attackingPlayer: string,
  attackedPlayerIds: string[],
  battlefield: readonly any[],
  resolveAttackedPlayerId: (attacker: any) => string,
): AttackWatcherQueuePlan {
  const triggerType = String(trigger.triggerType || '');
  const sourceController = String(trigger.controllerId || sourcePermanent?.controller || '');
  const sourceId = String(sourcePermanent?.id || '');
  const youControl = (attacker: any) => String(attacker?.controller || '') === sourceController;
  const notSource = (attacker: any) => String(attacker?.id || '') !== sourceId;
  const typePhrase = String(trigger.requiredTypePhrase || (trigger as any).value?.requiredTypePhrase || '');

  switch (triggerType) {
    case 'creature_attacks':
      return { kind: 'per_attacker', attackers: attackingCreatures.filter(youControl) };
    case 'another_creature_attacks':
      return { kind: 'per_attacker', attackers: attackingCreatures.filter((attacker) => youControl(attacker) && notSource(attacker)) };
    case 'typed_creature_attacks':
    case 'typed_subtype_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)),
      };
    case 'another_typed_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && notSource(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)
        )),
      };
    case 'opponent_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => String(attacker?.controller || '') !== sourceController),
      };
    case 'any_creature_attacks':
    case 'any_creature_attacks_or_blocks':
      return { kind: 'per_attacker', attackers: attackingCreatures };
    case 'nontoken_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && !isTokenPermanent(attacker)),
      };
    case 'equipped_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isCreatureEquipped(battlefield, attacker)),
      };
    case 'modified_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isAttackingCreatureModified(battlefield, attacker)),
      };
    case 'counter_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!hasPlusOnePlusOneCounter(attacker)) return false;
          if ((trigger as any).controlledOnly && !youControl(attacker)) return false;
          return true;
        }),
      };
    case 'low_power_creature_attacks': {
      const maxPower = Number(trigger.maxPower ?? (trigger as any).value?.maxPower);
      if (!Number.isFinite(maxPower)) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker)) return false;
          const { power } = getActualPowerToughness(attacker, { battlefield });
          return Number(power) <= maxPower;
        }),
      };
    }
    case 'chosen_type_creature_etb_or_attack': {
      const chosenType = String(
        sourcePermanent?.chosenCreatureType || sourcePermanent?.card?.chosenCreatureType || '',
      ).trim();
      if (!chosenType) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && permanentHasCreatureType(attacker, chosenType)
        )),
      };
    }
    case 'creature_attacks_alone':
      if (attackingCreatures.length !== 1 || !youControl(attackingCreatures[0])) return { kind: 'skip' };
      return { kind: 'once' };
    case 'typed_attacks_alone':
      if (attackingCreatures.length !== 1 || !youControl(attackingCreatures[0])) return { kind: 'skip' };
      if (!attackerMatchesTypePhrase(attackingCreatures[0], typePhrase)) return { kind: 'skip' };
      return { kind: 'once' };
    case 'exalted':
      if (attackingCreatures.length !== 1 || sourceController !== attackingPlayer) return { kind: 'skip' };
      return { kind: 'once' };
    case 'you_attack':
      if (sourceController !== attackingPlayer || attackingCreatures.length === 0) return { kind: 'skip' };
      return { kind: 'once' };
    case 'you_attack_with_commander':
    case 'commander_attacks': {
      if (sourceController !== attackingPlayer) return { kind: 'skip' };
      const commanderAttacking = attackingCreatures.some((attacker: any) => {
        if (String(attacker?.controller || '') !== sourceController) return false;
        return attacker?.isCommander === true || attacker?.commander === true || attacker?.card?.isCommander === true;
      });
      return commanderAttacking ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_enchanted_by_aura_you_control_attack': {
      const anyEnchanted = attackingCreatures.some((attacker: any) =>
        isEnchantedByAuraYouControl(battlefield, String(attacker?.id || ''), sourceController),
      );
      return anyEnchanted ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'player_attacks_your_opponent': {
      const playerIds = attackedPlayerIds.filter((id) => Boolean(id) && id !== sourceController);
      return playerIds.length > 0 ? { kind: 'per_attacked_player', playerIds } : { kind: 'skip' };
    }
    case 'enchanted_player_attacked':
    case 'curse_attack': {
      const enchantedPlayer = String(sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '').trim();
      if (!enchantedPlayer) return { kind: 'skip' };
      const attackingEnchanted = attackingCreatures.some((attacker) => resolveAttackedPlayerId(attacker) === enchantedPlayer);
      return attackingEnchanted ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'opponents_two_or_more_creatures_attack': {
      const opponentAttackers = attackingCreatures.filter((attacker) => String(attacker?.controller || '') !== sourceController);
      return opponentAttackers.length >= 2 ? { kind: 'once' } : { kind: 'skip' };
    }
    default:
      return { kind: 'skip' };
  }
}
