// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateDamageRestartSearch.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL .. SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE
// Public entry symbols: tryLoyaltyTemplateDamageRestartSearch
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { getGameId, getBattlefield, getTargets, getPlaneswalkerX, parseCountTokenWord, modifyLifeLikeStack } from "../utils.js";
import { toAvailableCard, normalizeCardNameForCompare, applyDamageToPermanent, applyDamageToPlayer, exilePermanents, getControlConstraint, getManaValueConstraint, getOpponents, getPlayerById, recordCreatureDealtDamageToPlayerThisTurn, satisfiesManaValueConstraint } from "./loyaltyTemplateRuntimeHelpers.js";
import { destroyPermanent, movePermanentToExile, updateCounters, createToken } from "../../../modules/counters_tokens.js";
import { getActualPowerToughness } from "../../../utils.js";
import { restartGameWithKarnExemptions } from "./loyaltyTemplateRestartGame.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateDamageRestartSearch(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL": {
      const m = text.match(
        /^[a-z0-9 ,'-]+ deals (\d+) damage to target opponent or planeswalker and each creature (?:they control|that player or that planeswalker's controller controls)\.?$/i
      );
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      let affectedController: string | null = null;

      if (player) {
        if (String(targetId) === String(controller)) return false; // effect says opponent
        applyDamageToPlayer(ctx, targetId as any, amount);
        affectedController = String(targetId);
      } else {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (!perm) return false;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("planeswalker")) return false;
        applyDamageToPermanent(ctx, targetId, amount);
        affectedController = String(perm.controller || "");
      }

      if (!affectedController) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) !== affectedController) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals x damage to target creature or planeswalker and you gain x life\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      applyDamageToPermanent(ctx, targetPermanentId, x);
      modifyLifeLikeStack(ctx, controller, x);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "DEALS_X_DAMAGE_TO_EACH_CREATURE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals x damage to each creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;
        applyDamageToPermanent(ctx, perm.id, x);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT": {
      const m = text.match(/^each creature you control deals damage equal to its power to each opponent\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      let total = 0;
      const creaturePowers: Array<{ perm: any; power: number }> = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        const pt = getActualPowerToughness(ctx as any, perm);
        const pwr = Math.max(0, pt.power | 0);
        total += pwr;
        if (pwr > 0) creaturePowers.push({ perm, power: pwr });
      }

      if (total <= 0) return true;
      for (const opp of opponents) {
        // Best-effort: record the individual creature sources that dealt damage.
        for (const cp of creaturePowers) {
          recordCreatureDealtDamageToPlayerThisTurn(ctx, cp.perm, opp, cp.power);
        }
        applyDamageToPlayer(ctx, opp, total);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${total} to each opponent)`);
      return true;
    }

    case "EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^exile [a-z0-9 ,'-]+ and each creature your opponents control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (sourceId) {
        movePermanentToExile(ctx, sourceId);
      }

      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toExile.push(perm.id);
      }

      exilePermanents(ctx, toExile);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${toExile.length} creatures)`);
      return true;
    }

    case "EXILE_TARGET_PERMANENT": {
      const m = text.match(/^exile target permanent\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const pwOracleId = triggerItem?.planeswalker?.oracleId;

      movePermanentToExile(
        ctx,
        targetId,
        pwOracleId
          ? {
              exiledWithSourceId: sourceId,
              exiledWithOracleId: pwOracleId,
              exiledWithSourceName: sourceName,
            }
          : undefined
      );
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_NONLAND_PERMANENT": {
      const m = text.match(
        /^destroy target nonland permanent(?: (?:you control|you don't control|an opponent controls))?(?: with mana value \d+ or (?:less|greater))?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (tl.includes("land")) return true;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && perm.controller !== controller) return false;
      if (control === 'not_you' && perm.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(perm, mv)) return false;

      destroyPermanent(ctx, targetId, true);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS": {
      const m = text.match(/^destroy target permanent that['’]s one or more colors\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return false;

      const colorsRaw: unknown = (perm as any)?.card?.colors ?? (perm as any)?.card?.color_indicator;
      const colors = Array.isArray(colorsRaw) ? colorsRaw.map((c) => String(c || '').toUpperCase()).filter(Boolean) : [];
      if (colors.length === 0) {
        // Illegal target (colorless) => resolve as no-op.
        return true;
      }

      destroyPermanent(ctx, targetId, true);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD": {
      const m = text.match(/^you and target opponent each draw a card\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      drawCardsFromZone(ctx, controller, 1);
      drawCardsFromZone(ctx, targetOpponent as any, 1);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND": {
      const m = text.match(/^target player exiles a card from their hand\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[targetPlayer]?.hand || [];
      if (hand.length <= 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetPlayer as any,
        description: `${sourceName}: Exile 1 card from hand`,
        mandatory: true,
        sourceName: sourceName,
        discardCount: 1,
        destination: "exile",
        exileTag: triggerItem?.planeswalker?.oracleId
          ? {
              exiledWithSourceId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
              exiledWithOracleId: triggerItem?.planeswalker?.oracleId,
              exiledWithSourceName: sourceName,
            }
          : undefined,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL": {
      const m = text.match(
        /^restart the game, leaving in exile all non-aura permanent cards exiled with [a-z0-9 ,'-]+\. then put those cards onto the battlefield under your control\.?$/i
      );
      if (!m) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (!sourceId) return false;

      const result = restartGameWithKarnExemptions(ctx, controller, String(sourceId));
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (preserved ${result.preservedCount})`
      );
      return true;
    }

    case "TARGET_PLAYER_SACRIFICES_A_CREATURE": {
      const m = text.match(/^target player sacrifices a creature\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const creatures = battlefield.filter((perm: any) => {
        if (perm?.controller !== targetPlayer) return false;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        return tl.includes("creature");
      });

      if (creatures.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no creatures to sacrifice)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.UPKEEP_SACRIFICE,
        playerId: targetPlayer as any,
        description: `${sourceName}: Sacrifice a creature`,
        mandatory: true,
        sourceName: sourceName,
        // Custom data for selection UI + server handler
        allowSourceSacrifice: false,
        hasCreatures: true,
        creatures: creatures.map((perm: any) => ({
          id: perm.id,
          name: perm.card?.name || "Creature",
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          power: perm.card?.power || perm.basePower,
          toughness: perm.card?.toughness || perm.baseToughness,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE": {
      const m = text.match(
        /^separate all permanents target player controls into two piles\.\s*that player sacrifices all permanents in the pile of their choice\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const permanents = battlefield.filter((perm: any) => perm?.controller === targetPlayer);
      if (permanents.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no permanents)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TWO_PILE_SPLIT,
        playerId: targetPlayer as any,
        description: `${sourceName}: Separate your permanents into two piles`,
        mandatory: true,
        sourceName,
        items: permanents.map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line || '',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        })),
        minPerPile: 0,
        choosePileFromSplitChoice: true,
        choosePileFromSplitChooserPlayerId: targetPlayer,
        choosePileFromSplitSourceName: sourceName,
        choosePileFromSplitChosenAction: 'sacrifice_permanents',
        choosePileFromSplitTargetPlayerId: targetPlayer,
        choosePileFromSplitChoiceDescription: `${sourceName}: Choose a pile to sacrifice`,
        choosePileFromSplitSplitMessage: `${sourceName}: The permanents were separated into two piles.`,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1": {
      const m = text.match(
        /^untap target artifact or creature\. if it's an artifact creature, put a \+1\/\+1 counter on it\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!(tl.includes("artifact") || tl.includes("creature"))) return true;

      perm.tapped = false;
      if (tl.includes("artifact") && tl.includes("creature")) {
        updateCounters(ctx, targetId, { "+1/+1": 1 });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return up to one target land card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const landCards = gy.filter((c: any) => String(c?.type_line || "").toLowerCase().includes("land"));
      if (landCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose up to one land card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: landCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Land',
          description: c.type_line || 'land card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND": {
      const m = text.match(
        /^look at the top card of your library\. if it's a creature card, you may reveal it and put it into your hand\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const lib: any[] = zones[controller]?.library || [];
      if (lib.length === 0) return true;

      const top = lib[0];
      const isCreature = String(top?.type_line || "").toLowerCase().includes('creature');
      if (!isCreature) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (top not creature)`);
        return true;
      }

      // Conservative: auto-put into hand (no "may" UI yet).
      // This is consistent with other non-interactive templates and avoids new UI.
      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew creature)`);
      return true;
    }

    case "CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT": {
      const m = text.match(/^create a 0\/0 green and blue fractal creature token\. put x \+1\/\+1 counters on it\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      const n = (x | 0) > 0 ? (x | 0) : 0;

      const createdIds = createToken(ctx, controller, 'Fractal', 1, undefined, undefined, {
        colors: ['G', 'U'],
        typeLine: 'Token Creature — Fractal',
      });

      if (createdIds.length > 0 && n > 0) {
        updateCounters(ctx, createdIds[0], { "+1/+1": n });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${n})`);
      return true;
    }

    case "SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD": {
      const m = text.match(/^surveil (\d+), then exile a card from a graveyard\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      // Use the existing SURVEIL step, but attach a follow-up so the socket handler
      // can enqueue the graveyard-exile selection after surveil is resolved.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SURVEIL,
        playerId: controller,
        description: `${sourceName}: Surveil ${n}`,
        mandatory: true,
        sourceName,
        surveilCount: n,
        followUpExileGraveyardCard: true,
        followUpSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SURVEIL_N": {
      const m = text.match(/^surveil (\d+)\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SURVEIL,
        playerId: controller,
        description: `${sourceName}: Surveil ${n}`,
        mandatory: true,
        sourceName,
        surveilCount: n,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued surveil ${n})`);
      return true;
    }

    case "REVEAL_TOP_N_YOU_MAY_PUT_A_CREATURE_CARD_AND_OR_A_LAND_CARD_INTO_YOUR_HAND_REST_INTO_GRAVEYARD": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.? you may put a creature card and\/or a land card from among them into your hand\.? put the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put up to 1 creature and/or 1 land into your hand)`,
        mandatory: false,
        sourceName,
        searchCriteria: `a creature card and/or a land card`,
        minSelections: 0,
        maxSelections: Math.min(2, revealed.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'graveyard',
        remainderRandomOrder: false,
        filter: { types: ['creature', 'land'] },
        maxTypes: { creature: 1, land: 1 },
        availableCards: revealed.map((card: any) => ({
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: card.image_uris,
          mana_cost: card.mana_cost,
          cmc: card.cmc,
          colors: card.colors,
          power: (card as any).power,
          toughness: (card as any).toughness,
          loyalty: (card as any).loyalty,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const isCreature = (c: any) => String(c?.type_line || '').toLowerCase().includes('creature');
      const selectable = revealed.filter(isCreature);
      const nonSelectable = revealed.filter((c: any) => !isCreature(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put all creature cards into your hand)` ,
        mandatory: selectable.length > 0,
        sourceName,
        searchCriteria: `all creature cards` ,
        minSelections: selectable.length,
        maxSelections: selectable.length,
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all nonland permanent cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const isNonlandPermanent = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (tl.includes('land')) return false;
        return (
          tl.includes('artifact') ||
          tl.includes('creature') ||
          tl.includes('enchantment') ||
          tl.includes('planeswalker') ||
          tl.includes('battle')
        );
      };

      const selectable = revealed.filter(isNonlandPermanent);
      const nonSelectable = revealed.filter((c: any) => !isNonlandPermanent(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Reveal top ${revealed.length} (put all nonland permanent cards into your hand)` ,
        mandatory: selectable.length > 0,
        sourceName,
        searchCriteria: `all nonland permanent cards` ,
        minSelections: selectable.length,
        maxSelections: selectable.length,
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(/^search your library for a card named (.+), put it onto the battlefield, then shuffle\.?$/i);
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName);
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library for ${m[1]} (put onto the battlefield)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY": {
      const m = text.match(
        /^search your library and\/or graveyard for a card named (.+) and put it onto the battlefield\. if you search your library this way, shuffle\.?$/i
      );
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      const zones = (ctx as any)?.state?.zones || {};
      const z = zones?.[controller] || {};
      const gy: any[] = Array.isArray(z?.graveyard) ? z.graveyard : [];

      const availableFromLib = Array.isArray(lib)
        ? lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];
      const availableFromGy = Array.isArray(gy)
        ? gy.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];

      const available = [...availableFromLib, ...availableFromGy];
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library and/or graveyard for ${m[1]} (put onto the battlefield)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        shuffleOnlyIfSelectedFromLibrary: true,
        searchZones: ['library', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY": {
      const m = text.match(
        /^search your library and\/or graveyard for a card named (.+), reveal it, and put it into your hand\. if you search your library this way, shuffle\.?$/i
      );
      if (!m) return false;

      const requestedName = normalizeCardNameForCompare(m[1]);
      if (!requestedName) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      const zones = (ctx as any)?.state?.zones || {};
      const z = zones?.[controller] || {};
      const gy: any[] = Array.isArray(z?.graveyard) ? z.graveyard : [];

      const availableFromLib = Array.isArray(lib)
        ? lib.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];
      const availableFromGy = Array.isArray(gy)
        ? gy.filter((c: any) => normalizeCardNameForCompare(c?.name) === requestedName)
        : [];

      const available = [...availableFromLib, ...availableFromGy];
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library and/or graveyard for ${m[1]} (reveal, put into your hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card named ${m[1]}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        shuffleOnlyIfSelectedFromLibrary: true,
        searchZones: ['library', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land) card with mana value (\d+) or less, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();
      const maxMv = parseInt(m[2], 10);
      if (!Number.isFinite(maxMv)) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const filter: any = {
        types: [rawType],
        maxCmc: maxMv,
      };

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes(rawType)) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= maxMv;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a ${m[1]} (mana value ${maxMv} or less)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a ${m[1]} card with mana value ${maxMv} or less`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter,
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for any number of ([a-z][a-z-]*) creature cards, put them onto the battlefield, then shuffle\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      if (!subtype) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const subtypeRx = new RegExp(`\\b${subtype.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase().replace(/—/g, ' ');
        return tl.includes('creature') && subtypeRx.test(tl);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for any number of ${m[1]} creature cards (put onto the battlefield)`,
        mandatory: false,
        sourceName,
        searchCriteria: `any number of ${m[1]} creature cards`,
        minSelections: 0,
        maxSelections: available.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['creature'], subtypes: [subtype] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }
    default:
      return undefined;
  }
}
