// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateSearchEmblemHandPut.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE .. YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD
// Public entry symbols: tryLoyaltyTemplateSearchEmblemHandPut
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { getGameId, parseCountTokenWord, modifyLifeLikeStack, getBattlefield, getTargets, getPlaneswalkerX, parseCreateTokenDescriptor } from "../utils.js";
import { toAvailableCard, getOpponents, getPlayerById, getSourcePlaneswalkerColors } from "./loyaltyTemplateRuntimeHelpers.js";
import { uid } from "../../../utils.js";
import { createToken } from "../../../modules/counters_tokens.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateSearchEmblemHandPut(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const entersTapped = !!m[1];

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('basic') && tl.includes('land');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a basic land (put onto the battlefield${entersTapped ? ' tapped' : ''})`,
        mandatory: true,
        sourceName,
        searchCriteria: `a basic land card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        entersTapped,
        filter: { types: ['land'], supertypes: ['basic'] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP": {
      const m = text.match(/^search your library for a card(?:,|\.)\s*then shuffle and put that card on top(?: of your library)?\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library for a card (put on top)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'top',
        reveal: false,
        shuffleAfter: true,
        availableCards: lib.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for an artifact card with mana value x or less, put (?:it|that card) onto the battlefield(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (x === null) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('artifact')) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= x;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for an artifact (mana value ${x} or less) (put onto battlefield)`,
        mandatory: true,
        sourceName,
        searchCriteria: `an artifact card with mana value ${x} or less`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['artifact'], maxCmc: x },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (basic )?([a-z][a-z-]*) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const basicFlag = !!m[1];
      const subtypeRaw = String(m[2] || '').trim();
      const subtypeLower = subtypeRaw.toLowerCase();
      if (!subtypeLower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const isBasicLandSubtype = ['plains', 'island', 'swamp', 'mountain', 'forest'].includes(subtypeLower);

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (basicFlag && !tl.includes('basic')) return false;
        if (isBasicLandSubtype && !tl.includes('land')) return false;
        return tl.includes(subtypeLower);
      });
      if (available.length === 0) return true;

      const filter: any = { subtypes: [subtypeLower] };
      if (isBasicLandSubtype) filter.types = ['land'];
      if (basicFlag) filter.supertypes = ['basic'];

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for ${basicFlag ? 'a basic ' : 'a '}${subtypeRaw} card (reveal, put into hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `${basicFlag ? 'a basic ' : 'a '}${subtypeRaw} card`,
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

    case "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(rawType);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for a ${m[1]} (reveal, put into hand)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a ${m[1]} card`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter: { types: [rawType] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE": {
      const m = text.match(
        /^search your library for up to one (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i
      );
      if (!m) return false;

      const rawType = String(m[1] || '').toLowerCase();

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(rawType);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search for up to one ${m[1]} (reveal, put into hand)`,
        mandatory: false,
        sourceName,
        searchCriteria: `up to one ${m[1]} card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'hand',
        reveal: true,
        shuffleAfter: true,
        filter: { types: [rawType] },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST": {
      const m = text.match(
        /^search your library for an instant or sorcery card that shares a color with this planeswalker, exile that card(?:,|\.)\s*then shuffle\.?\s*you may cast that card without paying its mana cost\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const pwColors = new Set(getSourcePlaneswalkerColors(ctx, controller, sourceName, triggerItem));
      if (pwColors.size === 0) return false;

      const sharesColor = (card: any): boolean => {
        const raw = card?.colors ?? card?.color_identity;
        const colors = Array.isArray(raw) ? raw.map((c: any) => String(c || '').toUpperCase()) : [];
        return colors.some((c: string) => pwColors.has(c));
      };

      const available = lib.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        const isInstantOrSorcery = tl.includes('instant') || tl.includes('sorcery');
        if (!isInstantOrSorcery) return false;
        return sharesColor(c);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Search your library (instant/sorcery sharing a color), exile it`,
        mandatory: true,
        sourceName,
        searchCriteria: `an instant or sorcery card that shares a color with ${sourceName}`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'exile',
        reveal: false,
        shuffleAfter: true,
        filter: { types: ['instant', 'sorcery'] },
        availableCards: available.map(toAvailableCard),
        followUpMayCastSelectedFromExileWithoutPayingManaCost: true,
        followUpMayCastDeclineDestination: 'exile',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_SACRIFICE_A_CREATURE_WHEN_YOU_DO_DESTROY_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^you may sacrifice a creature\.? when you do, destroy target creature or planeswalker\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const creatures = battlefield.filter((perm: any) => {
        if (perm?.controller !== controller) return false;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        return tl.includes('creature');
      });

      if (creatures.length === 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no creatures to sacrifice)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.UPKEEP_SACRIFICE,
        playerId: controller as any,
        description: `${sourceName}: You may sacrifice a creature`,
        mandatory: false,
        sourceName,
        allowSourceSacrifice: false,
        hasCreatures: true,
        afterSacrificeFollowupTargetSelection: true,
        afterSacrificeFollowupDescription: `${sourceName}: Destroy target creature or planeswalker`,
        afterSacrificeFollowupAction: 'destroy_target_creature_or_planeswalker',
        afterSacrificeFollowupTargetTypes: ['creature', 'planeswalker'],
        afterSacrificeFollowupTargetDescription: 'target creature or planeswalker',
        creatures: creatures.map((perm: any) => ({
          id: perm.id,
          name: perm.card?.name || 'Creature',
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          power: perm.card?.power || perm.basePower,
          toughness: perm.card?.toughness || perm.baseToughness,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "SCRY_N": {
      const m = text.match(/^scry (\d+)\.?$/i);
      if (!m) return false;

      const actualCount = parseInt(m[1], 10) || 0;
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${actualCount}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: actualCount,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (scry ${actualCount})`);
      return true;
    }

    case "SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^scry (\d+)\.?\s*(?:[a-z0-9 ,'-]+|it) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;
      const dmg = parseCountTokenWord(m[2]);
      if (scryN <= 0) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        scryFollowupChoice: true,
        scryFollowupKind: 'damage_each_opponent',
        scryFollowupController: controller,
        scryFollowupAmount: dmg,
        scryFollowupSourceName: sourceName,
        scryFollowupSourcePermanentId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, dmg ${dmg})`);
      return true;
    }

    case "SCRY_N_THEN_DRAW_A_CARD": {
      const m = text.match(/^scry (\d+),? then draw a card\.?$/i);
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        scryFollowupChoice: true,
        scryFollowupKind: 'draw_cards',
        scryFollowupController: controller,
        scryFollowupAmount: 1,
        scryFollowupSourceName: sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, draw 1)`);
      return true;
    }

    case "SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD": {
      const m = text.match(/^scry (\d+)\. if you control an artifact, draw a card\.?$/i);
      if (!m) return false;

      const scryN = parseInt(m[1], 10) || 0;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `${sourceName}: Scry ${scryN}`,
        mandatory: true,
        sourceName: sourceName,
        scryCount: scryN,
        scryFollowupChoice: true,
        scryFollowupKind: 'draw_cards',
        scryFollowupController: controller,
        scryFollowupAmount: 1,
        scryFollowupSourceName: sourceName,
        scryFollowupCondition: 'controller_controls_artifact',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued scry ${scryN}, conditional draw)`);
      return true;
    }

    case "EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE": {
      const m = text.match(
        /^each opponent discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const discardN = parseCountTokenWord(m[1]);
      const loseLifeN = parseCountTokenWord(m[2]);

      const opponents = getOpponents(ctx, controller);
      if (!opponents.length) return true;

      // Apply life loss immediately (approximation of simultaneous resolution).
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -loseLifeN);
      }

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (life only; no queue)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      for (const opp of opponents) {
        const hand: any[] = zones[opp]?.hand || [];
        const actualDiscard = Math.max(0, Math.min(discardN, hand.length));
        if (actualDiscard <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: opp,
          description: `${sourceName}: Discard ${actualDiscard} card(s)`,
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
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD": {
      const m = text.match(/^each opponent discards a card and you draw a card\.?$/i);
      if (!m) return false;

      // Approximate: draw immediately; queue opponent discards.
      drawCardsFromZone(ctx, controller, 1);

      const opponents = getOpponents(ctx, controller);
      if (!opponents.length) return true;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw only; no queue)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      for (const opp of opponents) {
        const hand: any[] = zones[opp]?.hand || [];
        if (hand.length <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DISCARD_SELECTION,
          playerId: opp,
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

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD": {
      const m = text.match(/^each opponent loses life equal to the number of cards in their graveyard\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        const gyCount = zones[opp]?.graveyardCount ?? zones[opp]?.graveyard?.length ?? 0;
        const lose = Math.max(0, gyCount | 0);
        if (lose > 0) modifyLifeLikeStack(ctx, opp, -lose);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL": {
      const m = text.match(/^target opponent loses life equal to the number of artifacts you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;
      if (targetId === controller) return false;
      const player = getPlayerById(ctx, targetId as any);
      if (!player) return false;

      const battlefield = getBattlefield(ctx);
      let artifactCount = 0;
      for (const p of battlefield) {
        if (p?.controller !== controller) continue;
        const tl = String(p?.card?.type_line || '').toLowerCase();
        if (tl.includes('artifact')) artifactCount++;
      }

      if (artifactCount > 0) modifyLifeLikeStack(ctx, targetId as any, -artifactCount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${artifactCount})`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE": {
      const m = text.match(
        /^each opponent loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i
      );
      if (!m) return false;

      const loseN = parseCountTokenWord(m[1]);
      const gainN = parseCountTokenWord(m[2]);

      const opponents = getOpponents(ctx, controller);
      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -loseN);
      }
      modifyLifeLikeStack(ctx, controller, gainN);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opp lose ${loseN}, you gain ${gainN})`);
      return true;
    }

    case "YOU_GET_EMBLEM": {
      const m = text.match(/^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid("emblem"),
        controller,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(
        /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\. you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i
      );
      if (!m) return false;

      const drawN = parseCountTokenWord(m[1]);
      if (drawN > 0) drawCardsFromZone(ctx, controller, drawN);

      const effect = String(m[2] || '').trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller,
        sourceName,
        effect,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (draw ${drawN})`);
      return true;
    }

    case "TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^target player gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller: targetPlayerId as any,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^target opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;
      if (targetPlayerId === controller) return false;

      const effect = m[1].trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller: targetPlayerId as any,
        sourceName,
        effect,
      });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT": {
      const m = text.match(/^each opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i);
      if (!m) return false;

      const effect = String(m[1] || '').trim();
      state.emblems = state.emblems || [];

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = p?.id;
        if (!pid) continue;
        if (pid === controller) continue;
        state.emblems.push({
          id: uid('emblem'),
          controller: pid,
          sourceName,
          effect,
        });
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC": {
      const m = text.match(
        /^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?\s*then create (a|an|one|two|three|four|five|\d+) (tapped )?(\d+)\/(\d+) ([^\.]+?) tokens?(?: with ([\s\S]+?))?\.?$/i
      );
      if (!m) return false;

      const effect = String(m[1] || '').trim();
      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid('emblem'),
        controller,
        sourceName,
        effect,
      });

      const count = parseCountTokenWord(m[2]);
      const isTapped = !!m[3];
      const power = parseInt(m[4], 10);
      const toughness = parseInt(m[5], 10);
      const descriptor = `${String(m[6] || '').trim()}${m[7] ? ` with ${String(m[7]).trim()}` : ''}`;
      const { name, colors, abilities } = parseCreateTokenDescriptor(descriptor);

      const createdIds = createToken(ctx, controller, name, count, power, toughness, {
        colors,
        abilities,
      });

      if (isTapped) {
        const battlefield = getBattlefield(ctx);
        for (const id of createdIds) {
          const perm = battlefield.find((p: any) => p?.id === id);
          if (perm) perm.tapped = true;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (emblem + ${count} token(s))`);
      return true;
    }

    case "CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_MANUAL": {
      const gameId = getGameId(ctx);
      const sourceId = String((triggerItem as any)?.source || "");
      const description = `[Manual planeswalker resolution] ${sourceName}: ${text}`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown') {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceId,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        });
      }

      return true;
    }

    case "PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND": {
      const m = text.match(/^put a card you own with a silver counter on it from exile into your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[controller]?.exile) ? zones[controller].exile : [];

      const available = exile.filter((c: any) => (c as any)?.silverCounters && Number((c as any).silverCounters) > 0);
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Choose a card you own with a silver counter on it (from exile)`,
        mandatory: true,
        sourceName,
        searchCriteria: `a card you own with a silver counter on it`,
        minSelections: 1,
        maxSelections: 1,
        destination: 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'exile',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD": {
      const m = text.match(
        /^you may put a ([a-z][a-z-]*) creature card with mana value (\d+) or less from your hand onto the battlefield\.?$/i
      );
      if (!m) return false;

      const subtype = String(m[1] || '').toLowerCase();
      const maxMv = parseInt(m[2], 10);
      if (!subtype || !Number.isFinite(maxMv)) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      if (hand.length === 0) return true;

      const available = hand.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        if (!tl.includes(subtype)) return false;
        const cmc = typeof c?.cmc === 'number' ? c.cmc : Number(c?.cmc ?? NaN);
        if (!Number.isFinite(cmc)) return false;
        return cmc <= maxMv;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a ${m[1]} creature (mana value ${maxMv} or less) from your hand onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${m[1]} creature card with mana value ${maxMv} or less`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'hand',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put a ([a-z][a-z-]*) creature card from your hand onto the battlefield\.?$/i);
      if (!m) return false;

      const adjective = String(m[1] || '').toLowerCase();
      if (!adjective) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      if (hand.length === 0) return true;

      const colorWords = new Set(['white', 'blue', 'black', 'red', 'green']);
      const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const isColor = colorWords.has(adjective);
      const colorSymbol = isColor ? colorMap[adjective] : null;

      const available = hand.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        if (isColor) {
          const colorsRaw: unknown = c?.colors ?? c?.color_identity;
          const colors = Array.isArray(colorsRaw) ? colorsRaw.map((x) => String(x || '').toUpperCase()) : [];
          return !!colorSymbol && colors.includes(colorSymbol);
        }
        return tl.includes(adjective);
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a ${m[1]} creature from your hand onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${m[1]} creature card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZone: 'hand',
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }
    default:
      return undefined;
  }
}
