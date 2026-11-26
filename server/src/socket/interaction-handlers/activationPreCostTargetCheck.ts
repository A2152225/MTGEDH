/**
 * CR 602.2b: an activated ability's targets are chosen before its costs are paid. Reject an activation
 * with no legal target before any cost handler taps, spends mana or logs "paid ... to activate".
 */
import type { PlayerID } from "../../../../shared/src/index.js";
import { reviewActivatedAbilityTargets } from "../../../../rules-engine/src/aiActivatedAbilityTargets.js";
import { parseTargetRequirements } from "../../rules-engine/targeting.js";
import { buildActivatedAbilityValidTargets } from "../resolutionActivatedAbilityTargetingUtils.js";
import { buildDependentPlayerObjectTargets, parseDependentPlayerObjectTarget } from "./activatedDependentPlayerTargets.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

/** Number of legal targets for the ability's first target requirement, or null when it has none to check. */
export function countActivationLegalTargets(
  game: any,
  pid: string,
  permanentId: string,
  cardName: string,
  permanent: any,
  abilityText: string,
  requiresTap: boolean,
): { legal: number; required: number } | null {
  const text = String(abilityText || '');
  if (!/\btargets?\b/i.test(text)) return null;
  const board = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const review = reviewActivatedAbilityTargets(game.state as any, pid as PlayerID, text, board, String(permanentId || ''));
  if (review.requiresTarget && review.legal.length === 0) return { legal: 0, required: 1 };
  const reqs = parseTargetRequirements(text, { gameState: game.state, controllerId: pid, sourceName: cardName, sourcePermanent: permanent });
  const types = Array.isArray(reqs.targetTypes) ? reqs.targetTypes.map((type) => String(type || '').toLowerCase()) : [];
  const required = Number(reqs.minTargets || 0);
  if (!reqs.needsTargets || types.length === 0 || required <= 0) return null;
  if (types.some((type) => type.startsWith('graveyard_'))) return null;
  const dependent = parseDependentPlayerObjectTarget(text);
  const legal = dependent
    ? buildDependentPlayerObjectTargets(game, pid, dependent).length
    : buildActivatedAbilityValidTargets(game, pid, reqs, { sourcePermanentId: permanentId, abilityText: text, sourceTapCost: requiresTap }).length;
  return { legal, required };
}

export function rejectActivationWithoutLegalTargets(
  ctx: ActivateBattlefieldAbilityContext,
  abilityText: string,
  requiresTap: boolean,
): boolean {
  if (ctx.splitSecondLockActive) return false;
  const counted = countActivationLegalTargets(ctx.game, String(ctx.pid), String(ctx.permanentId), ctx.cardName, ctx.permanent, abilityText, requiresTap);
  if (!counted || counted.legal >= counted.required) return false;
  ctx.socket.emit('error', {
    code: 'NO_VALID_TARGETS',
    message: `${ctx.cardName}'s ability has no legal target.`,
  });
  return true;
}
