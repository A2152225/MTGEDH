// client/src/utils/manaActions.ts
// Utility functions for mana-related client actions

import { socket } from '../socket';
import type { BattlefieldPermanent } from '../../../shared/src';

/**
 * Check if a permanent is a land that can be tapped for mana
 */
export function isLand(perm: BattlefieldPermanent): boolean {
  const typeLine = (perm.card as any)?.type_line?.toLowerCase() || '';
  return typeLine.includes('land');
}

/**
 * Handle clicking on a land to tap it for mana
 * This emits a tapForMana socket event to the server
 */
export function tapLandForMana(
  gameId: string, 
  permanentId: string, 
  manaChoice?: string
): void {
  socket.emit('tapForMana', { 
    gameId, 
    permanentId, 
    manaChoice 
  });
}

/**
 * Get mana pool display string for a player
 */
export function formatManaPool(manaPool?: {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  generic: number;
}): string {
  if (!manaPool) return '';
  
  const parts: string[] = [];
  if (manaPool.W > 0) parts.push(`{W}×${manaPool.W}`);
  if (manaPool.U > 0) parts.push(`{U}×${manaPool.U}`);
  if (manaPool.B > 0) parts.push(`{B}×${manaPool.B}`);
  if (manaPool.R > 0) parts.push(`{R}×${manaPool.R}`);
  if (manaPool.G > 0) parts.push(`{G}×${manaPool.G}`);
  if (manaPool.C > 0) parts.push(`{C}×${manaPool.C}`);
  if (manaPool.generic > 0) parts.push(`{*}×${manaPool.generic}`);
  
  return parts.join(' ');
}
