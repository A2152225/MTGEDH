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
  
  // Check if it's a creature in the type line
  if (typeLine.includes('creature')) {
    return true;
  }
  
  // Check for Equipment with Reconfigure or Enchantment with Bestow
  // These ARE creatures when NOT attached
  const hasReconfigure = oracleText.includes('reconfigure');
  const hasBestow = oracleText.includes('bestow');
  const isEquipment = typeLine.includes('equipment');
  const isEnchantment = typeLine.includes('enchantment');
  
  if ((isEquipment && hasReconfigure) || (isEnchantment && hasBestow)) {
    // Check if it's attached - if attachedTo is set, it's NOT a creature
    // The attachedTo property is already defined in BattlefieldPermanent interface
    return !perm.attachedTo; // IS a creature when NOT attached
  }
  
  return false;
}
