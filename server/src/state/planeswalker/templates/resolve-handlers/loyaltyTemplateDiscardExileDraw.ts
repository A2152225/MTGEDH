// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateDiscardExileDraw.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   DISCARD_A_CARD_THEN_DRAW_A_CARD .. RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD
// Public entry symbols: tryLoyaltyTemplateDiscardExileDraw
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { uid } from "../../../utils.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { getGameId, parseCountTokenWord, getTargets, getBattlefield } from "../utils.js";
import { toAvailableCard, upsertPlaneswalkerPlayableFromExileGrant, applyDamageToPermanent, applyDamageToPlayer, discardHandCardsToGraveyard, getOrInitManaPool } from "./loyaltyTemplateRuntimeHelpers.js";
import { createToken } from "../../../modules/counters_tokens.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateDiscardExileDraw(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "DISCARD_A_CARD_THEN_DRAW_A_CARD": {
      const m = text.match(/^discard a card, then draw a card\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[controller]?.hand || [];
      if (hand.length <= 0) {
        // Discard isn't possible; still draw 1.
        drawCardsFromZone(ctx, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no discard; drew 1)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: controller,
        description: `${sourceName}: Discard 1 card`,
        mandatory: true,
        sourceName,
        discardCount: 1,
        destination: 'graveyard',
        afterDiscardDrawCount: 1,
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

    case "EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN": {
      const m = text.match(/^each player shuffles their hand and graveyard into their library\. you draw seven cards\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const rng = (ctx as any).rng;

      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;

        const z = (zones[pid] = zones[pid] || {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        });

        const hand: any[] = Array.isArray(z.hand) ? z.hand : [];
        const gy: any[] = Array.isArray((z as any).graveyard) ? (z as any).graveyard : [];
        const lib: any[] = Array.isArray((ctx as any).libraries?.get(pid)) ? (ctx as any).libraries.get(pid) : [];

        for (const c of hand) {
          (c as any).zone = 'library';
          lib.push(c);
        }
        for (const c of gy) {
          (c as any).zone = 'library';
          lib.push(c);
        }

        // Clear zones.
        z.hand = [];
        z.handCount = 0;
        (z as any).graveyard = [];
        (z as any).graveyardCount = 0;

        // Shuffle library.
        if (lib.length > 1) {
          for (let i = lib.length - 1; i > 0; i--) {
            const r = typeof rng === 'function' ? rng() : Math.random();
            const j = Math.floor(r * (i + 1));
            [lib[i], lib[j]] = [lib[j], lib[i]];
          }
        }

        (ctx as any).libraries?.set(pid, lib);
        z.libraryCount = lib.length;
      }

      drawCardsFromZone(ctx, controller, 7);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL": {
      const m = text.match(/^attach this equipment to up to one target creature you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no target)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const sourceId =
        triggerItem?.sourceId ||
        triggerItem?.sourcePermanentId ||
        triggerItem?.planeswalker?.id ||
        triggerItem?.source;
      if (!sourceId) return false;

      const equipment = battlefield.find((p: any) => p?.id === sourceId);
      const targetCreature = battlefield.find((p: any) => p?.id === targetId);
      const equipmentTypeLine = String(equipment?.card?.type_line || '').toLowerCase();
      const targetTypeLine = String(targetCreature?.card?.type_line || '').toLowerCase();
      if (!equipment || !equipmentTypeLine.includes('equipment')) return false;
      if (!targetCreature || !targetTypeLine.includes('creature')) return false;
      if (targetCreature.controller !== controller) return false;

      const equipmentId = String(equipment.id);
      const prevAttachedTo = String((equipment as any).attachedTo || '');
      if (prevAttachedTo) {
        const prevCreature = battlefield.find((p: any) => p?.id === prevAttachedTo);
        if (prevCreature) {
          (prevCreature as any).attachedEquipment = Array.isArray((prevCreature as any).attachedEquipment)
            ? (prevCreature as any).attachedEquipment.filter((id: string) => id !== equipmentId)
            : [];
        }
      }

      (equipment as any).attachedTo = targetId;
      (targetCreature as any).attachedEquipment = Array.isArray((targetCreature as any).attachedEquipment)
        ? (targetCreature as any).attachedEquipment
        : [];
      if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
        (targetCreature as any).attachedEquipment.push(equipmentId);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid("c"));

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = {
        ...topCard,
        id: cardId,
        zone: "exile",
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);

      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      // Mark as playable-from-exile for the current turn.
      // Support boolean and numeric formats; we use numeric expiry for better correctness.
      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
      pfe[cardId] = (state as any).turnNumber ?? 0;
      upsertPlaneswalkerPlayableFromExileGrant(state, controller, [cardId], sourceName, text, 'play', Number((state as any).turnNumber ?? 0));

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${topCard?.name || "card"})`
      );
      return true;
    }

    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN": {
      const m = text.match(/^exile the top card of your library\.\s*if it(?:'|’)s red, you may cast it this turn\.?$/i);
      if (!m) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid("c"));

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = {
        ...topCard,
        id: cardId,
        zone: "exile",
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);

      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      const colors: string[] = Array.isArray((topCard as any)?.colors)
        ? (topCard as any).colors.map((c: any) => String(c).toUpperCase())
        : [];
      const colorIdentity: string[] = Array.isArray((topCard as any)?.color_identity)
        ? (topCard as any).color_identity.map((c: any) => String(c).toUpperCase())
        : [];
      const isRed = colors.includes("R") || colorIdentity.includes("R");

      if (isRed) {
        // Mark as playable-from-exile for the current turn.
        (state as any).playableFromExile = (state as any).playableFromExile || {};
        const pfe =
          ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
        pfe[cardId] = (state as any).turnNumber ?? 0;
        upsertPlaneswalkerPlayableFromExileGrant(state, controller, [cardId], sourceName, text, 'cast', Number((state as any).turnNumber ?? 0));
      }

      (ctx as any).bumpSeq?.();
      debug(
        2,
        `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${topCard?.name || "card"}${isRed ? ", red" : ""})`
      );
      return true;
    }

    case "EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may play them this turn\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      if (!count || count <= 0) return true;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});

      const actual = Math.max(0, Math.min(count, lib.length));
      const grantedCardIds: string[] = [];
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid("c"));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: "exile",
          exiledBy: sourceName,
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
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.max(0, Math.min(n, lib.length));
      const exiledNow: any[] = [];
      for (let i = 0; i < actual; i++) {
        const c = lib.shift();
        if (!c) continue;
        const cardId = String((c as any)?.id || uid('c'));
        const exiled = {
          ...(c as any),
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
        };
        z.exile.push(exiled);
        exiledNow.push(exiled);
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      if (exiledNow.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no cards exiled)`);
        return true;
      }

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('creature') || tl.includes('land');
      };
      const selectable = exiledNow.filter(isSelectable);
      const nonSelectable = exiledNow.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: From the exiled cards, you may put any number of creature and/or land cards onto the battlefield` ,
        mandatory: false,
        sourceName,
        searchZone: 'exile',
        searchCriteria: `any number of creature and/or land cards` ,
        minSelections: 0,
        maxSelections: selectable.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        remainderRandomOrder: false,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${exiledNow.length}; queued)`);
      return true;
    }

    case "EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*put all artifact cards from among them onto the battlefield\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.max(0, Math.min(n, lib.length));
      const exiledNow: any[] = [];
      for (let i = 0; i < actual; i++) {
        const c = lib.shift();
        if (!c) continue;
        const cardId = String((c as any)?.id || uid('c'));
        const exiled = {
          ...(c as any),
          id: cardId,
          zone: 'exile',
          exiledBy: sourceName,
        };
        z.exile.push(exiled);
        exiledNow.push(exiled);
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      if (exiledNow.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no cards exiled)`);
        return true;
      }

      const isArtifact = (c: any): boolean => String(c?.type_line || '').toLowerCase().includes('artifact');
      const artifacts = exiledNow.filter(isArtifact);
      const nonArtifacts = exiledNow.filter((c: any) => !artifacts.includes(c));

      if (artifacts.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no artifacts)`);
        return true;
      }

      // Deterministic but handled via the generic LIBRARY_SEARCH to reuse ETB/counter logic.
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Put all artifact cards exiled this way onto the battlefield` ,
        mandatory: true,
        sourceName,
        searchZone: 'exile',
        searchCriteria: `all artifact cards` ,
        minSelections: artifacts.length,
        maxSelections: artifacts.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        remainderRandomOrder: false,
        availableCards: artifacts.map(toAvailableCard),
        nonSelectableCards: nonArtifacts.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${exiledNow.length}; queued ${artifacts.length} artifact(s))`);
      return true;
    }

    case "EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN": {
      const m = text.match(
        /^exile the top two cards of your library\.\s*choose one of them\.\s*you may play that card this turn\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiledCards: any[] = [];
      const exiledCardIds: string[] = [];
      const currentTurn = Number((state as any).turnNumber ?? 0) || 0;

      const actual = Math.max(0, Math.min(2, lib.length));
      for (let i = 0; i < actual; i++) {
        const topCard = lib.shift();
        const cardId = String((topCard as any)?.id || uid("c"));
        const exiled = {
          ...topCard,
          id: cardId,
          zone: "exile",
          exiledBy: sourceName,
        };
        z.exile.push(exiled);
        exiledCards.push(exiled);
        exiledCardIds.push(cardId);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === "number") z.exileCount = z.exile.length;

      if (exiledCardIds.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose an exiled card. You may play it this turn.`,
        mandatory: true,
        sourceName,
        options: exiledCards.map((c: any) => ({
          id: String(c.id),
          label: String(c.name || "Exiled card"),
          description: String(c.type_line || ""),
        })),
        minSelections: 1,
        maxSelections: 1,
        grantPlayableFromExileChoice: true,
        grantPlayableFromExileController: controller,
        grantPlayableFromExileSourceName: sourceName,
        grantPlayableFromExileCardIds: exiledCardIds,
        grantPlayableFromExileUntilTurn: currentTurn,
        grantPlayableFromExileWindowText: 'this turn',
      } as any);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR": {
      const m = text.match(/^draw a card, then add one mana of any color\.?$/i);
      if (!m) return false;

      drawCardsFromZone(ctx, controller, 1);

      const pool = getOrInitManaPool(state, controller);
      (pool as any).anyColor = ((pool as any).anyColor || 0) + 1;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_A_CARD_THEN_SCRY_N": {
      const m = text.match(/^draw a card, then scry (\d+)\.?$/i);
      if (!m) return false;

      const scryCount = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      drawCardsFromZone(ctx, controller, 1);

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryCount}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY": {
      const m = text.match(/^draw a card, then put a card from your hand on top of your library\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      drawCardsFromZone(ctx, controller, 1);

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
      z.handCount = z.hand.length;

      if (z.hand.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no hand cards)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a card from your hand to put on top of your library.`,
        mandatory: true,
        sourceName,
        options: (z.hand as any[]).map((c: any) => ({
          id: String(c.id),
          label: String(c.name || "Card"),
          description: String(c.type_line || ""),
        })),
        minSelections: 1,
        maxSelections: 1,
        moveChosenHandCardToLibraryChoice: true,
        moveChosenHandCardToLibraryController: controller,
        moveChosenHandCardToLibrarySourceName: sourceName,
        moveChosenHandCardToLibraryPosition: 'top',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY": {
      const m = text.match(
        /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then put a card from your hand on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      drawCardsFromZone(ctx, controller, n);

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
      z.handCount = z.hand.length;

      if (z.hand.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no hand cards)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a card from your hand to put on the bottom of your library.`,
        mandatory: true,
        sourceName,
        options: (z.hand as any[]).map((c: any) => ({
          id: String(c.id),
          label: String(c.name || 'Card'),
          description: String(c.type_line || ''),
        })),
        minSelections: 1,
        maxSelections: 1,
        moveChosenHandCardToLibraryChoice: true,
        moveChosenHandCardToLibraryController: controller,
        moveChosenHandCardToLibrarySourceName: sourceName,
        moveChosenHandCardToLibraryPosition: 'bottom',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS": {
      const m = text.match(/^each player discards their hand, then draws three cards\.?$/i);
      if (!m) return false;

      const zones = (state as any).zones || ((state as any).zones = {});
      const players = ((state as any).players as any[]) || [];

      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;

        const z = (zones[pid] = zones[pid] || {
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
          discardHandCardsToGraveyard(ctx, pid, z.hand, z.graveyard);
          z.hand = [];
        }

        z.handCount = (z.hand as any[]).length;
        z.graveyardCount = (z.graveyard as any[]).length;

        drawCardsFromZone(ctx, pid, 3);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_PLAYER_DRAWS_A_CARD": {
      const m = text.match(/^each player draws a card\.?$/i);
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        drawCardsFromZone(ctx, pid, 1);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE": {
      const m = text.match(
        /^if target player has fewer than nine poison counters, they get a number of poison counters equal to the difference\.?$/i
      );
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      (ctx as any).poison = (ctx as any).poison || {};
      const poison = (ctx as any).poison as Record<string, number>;
      const current = poison[targetPlayerId] ?? 0;
      if (current < 9) {
        poison[targetPlayerId] = current + (9 - current);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${current} -> ${poison[targetPlayerId] ?? current})`);
      return true;
    }

    case "CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL": {
      const m = text.match(
        /^create x 1\/1 black vampire knight creature tokens with lifelink, where x is the highest life total among all players\.?$/i
      );
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      const life = ((ctx as any).life as Record<string, number>) || {};
      let highest = 0;
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        const v = life[pid] ?? 40;
        if (typeof v === 'number' && v > highest) highest = v;
      }
      const count = Math.max(0, highest | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Vampire Knight', count, 1, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Vampire Knight',
        abilities: ['Lifelink'],
        isArtifact: false,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL": {
      const m = text.match(
        /^create a number of 1\/1 black vampire knight creature tokens with lifelink equal to the highest life total among all players\.?$/i
      );
      if (!m) return false;

      const players = ((state as any).players as any[]) || [];
      const life = ((ctx as any).life as Record<string, number>) || {};
      let highest = 0;
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        const v = life[pid] ?? 40;
        if (typeof v === 'number' && v > highest) highest = v;
      }
      const count = Math.max(0, highest | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Vampire Knight', count, 1, 1, {
        colors: ['B'],
        typeLine: 'Token Creature — Vampire Knight',
        abilities: ['Lifelink'],
        isArtifact: false,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL": {
      const m = text.match(/^create x 2\/2 white cat creature tokens, where x is your life total\.?$/i);
      if (!m) return false;

      const life = ((ctx as any).life as Record<string, number>) || {};
      const count = Math.max(0, (life[controller] ?? 0) | 0);
      if (count === 0) return true;

      createToken(ctx, controller, 'Cat', count, 2, 2, {
        colors: ['W'],
        typeLine: 'Token Creature — Cat',
        abilities: [],
        isArtifact: false,
      });

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count})`);
      return true;
    }

    case "DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(
        /^[a-z0-9 ,'-]+ deals damage(?: to target (?:creature|player) or planeswalker)? equal to twice the number of warriors and equipment you control(?: to target (?:creature|player) or planeswalker)?\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      let warriors = 0;
      let equipment = 0;
      for (const perm of battlefield) {
        if (!perm || perm.controller !== controller) continue;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && tl.includes('warrior')) warriors++;
        if (tl.includes('equipment')) equipment++;
      }
      const damage = 2 * (warriors + equipment);

      const players = ((state as any).players as any[]) || [];
      const isPlayer = players.some((p: any) => p?.id === targetId);
      if (isPlayer) {
        applyDamageToPlayer(ctx, targetId, damage);
      } else {
        applyDamageToPermanent(ctx, targetId, damage);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${damage})`);
      return true;
    }

    case "RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(
        /^return all nonland permanent cards with mana value (\d+) or less from your graveyard to the battlefield\.?$/i
      );
      if (!m) return false;

      const maxMV = parseInt(m[1], 10);
      if (!Number.isFinite(maxMV)) return false;

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
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const graveyard: any[] = z.graveyard as any[];
      const toReturn: any[] = [];
      for (const c of graveyard) {
        const tl = String((c as any)?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        const isPermanent = tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('battle');
        if (!isPermanent) continue;
        const cmc = typeof (c as any)?.cmc === 'number' ? (c as any).cmc : Number((c as any)?.cmc ?? NaN);
        if (!Number.isFinite(cmc) || cmc > maxMV) continue;
        toReturn.push(c);
      }

      if (toReturn.length === 0) return true;

      // Remove returned cards from graveyard (by id when possible)
      const returnIds = new Set(toReturn.map((c: any) => String(c?.id || '')));
      z.graveyard = graveyard.filter((c: any) => !returnIds.has(String(c?.id || '')));
      z.graveyardCount = (z.graveyard as any[]).length;

      state.battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
      const battlefieldArr: any[] = (state as any).battlefield;

      for (const card of toReturn) {
        const tl = String((card as any)?.type_line || '').toLowerCase();
        const isCreature = tl.includes('creature');
        const basePower = isCreature ? parseInt(String((card as any)?.power ?? '0'), 10) : undefined;
        const baseToughness = isCreature ? parseInt(String((card as any)?.toughness ?? '0'), 10) : undefined;

        battlefieldArr.push({
          id: uid('perm'),
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          attachments: [],
          ...(Number.isFinite(basePower as any) ? { basePower } : {}),
          ...(Number.isFinite(baseToughness as any) ? { baseToughness } : {}),
          card: { ...(card as any), zone: 'battlefield' },
        } as any);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toReturn.length})`);
      return true;
    }
    default:
      return undefined;
  }
}
