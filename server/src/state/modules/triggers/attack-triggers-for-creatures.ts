/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: getAttackTriggersForCreatures (production body; replaces leftover dual-copy)
 * Public: getAttackTriggersForCreatures
 */

import type { GameContext } from "../../context.js";
import { getTurnScopedSpellTriggerSources } from "./turnScopedSpellTriggers.js";
import { withCommandZoneTriggerSources } from "../commandZoneAbilitySources.js";
import { noteExactlyTwoAttackers } from "./round67GameTriggers.js";
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
import { collectMatchingParsedEventLines, parsedEffectDuplicates, parsedEventLinesFor } from "./triggerConditionFamilyMatch.js";
import { dropTriggersFromAbilitylessSources } from './triggeredAbilitySuppression.js';
import { isControllerOptionalTriggeredAbilityEffect } from '../trigger-runtime-wiring.js';
import { oracleTextWithGrantedTriggers } from './grantedOracleTriggerScan.js';
import { applyParsedGroupAttackTriggers } from './attack-group-ir.js';

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
  noteExactlyTwoAttackers(ctx, attackingCreatures);
  // Spell-created "whenever a creature attacks this turn" sources (Ondu Rising) watch too.
  const battlefield = withCommandZoneTriggerSources(ctx.state, [
    ...(ctx.state?.battlefield || []),
    ...getTurnScopedSpellTriggerSources(ctx.state),
  ]);
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
        const grantedCompact = grantedAbility.toLowerCase().replace(/\s+/g, ' ').trim();
        for (let index = triggers.length - 1; index >= 0; index -= 1) {
          const existing = triggers[index];
          if (String(existing?.permanentId || '') !== String(attacker.id || '')) continue;
          const existingCompact = String(existing?.effect || existing?.description || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
          if (!existingCompact) continue;
          // The generic "whenever ~ attacks" matcher treats "attacks a player, if …"
          // as the effect. That tail is the same background ability about to be queued.
          const sameAbility = existingCompact === grantedCompact
            || (existingCompact.length >= 24 && grantedCompact.endsWith(existingCompact));
          if (sameAbility) triggers.splice(index, 1);
        }
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
        // "that player" in an intervening-if ("if no opponent has more life than that player") is the attacked player.
        thatPlayerId: resolveAttackedPlayerId(attacker) || undefined,
        // "whenever you attack with two or more creatures" (minOtherAttackers).
        matchContext: {
          attackerCount: attackingCreatures.length,
          attackedPlayerId: resolveAttackedPlayerId(attacker),
          // "attacks you" means the player: a string target must be a player id; no per-creature target means the defending player.
          attackedTargetIsPlayer: typeof attacker?.attacking === 'string' ? playerIds.includes(String(attacker.attacking)) : Boolean(defendingPlayer),
          attackedTargetIsBattle: (() => {
            const target = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
            if (!target || playerIds.includes(target)) return false;
            const perm = battlefield.find((p: any) => String(p?.id || '') === target);
            return /\bbattle\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
          })(),
          attackedTargetIsPlaneswalker: (() => {
            const target = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
            if (!target || playerIds.includes(target)) return false;
            const perm = battlefield.find((p: any) => String(p?.id || '') === target);
            return /\bplaneswalker\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
          })(),
          attackersAtDefender: attackingCreatures.filter((other: any) => String(other?.attacking || '') === String(attacker?.attacking || '')).length,
          monarchPlayerId: String((ctx.state as any)?.monarch || (ctx.state as any)?.monarchPlayerId || ''),
          initiativePlayerId: String((ctx.state as any)?.initiativePlayerId || (ctx.state as any)?.initiative || ''),
          controlledMaxPower: battlefield.filter((p: any) => String(p?.controller || '') === String(permanent.controller || '')).reduce((max: number, p: any) => Math.max(max, Number(p?.power ?? p?.card?.power) || 0), 0),
          playerLives: Array.isArray((ctx.state as any)?.players)
            ? (ctx.state as any).players.map((p: any) => ({ id: String(p?.id || ''), life: Number(p?.life) }))
            : [],
          crewedByPermanentIds: Array.isArray(attacker?.crewedByPermanentIdsThisTurn) ? attacker.crewedByPermanentIdsThisTurn.map(String) : [],
          attackerEquipped: Boolean(
            attacker?.isEquipped === true
            || (Array.isArray(attacker?.attachedEquipment) && attacker.attachedEquipment.length > 0)
            || battlefield.some((p: any) => String(p?.attachedTo || '') === String(attacker?.id || '') && /\bequipment\b/i.test(String(p?.card?.type_line || p?.type_line || '')))
          ),
        },
      });
      for (const line of effects) {
        const effect = line.effect;
        // "one or more ... attack" / "a player attacks (you)" fire once per declaration, not per attacker.
        const batched = (line as any).condition?.quantity === 'one_or_more';
        const key = `${String(permanent.id || '')}|${batched ? '*' : String(attacker?.id || '')}|${effect.toLowerCase()}`;
        if (seenParsedAttacks.has(key)) continue;
        // IR owns matching printed lines; legacy duplicates are retired after this loop.
        // (Do not skip IR when a legacy detector already queued the same effect.)
        seenParsedAttacks.add(key);
        // "you may pay {1}{G}. If you do, transform her." keeps the declare-attackers payment prompt: the cost moves to
        // manaCost/energyCost and the effect is the clause after "If you do" (same shape the legacy detector queued).
        const payCost = !line.delayed && (line.reflexive as any)?.actor === 'you' && !(line.reflexive as any)?.delayed
          ? /^you may pay ((?:\{[^}]+\})+)\.?$/i.exec(effect.trim())?.[1]?.toUpperCase()
          : undefined;
        const payment = payCost
          ? {
            ...((payCost.match(/\{E\}/g) || []).length > 0 ? { energyCost: (payCost.match(/\{E\}/g) || []).length } : { manaCost: payCost }),
          }
          : undefined;
        triggers.push({
          permanentId: String(permanent.id || ''),
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          triggerType: 'parsed_attacks',
          description: payment ? `${effect.replace(/[.\s]+$/, '').replace(/\{[^}]+\}/g, (s) => s.toUpperCase())}. If you do, ${line.reflexive!.effect}` : effect,
          effect: payment ? String(line.reflexive!.effect) : effect,
          // "it" / "that creature" in the effect resolves against the attacker (not for batched lines).
          ...(batched ? {} : { value: { attackingCreatureId: String(attacker?.id || '') } }),
          mandatory: payment ? false : !isControllerOptionalTriggeredAbilityEffect(effect),
          ...(payment || {}),
          ...(line.reflexive && !payment ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        } as any);
      }
    }
  }

  // IR owns printed attacks lines even when this event does not match (most life, monarch).
  // Retire leftover detectors that would otherwise fire the qualifier as the effect.
  {
    const irBySource = new Map<string, Array<{ effect: string }>>();
    for (const permanent of battlefield) {
      if (!permanent?.card) continue;
      // Granted quoted lines (Backgrounds, Kosei) are IR-owned on the recipient too, so their legacy grant entries retire.
      const lines = parsedEventLinesFor(
        oracleTextWithGrantedTriggers(String(permanent.card.oracle_text || ''), permanent, ctx.state),
        ['attacks'],
        String(permanent.card.name || '') || undefined,
      ).filter((line) => !line.condition?.legacyRuntimeOnly && !line.condition?.delayedRider && !line.condition?.thisWay);
      if (lines.length > 0) irBySource.set(String(permanent.id || ''), lines);
    }
    if (irBySource.size > 0) {
      const kept = triggers.filter((trigger) => {
        if (String(trigger?.triggerType || '') === 'parsed_attacks') return true;
        const lines = irBySource.get(String(trigger.permanentId || ''));
        if (!lines || lines.length === 0) return true;
        return !lines.some((line) => parsedEffectDuplicates([trigger.effect, trigger.description], line));
      });
      triggers.splice(0, triggers.length, ...kept);
    }
  }

  // Attacks alone / battalion: IR owns printed lines and retires their legacy duplicates.
  applyParsedGroupAttackTriggers(ctx, triggers, attackingCreatures, resolveAttackedPlayerId);

  triggers.splice(0, triggers.length, ...dropTriggersFromAbilitylessSources(triggers, ctx.state, (t) => String(t.permanentId || ''), { event: 'attack' }));
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
