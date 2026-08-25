// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateLifeManaDamageDestroy.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1 .. YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL
// Public entry symbols: tryLoyaltyTemplateLifeManaDamageDestroy
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getTargets, getBattlefield, parseCountTokenWord, modifyLifeLikeStack, getGameId, getPlaneswalkerX } from "../utils.js";
import { getOrInitManaPool, getPlayerById, applyDamageToPermanent, applyDamageToPlayer, addUnrestrictedManaSymbols, predefinedArtifactTokens, recordCreatureDamagedByCreatureThisTurn } from "./loyaltyTemplateRuntimeHelpers.js";
import { destroyPermanent, movePermanentToExile, createToken, updateCounters } from "../../../modules/counters_tokens.js";
import { getActualPowerToughness } from "../../../utils.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateLifeManaDamageDestroy(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1": {
      const m = text.match(/^target player's life total becomes 1\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const startingLife = (state as any)?.startingLife || 40;
      (state as any).life = (state as any).life || {};
      const currentLife = (state as any).life[targetId] ?? player.life ?? startingLife;
      const delta = 1 - Number(currentLife || 0);
      modifyLifeLikeStack(ctx, targetId as any, delta);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId})`);
      return true;
    }

    case "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N": {
      const m = text.match(
        /^target (player's|opponent's) life total becomes (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\.?$/i
      );
      if (!m) return false;

      const isOpponent = String(m[1] || '').toLowerCase().includes('opponent');
      const targetLife = parseCountTokenWord(m[2]);
      if (targetLife <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      if (isOpponent && targetId === controller) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const startingLife = (state as any)?.startingLife || 40;
      (state as any).life = (state as any).life || {};
      const currentLife = (state as any).life[targetId] ?? player.life ?? startingLife;
      const delta = targetLife - Number(currentLife || 0);
      modifyLifeLikeStack(ctx, targetId as any, delta);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, life=${targetLife})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (n <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      drawCardsFromZone(ctx, targetId as any, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${n})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      const loseN = parseCountTokenWord(m[2]);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      if (drawN > 0) drawCardsFromZone(ctx, targetId as any, drawN);
      if (loseN > 0) modifyLifeLikeStack(ctx, targetId as any, -loseN);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN}, lose ${loseN})`);
      return true;
    }

    case "TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS": {
      const m = text.match(
        /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?, then discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      const discardM = parseCountTokenWord(m[2]);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      if (drawN > 0) {
        drawCardsFromZone(ctx, targetId as any, drawN);
      }

      if (discardM <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN})`);
        return true;
      }

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[targetId]?.hand || [];
      const actualDiscard = Math.max(0, Math.min(discardM, hand.length));
      if (actualDiscard <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, no discard)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetId as any,
        description: `${sourceName}: Discard ${actualDiscard} card${actualDiscard === 1 ? '' : 's'}`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: actualDiscard,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId}, draw ${drawN}, queued discard ${actualDiscard})`);
      return true;
    }

    case "ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS": {
      const m = text.match(
        /^any number of target players each draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (n <= 0) return true;

      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      for (const targetId of targets) {
        const player = getPlayerById(ctx, targetId as any);
        if (!player) continue;
        drawCardsFromZone(ctx, targetId as any, n);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (targets=${targets.length}, draw ${n})`);
      return true;
    }

    case "ADD_MANA_SYMBOLS": {
      const m = text.match(/^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.?$/i);
      if (!m) return false;
      addUnrestrictedManaSymbols(state, controller, m[1]);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${m[1]})`);
      return true;
    }

    case "ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(/^add (\{[WUBRGC]\}) for each planeswalker you control\.?$/i);
      if (!m) return false;

      const symbol = String(m[1] || "").toUpperCase();
      const battlefield = getBattlefield(ctx);

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("planeswalker")) count++;
      }

      if (count > 0) {
        switch (symbol) {
          case "{W}":
            getOrInitManaPool(state, controller).white += count;
            break;
          case "{U}":
            getOrInitManaPool(state, controller).blue += count;
            break;
          case "{B}":
            getOrInitManaPool(state, controller).black += count;
            break;
          case "{R}":
            getOrInitManaPool(state, controller).red += count;
            break;
          case "{G}":
            getOrInitManaPool(state, controller).green += count;
            break;
          case "{C}":
            getOrInitManaPool(state, controller).colorless += count;
            break;
          default:
            return false;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbol} x${count})`);
      return true;
    }

    case "ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL": {
      const m = text.match(/^add (\{[WUBRGC]\}) for each (plains|island|swamp|mountain|forest) you control\.?$/i);
      if (!m) return false;

      const symbol = String(m[1] || '').toUpperCase();
      const landType = String(m[2] || '').toLowerCase();
      const battlefield = getBattlefield(ctx);

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || '') !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || '').toLowerCase();
        if (!typeLineLower.includes('land')) continue;
        if (typeLineLower.includes(landType)) count++;
      }

      if (count > 0) {
        switch (symbol) {
          case '{W}':
            getOrInitManaPool(state, controller).white += count;
            break;
          case '{U}':
            getOrInitManaPool(state, controller).blue += count;
            break;
          case '{B}':
            getOrInitManaPool(state, controller).black += count;
            break;
          case '{R}':
            getOrInitManaPool(state, controller).red += count;
            break;
          case '{G}':
            getOrInitManaPool(state, controller).green += count;
            break;
          case '{C}':
            getOrInitManaPool(state, controller).colorless += count;
            break;
          default:
            return false;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbol} x${count} for ${landType})`);
      return true;
    }

    case "ADD_TWO_MANA_ANY_COMBINATION": {
      const m = text.match(/^add two mana in any combination of colors\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const colorOptions = [
        { id: "white", label: "White" },
        { id: "blue", label: "Blue" },
        { id: "black", label: "Black" },
        { id: "red", label: "Red" },
        { id: "green", label: "Green" },
      ];

      // Reuse the existing two-step chooser flow, but mark it as unrestricted.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a color for the first mana`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        chooseManaColorsChoice: true,
        chooseManaColorsController: controller,
        chooseManaColorsSourceName: sourceName,
        chooseManaColorsSourceId: sourceId,
        chooseManaColorsRestriction: "unrestricted",
        chooseManaColorsSelectionsTotal: 2,
        chooseManaColorsAmountPerSelection: 1,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "ADD_TEN_MANA_ANY_ONE_COLOR": {
      const m = text.match(/^add ten mana of any one color\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const colorOptions = [
        { id: "white", label: "White" },
        { id: "blue", label: "Blue" },
        { id: "black", label: "Black" },
        { id: "red", label: "Red" },
        { id: "green", label: "Green" },
      ];

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a color to add ten mana`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        chooseManaColorsChoice: true,
        chooseManaColorsController: controller,
        chooseManaColorsSourceName: sourceName,
        chooseManaColorsSourceId: sourceId,
        chooseManaColorsRestriction: "unrestricted",
        chooseManaColorsSelectionsTotal: 1,
        chooseManaColorsAmountPerSelection: 10,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DEALS_DAMAGE_TO_TARGET_CREATURE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to target creature\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10) || 0;
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to target creature and (\d+) damage to that creature's controller\.?$/i
      );
      if (!m) return false;

      const dmgToCreature = parseInt(m[2], 10);
      const dmgToController = parseInt(m[3], 10);
      if (!Number.isFinite(dmgToCreature) || !Number.isFinite(dmgToController)) return false;

      const [targetCreatureId] = getTargets(triggerItem);
      if (!targetCreatureId) return false;

      const battlefield = getBattlefield(ctx);
      const creature = battlefield.find((p: any) => p?.id === targetCreatureId);
      if (!creature) return false;

      applyDamageToPermanent(ctx, targetCreatureId, dmgToCreature);

      const creatureController = (creature as any)?.controller as PlayerID | undefined;
      if (creatureController) {
        applyDamageToPlayer(ctx, creatureController, dmgToController);
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${dmgToCreature} to creature, ${dmgToController} to controller)`
      );
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to target player and each creature that player controls\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const targetPlayer = getPlayerById(ctx, targetPlayerId as any);
      if (!targetPlayer) return false;

      applyDamageToPlayer(ctx, targetPlayerId as any, amount);

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.id) continue;
        if (String((perm as any).controller || '') !== String(targetPlayerId)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || '').toLowerCase();
        if (!typeLineLower.includes('creature')) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals x damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const maxTargets = parseCountTokenWord(m[2]);
      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, Math.max(0, maxTargets | 0));
      if (!targetIds.length) return false;

      for (const targetId of targetIds) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, x);
        } else {
          applyDamageToPermanent(ctx, targetId, x);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to ${targetIds.length})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS": {
      const m = text.match(
        /^([a-z0-9 ,'-]+) deals (\d+) damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const maxTargets = parseCountTokenWord(m[3]);
      const targetIds = getTargets(triggerItem).filter(Boolean).slice(0, Math.max(0, maxTargets | 0));
      if (!targetIds.length) return false;

      for (const targetId of targetIds) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, amount);
        } else {
          applyDamageToPermanent(ctx, targetId, amount);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to ${targetIds.length})`);
      return true;
    }

    case "YOU_DEAL_X_DAMAGE_TO_ANY_TARGET": {
      const m = text.match(/^you deal x damage to any target\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, x);
        (ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to player)`);
        return true;
      }

      applyDamageToPermanent(ctx, targetId, x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x} to permanent)`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^target creature you control deals damage equal to its power to target creature or planeswalker\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem);
      const [sourceCreatureId, targetPermanentId] = targets;
      if (!sourceCreatureId || !targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);

      const sourcePerm = battlefield.find((p: any) => p?.id === sourceCreatureId);
      if (!sourcePerm) return false;
      if (String((sourcePerm as any).controller || "") !== String(controller)) return false;
      const sourceTypeLineLower = String((sourcePerm as any)?.card?.type_line || "").toLowerCase();
      if (!sourceTypeLineLower.includes("creature")) return false;

      const targetPerm = battlefield.find((p: any) => p?.id === targetPermanentId);
      if (!targetPerm) return false;
      const targetTypeLineLower = String((targetPerm as any)?.card?.type_line || "").toLowerCase();
      if (!targetTypeLineLower.includes("creature") && !targetTypeLineLower.includes("planeswalker")) return false;

      const pt = getActualPowerToughness(sourcePerm, (ctx as any).state);
      const power = Math.max(0, (pt as any).power | 0);
      if (power <= 0) {
        (ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power})`);
        return true;
      }

      if (targetTypeLineLower.includes("creature")) {
        recordCreatureDamagedByCreatureThisTurn(ctx, String(sourceCreatureId), String(targetPermanentId), power);
      }
      applyDamageToPermanent(ctx, targetPermanentId, power);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power})`);
      return true;
    }

    case "EXILE_TARGET_CREATURE": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS": {
      const m = text.match(
        /^exile target creature you control\. for each other player, exile up to one target creature that player controls\.?$/i
      );
      if (!m) return false;

      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      for (const targetId of targets) {
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || '').toLowerCase();
        if (!perm || !typeLine.includes('creature')) continue;
        movePermanentToExile(ctx, targetId);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (targets=${targets.length})`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER": {
      const m = text.match(/^exile target creature with power (\d+) or greater\.?$/i);
      if (!m) return false;

      const threshold = parseInt(m[1], 10) || 0;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      const power = getActualPowerToughness(perm, (ctx as any).state).power | 0;
      if (power < threshold) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power}, threshold=${threshold})`);
      return true;
    }

    case "EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE": {
      const m = text.match(/^exile target enchantment, tapped artifact, or tapped creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      const isEnchantment = typeLine.includes('enchantment');
      const isTappedArtifact = !!(perm as any).tapped && typeLine.includes('artifact');
      const isTappedCreature = !!(perm as any).tapped && typeLine.includes('creature');

      if (!isEnchantment && !isTappedArtifact && !isTappedCreature) return false;

      movePermanentToExile(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || (!typeLine.includes("artifact") && !typeLine.includes("enchantment"))) return false;

      destroyPermanent(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN": {
      const m = text.match(
        /^destroy target artifact, creature, or enchantment\.\s*create a treasure token\.?(?:\s*\([^)]*\))*\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || (!typeLine.includes('artifact') && !typeLine.includes('creature') && !typeLine.includes('enchantment'))) return false;

      destroyPermanent(ctx, targetId, true);

      const spec = (predefinedArtifactTokens as any).treasure;
      if (spec) {
        createToken(ctx, controller, spec.name, 1, undefined, undefined, {
          colors: spec.colors,
          typeLine: spec.typeLine,
          abilities: spec.abilities,
          isArtifact: true,
        });
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_DRAW_A_CARD": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      destroyPermanent(ctx, targetId, true);
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS": {
      const m = text.match(
        /^destroy target creature\.\s*put loyalty counters on [a-z0-9 ,'-]+ equal to that creature's toughness\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const targetPerm = battlefield.find((p: any) => p?.id === targetId);
      const targetTypeLine = String(targetPerm?.card?.type_line || "").toLowerCase();
      if (!targetPerm || !targetTypeLine.includes("creature")) return false;

      const toughness = Math.max(0, (getActualPowerToughness(targetPerm, (ctx as any).state) as any).toughness | 0);

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;
      const sourceTypeLine = String(sourcePerm?.card?.type_line || "").toLowerCase();
      if (!sourceTypeLine.includes('planeswalker')) return false;

      destroyPermanent(ctx, targetId, true);

      if (toughness > 0) {
        updateCounters(ctx, String(sourcePerm.id), { loyalty: toughness });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${toughness})`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT": {
      const m = text.match(/^destroy target creature with a -1\/\-1 counter on it\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const counters = (perm as any).counters || {};
      const hasMinusCounter = (counters['-1/-1'] || counters['minus1minus1'] || counters['m1m1'] || 0) > 0;
      if (!hasMinusCounter) return false;

      destroyPermanent(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS": {
      const m = text.match(/^destroy target creature\.\s*you gain life equal to its toughness\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const toughness = Math.max(0, (getActualPowerToughness(perm, (ctx as any).state) as any).toughness | 0);
      destroyPermanent(ctx, targetId, true);
      if (toughness > 0) modifyLifeLikeStack(ctx, controller, toughness);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${toughness})`);
      return true;
    }

    case "DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING": {
      const m = text.match(/^destroy target artifact, enchantment, or creature with flying\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const typeLine = String(perm?.card?.type_line || '').toLowerCase();
      const isArtifact = typeLine.includes('artifact');
      const isEnchantment = typeLine.includes('enchantment');
      const isCreature = typeLine.includes('creature');

      let hasFlying = false;
      if (isCreature) {
        const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
        const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        hasFlying = oracleTextLower.includes('flying') || granted.some((a: any) => String(a).toLowerCase().includes('flying'));
      }

      if (!isArtifact && !isEnchantment && !(isCreature && hasFlying)) return false;

      destroyPermanent(ctx, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE": {
      const m = text.match(/^destroy target creature\.\s*its controller loses 2 life\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes('creature')) return false;

      const destroyedController = String((perm as any).controller || "");

      destroyPermanent(ctx, targetId, true);
      if (destroyedController) {
        modifyLifeLikeStack(ctx, destroyedController as any, -2);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS": {
      const m = text.match(
        /^destroy target creature\. its controller draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      const drawCount = parseCountTokenWord(m[1]);
      const destroyedController = String((perm as any).controller || "");

      destroyPermanent(ctx, targetId, true);
      if (drawCount > 0 && destroyedController) {
        drawCardsFromZone(ctx, destroyedController as any, drawCount);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${drawCount})`);
      return true;
    }

    case "YOU_GAIN_LIFE_AND_DRAW_A_CARD": {
      const m = text.match(/^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i);
      if (!m) return false;
      const n = parseCountTokenWord(m[1]);
      modifyLifeLikeStack(ctx, controller, n);
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS": {
      const m = text.match(
        /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life and draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;
      const lifeGain = parseCountTokenWord(m[1]);
      const drawCount = parseCountTokenWord(m[2]);
      if (lifeGain > 0) modifyLifeLikeStack(ctx, controller, lifeGain);
      if (drawCount > 0) drawCardsFromZone(ctx, controller, drawCount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${lifeGain}, draw ${drawCount})`);
      return true;
    }

    case "YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(/^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life for each creature you control\.?$/i);
      if (!m) return false;

      const per = parseCountTokenWord(m[1]);
      const battlefield = getBattlefield(ctx);
      let count = 0;
      for (const p of battlefield) {
        if (p?.controller !== controller) continue;
        const typeLine = String(p?.card?.type_line || "").toLowerCase();
        if (typeLine.includes("creature")) count++;
      }
      modifyLifeLikeStack(ctx, controller, per * count);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${per}x${count})`);
      return true;
    }
    default:
      return undefined;
  }
}
