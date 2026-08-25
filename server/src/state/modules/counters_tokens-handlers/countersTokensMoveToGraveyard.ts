// server/src/state/modules/counters_tokens-handlers/countersTokensMoveToGraveyard.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: movePermanentToGraveyard.
// Public entry symbols: movePermanentToGraveyard.

import { buildZoneObjectWithRetainedCounters } from "../../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../../context.js";
import { parsePT, uid } from "../../utils.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { recalculatePlayerEffects } from "../game-state-effects.js";
import { getDeathTriggers, processLinkedExileReturns } from "../triggered-abilities.js";
import { isInterveningIfSatisfied } from "../triggers/intervening-if.js";
import { orderTriggersByAPNAP } from "../triggers/ordering.js";
import { processLTBTriggers } from "../triggerEmissionFamilyUtils.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import {
  applyLeaveBattlefieldReplacementLifeGain,
  tryApplyDeclarativeGraveyardDestinationReplacement,
} from "../zone-manipulation.js";
import { repairCardIdAwayFromZones } from "../stackReplayUtils.js";
import { drawCards as drawCardsFromZone } from "../zones.js";
import { pushDeathTriggerOntoStack } from "./countersTokensDeathTriggerStack.js";
import {
  getKeywordDeathTriggersForPermanent,
  mergeDeathTriggers,
} from "./countersTokensDeathTriggerKeywords.js";
import { getCountersTokensHandlerDeps } from "./countersTokensHandlerDeps.js";

function runSBA(ctx: GameContext): void {
  getCountersTokensHandlerDeps().runSBA(ctx);
}

function applyCounterModifications(
  gameState: any,
  targetPermanentId: string,
  deltas: Record<string, number>,
): Record<string, number> {
  return getCountersTokensHandlerDeps().applyCounterModifications(
    gameState,
    targetPermanentId,
    deltas,
  );
}

function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  getCountersTokensHandlerDeps().clearPreparedStateOnBattlefieldExit(state, permanent);
}

/**
 * Move a permanent from battlefield to graveyard.
 * Rule 111.7: Tokens cease to exist when they leave the battlefield - they don't go to graveyard.
 * Rule 700.4: Both tokens and non-tokens "die" and trigger death effects.
 * 
 * @param ctx - Game context
 * @param permanentId - ID of the permanent to move
 * @param triggerDeathEffects - Whether to trigger death effects (for creatures)
 * @returns true if the permanent was moved/removed, false if not found
 */
export function movePermanentToGraveyard(ctx: GameContext, permanentId: string, triggerDeathEffects = true): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const zones = state.zones = state.zones || {};
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = state.battlefield.splice(idx, 1)[0];
  const owner = (perm as any).owner || (perm as any).controller;
  const controller = (perm as any).controller || owner;
  const card = (perm as any).card;
  const zoneCard = ((perm as any).isFaceDown === true && (perm as any).faceUpCard)
    ? (perm as any).faceUpCard
    : card;
  const removedPermanentId = String((perm as any).id || permanentId || '').trim();
  const isToken = (perm as any).isToken === true;
  const isCreature = (card?.type_line || '').toLowerCase().includes('creature');

  clearPreparedStateOnBattlefieldExit(state, perm);

  // Per-turn tracking for morbid/revolt-style conditions
  try {
    (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
    (state as any).permanentLeftBattlefieldThisTurn[String(controller)] = true;
  } catch {
    // best-effort tracking only
  }

  try {
    processLTBTriggers(ctx, perm, { cause: 'graveyard' });
  } catch (err) {
    debugWarn(1, '[movePermanentToGraveyard] processLTBTriggers failed:', err);
  }

  const graveyardReplacement = tryApplyDeclarativeGraveyardDestinationReplacement(
    ctx,
    perm,
    String(owner || ''),
    {
      sourceZone: 'battlefield',
      controller: String(controller || ''),
      objectId: removedPermanentId,
      permanentId: removedPermanentId,
      cause: 'destroy',
    },
  );
  if (graveyardReplacement.handled) {
    applyLeaveBattlefieldReplacementLifeGain(ctx, graveyardReplacement, String(controller || ''));
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[movePermanentToGraveyard] Failed to recalculate player effects after replacement:', err);
    }
    // Tokens still die (CR 700.4) even though they cease to exist. Do not skip
    // death-trigger emission for token-ceases-to-exist replacements.
    if (!graveyardReplacement.ceasesToExist) {
      return true;
    }
  }

  try {
    if (isCreature) {
      (state as any).creatureDiedThisTurn = true;

      (state as any).creaturesDiedThisTurnByController = (state as any).creaturesDiedThisTurnByController || {};
      const key = String(controller);
      (state as any).creaturesDiedThisTurnByController[key] = ((state as any).creaturesDiedThisTurnByController[key] || 0) + 1;

      // Legacy alias map used by some intervening-if death-count templates.
      (state as any).creaturesDiedUnderYourControlThisTurn = (state as any).creaturesDiedUnderYourControlThisTurn || {};
      (state as any).creaturesDiedUnderYourControlThisTurn[key] = ((state as any).creaturesDiedUnderYourControlThisTurn[key] || 0) + 1;

      // Track creature subtype deaths this turn (for templates like "if a Phyrexian died under your control this turn").
      try {
        const typeLineRaw = String(card?.type_line || '');
        const typeLineLower = typeLineRaw.toLowerCase();
        const dashSplit = typeLineLower.split(/—|\s-\s/);
        const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
        const subtypeTokens = subtypePart
          .split(/\s+/)
          .map((t) => t.replace(/[^a-z0-9-]/g, '').trim())
          .filter(Boolean);

        if (subtypeTokens.length) {
          (state as any).creaturesDiedThisTurnByControllerSubtype = (state as any).creaturesDiedThisTurnByControllerSubtype || {};
          const byController = (state as any).creaturesDiedThisTurnByControllerSubtype;
          byController[key] = byController[key] || {};
          for (const st of subtypeTokens) {
            byController[key][st] = (byController[key][st] || 0) + 1;
          }
        }
      } catch {
        // best-effort tracking only
      }
    }
  } catch {
    // best-effort tracking only
  }
  
  // Fire death triggers BEFORE the creature leaves (for both tokens and non-tokens)
  // Rule 700.4: "Dies" means "is put into a graveyard from the battlefield"
  // Tokens still "die" even though they don't end up in the graveyard
  if (triggerDeathEffects) {
    try {
      // Best-effort turn tracking for intervening-if templates.
      try {
        if (isCreature) {
          const stateAny = state as any;
          const id = String((perm as any)?.id || '').trim();
          if (id) {
            stateAny.creaturesDiedThisTurnIds = Array.isArray(stateAny.creaturesDiedThisTurnIds)
              ? stateAny.creaturesDiedThisTurnIds
              : [];
            if (!stateAny.creaturesDiedThisTurnIds.includes(id)) {
              stateAny.creaturesDiedThisTurnIds.push(id);
            }
          }
        }
      } catch {
        // best-effort only
      }

      // Check for self death triggers (Aerith Gainsborough, etc.)
      const cardName = (card?.name || '').toLowerCase();
      const oracleText = (card?.oracle_text || '').toLowerCase();
      
      // Aerith Gainsborough: "When Aerith Gainsborough dies, put X +1/+1 counters on each legendary creature you control"
      if (cardName.includes('aerith gainsborough') || 
          (oracleText.includes('when') && oracleText.includes('dies') && 
           oracleText.includes('put') && oracleText.includes('+1/+1 counter') && 
           oracleText.includes('legendary creature you control'))) {
        const countersOnAerith = (perm as any).counters?.['+1/+1'] || 0;
        if (countersOnAerith > 0) {
          // Apply counters to each legendary creature you control
          const battlefield = state.battlefield || [];
          for (const p of battlefield) {
            if (!p || p.controller !== controller) continue;
            const typeLine = ((p.card as any)?.type_line || '').toLowerCase();
            if (typeLine.includes('legendary') && typeLine.includes('creature')) {
              // Apply counter modifiers (Doubling Season, Vorinclex, etc.)
              const deltas = { '+1/+1': countersOnAerith };
              const modifiedDeltas = applyCounterModifications(state, p.id, deltas);
              
              const current: Record<string, number> = { ...(p.counters ?? {}) };
              for (const [k, v] of Object.entries(modifiedDeltas)) {
                current[k] = (current[k] ?? 0) + v;
                if (current[k] <= 0) delete current[k];
              }
              p.counters = Object.keys(current).length ? current : undefined;
            }
          }
          
          // Run SBA after distributing counters
          runSBA(ctx);
        }
      }
      
      const deathTriggers = mergeDeathTriggers(
        getDeathTriggers(ctx, perm, controller),
        getKeywordDeathTriggersForPermanent(perm, controller),
      );
      if (deathTriggers.length > 0) {
        debug(2, `[movePermanentToGraveyard] Found ${deathTriggers.length} death trigger(s) for ${isToken ? 'token ' : ''}${card?.name || perm.id}`);
        const orderedDeathTriggers = orderTriggersByAPNAP(
          ctx,
          deathTriggers.map((trigger) => ({
            ...trigger,
            controllerId: String(trigger?.source?.controllerId || ''),
          })),
        );
        
        // Push death triggers onto the stack
        state.stack = state.stack || [];
        for (const trigger of orderedDeathTriggers) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          const sourcePerm = trigger?.source?.permanentId === perm.id
            ? perm
            : (state.battlefield || []).find((p: any) => p?.id === trigger?.source?.permanentId);
          const raw = String(trigger.effect || '').trim();
          let textForEval = raw;
          if (textForEval && !/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a creature dies, ${textForEval}`;
          }
          const dyingControllerId = String(controller || '').trim();
          const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
          const ok = isInterveningIfSatisfied(
            ctx as any,
            String(trigger.source.controllerId),
            textForEval,
            sourcePerm,
            dyingControllerId && needsThatPlayerRef
              ? {
                  thatPlayerId: dyingControllerId,
                  referencedPlayerId: dyingControllerId,
                  theirPlayerId: dyingControllerId,
                }
              : undefined
          );
          if (ok === false) continue;

          pushDeathTriggerOntoStack(ctx, trigger, perm);
        }
      }
      
      // Yuna, Grand Summoner: "Whenever another permanent you control is put into a graveyard from the battlefield, 
      // if it had one or more counters on it, you may put that number of +1/+1 counters on target creature."
      // Death's Presence: "Whenever a creature you control dies, put X +1/+1 counters on target creature you control, 
      // where X is the power of the creature that died."
      const battlefield = state.battlefield || [];
      const dyingPermanentCounters: Record<string, number> = (perm as any).counters || {};
      let totalCountersOnDying = 0;
      for (const count of Object.values(dyingPermanentCounters)) {
        if (typeof count === 'number') {
          totalCountersOnDying += count;
        }
      }
      const dyingCreaturePower = isCreature ? (parsePT((perm as any).card?.power) || 0) : 0;
      
      for (const p of battlefield) {
        if (!p || p.controller !== controller) continue;
        const permCardName = ((p.card as any)?.name || '').toLowerCase();
        const permOracleText = ((p.card as any)?.oracle_text || '').toLowerCase();
        
        // Yuna, Grand Summoner trigger
        if ((permCardName.includes('yuna') && permCardName.includes('grand summoner')) ||
            (permOracleText.includes('whenever another permanent you control') && 
             permOracleText.includes('graveyard from the battlefield') &&
             permOracleText.includes('if it had one or more counters'))) {
          if (totalCountersOnDying > 0) {
            // Create a triggered ability that requires target selection
            state.stack = state.stack || [];
            state.stack.push({
              id: uid("trigger"),
              type: 'triggered_ability',
              controller: controller,
              source: p.id,
              sourceName: (p.card as any)?.name || 'Yuna, Grand Summoner',
              description: `Put ${totalCountersOnDying} +1/+1 counter(s) on target creature`,
              triggerType: 'yuna_counter_transfer',
              countersToAdd: totalCountersOnDying,
              requiresTarget: true,
              targetType: 'creature',
              mandatory: false,
            } as any);
          }
        }
        
        // Death's Presence trigger
        if (isCreature && (permCardName.includes("death's presence") ||
            (permOracleText.includes('whenever a creature you control dies') &&
             permOracleText.includes('put x +1/+1 counters') &&
             permOracleText.includes('power of the creature that died')))) {
          if (dyingCreaturePower > 0) {
            // Create a triggered ability that requires target selection
            state.stack = state.stack || [];
            state.stack.push({
              id: uid("trigger"),
              type: 'triggered_ability',
              controller: controller,
              source: p.id,
              sourceName: (p.card as any)?.name || "Death's Presence",
              description: `Put ${dyingCreaturePower} +1/+1 counter(s) on target creature you control`,
              triggerType: 'deaths_presence',
              countersToAdd: dyingCreaturePower,
              requiresTarget: true,
              targetType: 'creature_you_control',
              mandatory: true,
            } as any);
          }
        }
      }
    } catch (err) {
      debugWarn(1, `[movePermanentToGraveyard] Error processing death triggers:`, err);
    }
  }
  
  // Rule 111.7: Tokens cease to exist when in any zone other than battlefield
  if (isToken) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    debug(2, `[movePermanentToGraveyard] Token ${card?.name || perm.id} ceased to exist (left battlefield)`);
    bumpSeq();
    return true; // Token ceased to exist (death triggers already fired above)
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into graveyard from anywhere, its owner may put it into
  // the command zone instead.
  // IMPORTANT: We must defer the zone change until the player chooses!
  const commanderInfo = commandZone?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  // Check if this is a commander - check both the card ID and the permanent's isCommander flag
  const isCommander = (zoneCard?.id && commanderIds.includes(zoneCard.id)) || (perm as any).isCommander === true;
  
  if (isCommander && zoneCard) {
    // During replay we cannot prompt; choose a deterministic default.
    // We default to moving the commander to the command zone (matches AI behavior).
    const isReplaying = Boolean((ctx as any).isReplaying);
    if (isReplaying) {
      try {
        // Ensure command-zone tracking includes this commander.
        if (commandZone && owner) {
          commandZone[owner] = commandZone[owner] || { commanderIds: [], inCommandZone: [] };
          const info: any = commandZone[owner];
          info.inCommandZone = Array.isArray(info.inCommandZone) ? info.inCommandZone : [];
          if (zoneCard.id && !info.inCommandZone.includes(zoneCard.id)) {
            info.inCommandZone.push(zoneCard.id);
          }
        }

        // Place card in the player's command zone zone container.
        if (owner) {
          const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 };
          (ownerZone as any).commandZone = Array.isArray((ownerZone as any).commandZone) ? (ownerZone as any).commandZone : [];
          (ownerZone as any).commandZone.push(buildZoneObjectWithRetainedCounters(zoneCard, perm, 'command'));
          (ownerZone as any).commandZoneCount = (ownerZone as any).commandZone.length;
        }
      } catch {
        // best-effort only
      }

      if (removedPermanentId) {
        processLinkedExileReturns(ctx, removedPermanentId);
      }

      bumpSeq();
      try {
        recalculatePlayerEffects(ctx);
      } catch {
        // ignore
      }
      return true;
    }

    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: perm.id,
      sourceName: zoneCard.name,
      sourceImage: zoneCard.image_uris?.small || zoneCard.image_uris?.normal,
      description: `Your commander ${zoneCard.name} would be put into your graveyard. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it go to graveyard' },
      ],
      commanderId: zoneCard.id,
      commanderName: zoneCard.name,
      fromZone: 'graveyard',
      card: {
        id: zoneCard.id,
        name: zoneCard.name,
        type_line: zoneCard.type_line,
        oracle_text: zoneCard.oracle_text,
        image_uris: zoneCard.image_uris,
        mana_cost: zoneCard.mana_cost,
        power: zoneCard.power,
        toughness: zoneCard.toughness,
        ...(buildZoneObjectWithRetainedCounters(zoneCard, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(zoneCard, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToGraveyard] Commander ${zoneCard.name} would go to graveyard - queued commander zone choice step`);

    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    
    // Remove from battlefield but DON'T add to graveyard yet - wait for player choice
    bumpSeq();
    
    // Recalculate player effects when permanents leave
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[movePermanentToGraveyard] Failed to recalculate player effects:', err);
    }
    
    return true; // Zone change deferred for commander
  }
  
  // Move to owner's graveyard (non-commander cards)
  if (owner) {
    const ownerZone = zones[owner] = zones[owner] || { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, libraryCount: 0 };
    (ownerZone as any).graveyard = (ownerZone as any).graveyard || [];
    if (zoneCard) {
      const graveyardCard = buildZoneObjectWithRetainedCounters(zoneCard, perm, 'graveyard');
      pushCardToPlayerGraveyardWithReplacements(ctx, String(owner), graveyardCard, (ownerZone as any).graveyard, {
        fromBattlefield: true,
        controllerId: String(controller),
      });
      (ownerZone as any).graveyardCount = (ownerZone as any).graveyard.length;
      // Undo/replay can leave a same-id hand ghost after fetch/sacrifice.
      const sacrificedCardId = String(zoneCard.id || graveyardCard?.id || '').trim();
      if (sacrificedCardId) {
        repairCardIdAwayFromZones(ctx, String(owner), sacrificedCardId, [
          'hand',
          'exile',
          'library',
        ]);
      }
    }
  }

  if (
    (perm as any).drawsCardOnBlitzDeath === true
    || (perm as any).blitzCostWasPaid === true
    || (perm as any).card?.drawsCardOnBlitzDeath === true
    || (perm as any).card?.blitzCostWasPaid === true
  ) {
    try {
      drawCardsFromZone(ctx, String(controller || owner || '') as any, 1);
    } catch {
      // best-effort only
    }
  }

  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }
  
  bumpSeq();
  
  // Recalculate player effects when permanents leave
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    debugWarn(1, '[movePermanentToGraveyard] Failed to recalculate player effects:', err);
  }
  
  return true;
}

