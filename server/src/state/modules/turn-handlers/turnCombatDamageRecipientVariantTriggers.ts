/**
 * Combat-damage triggers whose recipient is not just "a player":
 * "X deals combat damage, E" (event deals_combat_damage; once per attacker per damage step, so
 * trample onto a player and a creature does not double) and "deals combat damage to a player or
 * planeswalker" lines (orPlaneswalkerRecipient) when the attacker hit only a planeswalker.
 * Origin parent: turnCombatDamageTriggerQueue.ts applyDealCombatDamageTriggerQueue.
 * Public: recordPlaneswalkerCombatDamage, recordCreatureCombatDamageDealer,
 * collectRecipientVariantCombatDamageTriggers.
 *
 * Blockers are covered through the creature-damage dealer ledger (recordCreatureCombatDamageDealer):
 * a blocker that dealt combat damage fires deals_combat_damage and deals_combat_damage_to_creature.
 * Battle recipients are not tracked.
 */

import type { GameContext } from "../../context.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from "../triggers/triggerConditionFamilyMatch.js";
import { uid } from "../../utils.js";

type PwHit = { amount: number; planeswalkerId: string; controllerId: string };
const LEDGER = "_combatDamageToPlaneswalkersThisStep";
const DEALERS = "_creatureCombatDamageDealersThisStep";

/** Called by applyCreatureCombatDamageFromSource for any creature-to-creature combat damage. */
export function recordCreatureCombatDamageDealer(ctx: GameContext, sourceId: string): void {
  if (!sourceId) return;
  const anyCtx = ctx as any;
  const dealers: Record<string, true> = anyCtx[DEALERS] || (anyCtx[DEALERS] = {});
  dealers[sourceId] = true;
}

/** Called by applyCombatDamageToPlaneswalker after damage is dealt. */
export function recordPlaneswalkerCombatDamage(ctx: GameContext, attackerId: string, planeswalker: any, amount: number): void {
  if (!attackerId || !(amount > 0)) return;
  const anyCtx = ctx as any;
  const ledger: Record<string, PwHit> = anyCtx[LEDGER] || (anyCtx[LEDGER] = {});
  const prev = ledger[attackerId];
  ledger[attackerId] = {
    amount: (prev?.amount || 0) + amount,
    planeswalkerId: String(planeswalker?.id || ""),
    controllerId: String(planeswalker?.controller || ""),
  };
}

/** Reads and clears the planeswalker ledger; pushes entries unless skipLive (replay). */
export function collectRecipientVariantCombatDamageTriggers(
  ctx: GameContext,
  battlefield: any[],
  result: { attackersThatDealtDamage?: string[]; attackersThatDealtCreatureDamage?: string[] },
  pending: Array<{ stackItem: any; reason: string }>,
  skipLive: boolean,
): void {
  const anyCtx = ctx as any;
  const ledger: Record<string, PwHit> = anyCtx[LEDGER] || {};
  const dealers: Record<string, true> = anyCtx[DEALERS] || {};
  delete anyCtx[LEDGER];
  delete anyCtx[DEALERS];
  if (skipLive) return;
  const playerHit = new Set((result.attackersThatDealtDamage || []).map(String));
  const attackerCreatureHit = new Set((result.attackersThatDealtCreatureDamage || []).map(String));
  const ids = new Set<string>([...playerHit, ...attackerCreatureHit, ...Object.keys(ledger), ...Object.keys(dealers)]);
  for (const attackerId of ids) {
    const attacker = battlefield.find((p: any) => String(p?.id) === attackerId);
    if (!attacker?.card) continue;
    const sources = [attacker, ...battlefield.filter((p: any) => p?.card && String(p.id) !== attackerId)];
    const pushLine = (source: any, line: { effect: string }, triggerType: string, extra: Record<string, unknown>, reason: string) => {
      if (pending.some((entry) => (
        String(entry.stackItem?.permanentId || "") === String(source.id || "")
        && String(entry.stackItem?.combatDamageSubjectId || attackerId) === attackerId
        && parsedEffectDuplicates(entry.stackItem?.effect || "", line as any)
      ))) return;
      pending.push({
        stackItem: {
          id: uid("trigger"),
          type: "triggered_ability",
          controller: source.controller,
          source: source.id,
          permanentId: source.id,
          sourceName: source.card?.name,
          description: line.effect,
          effect: line.effect,
          triggerType,
          mandatory: !/\byou may\b/i.test(line.effect),
          combatDamageSubjectId: attackerId,
          card: source.card,
          ...extra,
        } as any,
        reason,
      });
    };
    for (const source of sources) {
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(source.card.oracle_text || ""),
        event: "deals_combat_damage",
        subjectPermanent: attacker,
        subjectControllerId: String(attacker.controller || ""),
        sourcePermanent: source,
      })) {
        if (line.condition?.quantity === "one_or_more") continue;
        pushLine(source, line, "deals_combat_damage", {}, "combat damage (any recipient)");
      }
    }
    // Non-attacker creature damage (blockers): the attacker creature pass does not see these.
    if (dealers[attackerId] && !attackerCreatureHit.has(attackerId) && !playerHit.has(attackerId) && !ledger[attackerId]) {
      for (const source of sources) {
        for (const line of collectMatchingParsedEventLines({
          ctx,
          oracleText: String(source.card.oracle_text || ""),
          event: "deals_combat_damage_to_creature",
          subjectPermanent: attacker,
          subjectControllerId: String(attacker.controller || ""),
          sourcePermanent: source,
        })) {
          if (line.condition?.quantity === "one_or_more") continue;
          pushLine(source, line, "deals_combat_damage_to_creature", {}, "blocker combat damage to creature");
        }
      }
    }
    const pw = ledger[attackerId];
    if (!pw || playerHit.has(attackerId)) continue;
    for (const source of sources) {
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(source.card.oracle_text || ""),
        event: "deals_combat_damage_to_player",
        subjectPermanent: attacker,
        subjectControllerId: String(attacker.controller || ""),
        sourcePermanent: source,
      })) {
        if (!line.condition?.orPlaneswalkerRecipient || line.condition?.quantity === "one_or_more") continue;
        pushLine(source, line, "deals_combat_damage", {
          targetPlayer: pw.controllerId,
          damagedPlayerId: pw.controllerId,
          damagedPlaneswalkerId: pw.planeswalkerId,
          damageAmount: pw.amount,
        }, "combat damage to planeswalker");
      }
    }
  }
}
