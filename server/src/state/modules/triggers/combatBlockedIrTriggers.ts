/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: parsed (IR) becomes_blocked / attacks_unblocked emitters
 * Public: mergeParsedBecomesBlockedTriggers, getParsedAttacksUnblockedTriggers, findBlockPartner,
 *   claimAttacksUnblockedEmission, queueParsedAttacksUnblockedTriggersOnce
 *
 * becomes_blocked: every battlefield source (self included) is matched against each blocked
 * attacker. Lines with a blockPartner filter ("becomes blocked by an artifact creature")
 * fire once per matching blocker; other lines fire once per blocked attacker. Legacy
 * self "blocked" oracle entries the IR line duplicates are replaced, so nothing fires twice.
 * attacks_unblocked: attackers of the defending player with no blockers after the declaration.
 */

import type { GameContext } from "../../context.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from "./triggerConditionFamilyMatch.js";
import { appendEvent } from "../../../db/index.js";
import { uid } from "../../utils.js";

function blockerIdsOf(attacker: any): string[] {
  if (Array.isArray(attacker?.blockedBy)) {
    return attacker.blockedBy.map((value: any) => String(value || '').trim()).filter(Boolean);
  }
  return attacker?.blockedBy ? [String(attacker.blockedBy).trim()] : [];
}

/** The attacker a blocking creature is blocking (first entry), from the battlefield. */
export function findBlockPartner(battlefield: any[], blocker: any): any {
  const raw = Array.isArray(blocker?.blocking) ? blocker.blocking[0] : blocker?.blocking;
  const id = String(raw || '').trim();
  return id ? battlefield.find((perm: any) => perm && String(perm.id || '') === id) : undefined;
}

export function mergeParsedBecomesBlockedTriggers(
  ctx: GameContext,
  blockedCreatures: any[],
  defendingPlayer: string,
  triggers: CombatTriggeredAbility[],
): void {
  const battlefield: any[] = (ctx as any).state?.battlefield || [];
  const seen = new Set<string>();
  for (const attacker of blockedCreatures) {
    if (!attacker) continue;
    const blockedByIds = blockerIdsOf(attacker);
    const blockers = blockedByIds
      .map((id) => battlefield.find((perm: any) => perm && String(perm.id || '') === id))
      .filter(Boolean);
    if (blockers.length === 0) continue;
    for (const permanent of battlefield) {
      if (!permanent?.card) continue;
      for (let index = 0; index < blockers.length; index += 1) {
        const partner = blockers[index];
        const lines = collectMatchingParsedEventLines({
          ctx,
          oracleText: String(permanent.card.oracle_text || ''),
          event: 'becomes_blocked',
          subjectPermanent: attacker,
          subjectControllerId: String(attacker?.controller || ''),
          sourcePermanent: permanent,
          blockPartnerPermanent: partner,
        });
        for (const line of lines) {
          const perPartner = Boolean(line.condition?.blockPartner);
          if (!perPartner && index > 0) continue;
          const key = [permanent.id, attacker.id, perPartner ? partner.id : '', line.effect.toLowerCase()].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const sourceId = String(permanent.id || '');
          for (let i = triggers.length - 1; i >= 0; i -= 1) {
            const legacy = triggers[i];
            if (legacy.triggerType !== 'blocked' || String(legacy.permanentId || '') !== sourceId) continue;
            if (parsedEffectDuplicates([legacy.effect, legacy.description], line)) triggers.splice(i, 1);
          }
          triggers.push({
            permanentId: sourceId,
            cardName: String(permanent.card?.name || 'Unknown'),
            controllerId: String(permanent.controller || ''),
            triggerType: 'blocked',
            description: line.effect,
            effect: line.effect,
            mandatory: !/\byou may\b/i.test(line.effect),
            ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
            ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
            value: {
              blockedCreatureId: String(attacker.id || ''),
              blockingCreatureIds: perPartner ? [String(partner.id || '')] : blockedByIds,
              defendingPlayer,
            },
          } as CombatTriggeredAbility);
        }
      }
    }
  }
}

function attackedPlayerOf(attacker: any, battlefield: any[], playerIds: string[]): string {
  const attacking = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
  if (!attacking) return '';
  if (playerIds.includes(attacking)) return attacking;
  const attacked = battlefield.find((perm: any) => String(perm?.id || '') === attacking);
  return String(attacked?.controller || '');
}

/** "Whenever ~ / a creature you control attacks and isn't blocked" after blockers are declared. */
export function getParsedAttacksUnblockedTriggers(
  ctx: GameContext,
  defendingPlayer: string,
): CombatTriggeredAbility[] {
  const state: any = (ctx as any).state || {};
  const battlefield: any[] = state.battlefield || [];
  const playerIds: string[] = (state.players || []).map((p: any) => String(p?.id || '')).filter(Boolean);
  const attackers = battlefield.filter((perm: any) => (
    perm?.attacking
    && blockerIdsOf(perm).length === 0
    && attackedPlayerOf(perm, battlefield, playerIds) === String(defendingPlayer || '')
  ));
  const out: CombatTriggeredAbility[] = [];
  const seen = new Set<string>();
  for (const attacker of attackers) {
    for (const permanent of battlefield) {
      if (!permanent?.card) continue;
      const lines = collectMatchingParsedEventLines({
        ctx,
        oracleText: String(permanent.card.oracle_text || ''),
        event: 'attacks_unblocked',
        subjectPermanent: attacker,
        subjectControllerId: String(attacker?.controller || ''),
        sourcePermanent: permanent,
        thatPlayerId: String(defendingPlayer || ''),
      });
      for (const line of lines) {
        const key = [permanent.id, attacker.id, line.effect.toLowerCase()].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          permanentId: String(permanent.id || ''),
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          triggerType: 'attacks_unblocked',
          description: line.effect,
          effect: line.effect,
          mandatory: !/\byou may\b/i.test(line.effect),
          ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
          value: {
            attackingCreatureId: String(attacker.id || ''),
            defendingPlayer: String(defendingPlayer || ''),
          },
        } as CombatTriggeredAbility);
      }
    }
  }
  return out;
}

/**
 * Once per defender per combat: the declare-blockers handler and every auto-skip path
 * (skipDeclareBlockers, AI declares, "no potential blockers" auto-declare) share this
 * guard so attacks_unblocked lines fire exactly once.
 */
export function claimAttacksUnblockedEmission(state: any, defendingPlayer: string): boolean {
  if (!state) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const attackerIds = battlefield.filter((perm: any) => perm?.attacking).map((perm: any) => String(perm.id || '')).sort().join(',');
  const key = [state.turnNumber ?? state.turn ?? 0, String(defendingPlayer || ''), attackerIds].join('|');
  const claimed: string[] = Array.isArray(state.attacksUnblockedEmittedFor) ? state.attacksUnblockedEmittedFor : [];
  if (claimed.includes(key)) return false;
  state.attacksUnblockedEmittedFor = [...claimed.slice(-15), key];
  return true;
}

/** Push parsed attacks_unblocked triggers for a defender whose declaration was skipped. */
export function queueParsedAttacksUnblockedTriggersOnce(ctx: any, defendingPlayer: string, gameIdOverride?: string): number {
  const state: any = ctx?.state;
  if (!state || ctx?.isReplaying) return 0;
  if (!claimAttacksUnblockedEmission(state, defendingPlayer)) return 0;
  const triggers = getParsedAttacksUnblockedTriggers(ctx, defendingPlayer);
  if (triggers.length === 0) return 0;
  state.stack = Array.isArray(state.stack) ? state.stack : [];
  const gameId = String(gameIdOverride || ctx.gameId || ctx.id || '').trim();
  for (const trigger of triggers as any[]) {
    const triggerId = uid('trigger');
    const source = (state.battlefield || []).find((perm: any) => String(perm?.id || '') === trigger.permanentId);
    state.stack.push({
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: trigger.description,
      effect: trigger.effect,
      ...(source?.card ? { card: { ...source.card } } : null),
      triggerType: 'attacks_unblocked',
      mandatory: trigger.mandatory,
      value: trigger.value,
      effectData: trigger.value,
    });
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(ctx.seq?.value ?? ctx.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: trigger.description,
          triggerType: 'attacks_unblocked',
          effect: trigger.effect,
          mandatory: trigger.mandatory,
          effectData: trigger.value,
        });
      } catch { /* persistence is best-effort, as in stack-put */ }
    }
  }
  return triggers.length;
}
