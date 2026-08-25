// server/src/state/modules/turn-handlers/turnCombatDamageTriggerQueue.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: combat-damage trigger discovery/queue inside
// dealCombatDamage (per-attacker, defender-side, batched).
// Public entry symbols: applyDealCombatDamageTriggerQueue.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { detectCombatDamageTriggers } from "../triggered-abilities.js";
import { isInterveningIfSatisfied } from "../triggers/intervening-if.js";
import { uid } from "../../utils.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import {
  type CombatDamageTriggerQueueEntry,
  pushCombatDamageTriggerQueueEntries,
} from "./turnCombatDamageTriggerPersist.js";
import type { DealCombatDamageResult } from "./turnCombatDamageAttackerLoop.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function shouldUsePersistedCombatDamageTriggersDuringReplay(ctx: GameContext): boolean {
  if (!(ctx as any).isReplaying) return false;
  const nextType = String((ctx as any)._replayNextEventType || '').trim();
  if (nextType === 'pushTriggeredAbility') return true;
  const prev = (ctx as any)._replayPreviousEvent;
  if (!prev || String(prev.type || '') !== 'pushTriggeredAbility') return false;
  const triggerType = String(prev.triggerType || '').trim().toLowerCase();
  return triggerType === 'combat_damage' || triggerType === 'dealt_damage' || triggerType === 'you_are_dealt_damage';
}

/**
 * Queue combat-damage triggers onto the stack from dealCombatDamage.
 * dealCombatDamage remains the dispatcher.
 */
export function applyDealCombatDamageTriggerQueue(
  ctx: GameContext,
  battlefield: any[],
  result: DealCombatDamageResult,
): void {
    const pendingCombatDamageTriggerEntries: CombatDamageTriggerQueueEntry[] = [];

    // Queue per-attacker combat damage triggers onto the stack.
    // This covers triggers like: "Whenever ~ deals combat damage to a player, ..."
    // IMPORTANT: do this before SBA, because SBA may move creatures off the battlefield.
    if (shouldUsePersistedCombatDamageTriggersDuringReplay(ctx)) {
      debug(2, `${ts()} [dealCombatDamage] Replay has persisted combat damage trigger events; skipping live rediscovery`);
    } else try {
      for (const [defendingPlayerId, attackerIds] of Object.entries(result.attackersThatDealtDamage || {})) {
        const ids = (attackerIds instanceof Set)
          ? Array.from(attackerIds)
          : (Array.isArray(attackerIds) ? attackerIds : []);

        for (const attackerId of ids as any[]) {
          const attackerPerm = battlefield.find((p: any) => p?.id === attackerId);
          if (!attackerPerm?.card) continue;

          const triggers = detectCombatDamageTriggers(attackerPerm.card, attackerPerm);
          const perAttackerTriggers = triggers.filter(t =>
            (t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage') && !t.batched
          );

          for (const trigger of perAttackerTriggers) {
            const text = String(trigger.description || trigger.effect || '').trim();
            if (!text) continue;

            // Intervening-if (CR 603.4): if recognized and false at trigger time, it doesn't trigger.
            try {
              const synthetic = trigger.triggerType === 'deals_damage'
                ? `Whenever ~ deals damage to a player, ${text}`
                : `Whenever ~ deals combat damage to a player, ${text}`;
              const ok = isInterveningIfSatisfied(
                ctx as any,
                String(attackerPerm.controller),
                synthetic,
                attackerPerm,
                {
                  defendingPlayerId: String(defendingPlayerId),
                  thatPlayerId: String(defendingPlayerId),
                  referencedPlayerId: String(defendingPlayerId),
                  theirPlayerId: String(defendingPlayerId),
                }
              );
              if (ok === false) {
                debug(2, `${ts()} [dealCombatDamage] Skipping trigger from ${attackerPerm.card?.name || attackerPerm.id} due to intervening-if being false: ${text}`);
                continue;
              }
            } catch {
              // Defensive: if evaluation fails, do not block.
            }

            const damageAmount = Math.max(0, Number(result.attackerDamageToPlayers?.[String(defendingPlayerId)]?.[String(attackerId)] || 0));
            if (damageAmount <= 0) {
              debug(2, `${ts()} [dealCombatDamage] Skipping combat damage trigger from ${attackerPerm.card?.name || attackerPerm.id} because no damage was dealt`);
              continue;
            }
            const stackItem = {
              id: uid('trigger'),
              type: 'triggered_ability',
              controller: attackerPerm.controller,
              source: attackerPerm.id,
              permanentId: attackerPerm.id,
              sourceName: attackerPerm.card?.name || trigger.cardName,
              description: text,
              triggerType: trigger.triggerType,
              mandatory: trigger.mandatory !== false,
              effect: trigger.effect || text,
              targets: [],
              targetPlayer: String(defendingPlayerId),
              defendingPlayer: String(defendingPlayerId),
              damagedPlayerId: String(defendingPlayerId),
              damageAmount,
              damageSourcePermanentIds: [String(attackerPerm.id)],
              effectData: {
                sourcePermanentId: String(attackerPerm.id),
                damagedPlayerId: String(defendingPlayerId),
                damageAmount,
              },
              card: attackerPerm.card,
            } as any;

            pendingCombatDamageTriggerEntries.push({ stackItem, reason: 'per-attacker combat damage' });
          }
        }
      }
    } catch (err) {
      debugWarn(1, `${ts()} [dealCombatDamage] Failed to queue per-attacker combat damage triggers:`, err);
    }

    // Queue defender-side combat damage triggers for permanents controlled by players who were dealt combat damage.
    // This covers text like "When you're dealt combat damage, ..."
    if (shouldUsePersistedCombatDamageTriggersDuringReplay(ctx)) {
      debug(2, `${ts()} [dealCombatDamage] Replay has persisted defender combat damage trigger events; skipping live rediscovery`);
    } else try {
      const state = (ctx as any).state;

      for (const [damagedPlayerId, totalDamage] of Object.entries(result.damageToPlayers || {})) {
        if (Number(totalDamage || 0) <= 0) continue;

        const attackerIds = result.attackersThatDealtDamage?.[damagedPlayerId];
        const damagingIds = attackerIds instanceof Set
          ? Array.from(attackerIds)
          : (Array.isArray(attackerIds) ? attackerIds : []);

        const attackingControllers = new Set<string>();
        for (const attackerId of damagingIds as any[]) {
          const attackerPerm = battlefield.find((p: any) => p?.id === attackerId);
          if (attackerPerm?.controller) {
            attackingControllers.add(String(attackerPerm.controller));
          }
        }

        const attackingPlayerId = attackingControllers.size === 1
          ? Array.from(attackingControllers)[0]
          : String(state.activePlayer || state.turnPlayer || '');

        for (const perm of battlefield) {
          if (String(perm?.controller || '') !== String(damagedPlayerId) || !perm?.card) continue;

          const triggers = detectCombatDamageTriggers(perm.card, perm);
          const oracleText = String(perm.card?.oracle_text || '');
          if (!triggers.some((trigger) => trigger.triggerType === 'you_are_dealt_damage')) {
            const lowerOracleText = oracleText.toLowerCase();
            const youAreDealtDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+damage,?\s*([^.]+)/i);
            const fallbackEffectText = oracleText.split(/,\s*/, 2)[1]?.trim();
            if (
              youAreDealtDamageMatch ||
              lowerOracleText.includes("whenever you're dealt damage") ||
              lowerOracleText.includes("when you're dealt damage") ||
              lowerOracleText.includes('whenever you are dealt damage') ||
              lowerOracleText.includes('when you are dealt damage')
            ) {
              const effectText = youAreDealtDamageMatch?.[1]?.trim() || fallbackEffectText || '';
              if (effectText) {
              triggers.push({
                permanentId: String(perm.id || ''),
                cardName: String(perm.card?.name || 'Unknown'),
                triggerType: 'you_are_dealt_damage',
                description: effectText,
                effect: effectText,
                mandatory: true,
              } as any);
              }
            }
          }
          const defenderTriggers = triggers.filter((trigger) =>
            trigger.triggerType === 'you_are_dealt_combat_damage' ||
            trigger.triggerType === 'you_are_dealt_damage' ||
            trigger.triggerType === 'creatures_deal_combat_damage_to_you_batched'
          );

          for (const trigger of defenderTriggers) {
            const text = String(trigger.description || trigger.effect || '').trim();
            if (!text) continue;

            try {
              const synthetic = trigger.triggerType === 'creatures_deal_combat_damage_to_you_batched'
                ? `Whenever one or more creatures deal combat damage to you, ${text}`
                : trigger.triggerType === 'you_are_dealt_damage'
                  ? `Whenever you're dealt damage, ${text}`
                  : `When you're dealt combat damage, ${text}`;
              const ok = isInterveningIfSatisfied(
                ctx as any,
                String(perm.controller),
                synthetic,
                perm,
                {
                  damagedPlayerId: String(damagedPlayerId),
                  attackingPlayerId,
                  defendingPlayerId: String(damagedPlayerId),
                }
              );
              if (ok === false) {
                debug(2, `${ts()} [dealCombatDamage] Skipping defender trigger from ${perm.card?.name || perm.id} due to intervening-if being false: ${text}`);
                continue;
              }
            } catch {
              // Defensive: if evaluation fails, do not block.
            }

            const damageAmount = Number(totalDamage || 0);
            const stackItem = {
              id: uid('trigger'),
              type: 'triggered_ability',
              controller: perm.controller,
              source: perm.id,
              permanentId: perm.id,
              sourceName: perm.card?.name || trigger.cardName,
              description: text,
              triggerType: trigger.triggerType,
              mandatory: trigger.mandatory !== false,
              effect: trigger.effect || text,
              targets: [],
              targetPlayer: String(damagedPlayerId),
              defendingPlayer: String(damagedPlayerId),
              damagedPlayerId: String(damagedPlayerId),
              attackingPlayerId,
              damageAmount,
              effectData: {
                damagedPlayerId: String(damagedPlayerId),
                attackingPlayerId,
                damageAmount,
              },
              card: perm.card,
            } as any;

            pendingCombatDamageTriggerEntries.push({ stackItem, reason: 'defender combat damage' });
          }
        }
      }
    } catch (err) {
      debugWarn(1, `${ts()} [dealCombatDamage] Failed to queue defender-side combat damage triggers:`, err);
    }

    // Queue batched combat damage triggers onto the stack.
    // These still trigger during damage dealing, but should use the same queued/persisted
    // APNAP path as other combat-damage trigger families instead of executing inline.
    if (shouldUsePersistedCombatDamageTriggersDuringReplay(ctx)) {
      debug(2, `${ts()} [dealCombatDamage] Replay has persisted batched combat damage trigger events; skipping live rediscovery`);
    } else try {
      for (const [defendingPlayerId, attackerIds] of Object.entries(result.attackersThatDealtDamage || {})) {
        const damagingIds = attackerIds instanceof Set
          ? Array.from(attackerIds)
          : (Array.isArray(attackerIds) ? attackerIds : []);
        if (damagingIds.length === 0) continue;

        const damageByController = new Map<string, { attackerIds: string[]; damageAmount: number }>();
        for (const attackerId of damagingIds as any[]) {
          const attackerPerm = battlefield.find((p: any) => p?.id === attackerId);
          const controllerId = String(attackerPerm?.controller || '').trim();
          if (!controllerId) continue;

          const entry = damageByController.get(controllerId) || { attackerIds: [], damageAmount: 0 };
          entry.attackerIds.push(String(attackerId));
          entry.damageAmount += Math.max(0, Number(result.attackerDamageToPlayers?.[String(defendingPlayerId)]?.[String(attackerId)] || 0));
          damageByController.set(controllerId, entry);
        }

        for (const [controllerId, controllerDamage] of damageByController.entries()) {
          if (controllerDamage.attackerIds.length === 0) continue;

          for (const perm of battlefield) {
            if (String(perm?.controller || '') !== String(controllerId) || !perm?.card) continue;

            const triggers = detectCombatDamageTriggers(perm.card, perm);
            const batchedTriggers = triggers.filter((trigger) =>
              trigger.triggerType === 'creatures_deal_combat_damage_batched' && trigger.batched
            );

            for (const trigger of batchedTriggers) {
              const text = String(trigger.description || trigger.effect || '').trim();
              if (!text) continue;

              try {
                const synthetic = `Whenever one or more creatures you control deal combat damage to a player, ${text}`;
                const needsThatPlayerRef = /\bthat player\b/i.test(synthetic);
                const ok = isInterveningIfSatisfied(
                  ctx as any,
                  String(controllerId),
                  synthetic,
                  perm,
                  {
                    defendingPlayerId: String(defendingPlayerId),
                    ...(needsThatPlayerRef
                      ? {
                          thatPlayerId: String(defendingPlayerId),
                          referencedPlayerId: String(defendingPlayerId),
                          theirPlayerId: String(defendingPlayerId),
                        }
                      : {}),
                  }
                );
                if (ok === false) {
                  debug(2, `${ts()} [dealCombatDamage] Skipping batched trigger from ${trigger.cardName} due to intervening-if being false: ${text}`);
                  continue;
                }
              } catch {
                // Defensive: if evaluation fails, do not block.
              }

              const stackItem = {
                id: uid('trigger'),
                type: 'triggered_ability',
                controller: perm.controller,
                source: perm.id,
                permanentId: perm.id,
                sourceName: perm.card?.name || trigger.cardName,
                description: text,
                triggerType: trigger.triggerType,
                mandatory: trigger.mandatory !== false,
                effect: trigger.effect || text,
                targets: [],
                targetPlayer: String(defendingPlayerId),
                defendingPlayer: String(defendingPlayerId),
                damagedPlayerId: String(defendingPlayerId),
                damageAmount: controllerDamage.damageAmount,
                damageSourcePermanentIds: [...controllerDamage.attackerIds],
                effectData: {
                  sourcePermanentId: String(perm.id),
                  damagedPlayerId: String(defendingPlayerId),
                  damageAmount: controllerDamage.damageAmount,
                  damageSourcePermanentIds: [...controllerDamage.attackerIds],
                },
                card: perm.card,
              } as any;

              pendingCombatDamageTriggerEntries.push({ stackItem, reason: 'batched combat damage' });
            }
          }
        }
      }
    } catch (err) {
      debugWarn(1, `${ts()} [dealCombatDamage] Failed to queue batched combat damage triggers:`, err);
    }

    pushCombatDamageTriggerQueueEntries(ctx, pendingCombatDamageTriggerEntries);
}
