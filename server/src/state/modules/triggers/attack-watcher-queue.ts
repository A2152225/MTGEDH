/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: planAttackWatcherQueue + attack-watcher helpers
 * Public: planAttackWatcherQueue, isAttackWatcherTriggerType
 */

import { isGoaded } from "../../../../../rules-engine/src/actions/combat.js";
import { oracleTextHasOwnKeyword } from "../../../../../rules-engine/src/oracleOwnKeywordText.js";
import { isCreatureTypeWord, permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import { getCurrentPowerToughnessForRules } from "../currentPowerToughness.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";
import { isEnchantedByAuraYouControl } from "./enchanted-by-aura.js";
import { enteringTypePhraseMatches } from "./triggerConditionFamilyMatch.js";
import { parseAttacksSubjectClause, triggerConditionMatches } from "../../../../../rules-engine/src/triggerCondition/index.js";
import { hasChangeling } from "../../../../../rules-engine/src/tribalSupport.js";

/** Watcher types that fire from other permanents, not as self-attack abilities. */
const ATTACK_WATCHER_TRIGGER_TYPES = new Set([
  'creature_attacks',
  'typed_creature_attacks',
  'typed_subtype_attacks',
  'typed_subtype_attacks_any',
  'another_typed_creature_attacks',
  'another_creature_attacks',
  'opponent_creature_attacks',
  'any_creature_attacks',
  'any_creature_attacks_or_blocks',
  'creature_attacks_alone',
  'creature_attacks_a_player_alone',
  'typed_attacks_alone',
  'modified_creature_attacks',
  'goaded_creature_attacks',
  'flying_creature_attacks',
  'haste_creature_attacks',
  'deathtouch_creature_attacks',
  'menace_creature_attacks',
  'trample_creature_attacks',
  'reach_creature_attacks',
  'toxic_creature_attacks',
  'flying_or_haste_attacks',
  'power_equals_toughness_attacks',
  'one_or_more_typed_attack',
  'one_or_more_nontoken_typed_attack',
  'one_or_more_artifact_creatures_attack',
  'one_or_more_modified_creatures_attack',
  'one_or_more_creatures_attack',
  'multi_typed_you_control_attacks',
  'multi_typed_creature_attacks_any',
  'this_and_typed_creature_attack',
  'three_or_more_flying_creatures_attack',
  'two_or_more_creatures_attack',
  'you_attack_with_two_or_more',
  'you_attack_with_exactly_two_creatures',
  'you_attack_with_three_or_more_creatures',
  'vehicle_attacks',
  'counter_creature_attacks',
  'low_power_creature_attacks',
  'entered_this_turn_attacks',
  'base_pt_creature_attacks',
  'own_but_dont_control_attacks',
  'mana_ability_creature_attacks',
  'equipped_creature_attacks_or_blocks',
  'equipped_creature_attacks',
  'nontoken_creature_attacks',
  'one_or_more_enchanted_by_aura_you_control_attack',
  'player_attacks_your_opponent',
  'enchanted_player_attacked',
  'curse_attack',
  'opponents_two_or_more_creatures_attack',
  'chosen_type_creature_etb_or_attack',
  'commander_you_control_etb_or_attack',
  'typed_token_power_or_greater_attacks',
  'equipped_creature_other_than_self_attacks_or_dies',
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

function hasAnyCounter(permanent: any): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return false;
  for (const value of Object.values(counters)) {
    if (typeof value === 'number' && value > 0) return true;
  }
  return false;
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

function attackerHasManaAbility(attacker: any): boolean {
  const texts: string[] = [String(attacker?.card?.oracle_text || attacker?.oracle_text || '')];
  for (const list of [attacker?.grantedAbilities, attacker?.card?.keywords]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) texts.push(String(entry || ''));
  }
  return texts.some((text) => {
    const lower = String(text || '').toLowerCase();
    if (/^tap_for_/.test(lower.trim())) return true;
    return /\{t\}(?:,[^:]*)?:\s*add\b/i.test(lower);
  });
}

function attackerHasKeyword(attacker: any, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  if (oracleTextHasOwnKeyword(String(attacker?.card?.oracle_text || attacker?.oracle_text || ''), kw)) return true;
  const lists = [attacker?.card?.keywords, attacker?.keywords, attacker?.grantedAbilities];
  return lists.some((list) => (
    Array.isArray(list) && list.some((entry) => String(entry || '').trim().toLowerCase() === kw)
  ));
}

function triggerControlledOnly(trigger: CombatTriggeredAbility, defaultValue = true): boolean {
  if (typeof (trigger as any).controlledOnly === 'boolean') return (trigger as any).controlledOnly;
  return defaultValue;
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
  const nonInner = t.match(/^non-?(.+)$/)?.[1];
  if (nonInner) return !attackerMatchesSingleTypeToken(attacker, nonInner);
  if (ATTACK_COLOR_NAMES.has(t)) return attackerHasColor(attacker, t);
  if (t === 'token') return isTokenPermanent(attacker);
  const typeLine = String(attacker?.card?.type_line || '').toLowerCase();
  if (['artifact', 'enchantment', 'legendary', 'vehicle', 'creature'].includes(t)) {
    return typeLine.includes(t);
  }
  const typeWord = (
    t.endsWith('s') && t.length > 2 && !isCreatureTypeWord(t) && isCreatureTypeWord(t.slice(0, -1))
  ) ? t.slice(0, -1) : t;
  return permanentHasCreatureType(attacker, typeWord);
}

function attackerMatchesParsedPhrase(attacker: any, phrase: string): boolean | null {
  return enteringTypePhraseMatches(String(attacker?.card?.type_line || ''), phrase, isTokenPermanent(attacker));
}

function attackerMatchesAttackSubject(attacker: any, phrase: string, sourcePermanent: any): boolean | null {
  const parsed = parseAttacksSubjectClause(phrase);
  if (!parsed) return null;
  return triggerConditionMatches(
    parsed,
    {
      id: String(attacker?.id || ''),
      typeLine: String(attacker?.card?.type_line || ''),
      controllerId: String(attacker?.controller || ''),
      isToken: isTokenPermanent(attacker),
      hasAllCreatureTypes: hasChangeling(
        String(attacker?.card?.oracle_text || ''),
        String(attacker?.card?.type_line || ''),
      ),
    },
    {
      id: String(sourcePermanent?.id || ''),
      controllerId: String(sourcePermanent?.controller || ''),
    },
  );
}

function attackerMatchesTypePhrase(attacker: any, phrase: string): boolean {
  const parsed = attackerMatchesParsedPhrase(attacker, phrase);
  if (parsed !== null) return parsed;
  const parts = String(phrase || '')
    .split(/\s*,\s*|\s+or\s+/i)
    .map((part) => part.trim().replace(/^(?:and\s+)/i, ''))
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
  currentTurn?: number,
  gameState?: any,
): AttackWatcherQueuePlan {
  // Attacker power/toughness checks use current P/T (anthems, equipment, pumps, counters).
  const ptState = gameState ?? { battlefield };
  const attackerPT = (attacker: any) => getCurrentPowerToughnessForRules(attacker, ptState);
  const triggerType = String(trigger.triggerType || '');
  const sourceController = String(trigger.controllerId || sourcePermanent?.controller || '');
  const sourceId = String(sourcePermanent?.id || '');
  const youControl = (attacker: any) => String(attacker?.controller || '') === sourceController;
  const notSource = (attacker: any) => String(attacker?.id || '') !== sourceId;
  const typePhrase = String(trigger.requiredTypePhrase || (trigger as any).value?.requiredTypePhrase || '');

  switch (triggerType) {
    case 'creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          attackerMatchesAttackSubject(attacker, 'a permanent you control', sourcePermanent) ?? youControl(attacker)
        )),
      };
    case 'another_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          attackerMatchesAttackSubject(attacker, 'another permanent you control', sourcePermanent)
          ?? (youControl(attacker) && notSource(attacker))
        )),
      };
    case 'typed_creature_attacks':
    case 'typed_subtype_attacks':
    case 'multi_typed_you_control_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)),
      };
    case 'typed_subtype_attacks_any':
    case 'multi_typed_creature_attacks_any':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => attackerMatchesTypePhrase(attacker, typePhrase)),
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
        attackers: attackingCreatures.filter((attacker) => (
          attackerMatchesAttackSubject(attacker, 'a permanent an opponent controls', sourcePermanent)
          ?? String(attacker?.controller || '') !== sourceController
        )),
      };
    case 'any_creature_attacks':
    case 'any_creature_attacks_or_blocks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          attackerMatchesAttackSubject(attacker, 'a permanent', sourcePermanent) ?? true
        )),
      };
    case 'nontoken_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          attackerMatchesAttackSubject(attacker, 'a nontoken permanent you control', sourcePermanent)
          ?? (youControl(attacker) && !isTokenPermanent(attacker))
        )),
      };
    case 'equipped_creature_attacks':
    case 'equipped_creature_attacks_or_blocks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isCreatureEquipped(battlefield, attacker)),
      };
    case 'equipped_creature_other_than_self_attacks_or_dies':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && notSource(attacker) && isCreatureEquipped(battlefield, attacker)
        )),
      };
    case 'modified_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isAttackingCreatureModified(battlefield, attacker)),
      };
    case 'goaded_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => isGoaded(attacker, currentTurn, battlefield as any[])),
      };
    case 'flying_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          (!triggerControlledOnly(trigger, false) || youControl(attacker))
          && attackerHasKeyword(attacker, 'flying')
        )),
      };
    case 'haste_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasKeyword(attacker, 'haste')),
      };
    case 'deathtouch_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasKeyword(attacker, 'deathtouch')),
      };
    case 'menace_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasKeyword(attacker, 'menace')),
      };
    case 'trample_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasKeyword(attacker, 'trample')),
      };
    case 'reach_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasKeyword(attacker, 'reach')),
      };
    case 'toxic_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && notSource(attacker) && attackerHasKeyword(attacker, 'toxic')
        )),
      };
    case 'flying_or_haste_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker)
          && (attackerHasKeyword(attacker, 'flying') || attackerHasKeyword(attacker, 'haste'))
        )),
      };
    case 'power_equals_toughness_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker)) return false;
          const { power, toughness } = attackerPT(attacker);
          return Number(power) === Number(toughness);
        }),
      };
    case 'one_or_more_typed_attack': {
      const anyTyped = attackingCreatures.some((attacker) => (
        youControl(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)
      ));
      return anyTyped ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_nontoken_typed_attack': {
      const anyTyped = attackingCreatures.some((attacker) => (
        youControl(attacker)
        && !isTokenPermanent(attacker)
        && attackerMatchesTypePhrase(attacker, typePhrase)
      ));
      return anyTyped ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_artifact_creatures_attack': {
      const anyArtifact = attackingCreatures.some((attacker) => (
        youControl(attacker) && attackerMatchesSingleTypeToken(attacker, 'artifact')
      ));
      return anyArtifact ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_modified_creatures_attack': {
      const anyModified = attackingCreatures.some((attacker) => (
        youControl(attacker) && isAttackingCreatureModified(battlefield, attacker)
      ));
      return anyModified ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_creatures_attack': {
      const any = attackingCreatures.some((attacker) => (
        !triggerControlledOnly(trigger, false) || youControl(attacker)
      ));
      return any ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'two_or_more_creatures_attack':
      return attackingCreatures.length >= 2 ? { kind: 'once' } : { kind: 'skip' };
    case 'you_attack_with_two_or_more': {
      if (sourceController !== attackingPlayer) return { kind: 'skip' };
      return attackingCreatures.filter(youControl).length >= 2 ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'you_attack_with_exactly_two_creatures': {
      if (sourceController !== attackingPlayer) return { kind: 'skip' };
      return attackingCreatures.filter(youControl).length === 2 ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'you_attack_with_three_or_more_creatures': {
      if (sourceController !== attackingPlayer) return { kind: 'skip' };
      return attackingCreatures.filter(youControl).length >= 3 ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'vehicle_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && attackerMatchesSingleTypeToken(attacker, 'vehicle')
        )),
      };
    case 'this_and_typed_creature_attack': {
      const sourceAttacking = attackingCreatures.some((attacker) => String(attacker?.id || '') === sourceId);
      if (!sourceAttacking) return { kind: 'skip' };
      const otherTyped = attackingCreatures.some((attacker) => (
        notSource(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)
      ));
      return otherTyped ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'three_or_more_flying_creatures_attack': {
      const flyers = attackingCreatures.filter((attacker) => (
        youControl(attacker) && attackerHasKeyword(attacker, 'flying')
      ));
      return flyers.length >= 3 ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'counter_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          const hasCounter = (trigger as any).anyCounter
            ? hasAnyCounter(attacker)
            : hasPlusOnePlusOneCounter(attacker);
          if (!hasCounter) return false;
          if ((trigger as any).controlledOnly && !youControl(attacker)) return false;
          return true;
        }),
      };
    case 'entered_this_turn_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attacker?.enteredThisTurn === true),
      };
    case 'base_pt_creature_attacks': {
      const basePower = Number((trigger as any).basePower);
      const baseToughness = Number((trigger as any).baseToughness);
      if (!Number.isFinite(basePower) || !Number.isFinite(baseToughness)) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker)) return false;
          const printedPower = Number(attacker?.card?.power ?? attacker?.power);
          const printedToughness = Number(attacker?.card?.toughness ?? attacker?.toughness);
          return printedPower === basePower && printedToughness === baseToughness;
        }),
      };
    }
    case 'own_but_dont_control_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          const owner = String(attacker?.owner || attacker?.card?.owner || '');
          const controller = String(attacker?.controller || '');
          return owner === sourceController && controller !== sourceController;
        }),
      };
    case 'mana_ability_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerHasManaAbility(attacker)),
      };
    case 'low_power_creature_attacks': {
      const maxPower = Number(trigger.maxPower ?? (trigger as any).value?.maxPower);
      if (!Number.isFinite(maxPower)) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker)) return false;
          const { power } = attackerPT(attacker);
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
    case 'commander_you_control_etb_or_attack':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker)
          && (attacker?.isCommander === true || attacker?.commander === true || attacker?.card?.isCommander === true)
        )),
      };
    case 'typed_token_power_or_greater_attacks': {
      const minPower = Number((trigger as any).minPower ?? (trigger as any).value?.minPower);
      if (!Number.isFinite(minPower)) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker) || !isTokenPermanent(attacker)) return false;
          if (!attackerMatchesTypePhrase(attacker, typePhrase)) return false;
          const { power } = attackerPT(attacker);
          return Number(power) >= minPower;
        }),
      };
    }
    case 'creature_attacks_alone':
      if (attackingCreatures.length !== 1 || !youControl(attackingCreatures[0])) return { kind: 'skip' };
      return { kind: 'once' };
    case 'creature_attacks_a_player_alone': {
      // CR 506.6: sole attacker of the specific defending player (multiplayer-aware).
      const aloneAttackers = attackingCreatures.filter((attacker) => {
        if (!youControl(attacker)) return false;
        const attackerId = String(attacker?.id || '');
        const defended = resolveAttackedPlayerId(attacker);
        if (!attackerId || !defended) return false;
        const others = attackingCreatures.filter((other) => {
          const otherId = String(other?.id || '');
          return Boolean(otherId) && otherId !== attackerId && resolveAttackedPlayerId(other) === defended;
        });
        return others.length === 0;
      });
      return aloneAttackers.length > 0 ? { kind: 'per_attacker', attackers: aloneAttackers } : { kind: 'skip' };
    }
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
