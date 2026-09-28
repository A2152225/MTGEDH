// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateLookDrawLifeDiscard.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM .. TARGET_PLAYER_DISCARDS_A_CARD
// Public entry symbols: tryLoyaltyTemplateLookDrawLifeDiscard
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { getGameId, parseCountTokenWord, getBattlefield, getTargets, modifyLifeLikeStack } from "../utils.js";
import { toAvailableCard, discardHandCardsToGraveyard, getPlayerById, upsertPlaneswalkerPlayableFromExileGrant } from "./loyaltyTemplateRuntimeHelpers.js";
import { uid } from "../../../utils.js";
import { getCurrentPowerToughnessForRules as currentPT } from "../../../modules/currentPowerToughness.js";
import { applyTemporaryLandBonus } from "../../../modules/game-state-effects.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../../modules/graveyardEntryUtils.js";
import { queueResolveTopOfStackPrompt } from "../../../modules/resolutionPromptEvents.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateLookDrawLifeDiscard(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) or ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const type1 = String(m[2] || '').trim();
      const type2 = String(m[3] || '').trim();
      const type1Lower = type1.toLowerCase();
      const type2Lower = type2.toLowerCase();
      if (!type1Lower || !type2Lower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const matchesEither = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(type1Lower) || tl.includes(type2Lower);
      };

      const selectable = revealed.filter(matchesEither);
      const nonSelectable = revealed.filter((c: any) => !matchesEither(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an ${type1} or ${type2} card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `an ${type1} or ${type2} card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        maxTypes: {
          [type1Lower]: 1,
          [type2Lower]: 1,
        },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const k = parseCountTokenWord(m[2]);
      if (!Number.isFinite(n) || !Number.isFinite(k)) return false;
      if (n <= 0 || k < 0) return false;
      if (k > n) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const maxPick = Math.min(Math.max(0, k | 0), revealed.length);

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (put ${maxPick} into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `${maxPick} card(s)` ,
        minSelections: maxPick,
        maxSelections: maxPick,
        destination: "hand",
        reveal: false,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderRandomOrder: true,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put one of them into your hand and the rest on the bottom of your library in any order\.?$/i
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

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (put 1 into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: "hand",
        reveal: false,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderPlayerChoosesOrder: true,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? artifact card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i
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

      const isArtifact = (c: any) => String(c?.type_line || '').toLowerCase().includes('artifact');
      const selectable = revealed.filter(isArtifact);
      const nonSelectable = revealed.filter((c: any) => !isArtifact(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an artifact card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 artifact card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: "hand",
        reveal: true,
        shuffleAfter: false,
        remainderDestination: "bottom",
        remainderPlayerChoosesOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND": {
      const m = text.match(
        /^look at the top two cards of your library\. exile one of them and put the other into your hand\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(2, lib.length));
      if (revealed.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (exile 1, put the other into your hand)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'hand',
        remainderRandomOrder: false,
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. exile one face down and put the rest on the bottom of your library in any order\. for as long as it remains exiled, you may cast it if it(?:'|’)s a creature spell\.?$/i
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

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (exile 1 face down)` ,
        mandatory: true,
        sourceName,
        searchCriteria: `1 card` ,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderPlayerChoosesOrder: true,
        destinationFaceDown: true,
        grantPlayableFromExileToController: true,
        playableFromExileTypeKey: 'creature',
        availableCards: revealed.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? aura, creature, or planeswalker card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i
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

      const typeKeys = ['aura', 'creature', 'planeswalker'];
      const isMatch = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return typeKeys.some((k) => tl.includes(k));
      };

      const selectable = revealed.filter(isMatch);
      const nonSelectable = revealed.filter((c: any) => !isMatch(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an Aura, creature, or planeswalker card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 Aura, creature, or planeswalker card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
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

    case "DRAW_CARDS_SELF": {
      const m = text.match(/(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i);
      const n = parseCountTokenWord(m?.[1] || "0");
      drawCardsFromZone(ctx, controller, n);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${n})`);
      return true;
    }

    case "DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^draw cards equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = currentPT(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      drawCardsFromZone(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${maxPower})`);
      return true;
    }

    case "DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^discard your hand, then draw cards equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      if (z.hand.length > 0) {
        discardHandCardsToGraveyard(ctx, controller, z.hand, z.graveyard);
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = currentPT(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      drawCardsFromZone(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew ${maxPower})`);
      return true;
    }

    case "DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY": {
      const m = text.match(
        /^discard your hand, then exile the top three cards of your library\.\s*until end of turn, you may play cards exiled this way\.?$/i
      );
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      // Discard your hand.
      if (z.hand.length > 0) {
        discardHandCardsToGraveyard(ctx, controller, z.hand, z.graveyard);
        z.hand = [];
      }
      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;

      // Exile the top three cards of your library.
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) {
        ;(ctx as any).bumpSeq?.();
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled 0)`);
        return true;
      }

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});

      const actual = Math.max(0, Math.min(3, lib.length));
      const grantedCardIds: string[] = [];
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid('c'));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
          exiledWithSourceId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
          exiledWithOracleId: triggerItem?.planeswalker?.oracleId,
          exiledWithSourceName: sourceName,
          canBePlayedBy: controller,
          playableUntilTurn: (state as any).turnNumber ?? 0,
        };
        z.exile.push(exiled);
        pfe[cardId] = (state as any).turnNumber ?? 0;
        grantedCardIds.push(cardId);
      }
      upsertPlaneswalkerPlayableFromExileGrant(state, controller, grantedCardIds, sourceName, text, 'play', Number((state as any).turnNumber ?? 0));

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === 'number') z.exileCount = z.exile.length;

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL": {
      const m = text.match(/^you gain life equal to the greatest power among creatures you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let maxPower = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        const power = currentPT(perm, (ctx as any).state).power;
        if (Number.isFinite(power)) maxPower = Math.max(maxPower, power);
      }

      if (maxPower > 0) modifyLifeLikeStack(ctx, controller, maxPower);
      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${maxPower})`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);
      if (topTwo.length < 2) return true;

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || "Unknown",
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your hand and the other on the bottom of your library`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        chooseLookedAtCardsDestinationChoice: true,
        chooseLookedAtCardsDestinationController: controller,
        chooseLookedAtCardsDestinationSourceName: sourceName,
        chooseLookedAtCardsDestinationTopCardIds: topTwo.map((c: any) => c.id),
        chooseLookedAtCardsDestinationChosenZone: 'hand',
        chooseLookedAtCardsDestinationOtherZone: 'bottom_library',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);
      if (topTwo.length < 2) return true;

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || "Unknown",
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your hand and the other into your graveyard`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        chooseLookedAtCardsDestinationChoice: true,
        chooseLookedAtCardsDestinationController: controller,
        chooseLookedAtCardsDestinationSourceName: sourceName,
        chooseLookedAtCardsDestinationTopCardIds: topTwo.map((c: any) => c.id),
        chooseLookedAtCardsDestinationChosenZone: 'hand',
        chooseLookedAtCardsDestinationOtherZone: 'graveyard',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD": {
      const m = text.match(/^look at the top two cards of your library\. put one of them into your graveyard\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || {};
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const topTwo = lib.slice(0, 2);

      if (topTwo.length === 0) return true;
      if (topTwo.length === 1) {
        const moved = lib.splice(0, 1).map((c: any) => ({ ...c, zone: 'graveyard' }));
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyard.unshift(...moved);
        z.libraryCount = lib.length;
        z.graveyardCount = z.graveyard.length;
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (1 card)`);
        return true;
      }

      const options = topTwo.map((c: any) => ({
        id: c.id,
        label: c.name || 'Unknown',
        description: c.type_line,
        imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Put one into your graveyard`,
        mandatory: true,
        sourceName: sourceName,
        options,
        minSelections: 1,
        maxSelections: 1,
        chooseLookedAtCardsDestinationChoice: true,
        chooseLookedAtCardsDestinationController: controller,
        chooseLookedAtCardsDestinationSourceName: sourceName,
        chooseLookedAtCardsDestinationTopCardIds: topTwo.map((c: any) => c.id),
        chooseLookedAtCardsDestinationChosenZone: 'graveyard',
        chooseLookedAtCardsDestinationOtherZone: 'top_library',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER": {
      const m = text.match(
        /^reveal the top three cards of your library\.\s*an opponent separates those cards into two piles\.\s*put one pile into your hand and the other on the bottom of your library in any order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || {
        library: [],
        libraryCount: 0,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      const revealed: any[] = lib.splice(0, Math.min(3, lib.length));
      z.library = lib;
      z.libraryCount = lib.length;
      if (revealed.length === 0) return true;

      const opponents = (state as any)?.players
        ? (state as any).players.filter((p: any) => p?.id !== controller && !p?.eliminated)
        : [];

      // No opponent in the game => put all revealed into hand.
      if (!opponents.length) {
        const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
        for (const c of revealed) hand.push({ ...c, zone: 'hand' });
        z.hand = hand;
        z.handCount = hand.length;
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no opponents)`);
        return true;
      }

      const topCardIds = revealed.map((c: any) => c?.id).filter(Boolean);

      const twoPileStep = (opponentId: string) => {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TWO_PILE_SPLIT,
          playerId: opponentId as any,
          description: `${sourceName}: Separate the revealed cards into two piles`,
          mandatory: true,
          sourceName,
          items: revealed.map((c: any) => ({
            id: c.id,
            label: c.name || 'Unknown',
            description: c.type_line,
            imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
          })),
          minPerPile: 0,
          choosePileFromSplitChoice: true,
          choosePileFromSplitChooserPlayerId: controller,
          choosePileFromSplitSourceName: sourceName,
          choosePileFromSplitItems: revealed,
          choosePileFromSplitOriginalOrder: topCardIds,
          choosePileFromSplitChosenAction: 'move_cards',
          choosePileFromSplitChosenDestination: 'hand',
          choosePileFromSplitOtherDestination: 'library',
          choosePileFromSplitMovePlayerId: controller,
          choosePileFromSplitChoiceDescription: `${sourceName}: Choose a pile to put into your hand`,
          choosePileFromSplitChatMessage: `${sourceName}: A pile was chosen to put into hand.`,
          choosePileFromSplitSplitMessage: `${sourceName}: The cards were separated into two piles.`,
        } as any);
      };

      if (opponents.length === 1) {
        twoPileStep(String(opponents[0].id));
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: Choose an opponent to separate the revealed cards into two piles`,
        mandatory: true,
        sourceName,
        options: opponents.map((p: any) => ({ id: p.id, label: p.name || p.id })),
        minSelections: 1,
        maxSelections: 1,
        choosePlayerForTwoPileSplitChoice: true,
        choosePlayerForTwoPileSplitController: controller,
        choosePlayerForTwoPileSplitSourceName: sourceName,
        choosePlayerForTwoPileSplitDescription: `${sourceName}: Separate the revealed cards into two piles`,
        choosePlayerForTwoPileSplitItems: revealed.map((c: any) => ({
          id: c.id,
          label: c.name || 'Unknown',
          description: c.type_line,
          imageUrl: c.image_uris?.normal || c.image_uris?.art_crop || c.image_uris?.small,
        })),
        choosePlayerForTwoPileSplitMinPerPile: 0,
        choosePileFromSplitChoice: true,
        choosePileFromSplitChooserPlayerId: controller,
        choosePileFromSplitSourceName: sourceName,
        choosePileFromSplitItems: revealed,
        choosePileFromSplitOriginalOrder: topCardIds,
        choosePileFromSplitChosenAction: 'move_cards',
        choosePileFromSplitChosenDestination: 'hand',
        choosePileFromSplitOtherDestination: 'library',
        choosePileFromSplitMovePlayerId: controller,
        choosePileFromSplitChoiceDescription: `${sourceName}: Choose a pile to put into your hand`,
        choosePileFromSplitChatMessage: `${sourceName}: A pile was chosen to put into hand.`,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD": {
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may discard a card. If you do, draw a card.`,
        mandatory: true,
        sourceName: sourceName,
        options: [
          { id: "discard", label: "Discard a card", description: "Then draw a card." },
          { id: "dont", label: "Don't discard", description: "Do nothing." },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalDiscardThenDrawChoice: true,
        optionalDiscardThenDrawPlayerId: controller,
        optionalDiscardThenDrawSourceName: sourceName,
        optionalDiscardThenDrawCount: 1,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_DISCARD_A_CARD": {
      drawCardsFromZone(ctx, controller, 1);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued discard)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM": {
      const m = text.match(/^draw a card, then discard a card at random\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const zones = (state as any)?.zones || {};
      const z = (zones[controller] = zones[controller] || {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      if (z.hand.length > 0) {
        const rng = typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random;
        const r = typeof rng === 'function' ? rng() : Math.random();
        const idx = Math.max(0, Math.min(z.hand.length - 1, Math.floor(r * z.hand.length)));
        const [discarded] = z.hand.splice(idx, 1);
        if (discarded) {
          pushCardToPlayerGraveyardWithReplacements(ctx, String(controller), discarded, z.graveyard);
        }
      }

      z.handCount = z.hand.length;
      z.graveyardCount = z.graveyard.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_TWO_CARDS_THEN_DISCARD_A_CARD": {
      drawCardsFromZone(ctx, controller, 2);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued discard)`);
      return true;
    }

    case "DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN": {
      const m = text.match(/^draw a card\. you may play an additional land this turn\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);
      applyTemporaryLandBonus(ctx, controller, 1);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_PLAYER_DISCARDS_A_CARD": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const m = text.match(
        /^target player discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i
      );
      if (!m) return false;
      const discardCount = parseCountTokenWord(m[1]);
      if (discardCount <= 0) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[targetId]?.hand || [];
      if (!hand.length) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: targetId as any,
        description: `${sourceName}: Discard ${discardCount} card${discardCount === 1 ? '' : 's'}`,
        mandatory: true,
        sourceName: sourceName,
        discardCount,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (target=${targetId})`);
      return true;
    }
    default:
      return undefined;
  }
}
