// Origin parent: server/src/state/modules/replacement-effects.ts
// Cluster: player-damage life-floor caps (Worship / Fortune Thief) for the
// damage replacement registry. Cap-only so combat's calculateModifiedDamage
// then evaluateDamageReplacementEvent does not double-apply amount modifiers.
// Public entry: applyPlayerDamageLifeFloorCaps.
// Leaf must not import replacement-effects.ts.

import type { GameContext } from '../context.js';
import {
  applyDamageReplacementsMinimized,
  detectDamageReplacementEffects,
} from './game-state-effects-handlers/gameStateEffectsReplacementApply.js';

export interface PlayerDamageLifeFloorInput {
  state?: unknown;
  amount: number;
  source?: { controller?: string; id?: string };
  sourceId?: string;
  target?: { id?: string; card?: unknown; type_line?: string };
  targetId?: string;
  targetPlayerId?: string;
  combatDamage?: boolean;
  damageKind?: 'combat' | 'noncombat';
  metadata?: Record<string, unknown>;
}

function eventTargetsPermanent(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const record = target as { card?: unknown; type_line?: string };
  if (record.card) return true;
  return typeof record.type_line === 'string' && record.type_line.trim().length > 0;
}

/**
 * Apply oracle `floorLifeAt` caps to player damage only.
 * Amount-modify families (Furnace / Gisela) stay on calculateModifiedDamage.
 */
export function applyPlayerDamageLifeFloorCaps(
  event: PlayerDamageLifeFloorInput,
): { finalAmount: number; appliedEffects: string[] } | null {
  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;
  if (eventTargetsPermanent(event.target)) return null;

  const damageReceiver = String(event.targetPlayerId || event.targetId || '').trim();
  if (!damageReceiver) return null;

  const meta = event.metadata || {};
  const damageDealer = String(
    meta.damageDealer
    || event.source?.controller
    || '',
  ).trim();
  const damageSourcePermanentId = String(
    meta.damageSourcePermanentId
    || event.source?.id
    || event.sourceId
    || '',
  ).trim();
  const isCombatDamage = event.combatDamage === true
    || event.damageKind === 'combat'
    || meta.isCombatDamage === true;

  const caps = detectDamageReplacementEffects(
    { state: event.state || {} } as GameContext,
    damageDealer,
    damageReceiver,
    Boolean(damageDealer) && damageDealer !== damageReceiver,
    damageSourcePermanentId || undefined,
    isCombatDamage,
  ).filter((effect) => effect.type === 'cap');
  if (caps.length === 0) return null;

  const result = applyDamageReplacementsMinimized(originalAmount, caps);
  if (result.finalAmount === originalAmount) return null;
  return result;
}
