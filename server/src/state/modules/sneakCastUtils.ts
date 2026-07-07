import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { movePermanentToHand } from './zones.js';
import { parseKeywordAlternateManaCost } from './alternate-costs.js';

export function isDeclareBlockersStep(state: any): boolean {
  const step = String(state?.step || '').toUpperCase().trim();
  return step === 'DECLARE_BLOCKERS' || step.includes('BLOCKERS');
}

export function parseSneakCost(oracleText: string): string | undefined {
  return parseKeywordAlternateManaCost(oracleText, 'sneak');
}

export function isUnblockedAttackingCreature(battlefield: any[], attackerId: string): boolean {
  const normalizedId = String(attackerId || '').trim();
  if (!normalizedId) return false;

  const attacker = battlefield.find((perm: any) => String(perm?.id || '') === normalizedId);
  if (!attacker || !(attacker as any).attacking) return false;

  return !battlefield.some((perm: any) =>
    Array.isArray((perm as any).blocking)
    && (perm as any).blocking.some((blockedId: any) => String(blockedId || '') === normalizedId),
  );
}

export function listUnblockedAttackingCreaturesForPlayer(state: any, playerId: PlayerID): any[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm: any) => {
    if (!perm || String(perm.controller || perm.owner || '') !== String(playerId || '')) return false;
    if (!String(perm?.card?.type_line || '').toLowerCase().includes('creature')) return false;
    return isUnblockedAttackingCreature(battlefield, String(perm.id || ''));
  });
}

export function calculateSneakOptions(
  game: any,
  playerId: string,
  card: any,
): {
  availableCreatures: Array<{
    id: string;
    name: string;
    attackTarget: string;
    imageUrl?: string;
  }>;
  messages: string[];
} {
  const options = {
    availableCreatures: [] as Array<{
      id: string;
      name: string;
      attackTarget: string;
      imageUrl?: string;
    }>,
    messages: [] as string[],
  };

  const oracleText = String(card?.oracle_text || '');
  if (!parseSneakCost(oracleText)) return options;
  if (!isDeclareBlockersStep(game?.state)) return options;
  if (String(game?.state?.turnPlayer || '') !== String(playerId || '')) return options;

  for (const permanent of listUnblockedAttackingCreaturesForPlayer(game.state, playerId as PlayerID)) {
    const attackTarget = String((permanent as any).attacking || '').trim();
    if (!attackTarget) continue;
    options.availableCreatures.push({
      id: String(permanent.id || ''),
      name: String(permanent?.card?.name || 'Creature'),
      attackTarget,
      imageUrl: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
    });
  }

  if (options.availableCreatures.length > 0) {
    options.messages.push(`Sneak available: return ${options.availableCreatures.length} unblocked attacker(s) to hand`);
  }

  return options;
}

export function canCastWithSneakAtCurrentTiming(game: any, playerId: string, card: any): boolean {
  if (!parseSneakCost(String(card?.oracle_text || ''))) return false;
  if (!isDeclareBlockersStep(game?.state)) return false;
  if (String(game?.state?.turnPlayer || '') !== String(playerId || '')) return false;
  return calculateSneakOptions(game, playerId, card).availableCreatures.length > 0;
}

export function validateSneakReturnedCreature(
  state: any,
  playerId: PlayerID,
  returnedCreatureId: string,
): { ok: true; permanent: any; attackTarget: string } | { ok: false; code: string; message: string } {
  const normalizedId = String(returnedCreatureId || '').trim();
  if (!normalizedId) {
    return { ok: false, code: 'SNEAK_CREATURE_REQUIRED', message: 'Select an unblocked attacking creature to return to hand for sneak.' };
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === normalizedId);
  if (!permanent || String(permanent.controller || permanent.owner || '') !== String(playerId || '')) {
    return { ok: false, code: 'SNEAK_CREATURE_NOT_FOUND', message: 'Selected sneak creature not found on the battlefield.' };
  }

  if (!isUnblockedAttackingCreature(battlefield, normalizedId)) {
    return { ok: false, code: 'SNEAK_CREATURE_NOT_UNBLOCKED', message: 'Sneak requires returning an unblocked attacking creature you control.' };
  }

  const attackTarget = String((permanent as any).attacking || '').trim();
  if (!attackTarget) {
    return { ok: false, code: 'SNEAK_NO_ATTACK_TARGET', message: 'Selected creature is not attacking.' };
  }

  return { ok: true, permanent, attackTarget };
}

export function applySneakReturnedCreatureCost(
  ctx: GameContext,
  returnedCreatureId: string,
): { attackTarget: string } | null {
  const state = (ctx as any).state as any;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(returnedCreatureId || ''));
  if (!permanent) return null;

  const attackTarget = String((permanent as any).attacking || '').trim();
  if (!attackTarget) return null;

  (permanent as any).attacking = false;
  (permanent as any).isAttacking = false;
  delete (permanent as any).attackedThisTurn;

  const moved = movePermanentToHand(ctx, String(returnedCreatureId || ''));
  if (!moved) return null;

  return { attackTarget };
}

export function applySneakPermanentBattlefieldEntry(permanent: any, stackItem?: any): void {
  if (!permanent) return;
  if (stackItem?.sneakCostWasPaid !== true && stackItem?.card?.sneakCostWasPaid !== true) return;

  const attackTarget = String(
    stackItem?.sneakAttackTarget
    || stackItem?.card?.sneakAttackTarget
    || '',
  ).trim();
  if (!attackTarget) return;

  permanent.tapped = true;
  permanent.attacking = attackTarget;
  permanent.isAttacking = true;
  permanent.summoningSickness = false;
  permanent.sneakCostWasPaid = true;
  permanent.sneakAttackTarget = attackTarget;
  permanent.card = {
    ...(permanent.card || {}),
    sneakCostWasPaid: true,
    sneakAttackTarget: attackTarget,
  };
}
