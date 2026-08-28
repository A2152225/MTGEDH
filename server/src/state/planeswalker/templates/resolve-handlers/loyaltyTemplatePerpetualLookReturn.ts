// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplatePerpetualLookReturn.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS .. DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD
// Public entry symbols: tryLoyaltyTemplatePerpetualLookReturn
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { getGameId, getBattlefield, getTargets, parseCountTokenWord } from "../utils.js";
import { toAvailableCard, isCreatureOfSubtype } from "./loyaltyTemplateRuntimeHelpers.js";
import { drawCards as drawCardsFromZone, movePermanentToHand } from "../../../modules/zones.js";
import { updateCounters } from "../../../modules/counters_tokens.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../../../modules/durable-permissions.js";

export function tryLoyaltyTemplatePerpetualLookReturn(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS": {
      const m = text.match(
        /^choose a creature card in your hand\. it perpetually gets \+1\/\+1 and perpetually gains "this spell costs \{1\} less to cast\."\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Choose a creature card in your hand. It perpetually gets +1/+1 and costs {1} less to cast.`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "TYPED_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X":
    case "DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X": {
      const m = text.match(
        /^([a-z][a-z-]*) cards in your hand perpetually gain "this spell costs \{1\} less to cast," and "you may pay \{x\} rather than pay this spell(?:'|’)s mana cost, where x is its mana value\."\.?$/i
      );
      if (!m) return false;

      const typeTitle = String(m[1] || "Dragon").replace(/[a-z]+/gi, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: ${typeTitle} cards in your hand gain perpetual cost modifications (Arena-only).`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER": {
      const m = text.match(
        /^up to one target creature(?:'|’)s base power perpetually becomes equal to its toughness\. it perpetually gains "this creature can attack as though it didn(?:'|’)t have defender\."\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      const description = `[Manual resolution] ${sourceName}: Up to one target creature gets perpetual base power/toughness and attack permission changes (Arena-only).`;

      debug(1, `[planeswalker/templates] ${description}`);

      if (gameId && gameId !== 'unknown' && !isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          sourceName,
          description,
          mandatory: false,
          options: [{ id: 'ack', label: 'Acknowledge' }],
          minSelections: 0,
          maxSelections: 1,
        } as any);
      }

      return true;
    }

    case "WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT": {
      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;

      // Stackable: multiple effects can exist in a turn.
      const existingTurn = stateAny.pendingAttackP1P1CounterThisTurnTurnApplied;
      if (typeof existingTurn !== "number" || existingTurn !== turnApplied) {
        stateAny.pendingAttackP1P1CounterThisTurn = 0;
      }

      stateAny.pendingAttackP1P1CounterThisTurn = (stateAny.pendingAttackP1P1CounterThisTurn || 0) + 1;
      stateAny.pendingAttackP1P1CounterThisTurnTurnApplied = turnApplied;

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${stateAny.pendingAttackP1P1CounterThisTurn})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE": {
      const battlefield = getBattlefield(ctx);
      const sourcePermanentId = String((triggerItem as any)?.source || "");
      const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
      if (!sourcePerm) return false;

      const typeLine = String(sourcePerm?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("planeswalker")) return false;

      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;

      (sourcePerm as any).untilNextTurnGrants = Array.isArray((sourcePerm as any).untilNextTurnGrants)
        ? (sourcePerm as any).untilNextTurnGrants
        : [];

      (sourcePerm as any).untilNextTurnGrants.push({
        kind: "vraska_destroy_creature_that_dealt_combat_damage",
        controllerId: controller,
        turnApplied,
        sourceName,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_AN_OPPONENT_CONTROLS_ATTACKS_IT_GETS_MINUS1_MINUS0_UNTIL_END_OF_TURN": {
      const m = text.match(
        /^until your next turn, whenever a creature an opponent controls attacks, it gets -1\/-0 until end of turn\.?$/i
      );
      if (!m) return false;

      const stateAny = state as any;
      stateAny.untilNextTurnPlayerGrants = Array.isArray(stateAny.untilNextTurnPlayerGrants) ? stateAny.untilNextTurnPlayerGrants : [];
      stateAny.untilNextTurnPlayerGrants.push({
        kind: "opponents_attackers_get_minus1_minus0_eot",
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        powerMod: -1,
        toughnessMod: 0,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "THE_NEXT_SPELL_YOU_CAST_THIS_TURN_HAS_AFFINITY_FOR_ARTIFACTS": {
      const m = text.match(/^the next spell you cast this turn has affinity for artifacts\./i);
      if (!m) return false;

      const stateAny = state as any;
      const turnApplied = stateAny.turnNumber || 0;
      stateAny.delayedAffinityForArtifactsNextCast = Array.isArray(stateAny.delayedAffinityForArtifactsNextCast)
        ? stateAny.delayedAffinityForArtifactsNextCast
        : [];

      stateAny.delayedAffinityForArtifactsNextCast.push({
        kind: "affinity_for_artifacts",
        controllerId: controller,
        turnApplied,
        sourceName,
        used: false,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_TYPED_P1P1":
    case "TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1": {
      const m = text.match(
        /^target creature you control gains deathtouch and lifelink until end of turn\.\s*if it(?:'|’)s an? ([a-z][a-z-]*), put a \+1\/\+1 counter on it\.?$/i
      );
      if (!m) return false;
      const subtype = String(m[1] || "vampire").toLowerCase();

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;
      if (perm.controller !== controller) return false;

      (perm as any).temporaryAbilities = (perm as any).temporaryAbilities || [];
      (perm as any).temporaryAbilities.push({
        ability: "deathtouch",
        source: sourceName,
        expiresAt: "end_of_turn",
        turnApplied: state.turnNumber || 0,
      });
      (perm as any).temporaryAbilities.push({
        ability: "lifelink",
        source: sourceName,
        expiresAt: "end_of_turn",
        turnApplied: state.turnNumber || 0,
      });

      if (isCreatureOfSubtype(perm, subtype)) {
        updateCounters(ctx as any, targetId, { "+1/+1": 1 });
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed: any[] = [];
      let foundCreature: any | null = null;

      while (lib.length > 0) {
        const c = lib.shift();
        if (!c) continue;
        const typeLine = String((c as any).type_line || "").toLowerCase();
        if (typeLine.includes("creature")) {
          foundCreature = c;
          break;
        }
        revealed.push(c);
      }

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

      if (foundCreature) {
        (foundCreature as any).zone = "hand";
        z.hand.push(foundCreature);
      }
      z.handCount = z.hand.length;

      // Shuffle the non-creature revealed cards and put them on the bottom.
      if (revealed.length > 1) {
        const rng = (ctx as any).rng;
        for (let i = revealed.length - 1; i > 0; i--) {
          const r = typeof rng === "function" ? rng() : Math.random();
          const j = Math.floor(r * (i + 1));
          [revealed[i], revealed[j]] = [revealed[j], revealed[i]];
        }
      }
      for (const c of revealed) {
        (c as any).zone = "library";
        lib.push(c);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed: any[] = [];
      let foundArtifact: any | null = null;

      while (lib.length > 0) {
        const c = lib.shift();
        if (!c) continue;
        const typeLine = String((c as any).type_line || "").toLowerCase();
        if (typeLine.includes("artifact")) {
          foundArtifact = c;
          break;
        }
        revealed.push(c);
      }

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

      if (foundArtifact) {
        (foundArtifact as any).zone = "hand";
        z.hand.push(foundArtifact);
      }
      z.handCount = z.hand.length;

      // Shuffle the non-artifact revealed cards and put them on the bottom.
      if (revealed.length > 1) {
        const rng = (ctx as any).rng;
        for (let i = revealed.length - 1; i > 0; i--) {
          const r = typeof rng === "function" ? rng() : Math.random();
          const j = Math.floor(r * (i + 1));
          [revealed[i], revealed[j]] = [revealed[j], revealed[i]];
        }
      }
      for (const c of revealed) {
        (c as any).zone = "library";
        lib.push(c);
      }

      (ctx as any).libraries?.set(controller, lib);
      z.libraryCount = lib.length;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*creature cards exiled this way gain "you may cast this card from exile as long as you control a lukka planeswalker\."\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

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

      const stateAny = state as any;
      stateAny.playableFromExile = stateAny.playableFromExile || {};
      const pfe = (stateAny.playableFromExile[controller] = stateAny.playableFromExile[controller] || {});

      const toExileCount = Math.min(n, lib.length);
      for (let i = 0; i < toExileCount; i++) {
        const c = lib.shift();
        if (!c) continue;

        const exiledCard: any = {
          ...(c as any),
          zone: 'exile',
          // Additional gating: only playable while you control a Lukka planeswalker.
          playFromExileRequiresControllerPlaneswalkerNameIncludes: 'lukka',
        };
        z.exile.push(exiledCard);

        const typeLine = String(exiledCard?.type_line || '').toLowerCase();
        const isCreatureCard = typeLine.includes('creature');
        if (isCreatureCard && exiledCard?.id) {
          pfe[String(exiledCard.id)] = true;
          upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
            playerId: controller,
            cardIds: [String(exiledCard.id)],
            action: 'cast',
            duration: 'static',
            turnApplied: Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0,
            sourceName,
            sourceText: text,
            typeLineIncludes: ['creature'],
            condition: {
              type: 'player_controls_permanent_type',
              playerId: controller,
              minCount: 1,
              typeLineIncludes: ['planeswalker'],
              nameIncludes: ['lukka'],
            },
          }));
        }
      }

      z.exileCount = z.exile.length;
      z.libraryCount = lib.length;
      (ctx as any).libraries?.set(controller, lib);
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^exile target creature you control, then reveal cards from the top of your library until you reveal a creature card with greater mana value\.\s*put that card onto the battlefield and the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const candidates = battlefield.filter((p: any) => {
        if (!p) return false;
        if (String(p.controller || '') !== String(controller)) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('creature');
      });
      if (candidates.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller as any,
        description: `${sourceName}: Exile a creature you control` ,
        mandatory: true,
        sourceName,
        validTargets: candidates.map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        })),
        targetTypes: ['creature_you_control'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'a creature you control',
        action: 'pw_lukka_exile_upgrade',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top seven cards of your library\.\s*you may put a permanent card with mana value 3 or less from among them onto the battlefield with a shield counter on it\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, 7);
      if (revealed.length === 0) return true;

      const isPermanent = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return (
          tl.includes('artifact') ||
          tl.includes('creature') ||
          tl.includes('enchantment') ||
          tl.includes('land') ||
          tl.includes('planeswalker') ||
          tl.includes('battle')
        );
      };

      const selectable = revealed.filter((c: any) => {
        if (!isPermanent(c)) return false;
        const mv = Number((c as any)?.cmc);
        return Number.isFinite(mv) && mv <= 3;
      });
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may put a permanent with MV 3 or less onto the battlefield with a shield counter)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 permanent card with mana value 3 or less` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        addCounters: { shield: 1 },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal a noncreature, nonland card from among them and put it into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl) return false;
        return !tl.includes('creature') && !tl.includes('land');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal a noncreature, nonland card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 noncreature, nonland card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal an? enchantment card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('enchantment');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an enchantment card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to 1 enchantment card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.\s*put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.min(n, lib.length));
      if (revealed.length === 0) return true;

      const isSelectable = (c: any): boolean => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('creature') || tl.includes('land');
      };

      const selectable = revealed.filter(isSelectable);
      const nonSelectable = revealed.filter((c: any) => !selectable.includes(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may put any number of creature and/or land cards onto the battlefield)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `any number of creature and/or land cards` ,
        minSelections: 0,
        maxSelections: selectable.length,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD": {
      const m = text.match(/^draw two cards\.\s*then discard two cards unless you discard an artifact card\.?$/i);
      if (!m) return false;

      // Draw happens up-front, then the player chooses how to satisfy the discard.
      drawCardsFromZone(ctx, controller, 2);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drawn; discard choice skipped)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: Choose discard option` ,
        mandatory: true,
        sourceName,
        options: [
          { id: 'discard_artifact', label: 'Discard an artifact card' },
          { id: 'discard_two', label: 'Discard two cards' },
        ],
        minSelections: 1,
        maxSelections: 1,
        chooseDiscardPlanChoice: true,
        chooseDiscardPlanPlayerId: controller,
        chooseDiscardPlanSourceName: sourceName,
        chooseDiscardPlanPreferredOptionId: 'discard_artifact',
        chooseDiscardPlanPreferredType: 'artifact',
        chooseDiscardPlanPreferredCount: 1,
        chooseDiscardPlanFallbackCount: 2,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_PLAYER_SACRIFICES_TWO_CREATURES": {
      const m = text.match(/^each player sacrifices two creatures of their choice\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      for (const p of players) {
        const pid = String(p?.id || '');
        if (!pid) continue;

        const creatures = battlefield.filter((perm: any) => {
          if (!perm) return false;
          if (String(perm.controller || '') !== pid) return false;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          return tl.includes('creature');
        });

        const required = Math.min(2, creatures.length);
        if (required <= 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as any,
          description: `${sourceName}: Choose ${required} creature${required === 1 ? '' : 's'} to sacrifice` ,
          mandatory: true,
          sourceName,
          validTargets: creatures.map((perm: any) => ({
            id: perm.id,
            label: perm.card?.name || 'Creature',
            description: perm.card?.type_line || 'creature',
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })),
          targetTypes: ['creature_you_control'],
          minTargets: required,
          maxTargets: required,
          targetDescription: 'creatures to sacrifice',
          action: 'sacrifice_selected_permanents',
        } as any);
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD": {
      const [targetId] = getTargets(triggerItem);

      // "Up to one" means the player may choose no target; if so, still draw.
      if (targetId) {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        const typeLine = String(perm?.card?.type_line || "").toLowerCase();
        const isValid =
          !!perm &&
          (typeLine.includes("artifact") || typeLine.includes("creature") || typeLine.includes("enchantment"));
        if (!isValid) return false;

        movePermanentToHand(ctx, targetId);
      }

      drawCardsFromZone(ctx, controller, 1);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_CREATURE_TO_OWNERS_HAND": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm || !typeLine.includes("creature")) return false;

      movePermanentToHand(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND": {
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const isAnother = String(text || '').toLowerCase().includes('return another target');
      if (isAnother && sourceId && targetId === sourceId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm) return false;
      if (!typeLine) return false;
      if (typeLine.includes('land')) return false;

      movePermanentToHand(ctx, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND": {
      const m = text.match(
        /^return target nonland permanent to its owner(?:'|’)s hand, then that player exiles a card from their hand\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      const typeLine = String(perm?.card?.type_line || "").toLowerCase();
      if (!perm) return false;
      if (!typeLine) return false;
      if (typeLine.includes('land')) return false;

      const ownerId = String((perm as any).owner || "");

      movePermanentToHand(ctx, targetId);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (returned; exile-from-hand skipped)`);
        return true;
      }

      if (!ownerId) return true;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[ownerId]?.hand || [];
      if (hand.length <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (returned; no cards to exile)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: ownerId as any,
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

    case "RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD": {
      const m = text.match(/^return up to two target land cards from your graveyard to the battlefield\.?$/i);
      if (!m) return false;

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
          return tl.includes('land');
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
        description: `${sourceName}: Choose up to two land cards in your graveyard to return to the battlefield`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 2,
        action: 'move_graveyard_card_to_battlefield',
        fromPlayerId: controller,
        validTargets,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued: choices=${validTargets.length})`);
      return true;
    }

    case "DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD": {
      const m = text.match(
        /^discard a card, then draw a card\. if a land card is discarded this way, draw an additional card\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones[controller]?.hand || [];
      if (hand.length <= 0) {
        // Nothing to discard; still draw 1.
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
        afterDiscardDrawCountIfDiscardedLand: 1,
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
    default:
      return undefined;
  }
}
