/**
 * Utility functions for determining creature status on the battlefield
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from '../../../shared/src/counterCombatRestrictions';
import {
  countControlledCreaturesForCombatGate,
  getControlledCreatureCombatGateViolation,
  parseControlledCreatureCombatGate,
} from '../../../shared/src/controlledCreatureCombatGate';
import { getCombinedPermanentText } from './permanentText';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getKeywordList(perm: BattlefieldPermanent): string[] {
  const rawKeywords = (perm.card as any)?.keywords;
  return Array.isArray(rawKeywords)
    ? rawKeywords.map((keyword: unknown) => String(keyword || '').toLowerCase()).filter(Boolean)
    : [];
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text);
}

function getSummoningSickness(perm: BattlefieldPermanent): boolean {
  return Boolean(
    (perm as any).summoningSickness
    ?? (perm as any).summoningSick
    ?? (perm as any).enteredThisTurn,
  );
}

function getAttachedPermanents(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[] | undefined,
): BattlefieldPermanent[] {
  if (!battlefield?.length) {
    return [];
  }

  const attachedIds = new Set<string>(
    Array.isArray((perm as any).attachedEquipment)
      ? (perm as any).attachedEquipment.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  );

  const attachments: BattlefieldPermanent[] = [];
  for (const candidate of battlefield) {
    if (!candidate?.id || candidate.id === perm.id) {
      continue;
    }
    if (attachedIds.has(candidate.id) || (candidate as any).attachedTo === perm.id) {
      attachments.push(candidate);
    }
  }

  return attachments;
}

function attachmentGrantsKeyword(attachedPermanent: BattlefieldPermanent, keyword: string): boolean {
  const typeLine = (((attachedPermanent.card as KnownCardRef | undefined)?.type_line) || '').toLowerCase();
  if (!typeLine.includes('equipment') && !typeLine.includes('aura')) {
    return false;
  }

  const text = getCombinedPermanentText(attachedPermanent);
  if (!text.includes('equipped creature') && !text.includes('enchanted creature')) {
    return false;
  }

  return new RegExp(
    `(?:equipped|enchanted) creature[^.\\n]*\\b(?:has|have|gain|gains)\\b[^.\\n]*\\b${escapeRegExp(keyword)}\\b`,
    'i',
  ).test(text);
}

/**
 * Check if a permanent is currently a creature.
 * Handles special cases:
 * - Equipment with Reconfigure: IS a creature when not attached
 * - Enchantment Creatures with Bestow: IS a creature when not attached
 * 
 * Rule 702.151b: "Attaching an Equipment with reconfigure to another creature causes 
 * the Equipment to stop being a creature until it becomes unattached from that creature."
 * 
 * @param perm The battlefield permanent to check
 * @returns true if the permanent is currently a creature
 */
export function isCurrentlyCreature(perm: BattlefieldPermanent): boolean {
  const card = perm.card as KnownCardRef | undefined;
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const permAny = perm as any;

  // Crew / animate / station: temporary Creature type until EOT (or while stationed).
  if (permAny.crewed === true) return true;
  if (Array.isArray(permAny.grantedTypes) && permAny.grantedTypes.some((t: any) => String(t).toLowerCase() === 'creature')) {
    return true;
  }
  if (permAny.animated === true || permAny.isCreature === true) return true;
  
  // Check for Equipment with Reconfigure or Enchantment with Bestow
  // These can be creatures OR equipment/auras depending on attachment state
  // Use word boundary regex to avoid false positives (e.g., "preconfigure")
  const hasReconfigure = /\breconfigure\b/i.test(oracleText);
  const hasBestow = /\bbestow\b/i.test(oracleText);
  const isEquipment = typeLine.includes('equipment');
  const isEnchantment = typeLine.includes('enchantment');
  
  if ((isEquipment && hasReconfigure) || (isEnchantment && hasBestow)) {
    // These permanents are creatures when NOT attached, equipment/aura when attached
    // The attachedTo property is already defined in BattlefieldPermanent interface
    return !perm.attachedTo; // IS a creature when NOT attached
  }
  
  // Vehicles are NOT creatures unless crewed/granted above.
  if (typeLine.includes('vehicle')) {
    return false;
  }

  // For all other permanents, check if it's a creature in the type line
  // This covers normal creatures, artifact creatures, enchantment creatures, etc.
  return typeLine.includes('creature');
}

export function hasCurrentKeyword(
  perm: BattlefieldPermanent,
  keyword: string,
  battlefield?: readonly BattlefieldPermanent[],
): boolean {
  const normalizedKeyword = keyword.toLowerCase();
  if (getKeywordList(perm).includes(normalizedKeyword)) {
    return true;
  }

  if (hasWord(getCombinedPermanentText(perm), normalizedKeyword)) {
    return true;
  }

  for (const attachedPermanent of getAttachedPermanents(perm, battlefield)) {
    if (attachmentGrantsKeyword(attachedPermanent, normalizedKeyword)) {
      return true;
    }
  }

  return false;
}

export function hasCurrentHaste(
  perm: BattlefieldPermanent,
  battlefield?: readonly BattlefieldPermanent[],
): boolean {
  return hasCurrentKeyword(perm, 'haste', battlefield);
}

function canAttackDespiteDefender(perm: BattlefieldPermanent): boolean {
  const text = getCombinedPermanentText(perm);
  return /creatures? with defender can attack|can attack as though .*defender|defender[^.\n]*attack|attack[^.\n]*defender/i.test(text);
}

export function canCreatureUseTapAbilityNow(
  perm: BattlefieldPermanent,
  battlefield?: readonly BattlefieldPermanent[],
): boolean {
  return !getSummoningSickness(perm) || hasCurrentHaste(perm, battlefield);
}


function getOracleTextForCombatGate(perm: BattlefieldPermanent): string {
  return [
    String((perm.card as any)?.oracle_text || ''),
    String((perm as any).oracle_text || ''),
    Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities.join('\n') : '',
  ].join('\n');
}

function failsControlledCreatureCombatGate(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[] | undefined,
  action: 'attack' | 'block',
): boolean {
  const field = battlefield || [];
  const oracleText = getOracleTextForCombatGate(perm);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return false;

  const controllerId = String(perm.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield: field,
    controllerId,
    isCreature: (p) => isCurrentlyCreature(p as BattlefieldPermanent),
    excludePermanentId: gate.otherOnly ? String(perm.id || '') : null,
  });

  return getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String((perm.card as any)?.name || 'This creature'),
  }).illegal;
}

export function canCreatureAttackNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  if (failsControlledCreatureCombatGate(perm, field, 'attack')) {
    return false;
  }
  const counterCheck = isCounterPreventingAttack(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }

  if (hasCurrentKeyword(perm, 'defender', battlefield) && !canAttackDespiteDefender(perm)) {
    return false;
  }

  return canCreatureUseTapAbilityNow(perm, battlefield);
}

export function canCreatureBlockNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  const field = battlefield || [];
  if (failsControlledCreatureCombatGate(perm, field, 'block')) {
    return false;
  }
  const counterCheck = isCounterPreventingBlock(perm, field);
  if (counterCheck.isPrevented) {
    return false;
  }

  const combinedText = getCombinedPermanentText(perm);
  if (combinedText.includes("can't block") && !combinedText.includes("can't be blocked")) {
    return false;
  }

  return true;
}

export function getCounterCombatRestrictionReason(
  perm: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[],
  action: 'attack' | 'block',
): string | undefined {
  const check = action === 'attack'
    ? isCounterPreventingAttack(perm, battlefield)
    : isCounterPreventingBlock(perm, battlefield);
  if (!check.isPrevented) return undefined;
  return `Has ${check.counterType} counter (${check.sourceName} effect)`;
}
export function getControlledCreatureCombatGateReason(
  perm: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
  action: 'attack' | 'block',
): string | undefined {
  const oracleText = getOracleTextForCombatGate(perm);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return undefined;
  const controllerId = String(perm.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield,
    controllerId,
    isCreature: (p) => isCurrentlyCreature(p as BattlefieldPermanent),
    excludePermanentId: gate.otherOnly ? String(perm.id || '') : null,
  });
  const violation = getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String((perm.card as any)?.name || 'This creature'),
  });
  return violation.illegal ? violation.reason : undefined;
}
