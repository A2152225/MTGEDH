// server/src/state/modules/apply-event-handlers/applyEventStackCoreEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Spell resolution core, stack push/pop, trigger batch resolution and land plays.
// Public entry: applyStackCoreEvents(ctx, e) -> true when it handled the event.
//
// Handles: resolveSpell, pushStack, resolveTopOfStack, resolveAllTriggers, sundialActivated, playLand
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { recordCardPutIntoGraveyardThisTurn } from "../turn-tracking.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import { drawCards, movePermanentToHand } from "../zones";
import { updateCounters, createToken, destroyPermanent, runSBA, movePermanentToExile } from "../counters_tokens";
import { cleanupCardLeavingExile } from "../playable-from-exile";
import { exileEntireStack } from "../stackExileUtils.js";
import { playLand } from "../stackPlayLandUtils.js";
import { pushStack } from "../stackPushUtils.js";
import { resolveTopOfStack } from "../stackResolveTopOfStackUtils.js";
import { getMatchingGraveyardCastingPermission } from "../graveyard-permissions.js";
import { shouldExileStackCardInsteadOfGraveyard } from "../stack-zone-replacements.js";
import { processSpellCounteredTriggers } from "../spellCounteredTriggerUtils.js";
import {
  getDurableLandPlayPermissionForCard,
  getDurableLibraryPermissionForCard,
  getDurablePlayableFromExilePermissionForCard,
} from "../durable-permissions.js";
import { resolveDurablePermissionForCastReplay } from "../castIntent.js";
import { nextTurn } from "../turn";
import {
  normalizeChosenTargetRefs,
  resolveReplayCardForPermissionUse,
  recordReplayDurablePermissionUse,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyRecordedPlayLandReplayState,
  consumeRecordedManaCostFromPool,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { resolveSpell } from "../../../rules-engine/targeting";
import { effectsFromDeletedResolveSpellSpec } from "../applyEventResolveSpellDeletedOpEffects.js";
import { debugWarn } from "../../../utils/debug.js";
import { calculateModifiedDamage, processLifeChange, resolveOpponentDirectedDamage } from "../game-state-effects";
import {
  replayPopTopOfStackDuringEventReplay,
  replayResolveAllTriggersDuringEventReplay,
} from "../replay-prompt-cleanup.js";
import { getOrInitManaPool } from "../../../socket/util.js";
import { applyDamageToPermanentWithCounterEffects } from "../counter-common-effects.js";
import { applyCreatureDamageFromSource, resolvePlayerDamage } from "../combat-damage-processing.js";

export function applyStackCoreEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "resolveSpell": {
        // Execute spell effects based on spec and chosen targets
        const spec = (e as any).spec;
        const chosen = normalizeChosenTargetRefs(ctx.state, spec, (e as any).chosen || []);
        const caster = (e as any).caster as PlayerID;
        
        // P1a: COUNTER_TARGET_* categorize resolve + former special-case path deleted.
        // Countering goes through Oracle IR → executeSpellEffect CounterSpell/CounterAbility
        // (or counterStackItem / applyEvent effect switch when those effects are emitted).
        if (spec && typeof resolveSpell === 'function') {
          try {
            const categorizedEffects = resolveSpell(spec, chosen, ctx.state, caster);
            const effects = categorizedEffects.length > 0
              ? categorizedEffects
              : effectsFromDeletedResolveSpellSpec(spec, chosen, ctx.state, caster);
            // Apply each effect
            for (const eff of effects) {
              switch (eff.kind) {
                case 'DestroyPermanent':
                  destroyPermanent(ctx as any, eff.id);
                  break;
                case 'MoveToExile':
                  movePermanentToExile(ctx as any, eff.id);
                  break;
                case 'BouncePermanent':
                  movePermanentToHand(ctx as any, (eff as any).id);
                  break;
                case 'TapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = true;
                  break;
                }
                case 'UntapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = false;
                  break;
                }
                case 'AddCountersPermanent':
                  updateCounters(ctx as any, (eff as any).id, { [(eff as any).counterType]: (eff as any).amount });
                  // Turn-tracking for intervening-if: "if you put a counter on a creature this turn".
                  // Best-effort: only marks true when the spell's caster is known and the target is a creature.
                  try {
                    const targetPerm = ctx.state.battlefield.find((p: any) => p?.id === (eff as any).id);
                    const tl = String(targetPerm?.card?.type_line || '').toLowerCase();
                    if (caster && tl.includes('creature')) {
                      const stateAny = ctx.state as any;
                      stateAny.putCounterOnCreatureThisTurn = stateAny.putCounterOnCreatureThisTurn || {};
                      stateAny.putCounterOnCreatureThisTurn[String(caster)] = true;
                    }
                  } catch {
                    // best-effort only
                  }
                  break;
                case 'DamagePermanent': {
                  // Apply damage to permanent (may kill it via SBA)
                  const perm = ctx.state.battlefield.find((p: any) => p.id === eff.id);
                  if (perm) {
                    const sourcePermanentId = String((eff as any).sourcePermanentId || (eff as any).sourceId || '');
                    const sourcePerm = sourcePermanentId
                      ? ctx.state.battlefield.find((p: any) => String(p?.id) === sourcePermanentId)
                      : null;
                    if (sourcePerm) {
                      applyCreatureDamageFromSource(ctx as any, sourcePerm, perm, eff.amount, 'damage');
                    } else {
                      const { amount: modified } = calculateModifiedDamage(
                        ctx as any,
                        eff.amount,
                        String(caster || ''),
                        String((perm as any)?.controller || ''),
                        undefined,
                        false,
                        String((perm as any)?.id || '') || undefined,
                      );
                      applyDamageToPermanentWithCounterEffects(perm, modified, 'damage');
                    }
                  }
                  break;
                }
                case 'DamagePlayer': {
                  const playerId = String((eff as any).playerId || '');
                  const dmg = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || dmg <= 0) break;

                  let sourceControllerId = String(caster || '');
                  let sourceCard: any;
                  const sourcePermanentId = String((eff as any).sourcePermanentId || (eff as any).sourceId || '');
                  const sourcePerm = sourcePermanentId
                    ? ctx.state.battlefield.find((p: any) => String(p?.id) === sourcePermanentId)
                    : null;
                  if (sourcePerm?.controller) {
                    sourceControllerId = String(sourcePerm.controller);
                    sourceCard = sourcePerm?.card;
                  }

                  const replacement = resolveOpponentDirectedDamage(ctx as any, {
                    sourceControllerId,
                    targetPlayerId: playerId,
                    damageAmount: dmg,
                    sourceCard,
                  });
                  const actualDmg = replacement.damageDealt;
                  const resolved = resolvePlayerDamage(ctx as any, {
                    targetPlayerId: playerId,
                    amount: actualDmg,
                    sourcePermanent: sourcePerm || undefined,
                    sourceCard,
                    skipAmountReplacements: true,
                  });

                  // Track per-turn damage/life loss for intervening-if templates.
                  try {
                    (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
                    (ctx.state as any).damageTakenThisTurnByPlayer[playerId] =
                      ((ctx.state as any).damageTakenThisTurnByPlayer[playerId] || 0) + resolved.damageDealt;
                  } catch {}
                  try {
                    if (resolved.lifeLost > 0) {
                      (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                      (ctx.state as any).lifeLostThisTurn[playerId] =
                        ((ctx.state as any).lifeLostThisTurn[playerId] || 0) + resolved.lifeLost;
                    }
                  } catch {}

                  // Best-effort attribution: if the effect includes a source battlefield creature.
                  try {
                    if (sourcePermanentId && resolved.damageDealt > 0) {
                      const battlefield = (ctx.state as any).battlefield || [];
                      const attributionSource = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
                      const tl = String(attributionSource?.card?.type_line || '').toLowerCase();
                      if (attributionSource && tl.includes('creature')) {
                        (ctx.state as any).creaturesThatDealtDamageToPlayer = (ctx.state as any).creaturesThatDealtDamageToPlayer || {};
                        const perPlayer = (((ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] =
                          (ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] || {}) as any);
                        perPlayer[sourcePermanentId] = {
                          creatureName: String(attributionSource?.card?.name || sourcePermanentId),
                          totalDamage: (perPlayer[sourcePermanentId]?.totalDamage || 0) + resolved.damageDealt,
                          lastDamageTime: Date.now(),
                        };
                      }
                    }
                  } catch {}
                  break;
                }
                case 'GainLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, true);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current + finalAmount;
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life gained this turn.
                  try {
                    (ctx.state as any).lifeGainedThisTurn = (ctx.state as any).lifeGainedThisTurn || {};
                    (ctx.state as any).lifeGainedThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeGainedThisTurn[String(playerId)] || 0) + finalAmount;
                  } catch {}
                  break;
                }
                case 'LoseLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, false);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current - Math.abs(finalAmount);
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life lost this turn.
                  try {
                    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + Math.abs(finalAmount);
                  } catch {}
                  break;
                }
                case 'DrawCards':
                  if ((eff as any).playerId && (eff as any).count) {
                    try {
                      drawCards(ctx as any, (eff as any).playerId, Number((eff as any).count));
                    } catch {}
                  }
                  break;
                case 'RequestDiscard':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingDiscard = (ctx.state as any).pendingDiscard || {};
                    (ctx.state as any).pendingDiscard[(eff as any).playerId] = {
                      count: Number((eff as any).count),
                      source: (e as any)?.cardId || 'spell',
                      reason: 'spell_effect',
                    };
                  }
                  break;
                case 'CreateToken':
                  try {
                    createToken(
                      ctx as any,
                      (eff as any).controller,
                      (eff as any).name,
                      (eff as any).count,
                      (eff as any).basePower,
                      (eff as any).baseToughness,
                      (eff as any).options
                    );
                  } catch {}
                  break;
                case 'QueueScry':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingScry = (ctx.state as any).pendingScry || {};
                    (ctx.state as any).pendingScry[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'QueueSurveil':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingSurveil = (ctx.state as any).pendingSurveil || {};
                    (ctx.state as any).pendingSurveil[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'MillCards': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const count = Math.max(0, Number((eff as any).count ?? 0));
                  if (!playerId || count <= 0) break;

                  const lib = (ctx as any).libraries?.get?.(playerId);
                  const zones = (ctx.state as any).zones || ((ctx.state as any).zones = {});
                  const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  if (lib && Array.isArray(lib)) {
                    for (let i = 0; i < count && lib.length > 0; i++) {
                      const milled = lib.shift();
                      if (milled) {
                        pushCardToPlayerGraveyardWithReplacements(ctx as any, String(playerId), milled, z.graveyard);
                      }
                    }
                    (ctx as any).libraries?.set?.(playerId, lib);
                    z.libraryCount = lib.length;
                    z.graveyardCount = z.graveyard.length;
                  }
                  break;
                }
                case 'GoadPermanent': {
                  const id = String((eff as any).id || '');
                  const goaderId = (eff as any).goaderId as PlayerID;
                  if (!id || !goaderId) break;
                  const idx = ctx.state.battlefield.findIndex((p: any) => p.id === id);
                  if (idx < 0) break;

                  const perm = ctx.state.battlefield[idx] as any;
                  const existing = perm.goadedBy || [];
                  if (!existing.includes(goaderId)) {
                    perm.goadedBy = [...existing, goaderId];
                  }
                  const currentTurn = Number((ctx.state as any).turnNumber ?? 0) || 0;
                  const expiryTurn = currentTurn + 1;
                  perm.goadedUntil = { ...(perm.goadedUntil || {}), [goaderId]: expiryTurn };
                  break;
                }
                case 'CounterSpell': {
                  // Counter a spell on the stack
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                    // Move the countered spell to its replacement destination
                    const controller = (countered as any).controller as PlayerID;
                    const zones = ctx.state.zones = ctx.state.zones || {};
                    zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                    if ((countered as any).card) {
                      if ((countered as any).card?.ceaseOnCounter === true) {
                        // Copied spells cease to exist instead of changing zones.
                      } else if (shouldExileStackCardInsteadOfGraveyard(countered)) {
                        const exile = (zones[controller] as any).exile = (zones[controller] as any).exile || [];
                        exile.push({ ...(countered as any).card, zone: 'exile' });
                        (zones[controller] as any).exileCount = exile.length;
                      } else {
                        const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                        gy.push({ ...(countered as any).card, zone: 'graveyard' });
                        recordCardPutIntoGraveyardThisTurn(ctx as any, String(controller), (countered as any).card, { fromBattlefield: false });
                        (zones[controller] as any).graveyardCount = gy.length;
                      }
                    }
                    try {
                      processSpellCounteredTriggers(ctx as any, {
                        counteringControllerId: String(caster || ''),
                        counteredControllerId: String(controller || ''),
                        counteredStackItemId: String((countered as any)?.id || eff.stackItemId || ''),
                        counteredCardName: String((countered as any)?.card?.name || 'spell'),
                        counteringSourceName: 'Counter',
                        counteredWasSpell: true,
                      });
                    } catch {
                      // best-effort
                    }
                  }
                  break;
                }
                case 'CounterAbility': {
                  // Counter an ability on the stack (just remove it)
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    ctx.state.stack.splice(stackIdx, 1);
                  }
                  break;
                }
              }
            }
            // Run state-based actions after applying effects
            runSBA(ctx as any);
            ctx.bumpSeq();
          } catch (err) {
            debugWarn(1, '[applyEvent] resolveSpell failed:', err);
          }
        }
        break;
      }

      case "pushStack": {
        pushStack(ctx as any, (e as any).item);
        break;
      }

      case "resolveTopOfStack": {
        // Live resolution re-runs IR/triggers and drifts zones; outcomes are in
        // executeEffect / mutation events. During replay, only pop the resolved item
        // (plus any consecutive Always-No optional triggers drained in the same live call).
        if ((ctx as any).isReplaying) {
          replayPopTopOfStackDuringEventReplay(ctx as any);
        } else {
          resolveTopOfStack(ctx as any);
        }
        break;
      }

      case "resolveAllTriggers": {
        // Live path resolves the whole stack via direct resolveTopOfStack() calls
        // without per-item events, then logs one resolveAllTriggers { count }.
        // Without a replay pop, every historical pushTriggeredAbility (e.g. Aura
        // Shards from the whole game) reappears on the stack after restart.
        if ((ctx as any).isReplaying) {
          replayResolveAllTriggersDuringEventReplay(
            ctx as any,
            Number((e as any).count ?? 0),
          );
        }
        break;
      }

      case "sundialActivated": {
        try {
          const playerId = String((e as any).by || (e as any).playerId || '').trim();
          const paid = String((e as any).paid || '').trim();
          const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
          const sundial = battlefield.find((perm: any) =>
            perm &&
            String(perm.controller || '') === playerId &&
            String(perm.card?.name || '').toLowerCase().includes('sundial of the infinite')
          );

          if (playerId && paid) {
            const pool = getOrInitManaPool(ctx.state as any, playerId as any);
            consumeRecordedManaCostFromPool(pool as any, paid);
          }

          if (sundial) {
            (sundial as any).tapped = Boolean((e as any).tapped);
          }

          exileEntireStack(ctx as any, playerId as any);
          nextTurn(ctx as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sundialActivated): failed', err);
        }
        break;
      }

      case "playLand": {
        // Turn-tracking: persisted events include fromZone (hand/graveyard). Use this as
        // authoritative positive evidence for intervening-if templates.
        try {
          const playerId = String((e as any).playerId);
          const fromZone = String((e as any).fromZone || '').toLowerCase();
          const stateAny = (ctx.state as any) as any;
          if (fromZone === 'graveyard') {
            stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
            stateAny.playedLandFromGraveyardThisTurn[playerId] = true;
          }
        } catch {
          // best-effort only
        }

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const cardData = (e as any).card || (e as any).cardId;
        const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
        const playerId = String((e as any).playerId || '').trim();
        const cardForPermission = resolveReplayCardForPermissionUse(ctx as any, e, fromZone, cardData);
        const battlefieldLengthBefore = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield.length : 0;
        const durablePermissionToRecord = playerId
          ? resolveDurablePermissionForCastReplay(
            ctx.state as any,
            e as any,
            fromZone === 'library'
              ? getDurableLibraryPermissionForCard(ctx.state as any, playerId as any, cardForPermission, 'play')
              : fromZone === 'exile'
                ? getDurablePlayableFromExilePermissionForCard(ctx.state as any, playerId as any, cardForPermission, 'play')
                  || getDurableLandPlayPermissionForCard(ctx.state as any, playerId as any, 'exile', cardForPermission)
                : fromZone === 'graveyard'
                  ? getMatchingGraveyardCastingPermission(ctx.state as any, playerId as any, cardForPermission, 'play')
                    || getDurableLandPlayPermissionForCard(ctx.state as any, playerId as any, 'graveyard', cardForPermission)
                  : undefined,
          )
          : undefined;

        // Defensive replay hardening: if the persisted event indicates the land
        // was played from true exile, ensure any impulse-style tags/permissions
        // are cleaned up even if playLand can't infer the source from current zones.
        try {
          if (fromZone === 'exile') {
            const cardObj = typeof cardData === 'string' ? { id: cardData } : cardData;
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        playLand(ctx as any, (e as any).playerId, cardData);
        try {
          const battlefieldLengthAfter = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield.length : 0;
          if (playerId && battlefieldLengthAfter > battlefieldLengthBefore) {
            recordReplayDurablePermissionUse(ctx.state as any, durablePermissionToRecord);
          }
        } catch {
          // best-effort only
        }
        applyRecordedPlayLandReplayState(ctx, e);
        break;
      }

      default:
        return false;
  }

  return true;
}
