// Origin parent: server/src/state/modules/game-state-effects-handlers/gameStateEffectsMillDamage.ts
// Applies the damage replacements collected by collectDamageSideEffectSpecsFromState that do more than
// change the amount: redirection to another permanent / player and prevention that removes +1/+1 counters.
// Called at the top of calculateModifiedDamage; returns null when nothing applies.
// Public entry symbols: applyDamageSideEffectReplacements.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { applyBatch17DamagePrevention } from "../replacementBatch17DamagePrevention.js";
import { applyBatch18NoncombatPrevention } from "../replacementBatch18NoncombatPrevention.js";
import { collectDamageSideEffectSpecsFromState } from "../replacementEffectSpec-handlers/replacementEffectSpecDamageSideEffectTemplates.js";

function markDamage(perm: any, amount: number): void {
  perm.markedDamage = (Number(perm.markedDamage) || 0) + amount;
  perm.damageThisTurn = (Number(perm.damageThisTurn) || 0) + amount;
  perm.tookDamageThisTurn = true;
}

function dealDamageToPlayer(state: any, playerId: string, amount: number): boolean {
  const player = Array.isArray(state?.players) ? state.players.find((p: any) => String(p?.id) === playerId) : undefined;
  if (!player) return false;
  state.life = state.life || {};
  const current = Number(state.life[playerId] ?? player.life ?? 40);
  state.life[playerId] = current - amount;
  player.life = state.life[playerId];
  return true;
}

export function applyDamageSideEffectReplacements(
  ctx: GameContext,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state = (ctx as any)?.state || ctx;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!battlefield.length) return null;
  const b17 = applyBatch17DamagePrevention(ctx, damageAmount, damageReceiver, targetPermanentId);
  if (b17) return b17;
  const b18 = applyBatch18NoncombatPrevention(state, damageAmount, damageReceiver, targetPermanentId, isCombatDamage);
  if (b18) return b18;
  const specs = collectDamageSideEffectSpecsFromState(state);
  if (!specs.length) return null;
  const find = (id: string) => (id ? battlefield.find((p: any) => String(p?.id || '') === id) : undefined);
  const targetId = String(targetPermanentId || '').trim();

  if (targetId) {
    for (const spec of specs) {
      if (spec.event !== 'damage-prevention-cost' || String(spec.sourcePermanentId || '') !== targetId) continue;
      const perm = find(targetId);
      if (!perm) continue;
      const md = (spec.metadata || {}) as Record<string, unknown>;
      perm.counters = perm.counters || {};
      if (md.addCountersInstead === true) {
        const kind = String(md.counter || '+1/+1');
        perm.counters[kind] = Math.max(0, Number(perm.counters[kind]) || 0) + damageAmount;
        return { amount: 0, modifiers: [`${spec.sourceName}: ${damageAmount} ${kind} counter(s) instead of damage`] } as any;
      }
      const have = Math.max(0, Number(perm.counters['+1/+1']) || 0);
      if (md.requiresCounter === true && have <= 0) continue;
      const remove = Math.min(have, md.removeMode === 'amount' ? damageAmount : 1);
      if (remove > 0) perm.counters['+1/+1'] = have - remove;
      return {
        amount: 0,
        modifiers: [`${spec.sourceName}: prevented ${damageAmount} damage and removed ${remove} +1/+1 counter(s)`],
      };
    }
  }

  for (const spec of specs) {
    if (spec.event !== 'damage-redirect') continue;
    const md = (spec.metadata || {}) as Record<string, unknown>;
    const source = find(String(spec.sourcePermanentId || ''));
    if (!source) continue;
    if (md.redirectTo === 'attached-controller') {
      if (!targetId || String(source.attachedTo || '') !== targetId) continue;
      const enchanted = find(targetId);
      const controller = String(enchanted?.controller || '');
      if (!controller || !dealDamageToPlayer(state, controller, damageAmount)) continue;
      return { amount: 0, modifiers: [`${spec.sourceName}: ${damageAmount} damage dealt to ${controller} instead`] };
    }
    const controller = String(spec.sourceController || '');
    const recipientId = md.redirectTo === 'self' ? String(source.id) : String(source.attachedTo || '');
    if (!recipientId || recipientId === targetId) continue;
    const protectsPlayer = !targetId && String(damageReceiver || '') === controller;
    const protectsPermanent = !!targetId && md.includeOtherPermanents === true
      && String(find(targetId)?.controller || '') === controller;
    if (!protectsPlayer && !protectsPermanent) continue;
    if (md.requiresUntapped === true && source.tapped) continue;
    if (md.sourceFilter) {
      const dealer = find(String(damageSourcePermanentId || '').trim());
      const typeLine = String(dealer?.card?.type_line || '').toLowerCase();
      if (md.sourceFilter === 'artifact' && !typeLine.includes('artifact')) continue;
      if (md.sourceFilter === 'unblocked-creature') {
        const blocked = Array.isArray(dealer?.blockedBy) && dealer.blockedBy.length > 0;
        if (!typeLine.includes('creature') || !dealer?.attacking || blocked) continue;
      }
    }
    const recipient = find(recipientId);
    if (!recipient) continue;
    markDamage(recipient, damageAmount);
    return {
      amount: 0,
      modifiers: [`${spec.sourceName}: ${damageAmount} damage dealt to ${recipient.card?.name || recipientId} instead`],
    };
  }
  void damageDealer;
  return null;
}
