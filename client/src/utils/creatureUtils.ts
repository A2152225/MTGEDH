/**
 * Utility functions for determining creature status on the battlefield
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
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
  return Boolean((perm as any).summoningSickness ?? (perm as any).summoningSick);
}

function getAttachedPermanents(
  perm: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[] | undefined,
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
  
  // For all other permanents, check if it's a creature in the type line
  // This covers normal creatures, artifact creatures, enchantment creatures, etc.
  return typeLine.includes('creature');
}

export function hasCurrentKeyword(
  perm: BattlefieldPermanent,
  keyword: string,
  battlefield?: BattlefieldPermanent[],
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
  battlefield?: BattlefieldPermanent[],
): boolean {
  return hasCurrentKeyword(perm, 'haste', battlefield);
}

function canAttackDespiteDefender(perm: BattlefieldPermanent): boolean {
  const text = getCombinedPermanentText(perm);
  return /creatures? with defender can attack|can attack as though .*defender|defender[^.\n]*attack|attack[^.\n]*defender/i.test(text);
}

export function canCreatureUseTapAbilityNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  return !getSummoningSickness(perm) || hasCurrentHaste(perm, battlefield);
}

export function canCreatureAttackNow(
  perm: BattlefieldPermanent,
  battlefield?: BattlefieldPermanent[],
): boolean {
  if (hasCurrentKeyword(perm, 'defender', battlefield) && !canAttackDespiteDefender(perm)) {
    return false;
  }

  return canCreatureUseTapAbilityNow(perm, battlefield);
}
