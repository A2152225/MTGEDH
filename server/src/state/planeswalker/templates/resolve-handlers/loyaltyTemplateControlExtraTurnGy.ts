// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateControlExtraTurnGy.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS .. EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD
// Public entry symbols: tryLoyaltyTemplateControlExtraTurnGy
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, parseCountTokenWord, getGameId, modifyLifeLikeStack } from "../utils.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { movePermanentToExile, updateCounters } from "../../../modules/counters_tokens.js";
import { syncPreparedPermanentAfterControlChange } from "../../../modules/prepared.js";
import { getOpponents, permanentHasKeyword, applyDamageToPlayer, discardHandCardsToGraveyard, findCreatureOnBattlefieldById, recordCreatureDealtDamageToPlayerThisTurn } from "./loyaltyTemplateRuntimeHelpers.js";
import { addExtraTurn } from "../../../modules/turn.js";
import { getActualPowerToughness } from "../../../utils.js";
import { drawCards as drawCardsFromZone, movePermanentToHand, movePermanentToLibrary } from "../../../modules/zones.js";

export function tryLoyaltyTemplateControlExtraTurnGy(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^gain control of all creatures target opponent controls\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== targetOpponent) continue;

        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        const previousController = String(perm.controller || '');
        perm.controller = controller;
        syncPreparedPermanentAfterControlChange(ctx.state, perm, previousController);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^exile each nonland permanent your opponents control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller === controller) continue;

        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (typeLine.includes("land")) continue;

        if (perm?.id) toExile.push(String(perm.id));
      }

      for (const id of toExile) {
        movePermanentToExile(ctx, id);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toExile.length} exiled)`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN": {
      const m = text.match(
        /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];

      // Gain control until EOT (reverted in endTemporaryEffects via state.controlChangeEffects)
      const originalController = target.controller;
      if (originalController !== controller) {
        target.controller = controller;
        syncPreparedPermanentAfterControlChange(ctx.state, target, String(originalController || ''));
        stateAny.controlChangeEffects.push({
          permanentId: target.id,
          originalController,
          newController: controller,
          duration: 'eot',
          appliedAt: Date.now(),
        });
      }

      // Untap
      target.tapped = false;

      // Grant haste until EOT (cleanup removes via untilEndOfTurn.grantedAbilitiesToRemove)
      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
        (target as any).grantedAbilities.push('Haste');
      }
      if (!(target as any).untilEndOfTurn || typeof (target as any).untilEndOfTurn !== 'object') {
        (target as any).untilEndOfTurn = {};
      }
      (target as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((target as any).untilEndOfTurn.grantedAbilitiesToRemove)
        ? (target as any).untilEndOfTurn.grantedAbilitiesToRemove
        : [];
      if (!(target as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
        (target as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN_SACRIFICE_IT_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_IF_ITS_MANA_VALUE_IS_3_OR_LESS": {
      const m = text.match(
        /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.\s*sacrifice it at the beginning of the next end step if (?:it has|its) mana value (?:is )?3 or less\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];

      // Gain control until EOT (reverted in endTemporaryEffects via state.controlChangeEffects)
      const originalController = target.controller;
      if (originalController !== controller) {
        target.controller = controller;
        syncPreparedPermanentAfterControlChange(ctx.state, target, String(originalController || ''));
        stateAny.controlChangeEffects.push({
          permanentId: target.id,
          originalController,
          newController: controller,
          duration: 'eot',
          appliedAt: Date.now(),
        });
      }

      // Untap
      target.tapped = false;

      // Grant haste until EOT (cleanup removes via untilEndOfTurn.grantedAbilitiesToRemove)
      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
        (target as any).grantedAbilities.push('Haste');
      }
      if (!(target as any).untilEndOfTurn || typeof (target as any).untilEndOfTurn !== 'object') {
        (target as any).untilEndOfTurn = {};
      }
      (target as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((target as any).untilEndOfTurn.grantedAbilitiesToRemove)
        ? (target as any).untilEndOfTurn.grantedAbilitiesToRemove
        : [];
      if (!(target as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
        (target as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
      }

      // Conditional delayed sacrifice at the beginning of the next end step.
      const mv = Number((target as any)?.card?.cmc ?? 0) || 0;
      if (mv <= 3) {
        const currentTurn = Number(stateAny.turnNumber ?? 0) || 0;
        const currentPhase = String(stateAny.phase ?? '').toLowerCase();
        const currentStepUpper = String(stateAny.step ?? '').toUpperCase();
        const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
        const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

        stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
          ? stateAny.pendingSacrificeAtNextEndStep
          : [];
        stateAny.pendingSacrificeAtNextEndStep.push({
          permanentId: target.id,
          fireAtTurnNumber,
          maxManaValue: 3,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_PLAYER_DISCARDS_A_CARD": {
      const m = text.match(/^each player discards a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no queue)`);
        return true;
      }

      const players = ((ctx as any).state?.players as any[]) || [];
      const zones = (state as any)?.zones || {};
      for (const p of players) {
        const pid = p?.id as PlayerID;
        if (!pid) continue;

        const hand: any[] = zones[pid]?.hand || [];
        if (hand.length <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: pid,
          description: `${sourceName}: Discard 1 card`,
          mandatory: true,
          sourceName: sourceName,
          discardCount: 1,
          hand: hand.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            colors: c.colors,
          })),
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV": {
      const m = text.match(
        /^reveal the top card of your library\.(?:\s*and)?\s*put that card into your hand\.?\s*each opponent loses life equal to its mana value\.?$/i
      );
      if (!m) return false;

      const [card] = drawCardsFromZone(ctx, controller, 1);
      if (!card) return true;

      const mv = Number((card as any)?.cmc ?? 0) || 0;
      if (mv <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -mv);
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mv=${mv})`);
      return true;
    }

    case "DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE": {
      const m = text.match(/^discard all the cards in your hand, then draw that many cards plus one\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const discardN = (z.hand as any[]).length;
      if (discardN > 0) {
        discardHandCardsToGraveyard(ctx, controller, z.hand as any[], z.graveyard);
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      drawCardsFromZone(ctx, controller, discardN + 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (discard ${discardN}, draw ${discardN + 1})`);
      return true;
    }

    case "YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD": {
      const m = text.match(
        /^you may sacrifice another permanent\. if you do, you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lifeGain = parseCountTokenWord(m[1]);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may sacrifice another permanent. If you do, you gain ${lifeGain} life and draw a card.`,
        mandatory: true,
        sourceName,
        sourceId,
        options: [
          { id: 'sac', label: 'Sacrifice a permanent' },
          { id: 'dont', label: "Don't sacrifice" },
        ],
        minSelections: 1,
        maxSelections: 1,
        sacrificeAnotherPermanentForBenefitChoice: true,
        sacrificeAnotherPermanentForBenefitStage: 'ask',
        sacrificeAnotherPermanentForBenefitController: controller,
        sacrificeAnotherPermanentForBenefitSourceName: sourceName,
        sacrificeAnotherPermanentForBenefitSourcePermanentId: sourceId,
        sacrificeAnotherPermanentForBenefitLifeGain: lifeGain,
        sacrificeAnotherPermanentForBenefitDrawCount: 1,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE": {
      const m = text.match(
        /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.\s*put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target creature\.?$/i
      );
      if (!m) return false;

      const lifeGain = parseCountTokenWord(m[1]);
      const counters = parseCountTokenWord(m[2]);

      if (lifeGain > 0) modifyLifeLikeStack(ctx, controller, lifeGain);

      const [targetId] = getTargets(triggerItem);
      if (targetId) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        if (perm && tl.includes('creature')) {
          updateCounters(ctx, targetId, { '+1/+1': counters });
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE": {
      const m = text.match(
        /^exile target creature\. its controller gains (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const gain = parseCountTokenWord(m[1]);
      const controllerId = String((perm as any).controller || '');

      movePermanentToExile(ctx, targetId);
      if (gain > 0 && controllerId) {
        modifyLifeLikeStack(ctx, controllerId as any, gain);
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER": {
      const m = text.match(/^exile target creature\. its controller gains life equal to its power\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const controllerId = String((perm as any).controller || '');
      const power = Math.max(0, getActualPowerToughness(perm, (ctx as any).state).power | 0);

      movePermanentToExile(ctx, targetId);
      if (power > 0 && controllerId) {
        modifyLifeLikeStack(ctx, controllerId as any, power);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power})`);
      return true;
    }

    case "RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return target card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose a card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: gy.map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(
        /^return target creature card(?: with mana value (\d+) or less)? from your graveyard to the battlefield\.(?:\s*[\s\S]+)?$/i
      );
      if (!m) return false;

      const maxMv = m[1] ? parseInt(m[1], 10) : undefined;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      const validTargets = gy
        .filter((c: any) => {
          const tl = String(c?.type_line || '').toLowerCase();
          if (!tl.includes('creature')) return false;
          if (typeof maxMv === 'number') {
            const cmc = typeof c?.cmc === 'number' ? c.cmc : parseFloat(String(c?.cmc || ''));
            if (!Number.isFinite(cmc)) return false;
            if (cmc > maxMv) return false;
          }
          return true;
        })
        .map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        }));

      if (validTargets.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description:
          typeof maxMv === 'number'
            ? `${sourceName}: Choose a creature card (mana value ${maxMv} or less) in your graveyard to return to the battlefield`
            : `${sourceName}: Choose a creature card in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: choices=${validTargets.length})`);
      return true;
    }

    case "RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(/^return target ([a-z][a-z-]*) card from your graveyard to the battlefield\.?$/i);
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      if (gy.length === 0) return true;

      const validTargets = gy
        .filter((c: any) => {
          const tl = String(c?.type_line || '').toLowerCase();
          if (!tl) return false;

          // Avoid returning Auras without an attachment choice.
          if (tl.includes('aura')) return false;

          // Must be a permanent card.
          const isPermanent =
            tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('land');
          if (!isPermanent) return false;

          return tl.includes(subtype);
        })
        .map((c: any) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        }));

      if (validTargets.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose a ${subtype} card in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: subtype=${subtype}, choices=${validTargets.length})`);
      return true;
    }

    case "RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS": {
      const m = text.match(/^return up to two target creatures to their owners'? hands\.?$/i);
      if (!m) return false;

      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, 2);
      if (targetIds.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const targetId of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        if (!perm || !typeLine.includes('creature')) return false;
      }

      for (const targetId of targetIds) {
        movePermanentToHand(ctx, targetId);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targetIds.length})`);
      return true;
    }

    case "PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY": {
      const m = text.match(/^put target creature on top of its owner['’]s library\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      movePermanentToLibrary(ctx as any, targetId, 'top');
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE": {
      const m = text.match(/^take an extra turn after this one\.?$/i);
      if (!m) return false;

      addExtraTurn(ctx as any, controller, sourceName);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE": {
      const m = text.match(/^tap all creatures your opponents control\.?\s*(?:you\s+)?take an extra turn after this one\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let tappedCount = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (!perm.tapped) tappedCount += 1;
        perm.tapped = true;
      }

      addExtraTurn(ctx as any, controller, sourceName);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (tapped ${tappedCount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const dmg = parseCountTokenWord(m[2]);
      if (dmg <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      const sourcePermanentId = String(triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || '');
      const sourceCreature = findCreatureOnBattlefieldById(ctx, sourcePermanentId);

      for (const opp of opponents) {
        if (sourceCreature) recordCreatureDealtDamageToPlayerThisTurn(ctx, sourceCreature, opp, dmg);
        applyDamageToPlayer(ctx, opp, dmg);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${dmg} to each opponent)`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT": {
      const m = text.match(/^creatures you control gain flying and double strike until end of turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
        if (!perm.grantedAbilities.includes('Flying')) perm.grantedAbilities.push('Flying');
        if (!perm.grantedAbilities.includes('Double strike')) perm.grantedAbilities.push('Double strike');

        perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
        }
        if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Double strike')) {
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Double strike');
        }
        affected += 1;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH": {
      const m = text.match(/^until your next turn, up to one target creature gains vigilance and reach\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return true;

      const stateAny = ctx.state as any;
      const grants = ['Vigilance', 'Reach'];

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      for (const g of grants) {
        if (!(target as any).grantedAbilities.includes(g)) (target as any).grantedAbilities.push(g);
      }

      ;(target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      ;(target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: grants,
        sourceName,
        kind: 'keyword_grants',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^up to one target creature (?:can't|cannot) attack or block until your next turn\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return true;

      const stateAny = ctx.state as any;
      const grantText = "This creature can't attack or block (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: 'cant_attack_or_block',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(
        /^target creature without first strike, double strike, or vigilance (?:can't|cannot) attack or block until your next turn\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return false;

      // Must NOT have any of these keywords to be a legal target.
      if (
        permanentHasKeyword(target, 'first strike') ||
        permanentHasKeyword(target, 'double strike') ||
        permanentHasKeyword(target, 'vigilance')
      ) {
        return false;
      }

      const stateAny = ctx.state as any;
      const grantText = "This creature can't attack or block (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants)
        ? (target as any).untilNextTurnGrants
        : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: 'cant_attack_or_block',
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target ([a-z][a-z-]*)\. untap it\. it gains deathtouch until end of turn\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;
      if (subtype && !tl.includes(subtype)) return true;

      updateCounters(ctx, targetId, { '+1/+1': 1 });
      perm.tapped = false;

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes('deathtouch'))) {
        perm.grantedAbilities.push('Deathtouch');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Deathtouch')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Deathtouch');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on target creature\. it becomes an angel in addition to its other types and gains flying\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      updateCounters(ctx, targetId, { '+1/+1': n });

      perm.card = perm.card || {};
      const currentTypeLine = String(perm.card.type_line || '');
      if (!/\bangel\b/i.test(currentTypeLine)) {
        perm.card.type_line = currentTypeLine.length > 0 ? `${currentTypeLine} Angel` : 'Angel';
      }

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.includes('Flying')) perm.grantedAbilities.push('Flying');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD": {
      const m = text.match(/^each opponent loses life equal to the number of creature cards in your graveyard\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const creatureCount = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')).length;
      if (creatureCount <= 0) return true;

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -creatureCount);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${creatureCount})`);
      return true;
    }
    default:
      return undefined;
  }
}
