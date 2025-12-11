/**
 * Utility functions for determining creature status on the battlefield
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

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
