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
import {
  grantedAbilityIsOwnKeyword,
  oracleTextGrantsKeywordOnlyToOthers,
  oracleTextHasOwnKeyword,
} from '../../../rules-engine/src/oracleOwnKeywordText';
import { permanentHasKeywordAbility, permanentLosesKeyword } from '../../../rules-engine/src/permanentKeywordAbilities';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getKeywordList(perm: BattlefieldPermanent): string[] {
  const rawKeywords = (perm.card as any)?.keywords;
  return Array.isArray(rawKeywords)
    ? rawKeywords.map((keyword: unknown) => String(keyword || '').toLowerCase()).filter(Boolean)
    : [];
}

function getOwnOracleText(perm: BattlefieldPermanent): string {
  return String((perm.card as any)?.oracle_text || (perm as any).oracle_text || '');
}

function getSummoningSickness(perm: BattlefieldPermanent): boolean {
  return Boolean(
    (perm as any).summoningSickness
    || (perm as any).summoningSick
    || (perm as any).enteredThisTurn,
  );
}

function grantedAbilitiesIncludeKeyword(perm: BattlefieldPermanent, keyword: string): boolean {
  const granted = (perm as any).grantedAbilities;
  if (!Array.isArray(granted)) return false;
  return granted.some((entry: unknown) => grantedAbilityIsOwnKeyword(entry, keyword));
}

function temporaryAbilitiesIncludeKeyword(perm: BattlefieldPermanent, keyword: string): boolean {
  const tempAbilities = [
    ...(Array.isArray((perm as any).tempAbilities) ? (perm as any).tempAbilities : []),
    ...(Array.isArray((perm as any).temporaryAbilities) ? (perm as any).temporaryAbilities : []),
  ];
  return tempAbilities.some((entry: any) => {
    if (typeof entry === 'string') return grantedAbilityIsOwnKeyword(entry, keyword);
    return grantedAbilityIsOwnKeyword(entry?.ability || entry?.keyword || entry?.name, keyword);
  });
}

function typeLineHasCreatureType(typeLine: string, creatureType: string): boolean {
  const type = String(creatureType || '').trim().toLowerCase().replace(/s$/, '');
  if (!type) return false;
  return new RegExp(`\\b${escapeRegExp(type)}s?\\b`, 'i').test(typeLine);
}

function battlefieldGrantsKeyword(
  perm: BattlefieldPermanent,
  keyword: string,
  battlefield: readonly BattlefieldPermanent[] | undefined,
): boolean {
  if (!battlefield?.length) return false;
  const recipientId = String(perm.id || '');
  const recipientController = String(perm.controller || '');
  const recipientTypeLine = String((perm.card as any)?.type_line || '').toLowerCase();
  const escaped = escapeRegExp(keyword);

  for (const grantor of battlefield) {
    if (!grantor || String(grantor.controller || '') !== recipientController) continue;
    const oracle = String((grantor.card as any)?.oracle_text || '');
    if (!oracle) continue;
    const grantorId = String(grantor.id || '');

    if (
      new RegExp(String.raw`\bcreatures you control have\b[^\n.]*\b${escaped}\b`, 'i').test(oracle) &&
      !new RegExp(String.raw`\bother creatures you control have\b[^\n.]*\b${escaped}\b`, 'i').test(oracle)
    ) {
      return true;
    }

    const otherTypeMatch = oracle.match(
      new RegExp(
        String.raw`\bother\s+(\w+?)s?\s+(?:creatures?\s+)?you\s+control\s+have\b[^\n.]*\b${escaped}\b`,
        'i',
      ),
    );
    if (otherTypeMatch && grantorId && grantorId !== recipientId) {
      if (typeLineHasCreatureType(recipientTypeLine, String(otherTypeMatch[1] || ''))) {
        return true;
      }
    }

    const tribalMatch = oracle.match(
      new RegExp(
        String.raw`\b(\w+)\s+creatures? you control have\b[^\n.]*\b${escaped}\b`,
        'i',
      ),
    );
    if (tribalMatch && !/^(all|each|every|other)$/i.test(String(tribalMatch[1] || ''))) {
      if (typeLineHasCreatureType(recipientTypeLine, String(tribalMatch[1] || ''))) {
        return true;
      }
    }
  }

  return false;
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

  // Theros gods below devotion / impending with time counters.
  if (permAny.notCreature === true) return false;

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
  // Shared accurate helper (same as server and AI): removal wins, then own/granted keywords.
  if (permanentLosesKeyword(perm, normalizedKeyword, battlefield)) return false;
  if (permanentHasKeywordAbility(perm, normalizedKeyword, battlefield)) return true;
  const ownOracle = getOwnOracleText(perm);
  const otherOnlyGrant = oracleTextGrantsKeywordOnlyToOthers(ownOracle, normalizedKeyword);

  // Scryfall/keyword lists can be filled by a naive full-oracle scan of a lord grant.
  if (!otherOnlyGrant && getKeywordList(perm).includes(normalizedKeyword)) {
    return true;
  }

  if (oracleTextHasOwnKeyword(ownOracle, normalizedKeyword)) {
    return true;
  }

  if (!otherOnlyGrant && grantedAbilitiesIncludeKeyword(perm, normalizedKeyword)) {
    return true;
  }

  if (temporaryAbilitiesIncludeKeyword(perm, normalizedKeyword)) {
    return true;
  }

  for (const attachedPermanent of getAttachedPermanents(perm, battlefield)) {
    if (attachmentGrantsKeyword(attachedPermanent, normalizedKeyword)) {
      return true;
    }
  }

  return battlefieldGrantsKeyword(perm, normalizedKeyword, battlefield);
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
