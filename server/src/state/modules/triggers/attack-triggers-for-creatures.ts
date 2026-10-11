/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: getAttackTriggersForCreatures (production body; replaces leftover dual-copy)
 * Public: getAttackTriggersForCreatures
 */

import type { GameContext } from "../../context.js";
import { debug } from "../../../utils/debug.js";
import { primeDerivedContinuousEffectsForScan } from "../staticEffectSpec.js";
import { detectAttackTriggers } from "./attack-detection.js";
import { isReflexiveDelayedDoTriggerType } from "./attack-detection-reflexive.js";
import { getAttachmentAttackTriggers } from "./attachment-attack-detection.js";
import {
  isAttackWatcherTriggerType,
  planAttackWatcherQueue,
} from "./attack-watcher-queue.js";
import {
  extractCommanderOwnedGrantedAbilityTexts,
  mergeCombatTriggerValue,
} from "./combat-attack-trigger-helpers.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";
import {
  applyTriggerDoublers,
  detectTriggerDoublers,
} from "./trigger-doublers.js";
import { collectMatchingParsedEventLines } from "./triggerConditionFamilyMatch.js";

// ============================================================================
// Attack Triggers
// ============================================================================


/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const detectGameState = ctx.state
    ? {
        ...ctx.state,
        experienceCounters: (ctx.state as any).experienceCounters ?? (ctx as any).experience,
      }
    : undefined;
  // Spread copy lost the non-enumerable continuous-effects cache; compute once for the scan
  // rather than once per attacker/watcher inside detectAttackTriggers.
  if (detectGameState) primeDerivedContinuousEffectsForScan(detectGameState);
  
  const playerIds = Array.isArray((ctx as any).state?.players)
    ? (ctx as any).state.players.map((player: any) => String(player?.id || '')).filter(Boolean)
    : [];

  const resolveAttackedPlayerId = (attacker: any): string => {
    const attacking = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
    if (attacking && playerIds.includes(attacking)) return attacking;
    if (attacking) {
      const attackedPermanent = battlefield.find((perm: any) => String(perm?.id || '') === attacking);
      const controller = String(attackedPermanent?.controller || '');
      if (controller && playerIds.includes(controller)) return controller;
    }
    return String(defendingPlayer || '');
  };

  const attackedPlayerIds = Array.from(new Set(
    attackingCreatures.map((attacker) => resolveAttackedPlayerId(attacker)).filter(Boolean),
  ));
  if (attackedPlayerIds.length === 0 && defendingPlayer) {
    attackedPlayerIds.push(String(defendingPlayer));
  }

  // Stamp commander identity on attackers for watcher planning (W'Kabi, etc.).
  for (const attacker of attackingCreatures) {
    if (!attacker || attacker.isCommander === true) continue;
    const owner = String(attacker?.owner || attacker?.controller || attackingPlayer || '');
    const zone = (ctx.state as any)?.commandZone?.[owner];
    const commanderIds = Array.isArray(zone?.commanderIds) ? zone.commanderIds : [];
    const commanderNames = Array.isArray(zone?.commanderNames) ? zone.commanderNames.map((n: any) => String(n || '').toLowerCase()) : [];
    const cardId = String(attacker?.card?.id || attacker?.id || '');
    const cardName = String(attacker?.card?.name || '').toLowerCase();
    if ((cardId && commanderIds.includes(cardId)) || (cardName && commanderNames.includes(cardName))) {
      attacker.isCommander = true;
    }
  }

  // Self-attack abilities on the attacking creatures (keywords, "whenever this attacks", Join Forces).
  // Watcher types are queued once below so an attacking source is not double-counted.
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker, detectGameState);
    const defendingPlayerId = resolveAttackedPlayerId(attacker);
    triggers.push(
      ...attackerTriggers
        .filter((trigger) =>
          !isAttackWatcherTriggerType(trigger.triggerType)
          && !isReflexiveDelayedDoTriggerType(trigger.triggerType)
        )
        .map((trigger) => ({
          ...trigger,
          controllerId: String((trigger as any).controllerId || attacker?.controller || attackingPlayer || ''),
          value: mergeCombatTriggerValue((trigger as any).value, {
            defendingPlayerId,
            defendingPlayer: defendingPlayerId,
            attackingCreatureId: attacker.id,
          }),
        }))
    );
  }

  // Watchers on any battlefield permanent: typed/another/any/opponent/alone/modified/curse/exalted/...
  for (const permanent of battlefield) {
    if (!permanent) continue;
    const permTriggers = detectAttackTriggers(permanent.card, permanent, detectGameState);
    for (const trigger of permTriggers) {
      if (!isAttackWatcherTriggerType(trigger.triggerType)) continue;
      const sourceController = String((trigger as any).controllerId || permanent.controller || '');
      const turnNumber = Number((ctx.state as any)?.turnNumber);
      const plan = planAttackWatcherQueue(
        { ...trigger, controllerId: sourceController },
        permanent,
        attackingCreatures,
        attackingPlayer,
        attackedPlayerIds,
        battlefield,
        resolveAttackedPlayerId,
        Number.isFinite(turnNumber) ? turnNumber : undefined,
        ctx.state,
      );
      if (plan.kind === 'skip') continue;
      if (plan.kind === 'per_attacked_player') {
        for (const attackedId of plan.playerIds) {
          triggers.push({
            ...trigger,
            controllerId: sourceController,
            value: mergeCombatTriggerValue((trigger as any).value, {
              defendingPlayerId: attackedId,
              defendingPlayer: attackedId,
              attackingPlayerId: attackingPlayer,
            }),
          });
        }
        continue;
      }
      if (plan.kind === 'once') {
        triggers.push({
          ...trigger,
          controllerId: sourceController,
        });
        continue;
      }
      for (const attacker of plan.attackers) {
        const defendingPlayerId = resolveAttackedPlayerId(attacker);
        triggers.push({
          ...trigger,
          controllerId: sourceController,
          value: mergeCombatTriggerValue((trigger as any).value, {
            defendingPlayerId,
            defendingPlayer: defendingPlayerId,
            attackingCreatureId: attacker.id,
            attackingPlayerId: attackingPlayer,
          }),
        });
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
      triggers.push({
        permanentId: attachTrigger.permanentId,
        cardName: attachTrigger.cardName,
        controllerId: String(attachTrigger.controllerId || ''),
        description: attachTrigger.effect,
        triggerType: 'equipment_attack',
        mandatory: attachTrigger.mandatory,
        value: {
          attachedToId: attachTrigger.attachedToId,
          searchesLibrary: attachTrigger.searchesLibrary,
          searchType: attachTrigger.searchType,
          createsToken: attachTrigger.createsToken,
        },
      });
    }
  }
  
  // Quoted "Commander creatures you own have 'Whenever this creature attacks…'" grants
  // (Backgrounds and any other permanent using that template).
  for (const attacker of attackingCreatures) {
    const attackerOwner = String(attacker?.owner || attackingPlayer);
    const ownerCommandZone = (ctx.state as any).commandZone?.[attackerOwner];
    const ownerCommanderIds = ownerCommandZone?.commanderIds || [];
    const ownerCommanderNames = ownerCommandZone?.commanderNames || [];
    const isOwnedByAttackingPlayer = attackerOwner === attackingPlayer;
    const isCommander =
      attacker?.isCommander === true ||
      ownerCommanderIds.includes(attacker.card?.id) ||
      (attacker.card?.name && ownerCommanderNames.includes(attacker.card.name));

    if (!isOwnedByAttackingPlayer || !isCommander) continue;

    for (const permanent of battlefield) {
      if (!permanent || String(permanent.controller || '') !== attackingPlayer) continue;
      const grantedAbilities = extractCommanderOwnedGrantedAbilityTexts(String(permanent.card?.oracle_text || ''));
      for (const grantedAbility of grantedAbilities) {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Commander',
          controllerId: String(attacker?.controller || attackingPlayer || ''),
          description: grantedAbility,
          triggerType: 'attacks',
          mandatory: !/\byou may\b/i.test(grantedAbility),
          value: {
            grantedBy: permanent.id,
            grantedByName: permanent.card?.name,
            defendingPlayer,
            defendingPlayerId: resolveAttackedPlayerId(attacker),
          },
        });
        debug(2, `[getAttackTriggersForCreatures] ${permanent.card?.name} granted attack trigger to commander ${attacker.card?.name} (defending ${defendingPlayer})`);
      }
    }
  }
  
  const seenParsedAttacks = new Set<string>();
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const attacker of attackingCreatures) {
      const effects = collectMatchingParsedEventLines({
        ctx,
        oracleText: String(permanent.card.oracle_text || ''),
        event: 'attacks',
        subjectPermanent: attacker,
        subjectControllerId: String(attacker?.controller || ''),
        sourcePermanent: permanent,
      });
      for (const line of effects) {
        const effect = line.effect;
        const key = `${String(permanent.id || '')}|${String(attacker?.id || '')}|${effect.toLowerCase()}`;
        if (seenParsedAttacks.has(key)) continue;
        const already = triggers.some((trigger) => (
          String(trigger.permanentId || '') === String(permanent.id || '')
          && String(trigger.effect || trigger.description || '').toLowerCase().includes(effect.toLowerCase().slice(0, 24))
        ));
        if (already) continue;
        seenParsedAttacks.add(key);
        triggers.push({
          permanentId: String(permanent.id || ''),
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          triggerType: 'parsed_attacks',
          description: effect,
          effect,
          mandatory: !/\byou may\b/i.test(effect),
          ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        });
      }
    }
  }

  // ===== Apply trigger doublers (Roaming Throne, Isshin, etc.) =====
  const doublers = detectTriggerDoublers(battlefield, attackingPlayer);
  
  if (doublers.length > 0) {
    debug(2, `[getAttackTriggersForCreatures] Found ${doublers.length} trigger doubler(s)`);
    
    // For each attacking creature, apply doublers to its triggers
    const doubledTriggers: CombatTriggeredAbility[] = [];
    
    for (const trigger of triggers) {
      // Find the source permanent for creature type checks
      const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
      
      // Apply doublers with attack trigger type
      const resultTriggers = applyTriggerDoublers(
        [trigger],
        doublers,
        'attack',
        sourcePerm,
        battlefield,
        { cause: 'attack', gameState: ctx.state },
      );
      doubledTriggers.push(...resultTriggers);
    }
    
    return doubledTriggers;
  }
  
  return triggers;
}
