/**
 * Helpers for mounting DamageAssignmentModal on already-queued
 * COMBAT_DAMAGE_ASSIGNMENT resolution steps (Butcher Orgg free-division, etc.).
 * Ordinary multi-blocker combat damage stays automatic in the combat loop —
 * this module must not invent those prompts.
 */

export type CombatDamageAssignmentMode = 'blockers' | 'free-division';

export interface CombatDamageAssignmentShare {
  target: string;
  amount: number;
}

export interface CombatDamageAssignmentModalData {
  stepId: string;
  assignmentMode: CombatDamageAssignmentMode;
  attacker: any;
  blockers: any[];
  hasTrample: boolean;
  requireLethalOrder?: boolean;
  defendingPlayerId?: string;
  defendingPlayerName?: string;
}

export function playerCombatDamageTargetId(playerId: string): string {
  return `player:${String(playerId)}`;
}

export function isPlayerCombatDamageTargetId(id: string): boolean {
  return String(id || '').startsWith('player:');
}

export function isCombatDamageAssignmentStep(step: any): boolean {
  return String(step?.type || '').toLowerCase() === 'combat_damage_assignment';
}

export function isFreeDivisionCombatDamageStep(step: any): boolean {
  const assignmentMode = String(step?.assignmentMode || '').toLowerCase();
  const specialMode = String(step?.specialCombatDamageMode || '').toLowerCase();
  return assignmentMode === 'free-division' || specialMode === 'divide';
}

function isCreaturePermanent(perm: any): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

function findPermanent(battlefield: any[], id: string): any | undefined {
  const needle = String(id || '').trim();
  if (!needle) return undefined;
  return (battlefield || []).find((perm: any) => String(perm?.id || '').trim() === needle);
}

function stubAttacker(step: any): any {
  const id = String(step?.attackerId || step?.sourceId || 'attacker');
  const power = step?.power ?? step?.damageAmount ?? step?.attackerPower;
  return {
    id,
    controller: step?.controllerId || step?.playerId,
    card: {
      name: step?.sourceName || step?.attackerName || 'Attacker',
      type_line: 'Creature',
      power: power != null ? String(power) : '0',
      toughness: step?.toughness != null ? String(step.toughness) : '0',
    },
  };
}

function recipientId(raw: any): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  return String(raw.id || raw.target || raw.permanentId || '').trim();
}

export function buildCombatDamageAssignmentModalData(
  step: any,
  view: any,
): CombatDamageAssignmentModalData | null {
  if (!isCombatDamageAssignmentStep(step)) return null;
  const battlefield: any[] = Array.isArray(view?.battlefield) ? view.battlefield : [];
  const attackerId = String(step.attackerId || step.sourceId || '').trim();
  const attacker = findPermanent(battlefield, attackerId) || stubAttacker(step);
  const defendingPlayerId = String(step.defendingPlayerId || step.defenderId || '').trim();
  const players: any[] = Array.isArray(view?.players) ? view.players : [];
  const defendingPlayer = players.find((player: any) => String(player?.id || '') === defendingPlayerId);
  const defendingPlayerName = String(
    defendingPlayer?.username
    || defendingPlayer?.name
    || step.defendingPlayerName
    || 'Defending player',
  );
  const assignmentMode: CombatDamageAssignmentMode = isFreeDivisionCombatDamageStep(step)
    ? 'free-division'
    : 'blockers';

  let blockers: any[] = [];
  if (assignmentMode === 'free-division') {
    const recipients = Array.isArray(step.recipients) ? step.recipients : [];
    const creatureIds = recipients
      .map(recipientId)
      .filter((id: string) => id && !isPlayerCombatDamageTargetId(id));
    blockers = creatureIds
      .map((id: string) => findPermanent(battlefield, id))
      .filter(Boolean);
    if (recipients.length === 0 && defendingPlayerId) {
      blockers = battlefield.filter((perm: any) => {
        if (String(perm?.controller || perm?.controllerId || '') !== defendingPlayerId) return false;
        if (attackerId && String(perm?.id || '') === attackerId) return false;
        return isCreaturePermanent(perm);
      });
    }
  } else {
    const rawBlockers = step.blockerIds || step.blockers || [];
    blockers = (Array.isArray(rawBlockers) ? rawBlockers : [])
      .map((entry: any) => findPermanent(battlefield, recipientId(entry)))
      .filter(Boolean);
  }

  return {
    stepId: String(step.id || ''),
    assignmentMode,
    attacker,
    blockers,
    hasTrample: assignmentMode === 'free-division' ? false : Boolean(step.hasTrample),
    requireLethalOrder: assignmentMode === 'free-division' ? false : step.requireLethalOrder !== false,
    defendingPlayerId: defendingPlayerId || undefined,
    defendingPlayerName,
  };
}

export function applyCombatDamageAssignmentPrompt(
  step: any,
  view: any,
  p: {
    setDamageAssignmentData?: (data: CombatDamageAssignmentModalData) => void;
    setDamageAssignmentModalOpen?: (open: boolean) => void;
  },
): boolean {
  const data = buildCombatDamageAssignmentModalData(step, view);
  if (!data || !data.stepId) return false;
  p.setDamageAssignmentData?.(data);
  p.setDamageAssignmentModalOpen?.(true);
  return true;
}

export function buildCombatDamageAssignmentResponse(args: {
  assignments: Array<{ blockerId: string; damage: number }>;
  trampleDamage?: number;
  assignmentMode: CombatDamageAssignmentMode;
  defendingPlayerId?: string;
  stepId: string;
}): { stepId: string; selections: { shares: CombatDamageAssignmentShare[] }; cancelled: false } {
  const shares: CombatDamageAssignmentShare[] = [];
  for (const assignment of args.assignments || []) {
    const amount = Math.max(0, Math.floor(Number(assignment?.damage || 0)));
    const target = String(assignment?.blockerId || '').trim();
    if (amount > 0 && target) shares.push({ target, amount });
  }
  const trample = Math.max(0, Math.floor(Number(args.trampleDamage || 0)));
  if (args.assignmentMode !== 'free-division' && trample > 0 && args.defendingPlayerId) {
    shares.push({ target: playerCombatDamageTargetId(args.defendingPlayerId), amount: trample });
  }
  return {
    stepId: String(args.stepId),
    selections: { shares },
    cancelled: false,
  };
}
