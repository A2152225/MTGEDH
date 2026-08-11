import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { EngineEffect } from '../../rules-engine/targeting.js';
import { uid, triggerLifeGainEffects } from '../utils.js';
import { processLifeChange, resolveOpponentDirectedDamage, applyMillReplacements } from './game-state-effects.js';
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from './triggers/damage-received.js';
import { queueBecomesUntappedTriggers } from './triggers/tap-untap.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { drawCards as drawCardsFromZone, movePermanentToHand, processMillTriggers } from './zones.js';
import { createToken, destroyPermanent, movePermanentToExile, updateCounters, runSBA } from './counters_tokens.js';
import { applyCreatureDamageFromSource, resolvePlayerDamage } from './combat-damage-processing.js';
import { addExtraCombat } from './turn.js';
import { applyGoadToCreature } from './goad-effects.js';
import { shouldExileStackCardInsteadOfGraveyard } from './stack-zone-replacements.js';
import { cleanupCardLeavingExile } from './playable-from-exile.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { queueDealsDamageToPlayerTriggersFromPermanent } from './triggerLifeDamageUtils.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { detectEntersWithCounters } from './detectEntersWithCounters.js';
import { processSpellCounteredTriggers } from './spellCounteredTriggerUtils.js';
import { debug, debugWarn } from '../../utils/debug.js';
/**
 * Execute a single spell effect
 */
export function executeSpellEffect(
  ctx: GameContext,
  effect: EngineEffect,
  caster: PlayerID,
  spellName: string,
  sourcePermanentId?: string,
  sourceId?: string,
): void {
  const { state } = ctx;
  
  switch (effect.kind) {
    case 'DestroyPermanent': {
      const battlefield = state.battlefield || [];
      const target = battlefield.find((p: any) => p && p.id === effect.id);
      if (target) {
        const destroyedPermanentId = String((target as any).id || effect.id);
        const destroyedName = String((target as any).card?.name || effect.id);
        destroyPermanent(ctx, destroyedPermanentId, true);
        debug(2, `[resolveSpell] ${spellName} destroyed ${destroyedName}`);
      }
      break;
    }
    case 'MoveToExile': {
      const battlefield = state.battlefield || [];
      const target = battlefield.find((p: any) => p.id === effect.id);
      if (target) {
        movePermanentToExile(ctx, String((target as any).id || effect.id));
        debug(2, `[resolveSpell] ${spellName} exiled ${(target as any).card?.name || effect.id}`);
      }
      break;
    }
    case 'BouncePermanent': {
      const id = String((effect as any).id || '');
      if (!id) break;
      const moved = movePermanentToHand(ctx, id);
      if (moved) {
        debug(2, `[resolveSpell] ${spellName} returned ${id} to its owner's hand`);
      }
      break;
    }
    case 'TapPermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === (effect as any).id);
      if (perm) {
        (perm as any).tapped = true;
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} tapped ${(perm as any).card?.name || (effect as any).id}`);
      }
      break;
    }
    case 'UntapPermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === (effect as any).id);
      if (perm) {
        const wasTapped = Boolean((perm as any).tapped);
        (perm as any).tapped = false;
        if (wasTapped) {
          queueBecomesUntappedTriggers(ctx, perm);
        }
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} untapped ${(perm as any).card?.name || (effect as any).id}`);
      }
      break;
    }
    case 'AddExtraCombat': {
      addExtraCombat(ctx, spellName, Boolean((effect as any).untapAttackers));
      debug(2, `[resolveSpell] ${spellName} added an extra combat phase`);
      break;
    }
    case 'GainLife': {
      const playerId = (effect as any).playerId as PlayerID;
      const amount = Math.max(0, Number((effect as any).amount ?? 0));
      if (!playerId || amount <= 0) break;

      const { finalAmount } = processLifeChange(ctx as any, playerId, amount, true);
      if (finalAmount === 0) break;

      const players = state.players || [];
      const player = players.find((p: any) => p.id === playerId);
      const startingLife = (state as any).startingLife ?? 40;
      (state as any).life = (state as any).life || {};

      const current = (state as any).life[playerId] ?? (player as any)?.life ?? startingLife;
      const next = current + finalAmount;
      (state as any).life[playerId] = next;
      if (player) (player as any).life = next;
      (ctx as any).life = (ctx as any).life || {};
      (ctx as any).life[playerId] = next;

      ctx.bumpSeq();
      if (finalAmount > 0) {
        try { triggerLifeGainEffects((ctx as any).state, playerId, finalAmount); } catch {}
      }
      debug(2, `[resolveSpell] ${spellName} changed life for ${playerId}: ${finalAmount >= 0 ? '+' : ''}${finalAmount}`);
      break;
    }
    case 'LoseLife': {
      const playerId = (effect as any).playerId as PlayerID;
      const amount = Math.max(0, Number((effect as any).amount ?? 0));
      if (!playerId || amount <= 0) break;

      const { finalAmount } = processLifeChange(ctx as any, playerId, amount, false);
      if (finalAmount === 0) break;

      const players = state.players || [];
      const player = players.find((p: any) => p.id === playerId);
      const startingLife = (state as any).startingLife ?? 40;
      (state as any).life = (state as any).life || {};

      const current = (state as any).life[playerId] ?? (player as any)?.life ?? startingLife;
      const next = current - Math.abs(finalAmount);
      (state as any).life[playerId] = next;
      if (player) (player as any).life = next;
      (ctx as any).life = (ctx as any).life || {};
      (ctx as any).life[playerId] = next;

      ctx.bumpSeq();
      debug(2, `[resolveSpell] ${spellName} changed life for ${playerId}: -${Math.abs(finalAmount)}`);
      break;
    }
    case 'FlickerPermanent': {
      const battlefield = state.battlefield || [];
      const target = battlefield.find((p: any) => p.id === effect.id);
      if (target) {
        const targetId = String((target as any).id || effect.id);
        const flickeredCard = (target as any).card;
        const flickeredName = flickeredCard?.name || effect.id;
        const owner = ((target as any).owner || (target as any).controller) as PlayerID;
        const cardId = String(flickeredCard?.id || '').trim();
        const isToken = (target as any).isToken === true;
        const returnAt = normalizeFlickerReturnAt((effect as any).returnDelay || 'immediate');

        movePermanentToExile(ctx, targetId, {
          ...(!isToken && owner && cardId
            ? {
                flickerReturnData: {
                  ownerId: String(owner),
                  cardId,
                  returnAt,
                  sourceName: spellName,
                },
              }
            : {}),
        });

        if (isToken) {
          debug(2, `[resolveSpell] ${spellName} exiled token ${flickeredName} - token ceased to exist`);
          break;
        }

        if (!owner || !cardId) {
          debug(2, `[resolveSpell] ${spellName} exiled ${flickeredName} - return skipped because owner/card id was missing`);
          break;
        }

        const returned = resolveFlickerReturnAfterExile(ctx, owner, cardId, returnAt, spellName);
        if (returnAt === 'immediate') {
          if (returned) {
            debug(2, `[resolveSpell] ${spellName} flickered ${flickeredName} - returned immediately as new permanent ${returned.id}`);
          } else {
            debug(2, `[resolveSpell] ${spellName} exiled ${flickeredName} - immediate return deferred or skipped`);
          }
        } else {
          debug(2, `[resolveSpell] ${spellName} exiled ${flickeredName} - scheduled return at ${returnAt}`);
        }
      }
      break;
    }
    case 'DamagePermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === effect.id);
      if (perm) {
        const dmg = Math.max(0, Number((effect as any).amount ?? 0));

        // Turn-tracking for intervening-if: creatureâ†’creature damage relationships, including non-combat sources.
        // Best-effort: only records when the source is a battlefield creature and the target is a creature permanent.
        if (dmg > 0 && sourcePermanentId) {
          try {
            const srcId = String(sourcePermanentId);
            const tgtId = String((perm as any)?.id ?? (effect as any)?.id ?? '');
            if (tgtId) {
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === srcId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String((perm as any)?.card?.type_line || '').toLowerCase();
              if (sourcePerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                const stateAny = state as any;
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][tgtId] = true;
              }
            }
          } catch {
            // best-effort only
          }
        }

        const sourcePerm = sourcePermanentId
          ? battlefield.find((p: any) => String(p?.id) === String(sourcePermanentId))
          : null;
        const damageResult = sourcePerm
          ? applyCreatureDamageFromSource(ctx, sourcePerm, perm, dmg, 'damageMarked')
          : (() => {
              (perm as any).damage = ((perm as any).damage || 0) + dmg;
              return { prevented: false, appliedAmount: dmg, usedMinusCounters: false };
            })();
        if (damageResult.prevented || damageResult.appliedAmount <= 0) break;

        debug(2, `[resolveSpell] ${spellName} dealt ${damageResult.appliedAmount} damage to ${(perm as any).card?.name || effect.id}`);

        // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
        processDamageReceivedTriggers(ctx, perm, damageResult.appliedAmount, (triggerInfo) => {
          if (dispatchDamageReceivedTrigger(ctx, triggerInfo)) {
            return;
          }

          // Initialize pendingDamageTriggers if needed
          if (!state.pendingDamageTriggers) {
            state.pendingDamageTriggers = {};
          }
          
          // Add the trigger to the pending list for socket layer to process
          state.pendingDamageTriggers[triggerInfo.triggerId] = {
            sourceId: triggerInfo.sourceId,
            sourceName: triggerInfo.sourceName,
            controller: triggerInfo.controller,
            damageAmount: triggerInfo.damageAmount,
            triggerType: 'dealt_damage' as const,
            targetType: triggerInfo.targetType,
            effect: triggerInfo.effect,
            ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
            ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
            ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
          };
          
          debug(2, `[resolveSpell] Queued damage trigger: ${triggerInfo.sourceName} was dealt ${damageResult.appliedAmount} damage`);
        });
        try {
          runSBA(ctx);
        } catch {}
      }
      break;
    }
    case 'DamagePlayer': {
      const players = state.players || [];
      const player = players.find((p: any) => p.id === effect.playerId);
      if (player) {
        const dmg = Math.max(0, Number((effect as any).amount ?? 0));
        const targetPlayerId = String((effect as any).playerId || '');
        if (dmg <= 0 || !targetPlayerId) break;

        let sourceControllerId = String(caster || '');
        let sourceCard: any;
        if (sourcePermanentId) {
          const battlefield = state.battlefield || [];
          const sourcePerm = battlefield.find((p: any) => String(p?.id) === String(sourcePermanentId));
          if (sourcePerm?.controller) {
            sourceControllerId = String(sourcePerm.controller);
          }
          sourceCard = sourcePerm?.card;
        }

        const replacement = resolveOpponentDirectedDamage(ctx, {
          sourceControllerId,
          targetPlayerId,
          damageAmount: dmg,
          sourceCard,
        });
        for (const modifier of replacement.damageModifiers) {
          debug(2, `[resolveSpell] ${modifier}`);
        }
        for (const replacementMsg of replacement.effectsApplied) {
          debug(2, `[resolveSpell] ${replacementMsg}`);
        }
        const actualDmg = replacement.damageDealt;
        const sourcePerm = sourcePermanentId
          ? (state.battlefield || []).find((p: any) => String(p?.id) === String(sourcePermanentId))
          : null;
        const resolved = resolvePlayerDamage(ctx, {
          targetPlayerId,
          amount: actualDmg,
          sourcePermanent: sourcePerm || undefined,
          sourceCard,
        });

        // Track per-turn damage/life loss for intervening-if templates.
        try {
          (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
          (state as any).damageTakenThisTurnByPlayer[targetPlayerId] =
            ((state as any).damageTakenThisTurnByPlayer[targetPlayerId] || 0) + resolved.damageDealt;
        } catch {
          /* best-effort */
        }
        try {
          if (resolved.lifeLost > 0) {
            (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
            (state as any).lifeLostThisTurn[targetPlayerId] =
              ((state as any).lifeLostThisTurn[targetPlayerId] || 0) + resolved.lifeLost;
          }
        } catch {
          /* best-effort */
        }

        // Track that a creature dealt damage to a player this turn (used by intervening-if + Reciprocate-style checks).
        try {
          if (sourcePermanentId && resolved.damageDealt > 0) {
            const srcId = String(sourcePermanentId);
            const battlefield = state.battlefield || [];
            const sourcePerm = battlefield.find((p: any) => String(p?.id) === srcId);
            const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
            if (sourcePerm && sourceTL.includes('creature')) {
              const creatureName = String(sourcePerm?.card?.name || 'Unknown Creature');
              (state as any).creaturesThatDealtDamageToPlayer = (state as any).creaturesThatDealtDamageToPlayer || {};
              const perPlayer = ((state as any).creaturesThatDealtDamageToPlayer[targetPlayerId] =
                (state as any).creaturesThatDealtDamageToPlayer[targetPlayerId] || {});
              perPlayer[srcId] = {
                creatureName,
                totalDamage: (perPlayer[srcId]?.totalDamage || 0) + resolved.damageDealt,
                lastDamageTime: Date.now(),
              };
            }
          }
        } catch {
          // best-effort only
        }

        debug(2, `[resolveSpell] ${spellName} dealt ${resolved.damageDealt} damage to player ${targetPlayerId}`);

        // If we have a battlefield permanent as the source of this effect, queue its damage-to-player triggers.
        try {
          if (sourcePermanentId && resolved.damageDealt > 0) {
            queueDealsDamageToPlayerTriggersFromPermanent(ctx, String(sourcePermanentId), String(targetPlayerId), resolved.damageDealt);
          }
        } catch {
          // Defensive: do not block resolution.
        }
      }
      break;
    }
    case 'DrawCards': {
      try {
        const count = Math.max(0, Number((effect as any).count ?? 0));
        if (count > 0) {
          const drawn = drawCardsFromZone(ctx, (effect as any).playerId as PlayerID, count);
          debug(2, `[resolveSpell] ${spellName} caused ${(effect as any).playerId} to draw ${drawn.length} card(s)`);
        }
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} draw failed:`, err);
      }
      break;
    }
    case 'RequestDiscard': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const player = (state as any).players?.find((entry: any) => entry.id === playerId);
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      const handOptions = hand.map((card: any) => ({
        id: String(card?.id || ''),
        name: String(card?.name || card?.card?.name || 'Card'),
        type_line: card?.type_line || card?.card?.type_line,
        oracle_text: card?.oracle_text || card?.card?.oracle_text,
        imageUrl: card?.image_uris?.normal || card?.imageUrl,
        mana_cost: card?.mana_cost || card?.card?.mana_cost,
        cmc: card?.cmc ?? card?.card?.cmc,
      })).filter((card) => card.id);

      if (handOptions.length <= count) {
        break;
      }

      try {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId,
          description: `${spellName}: Discard ${count} card(s)`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          hand: handOptions,
          discardCount: count,
          minDiscardCount: count,
          maxDiscardCount: count,
          currentHandSize: handOptions.length,
          reason: 'effect',
        } as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId: stepSourceId || String((step as any)?.sourceId || '').trim(),
          queuedResolutionStep: step,
        });
        debug(2, `[resolveSpell] ${spellName} queued discard selection ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue discard failed:`, err);
      }
      break;
    }
    case 'AddCountersPermanent': {
      const permanentId = String((effect as any).id || '').trim();
      const counterType = String((effect as any).counterType || '').trim();
      const amount = Math.max(0, Number((effect as any).amount ?? 0));
      if (permanentId && counterType && amount > 0) {
        updateCounters(ctx, permanentId, { [counterType]: amount });
        debug(2, `[resolveSpell] ${spellName} added ${amount} ${counterType} counter(s) to ${permanentId}`);
      }
      break;
    }
    case 'CreateToken': {
      try {
        const controller = (effect as any).controller as PlayerID;
        const name = String((effect as any).name || 'Token');
        const count = Math.max(0, Number((effect as any).count ?? 0));
        const basePower = (effect as any).basePower;
        const baseToughness = (effect as any).baseToughness;
        const options = (effect as any).options;
        if (controller && count > 0) {
          createToken(ctx, controller, name, count, basePower, baseToughness, options);
          debug(2, `[resolveSpell] ${spellName} created ${count} ${name} token(s) for ${controller}`);
        }
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} createToken failed:`, err);
      }
      break;
    }
    case 'QueueScry': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;
      try {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.SCRY,
          playerId,
          description: `${spellName}: Scry ${count}`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          scryCount: count,
        } as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId: stepSourceId || String((step as any)?.sourceId || '').trim(),
          queuedResolutionStep: step,
        });
        debug(2, `[resolveSpell] ${spellName} queued scry ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue scry failed:`, err);
      }
      break;
    }
    case 'QueueSurveil': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;
      try {
        const library = Array.isArray((ctx as any).libraries?.get?.(playerId))
          ? (ctx as any).libraries.get(playerId)
          : [];
        const actualCount = Math.min(count, library.length);
        if (actualCount <= 0) {
          break;
        }
        const cards = library.slice(0, actualCount).map((card: any) => ({
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          imageUrl: card.image_uris?.normal,
          mana_cost: card.mana_cost,
          cmc: card.cmc,
        }));
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.SURVEIL,
          playerId,
          description: `${spellName}: Surveil ${actualCount}`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          surveilCount: actualCount,
          cards,
        } as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId: stepSourceId || String((step as any)?.sourceId || '').trim(),
          queuedResolutionStep: step,
        });
        debug(2, `[resolveSpell] ${spellName} queued surveil ${actualCount} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue surveil failed:`, err);
      }
      break;
    }
    case 'QueueBlight': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const battlefield = state.battlefield || [];
      const validTargets = battlefield
        .filter((p: any) => p && String(p.controller || '') === String(playerId))
        .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (validTargets.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlight: ${playerId} has no creatures to blight`);
        break;
      }

      try {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          description: `${spellName}: Blight ${count} â€” choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',

          // Consumed by the generic Blight hook in socket/resolution.ts
          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: playerId,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        } as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId: stepSourceId || String((step as any)?.sourceId || '').trim(),
          queuedResolutionStep: step,
        });
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight failed:`, err);
      }
      break;
    }
    case 'QueueBlightEachOpponent': {
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const players = (state as any).players || [];
      const turnOrder: PlayerID[] = players.map((p: any) => p?.id).filter((id: any) => typeof id === 'string') as any;
      const activePlayerId: PlayerID =
        (state as any).turnPlayer ||
        (state as any).activePlayerId ||
        players[(state as any).activePlayerIndex || 0]?.id ||
        caster;

      const battlefield = state.battlefield || [];

      const configs: any[] = [];
      for (const pr of players) {
        if (!pr?.id) continue;
        if (String(pr.id) === String(caster)) continue;
        if ((pr as any).hasLost) continue;

        const validTargets = battlefield
          .filter((p: any) => p && String(p.controller || '') === String(pr.id))
          .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line || 'creature',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length === 0) continue;

        configs.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pr.id,
          description: `${spellName}: Blight ${count} â€” choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          priority: 0,

          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: pr.id,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        });
      }

      if (configs.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlightEachOpponent: no opponents had creatures to blight`);
        break;
      }

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, configs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String((steps[0] as any)?.playerId || (configs[0] as any)?.playerId || '').trim(),
          sourceId: stepSourceId || String((steps[0] as any)?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${configs.length} opponent(s)`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight(each opponent) failed:`, err);
      }

      break;
    }
    case 'QueueBlightEachPlayer': {
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const stepSourceId = String((effect as any).sourceId || sourceId || '').trim() || undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const players = (state as any).players || [];
      const turnOrder: PlayerID[] = players.map((p: any) => p?.id).filter((id: any) => typeof id === 'string') as any;
      const activePlayerId: PlayerID =
        (state as any).turnPlayer ||
        (state as any).activePlayerId ||
        players[(state as any).activePlayerIndex || 0]?.id ||
        caster;

      const battlefield = state.battlefield || [];

      const configs: any[] = [];
      for (const pr of players) {
        if (!pr?.id) continue;
        if ((pr as any).hasLost) continue;

        const validTargets = battlefield
          .filter((p: any) => p && String(p.controller || '') === String(pr.id))
          .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line || 'creature',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length === 0) continue;

        configs.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pr.id,
          description: `${spellName}: Blight ${count} â€” choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceId: stepSourceId,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          priority: 0,

          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: pr.id,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        });
      }

      if (configs.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlightEachPlayer: no players had creatures to blight`);
        break;
      }

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, configs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String((steps[0] as any)?.playerId || (configs[0] as any)?.playerId || '').trim(),
          sourceId: stepSourceId || String((steps[0] as any)?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${configs.length} player(s)`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight(each player) failed:`, err);
      }

      break;
    }
    case 'MillCards': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      if (!playerId || count <= 0) break;

      const { finalCount } = applyMillReplacements(ctx, count, String(caster), String(playerId));
      const millCount = Math.max(0, Number(finalCount ?? count));
      if (millCount <= 0) break;

      const ctxLibraries = (ctx as any).libraries as Map<string, any[]> | undefined;
      let lib: any[] | undefined;
      if (ctxLibraries && typeof ctxLibraries.get === 'function') {
        lib = ctxLibraries.get(playerId);
      }

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
      const milledCards: any[] = [];

      if (lib && Array.isArray(lib)) {
        for (let i = 0; i < millCount && lib.length > 0; i++) {
          const milled = lib.shift();
          if (milled) {
            pushCardToPlayerGraveyardWithReplacements(ctx, String(playerId), milled, z.graveyard);
            milledCards.push({ ...milled, zone: 'graveyard' });
          }
        }
        if (ctxLibraries && typeof ctxLibraries.set === 'function') {
          ctxLibraries.set(playerId, lib);
        }
        z.libraryCount = lib.length;
        z.graveyardCount = z.graveyard.length;
        processMillTriggers(ctx, playerId, milledCards, caster);
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} milled ${millCount} card(s) for ${playerId}`);
      }
      break;
    }
    case 'GoadPermanent': {
      const id = String((effect as any).id || '');
      const goaderId = (effect as any).goaderId as PlayerID;
      if (!id || !goaderId) break;
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === id);
      if (idx < 0) break;
      const currentTurn = Number((state as any).turnNumber ?? 0) || 0;
      const expiryTurn = currentTurn + 1;
      const updated = applyGoadToCreature(battlefield[idx] as any, goaderId, expiryTurn);
      battlefield[idx] = updated as any;
      ctx.bumpSeq();
      debug(2, `[resolveSpell] ${spellName} goaded ${(updated as any).card?.name || id} (by ${goaderId})`);
      break;
    }
    case 'CounterSpell': {
      // Counter a spell on the stack and move it to its replacement destination
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const controller = (countered as any).controller;
        const counteredCardName = (countered as any).card?.name || 'spell';
        
        if ((countered as any).card && controller) {
          const zones = ctx.state.zones = ctx.state.zones || {};
          zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          if ((countered as any).card?.ceaseOnCounter === true) {
            debug(2, `[resolveSpell] Countered copied spell ${counteredCardName} ceased to exist`);
          } else if (shouldExileStackCardInsteadOfGraveyard(countered)) {
            const exile = (zones[controller] as any).exile = (zones[controller] as any).exile || [];
            exile.push({ ...(countered as any).card, zone: 'exile' });
            (zones[controller] as any).exileCount = exile.length;
          } else {
            const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
            gy.push({ ...(countered as any).card, zone: 'graveyard' });
            (zones[controller] as any).graveyardCount = gy.length;
          }
        }

        try {
          processSpellCounteredTriggers(ctx, {
            counteringControllerId: String(caster || ''),
            counteredControllerId: String(controller || ''),
            counteredStackItemId: String((countered as any)?.id || effect.stackItemId || ''),
            counteredCardName: String(counteredCardName),
            counteringSourceName: spellName,
            counteredWasSpell: true,
          });
        } catch (err) {
          debugWarn(1, '[executeSpellEffect] processSpellCounteredTriggers failed:', err);
        }
        
        debug(2, `[resolveSpell] ${spellName} countered ${counteredCardName}`);
      }
      break;
    }
    case 'CounterAbility': {
      // Counter an ability on the stack (activated or triggered)
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const abilityDesc = (countered as any).description || (countered as any).ability?.text || 'ability';
        debug(2, `[resolveSpell] ${spellName} countered ${abilityDesc}`);
        // Abilities don't go anywhere when countered - they just cease to exist
      }
      break;
    }
    case 'Broadcast': {
      debug(2, `[resolveSpell] ${effect.message}`);
      break;
    }
  }
}

type FlickerReturnAt = 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat';

function normalizeFlickerReturnAt(returnDelay: unknown): FlickerReturnAt {
  const normalized = String(returnDelay || '').toLowerCase();
  if (normalized === 'end_of_turn') return 'next_end_step';
  if (normalized === 'end_of_combat') return 'end_of_combat';
  if (normalized === 'owners_next_end_step') return 'owners_next_end_step';
  if (normalized === 'next_end_step') return 'next_end_step';
  return 'immediate';
}

export function scheduleExiledCardReturnToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  returnAt: FlickerReturnAt,
  sourceName: string,
): boolean {
  const normalizedOwnerId = String(ownerId || '').trim() as PlayerID;
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedOwnerId || !normalizedCardId || returnAt === 'immediate') {
    return false;
  }

  const stateAny = (ctx as any).state as any;
  stateAny.pendingFlickerReturns = Array.isArray(stateAny.pendingFlickerReturns)
    ? stateAny.pendingFlickerReturns
    : [];
  stateAny.pendingFlickerReturns.push({
    kind: 'return_from_exile_to_battlefield',
    ownerId: normalizedOwnerId,
    cardId: normalizedCardId,
    returnAt,
    sourceName,
  });
  return true;
}

export function returnExiledCardToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  sourceName = 'Flicker effect',
): any | null {
  const stateAny = (ctx as any).state as any;
  const normalizedOwnerId = String(ownerId || '').trim() as PlayerID;
  const normalizedCardId = String(cardId || '').trim();
  if (!stateAny || !normalizedOwnerId || !normalizedCardId) return null;

  const zones = stateAny.zones || {};
  const ownerZones = zones[normalizedOwnerId];
  const exile = Array.isArray(ownerZones?.exile) ? ownerZones.exile : [];
  const exileIndex = exile.findIndex((card: any) => String(card?.id || '') === normalizedCardId);
  if (exileIndex < 0) return null;

  const card = exile.splice(exileIndex, 1)[0];
  if (typeof ownerZones.exileCount === 'number') {
    ownerZones.exileCount = exile.length;
  }
  cleanupCardLeavingExile(stateAny, card);

  const entersWithCounters = detectEntersWithCounters(card);
  const isPlaneswalker = String(card?.type_line || '').toLowerCase().includes('planeswalker');
  const newPermanent: any = {
    id: uid('perm'),
    card: { ...card, zone: 'battlefield' },
    controller: normalizedOwnerId,
    owner: normalizedOwnerId,
    tapped: false,
    summoning_sickness: String(card?.type_line || '').toLowerCase().includes('creature') || false,
    counters: entersWithCounters && Object.keys(entersWithCounters).length > 0 ? entersWithCounters : {},
    attachedTo: undefined,
  };

  if (isPlaneswalker && card?.loyalty) {
    const loyaltyValue = parseInt(String(card.loyalty), 10);
    if (!Number.isNaN(loyaltyValue)) {
      newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
      newPermanent.loyalty = loyaltyValue;
      newPermanent.baseLoyalty = loyaltyValue;
    }
  }

  stateAny.battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];
  stateAny.battlefield.push(newPermanent);

  debug(2, `[returnExiledCardToBattlefield] ${sourceName}: returned ${card?.name || normalizedCardId} to battlefield as ${newPermanent.id}`);
  triggerETBEffectsForPermanent(ctx, newPermanent, normalizedOwnerId);
  (ctx as any).bumpSeq?.();
  return newPermanent;
}

function isCardInOwnerExile(ctx: GameContext, ownerId: PlayerID, cardId: string): boolean {
  const stateAny = (ctx as any).state as any;
  const exile = stateAny?.zones?.[ownerId]?.exile;
  return Array.isArray(exile) && exile.some((card: any) => String(card?.id || '') === String(cardId || ''));
}

function resolveFlickerReturnAfterExile(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  returnAt: FlickerReturnAt,
  sourceName: string,
): any | null {
  if (returnAt === 'immediate') {
    return returnExiledCardToBattlefield(ctx, ownerId, cardId, sourceName);
  }
  if (!isCardInOwnerExile(ctx, ownerId, cardId)) {
    return null;
  }
  scheduleExiledCardReturnToBattlefield(ctx, ownerId, cardId, returnAt, sourceName);
  return null;
}

