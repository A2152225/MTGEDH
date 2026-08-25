// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateLoyaltyCountersMill.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS .. PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT
// Public entry symbols: tryLoyaltyTemplateLoyaltyCountersMill
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, parseCountTokenWord, getGameId, modifyLifeLikeStack, getPlaneswalkerX } from "../utils.js";
import { updateCounters, movePermanentToExile, createToken } from "../../../modules/counters_tokens.js";
import { addRestrictedMana, millCards, getPlayerById, extractQuotedAbilities, getOpponents, parseTokenDescriptorToTypeLineAndColors, predefinedArtifactTokens } from "./loyaltyTemplateRuntimeHelpers.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateLoyaltyCountersMill(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^put a loyalty counter on ([a-z0-9 ,'-]+) for each creature target opponent controls\.?$/i);
      if (!m) return false;

      const [opponentId] = getTargets(triggerItem);
      if (!opponentId) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if ((perm as any).controller !== opponentId) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("creature")) count++;
      }

      if (count > 0) {
        updateCounters(ctx, String(sourcePerm.id), { loyalty: count });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${count}, opponent=${opponentId})`);
      return true;
    }

    case "EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP": {
      const [targetId] = getTargets(triggerItem);
      // "up to one" => no target is a legal choice
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const typeLineLower = String(perm?.card?.type_line || "").toLowerCase();
      const isArtifactOrCreature = typeLineLower.includes("artifact") || typeLineLower.includes("creature");
      if (!isArtifactOrCreature) return false;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;

      // Exile the permanent (tokens will cease to exist and won't return).
      movePermanentToExile(ctx, targetId);

      // Schedule a delayed return at the beginning of the owner's next end step.
      // We keep this as best-effort automation (no stack object); processed in turn.ts.
      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${ownerId}'s next end step)`);
      return true;
    }

    case "EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;

      // "another" => cannot target the source permanent.
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (sourceId && targetId === sourceId) return false;

      // Must be a permanent you own.
      if (ownerId !== controller) return false;

      movePermanentToExile(ctx, targetId);

      // If this was a commander and the owner chose command zone (or exile failed),
      // don't schedule a return (best-effort).
      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];
      const stillInExile = exile.some((c: any) => c?.id === cardId);
      if (!stillInExile) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, but not in exile zone; skip return scheduling)`);
        return true;
      }

      // Best-effort automation: schedule return at the beginning of your next end step.
      // Note: This is not strictly "immediate"; we intentionally reuse the existing
      // pending-flicker infrastructure to keep implementation consistent.
      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId: controller,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${controller}'s next end step)`);
      return true;
    }

    case "EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const ownerId: PlayerID = (perm as any).owner;
      const cardId: string | undefined = (perm as any).card?.id;
      if (!ownerId || !cardId) return false;
      if (ownerId !== controller) return false;

      movePermanentToExile(ctx, targetId);

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];
      const stillInExile = exile.some((c: any) => c?.id === cardId);
      if (!stillInExile) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, but not in exile zone; skip return scheduling)`);
        return true;
      }

      (state as any).pendingFlickerReturns = Array.isArray((state as any).pendingFlickerReturns)
        ? (state as any).pendingFlickerReturns
        : [];
      (state as any).pendingFlickerReturns.push({
        kind: "return_from_exile_to_battlefield",
        ownerId: controller,
        cardId,
        returnAt: "owners_next_end_step",
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${cardId}, returns at ${controller}'s next end step)`);
      return true;
    }

    case "EXILE_ALL_OTHER_PERMANENTS": {
      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      if (!Array.isArray(battlefield) || battlefield.length === 0) return true;

      const toExile: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.id) continue;
        if (sourceId && perm.id === sourceId) continue;
        toExile.push(perm.id);
      }

      for (const id of toExile) {
        movePermanentToExile(ctx, id);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${toExile.length} permanents)`);
      return true;
    }

    case "CREATE_NAMED_TOKEN_WITH_ABILITIES": {
      const mComma = text.match(
        /^create (a|an|one|two|three|four|five|\d+)?\s*(tapped )?([^,]+),\s*a\s+(.+?)\s+token(?:\s+with\s+"[\s\S]+")?\.?$/i
      );

      const mNamed = !mComma
        ? text.match(
            /^create (a|an|one|two|three|four|five|\d+)?\s*(tapped )?(?:colorless )?(.+?)\s+token\s+named\s+([^\.]+?)(?:\s+with\s+"[\s\S]+")?\.?$/i
          )
        : null;

      if (!mComma && !mNamed) return false;

      const count = (mComma?.[1] || mNamed?.[1]) ? parseCountTokenWord((mComma?.[1] || mNamed?.[1]) as any) : 1;
      const isTapped = !!(mComma?.[2] || mNamed?.[2]);
      const tokenName = (mComma ? mComma[3] : mNamed![4]).trim();
      const descriptor = (mComma ? mComma[4] : mNamed![3]).trim();

      const quotedAbilities = extractQuotedAbilities(text);
      const { typeLine, colors, isArtifact } = parseTokenDescriptorToTypeLineAndColors(descriptor);

      const createdIds = createToken(ctx, controller, tokenName, count, undefined, undefined, {
        colors,
        typeLine,
        abilities: quotedAbilities,
        isArtifact,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${tokenName})`);
      return true;
    }

    case "REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || { library: [], libraryCount: 0, hand: [], handCount: 0, exile: [], exileCount: 0 });
      const lib: any[] = z.library || [];
      const topCards = lib.slice(0, 2);

      if (topCards.length <= 0) return true;
      if (topCards.length === 1) {
        // Best-effort: if only one card, just draw it.
        drawCardsFromZone(ctx, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (only 1 card; drew it)`);
        return true;
      }

      const opponents = getOpponents(ctx, controller);
      const controllerName = getPlayerById(ctx, controller)?.name || "You";

      // If there is exactly one opponent, skip choosing who chooses.
      if (opponents.length === 1) {
        const oppId = opponents[0];
        const options = topCards.map((c: any) => ({
          id: c.id,
          label: c.name || "Unknown",
          description: c.type_line,
          imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
        }));

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: oppId,
          description: `${sourceName}: Choose a card to put into ${controllerName}'s hand`,
          mandatory: true,
          sourceName,
          options,
          minSelections: 1,
          maxSelections: 1,
          chooseLookedAtCardsDestinationChoice: true,
          chooseLookedAtCardsDestinationController: controller,
          chooseLookedAtCardsDestinationSourceName: sourceName,
          chooseLookedAtCardsDestinationTopCardIds: topCards.map((c: any) => c.id),
          chooseLookedAtCardsDestinationChosenZone: 'hand',
          chooseLookedAtCardsDestinationOtherZone: 'exile',
          chooseLookedAtCardsDestinationOtherCardPatch: {
            silverCounters: 1,
            exiledBy: sourceName,
          },
        } as any);

        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponent chooses)`);
        return true;
      }

      // Controller chooses which opponent makes the choice.
      const oppOptions = opponents.map((pid) => ({
        id: pid,
        label: getPlayerById(ctx, pid as any)?.name || String(pid),
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose an opponent to make the choice`,
        mandatory: true,
        sourceName,
        options: oppOptions,
        minSelections: 1,
        maxSelections: 1,
        choosePlayerForLookedAtCardsChoice: true,
        choosePlayerForLookedAtCardsController: controller,
        choosePlayerForLookedAtCardsSourceName: sourceName,
        choosePlayerForLookedAtCardsDescription: `${sourceName}: Choose a card to put into ${controllerName}'s hand`,
        choosePlayerForLookedAtCardsOptions: topCards.map((c: any) => ({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris,
          mana_cost: c.mana_cost,
          cmc: c.cmc,
          colors: c.colors,
        })),
        choosePlayerForLookedAtCardsDestinationController: controller,
        choosePlayerForLookedAtCardsDestinationSourceName: sourceName,
        choosePlayerForLookedAtCardsDestinationTopCardIds: topCards.map((c: any) => c.id),
        choosePlayerForLookedAtCardsDestinationChosenZone: 'hand',
        choosePlayerForLookedAtCardsDestinationOtherZone: 'exile',
        choosePlayerForLookedAtCardsDestinationOtherCardPatch: {
          silverCounters: 1,
          exiledBy: sourceName,
        },
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (controller chooses opponent)`);
      return true;
    }

    case "ADD_RESTRICTED_MANA_SPEND_ONLY": {
      const m = text.match(/^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.\s*spend this mana only to (?:cast )?([^\.]+?)\.?$/i);
      if (!m) return false;

      const symbols = m[1];
      const spendClause = m[2].toLowerCase();

      let restriction: any = null;
      if (spendClause.includes("creature")) restriction = "creatures";
      else if (spendClause.includes("artifact")) restriction = "artifacts";
      else if (spendClause.includes("colorless")) restriction = "colorless_spells";
      else if (spendClause.includes("instant") || spendClause.includes("sorcery")) restriction = "instant_sorcery";
      else if (spendClause.includes("ability") || spendClause.includes("abilities")) restriction = "abilities";
      else return false; // don't match unsupported restriction types yet

      const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      const rx = /\{([WUBRGC])\}/gi;
      let mm: RegExpExecArray | null;
      while ((mm = rx.exec(symbols))) {
        const sym = mm[1].toUpperCase();
        counts[sym] = (counts[sym] || 0) + 1;
      }

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourceLabel = sourceName;

      addRestrictedMana(state, controller, "white", counts.W, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "blue", counts.U, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "black", counts.B, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "red", counts.R, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "green", counts.G, restriction, sourceId, sourceLabel);
      addRestrictedMana(state, controller, "colorless", counts.C, restriction, sourceId, sourceLabel);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, restriction=${restriction})`);
      return true;
    }

    case "ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS": {
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
        description: `${sourceName}: Choose a color for the first mana (spend only to cast Dragon spells)`,
        mandatory: true,
        sourceName: sourceName,
        options: colorOptions,
        minSelections: 1,
        maxSelections: 1,
        chooseManaColorsChoice: true,
        chooseManaColorsController: controller,
        chooseManaColorsSourceName: sourceName,
        chooseManaColorsSourceId: sourceId,
        chooseManaColorsRestriction: "dragon_spells",
        chooseManaColorsSelectionsTotal: 2,
        chooseManaColorsAmountPerSelection: 1,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const pool: any = state.manaPool?.[controller] || {};
      const maxPay =
        (pool.white || 0) +
        (pool.blue || 0) +
        (pool.black || 0) +
        (pool.red || 0) +
        (pool.green || 0) +
        (pool.colorless || 0);

      const options = Array.from({ length: Math.max(0, maxPay) + 1 }, (_, i) => ({
        id: String(i),
        label: String(i),
        description: i === 1 ? "Pay 1 mana" : `Pay ${i} mana`,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Pay any amount of mana (0–${maxPay})`,
        mandatory: true,
        sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        payManaToLookAndChooseCardChoice: true,
        payManaToLookAndChooseCardController: controller,
        payManaToLookAndChooseCardSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_PREDEFINED_ARTIFACT_TOKENS":
    case "CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS": {
      const isTapped = match.id === "CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS";
      const m = text.match(
        /^create (a|an|one|two|three|four|five|\d+) (?:tapped )?(food|treasure|clue|map|blood|gold|powerstone) tokens?\.(?:\s*\([^)]*\)\.)?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const tokenKey = m[2].toLowerCase();
      const spec = predefinedArtifactTokens[tokenKey];
      if (!spec) return false;

      const createdIds = createToken(ctx, controller, spec.name, count, undefined, undefined, {
        colors: spec.colors,
        typeLine: spec.typeLine,
        abilities: spec.abilities,
        isArtifact: true,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${spec.name}${count === 1 ? "" : "s"}${isTapped ? ", tapped" : ""})`);
      return true;
    }

    case "GAIN_LIFE_SELF": {
      const m = text.match(/you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      modifyLifeLikeStack(ctx, controller, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "LOSE_LIFE_SELF": {
      const m = text.match(/you lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      modifyLifeLikeStack(ctx, controller, -n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "DRAW_CARD_AND_LOSE_LIFE_SELF": {
      const m = text.match(
        /^you draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) card and lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.(?:\s*proliferate\.)?$/i
      );
      if (!m) return false;
      const drawN = parseCountTokenWord(m[1]);
      const loseN = parseCountTokenWord(m[2]);
      drawCardsFromZone(ctx, controller, drawN);
      modifyLifeLikeStack(ctx, controller, -loseN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN}, lose ${loseN})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_N": {
      const m = text.match(
        /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const milled = millCards(ctx, targetPlayer as any, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targetPlayer} mills ${milled.length})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_N_THEN_DRAW": {
      const m = text.match(
        /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.\s*draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i
      );
      if (!m) return false;

      const millN = parseCountTokenWord(m[1]);
      const drawN = parseCountTokenWord(m[2]);
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      millCards(ctx, targetPlayer as any, millN);
      drawCardsFromZone(ctx, controller, drawN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mill ${millN}, draw ${drawN})`);
      return true;
    }

    case "DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD": {
      const m = text.match(/^draw a card\.\s*target player mills a card\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const player = getPlayerById(ctx, targetPlayerId as any);
      if (!player) return false;

      drawCardsFromZone(ctx, controller, 1);
      millCards(ctx, targetPlayerId as any, 1);

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS": {
      const m = text.match(/^draw a card\.\s*each player mills two cards\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        millCards(ctx, pid as any, 2);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_THREE_TIMES_X": {
      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x) return false;

      const millN = 3 * x;
      millCards(ctx, targetPlayer as any, millN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x}, mill ${millN})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20": {
      const m = text.match(
        /^target player mills three cards\. then if a graveyard has twenty or more cards in it, you draw three cards\. otherwise, you draw a card\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      millCards(ctx, targetPlayer as any, 3);

      const zones = (state as any)?.zones || {};
      const players = ((ctx as any).state?.players as any[]) || [];
      const anyGy20 = players.some((p: any) => {
        const pid = p?.id as any;
        const gyCount = zones[pid]?.graveyardCount ?? zones[pid]?.graveyard?.length ?? 0;
        return (gyCount | 0) >= 20;
      });

      const drawN = anyGy20 ? 3 : 1;
      drawCardsFromZone(ctx, controller, drawN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN})`);
      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND": {
      const m = text.match(/^untap up to one target creature and up to one target land\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 2);
      if (targets.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;
        perm.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS": {
      const m = text.match(/^untap up to two target creatures and up to two target lands\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 4);
      if (targets.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;
        perm.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_TARGETS": {
      const m = text.match(/put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters?/i);
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem);
      if (!targets.length) return false;

      for (const id of targets) {
        updateCounters(ctx, id, { "+1/+1": n });
      }
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targets.length} target(s), +${n}/+${n} counters)`);
      return true;
    }

    case "PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL": {
      const m = text.match(
        /^put x \+1\/\+1 counters on target creature, where x is your life total(?:\.\s*that creature gains trample until end of turn)?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const controllerLifeRaw = (state as any)?.life?.[controller];
      const players = ((state as any)?.players as any[]) || [];
      const controllerPlayer = players.find((p: any) => String(p?.id || '') === String(controller));
      const controllerLife =
        (typeof controllerLifeRaw === 'number' && Number.isFinite(controllerLifeRaw)
          ? controllerLifeRaw
          : typeof controllerPlayer?.life === 'number'
            ? controllerPlayer.life
            : (state as any)?.startingLife ?? 40) | 0;

      const x = Math.max(0, controllerLife);
      if (x > 0) {
        updateCounters(ctx, targetId, { "+1/+1": x });
      }

      const grantTrample = String(text).toLowerCase().includes('gains trample until end of turn');
      if (grantTrample) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (perm) {
          (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
          if (!(perm as any).grantedAbilities.includes('Trample')) (perm as any).grantedAbilities.push('Trample');

          (perm as any).untilEndOfTurn =
            (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(
            ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          )
            ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
            : [];
          if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
            ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x}${grantTrample ? ', +Trample EOT' : ''})`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(
        /^put a \+1\/\+1 counter on each creature you control(?:\. those creatures gain vigilance until end of turn)?\.?$/i
      );
      if (!m) return false;

      const grantVigilance = String(text).toLowerCase().includes("gain vigilance until end of turn");
      const battlefield = getBattlefield(ctx);

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        updateCounters(ctx, perm.id, { "+1/+1": 1 });
        affected++;

        if (grantVigilance) {
          perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
          if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("vigilance"))) {
            perm.grantedAbilities.push("Vigilance");
          }

          perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
          (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
            ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
            : [];
          if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Vigilance")) {
            (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Vigilance");
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(/^put a loyalty counter on each (white|blue|black|red|green) planeswalker you control\.?$/i);
      if (!m) return false;

      const colorWord = String(m[1] || "").toLowerCase();
      const colorLetter =
        colorWord === "white"
          ? "W"
          : colorWord === "blue"
            ? "U"
            : colorWord === "black"
              ? "B"
              : colorWord === "red"
                ? "R"
                : colorWord === "green"
                  ? "G"
                  : null;
      if (!colorLetter) return false;

      const battlefield = getBattlefield(ctx);

      const permHasColor = (perm: any): boolean => {
        const card = perm?.card;
        if (!card) return false;
        const colors: string[] = Array.isArray(card.colors)
          ? card.colors
          : Array.isArray(card.color_identity)
            ? card.color_identity
            : [];
        if (colors.map((c) => String(c).toUpperCase()).includes(colorLetter)) return true;

        if (colors.length === 0) {
          const manaCost = String(card.mana_cost || "").toUpperCase();
          return manaCost.includes(`{${colorLetter}}`);
        }

        return false;
      };

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (!typeLineLower.includes("planeswalker")) continue;
        if (!permHasColor(perm)) continue;

        updateCounters(ctx, String(perm.id), { loyalty: 1 });
        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on each creature you control and (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) loyalty counters? on each other planeswalker you control\.?$/i
      );
      if (!m) return false;

      const nCreatures = parseCountTokenWord(m[1]);
      const nLoyalty = parseCountTokenWord(m[2]);
      if (nCreatures <= 0 && nLoyalty <= 0) return true;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      let creaturesAffected = 0;
      let planeswalkersAffected = 0;

      for (const perm of battlefield) {
        if (!perm) continue;
        if (String((perm as any).controller || "") !== String(controller)) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();

        if (nCreatures > 0 && typeLineLower.includes("creature")) {
          updateCounters(ctx, perm.id, { "+1/+1": nCreatures });
          creaturesAffected++;
          continue;
        }

        if (nLoyalty > 0 && typeLineLower.includes("planeswalker")) {
          if (sourceId && String(perm.id) === String(sourceId)) continue; // "other" planeswalkers
          updateCounters(ctx, String(perm.id), { loyalty: nLoyalty });
          planeswalkersAffected++;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (creatures=${creaturesAffected}, otherPlaneswalkers=${planeswalkersAffected})`
      );
      return true;
    }

    case "PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE": {
      const m = text.match(/^put a -1\/-1 counter on up to one target creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "-1/-1": 1 });
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. that creature gains menace until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;

      updateCounters(ctx, targetId, { "+1/+1": 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("menace"))) {
        perm.grantedAbilities.push("Menace");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Menace")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Menace");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }
    default:
      return undefined;
  }
}
