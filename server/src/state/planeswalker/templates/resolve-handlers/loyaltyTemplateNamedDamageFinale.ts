// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateNamedDamageFinale.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT .. RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND
// Public entry symbols: tryLoyaltyTemplateNamedDamageFinale
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, modifyLifeLikeStack, getGameId, getPlaneswalkerX, parseCountTokenWord } from "../utils.js";
import { applyDamageToPermanent, applyDamageToPlayer, destroyPermanents, getOpponents, findCreatureOnBattlefieldById, recordCreatureDealtDamageToPlayerThisTurn } from "./loyaltyTemplateRuntimeHelpers.js";
import { createToken, updateCounters } from "../../../modules/counters_tokens.js";
import { recordCardLeftGraveyardThisTurn } from "../../../modules/turn-tracking.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { uid } from "../../../utils.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../../../modules/durable-permissions.js";
import { syncPreparedPermanentAfterControlChange } from "../../../modules/prepared.js";
import { shuffleInPlace } from "./loyaltyTemplateHelpers.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateNamedDamageFinale(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT": {
      const m = text.match(
        /^exile the top card of your library\. you may cast that card\. if you don't, ([a-z0-9 ,'-]+) deals (\d+) damage to each opponent\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] | undefined = (ctx as any).libraries?.get(controller);
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);

      const cardId = String((topCard as any)?.id || uid('c'));

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
        zone: 'exile',
        exiledBy: sourceName,
        canBePlayedBy: controller,
        playableUntilTurn: (state as any).turnNumber ?? 0,
      };
      z.exile.push(exiled);
      z.libraryCount = lib.length;
      if (typeof z.exileCount === 'number') z.exileCount = z.exile.length;

      (state as any).playableFromExile = (state as any).playableFromExile || {};
      const pfe = ((state as any).playableFromExile[controller] = (state as any).playableFromExile[controller] || {});
      pfe[cardId] = (state as any).turnNumber ?? 0;
      upsertDurablePermission(state as any, buildDurablePlayableFromExilePermission({
        playerId: controller,
        cardIds: [cardId],
        action: 'cast',
        duration: 'one_shot',
        turnApplied: Number((state as any).turnNumber ?? 0),
        expiresAtTurn: Number((state as any).turnNumber ?? 0),
        sourceName,
        sourceText: text,
        usageLimit: { type: 'one_shot', maxUses: 1 },
      }));

      const dmg = parseInt(m[2], 10) || 0;
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller as any,
        description: `${sourceName}: You may cast ${topCard?.name || 'that card'}. If you don't, ${sourceName} deals ${dmg} damage to each opponent.`,
        mandatory: false,
        sourceName,
        options: [
          { id: 'cast', label: `Cast ${topCard?.name || 'that card'}` },
          { id: 'decline', label: "Don't cast" },
        ],
        minSelections: 1,
        maxSelections: 1,
        castFromExileCardId: cardId,
        castFromExileCard: exiled,
        castFromExileDeclineDestination: 'exile',
        castFromExileDeclineDamageEachOpponent: dmg,
        castFromExileDeclineDamageSourcePermanentId: triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id,
      } as any);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY": {
      const m = text.match(/^each opponent loses 1 life\.\s*you gain life equal to the life lost this way\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      if (opponents.length === 0) return true;

      for (const opp of opponents) {
        modifyLifeLikeStack(ctx, opp, -1);
      }
      modifyLifeLikeStack(ctx, controller, opponents.length);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY": {
      const m = text.match(
        /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of target opponent's library\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const z = (zones[targetOpponent] = zones[targetOpponent] || {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      z.library = Array.isArray(z.library) ? z.library : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const actual = Math.min(n, z.library.length);
      if (actual <= 0) return true;

      const moved = z.library.splice(0, actual).map((c: any) => ({ ...(c as any), zone: 'exile' }));
      z.exile.unshift(...moved);
      z.libraryCount = z.library.length;
      z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled ${actual})`);
      return true;
    }

    case "DESTROY_TARGET_PLANESWALKER": {
      const m = text.match(/^destroy (?:another )?target planeswalker\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('planeswalker')) return true;

      destroyPermanents(ctx, [String(targetId)]);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_ALL_NON_ZOMBIE_CREATURES": {
      const m = text.match(/^destroy all non-([a-z]+) creatures\.?$/i);
      if (!m) return false;
      const excluded = String(m[1] || 'zombie').toLowerCase();

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card?.type_line) continue;
        const tl = String(perm.card.type_line).toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes(excluded)) continue;
        if (perm.id) toDestroy.push(String(perm.id));
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toDestroy.length} destroyed)`);
      return true;
    }

    case "DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS": {
      const m = text.match(/^destroy all lands target player controls\.?$/i);
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller || '') !== String(targetPlayer)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('land')) continue;
        if (perm.id) toDestroy.push(String(perm.id));
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${toDestroy.length} destroyed)`);
      return true;
    }

    case "EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY": {
      const m = text.match(
        /^exile all cards from target player's library, then that player shuffles their hand into their library\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const z = (zones[targetPlayer] = zones[targetPlayer] || {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      });

      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const exiled = z.library.splice(0, z.library.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));
      z.exile.unshift(...exiled);

      const newLib = z.hand.splice(0, z.hand.length).map((c: any) => ({ ...(c as any), zone: 'library' }));
      shuffleInPlace(newLib, typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random);
      z.library = newLib;

      z.libraryCount = z.library.length;
      z.handCount = z.hand.length;
      z.exileCount = z.exile.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled=${exiled.length})`);
      return true;
    }

    case "EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS": {
      const m = text.match(/^exile all cards from all opponents' hands and graveyards\.?$/i);
      if (!m) return false;

      const zones = (state as any)?.zones || ((state as any).zones = {});
      const opponents = getOpponents(ctx, controller);
      let movedTotal = 0;

      for (const opp of opponents) {
        const z = (zones[opp] = zones[opp] || {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        });

        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.exile = Array.isArray(z.exile) ? z.exile : [];

        const movedHand = z.hand.splice(0, z.hand.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));
        const movedGy = z.graveyard.splice(0, z.graveyard.length).map((c: any) => ({ ...(c as any), zone: 'exile' }));

        if (movedGy.length > 0) {
          // Turn-tracking: cards left this graveyard this turn.
          recordCardLeftGraveyardThisTurn(ctx as any, String(opp), movedGy.find((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')));
          recordCardLeftGraveyardThisTurn(ctx as any, String(opp), movedGy[0]);
        }

        z.exile.unshift(...movedHand, ...movedGy);
        movedTotal += movedHand.length + movedGy.length;

        z.handCount = z.hand.length;
        z.graveyardCount = z.graveyard.length;
        z.exileCount = z.exile.length;
      }

      if (movedTotal > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (exiled=${movedTotal})`);
      return true;
    }

    case "GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS": {
      const m = text.match(/^gain control of all artifacts and creatures target opponent controls\.?$/i);
      if (!m) return false;

      const [targetOpponent] = getTargets(triggerItem);
      if (!targetOpponent) return false;

      const battlefield = getBattlefield(ctx);
      let changed = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller || '') !== String(targetOpponent)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('artifact') && !tl.includes('creature')) continue;
        const previousController = String(perm.controller || '');
        perm.controller = controller;
        syncPreparedPermanentAfterControlChange(ctx.state, perm, previousController);
        changed++;
      }

      if (changed > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (changed=${changed})`);
      return true;
    }

    case "UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL": {
      const m = text.match(/^untap each enchanted permanent you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;

      for (const aura of battlefield) {
        if (!aura?.card) continue;
        const tl = String(aura.card?.type_line || '').toLowerCase();
        if (!tl.includes('enchantment') || !tl.includes('aura')) continue;

        const attachedTo = String((aura as any).attachedTo || '');
        if (!attachedTo) continue;

        const enchanted = battlefield.find((p: any) => p?.id === attachedTo);
        if (!enchanted) continue;
        if (enchanted.controller !== controller) continue;

        if ((enchanted as any).tapped) {
          (enchanted as any).tapped = false;
          untapped++;
        }
      }

      if (untapped > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped=${untapped})`);
      return true;
    }

    case "YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL": {
      const m = text.match(
        /^you gain life equal to the number of creatures you control plus the number of planeswalkers you control\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let creatures = 0;
      let planeswalkers = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('creature')) creatures++;
        if (tl.includes('planeswalker')) planeswalkers++;
      }

      const total = creatures + planeswalkers;
      if (total > 0) {
        modifyLifeLikeStack(ctx, controller, total);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (life=${total})`);
      return true;
    }

    case "SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL": {
      const m = text.match(/^sarkhan deals 1 damage to each opponent and each creature your opponents control\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      const sourcePermanentId = String(triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || '');
      const sourceCreature = findCreatureOnBattlefieldById(ctx, sourcePermanentId);
      for (const opp of opponents) {
        if (sourceCreature) recordCreatureDealtDamageToPlayerThisTurn(ctx, sourceCreature, opp, 1);
        applyDamageToPlayer(ctx, opp, 1);
      }

      const battlefield = getBattlefield(ctx);
      let damaged = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller === controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        applyDamageToPermanent(ctx, String(perm.id), 1);
        damaged++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (creatures=${damaged})`);
      return true;
    }

    case "KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL": {
      const m = text.match(/^koth deals damage to target creature equal to the number of mountains you control\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((p: any) => p?.id === targetId);
      if (!target?.card) return true;
      if (!String(target.card?.type_line || '').toLowerCase().includes('creature')) return true;

      const mountains = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('mountain');
      }).length;

      if (mountains > 0) {
        applyDamageToPermanent(ctx, String(targetId), mountains);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mountains=${mountains})`);
      return true;
    }

    case "NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL": {
      const m = text.match(
        /^nahiri deals damage to target creature or planeswalker equal to twice the number of equipment you control\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const equipmentCount = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('equipment');
      }).length;

      const dmg = Math.max(0, equipmentCount * 2);
      if (dmg > 0) {
        applyDamageToPermanent(ctx, String(targetId), dmg);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (equipment=${equipmentCount})`);
      return true;
    }

    case "NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE": {
      const m = text.match(/^nahiri deals x damage to target tapped creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((p: any) => p?.id === targetId);
      if (!target?.card) return true;

      const tl = String(target.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;
      if (!(target as any).tapped) return true;

      applyDamageToPermanent(ctx, String(targetId), x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE": {
      const m = text.match(/^sorin markov deals 2 damage to any target and you gain 2 life\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));
      if (isPlayer) {
        applyDamageToPlayer(ctx, targetId as any, 2);
      } else {
        applyDamageToPermanent(ctx, String(targetId), 2);
      }

      modifyLifeLikeStack(ctx, controller, 2);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE": {
      const m = text.match(
        /^kaya deals damage to target player equal to the number of cards that player owns in exile and you gain that much life\.?$/i
      );
      if (!m) return false;

      const [targetPlayer] = getTargets(triggerItem);
      if (!targetPlayer) return false;

      const zones = (state as any)?.zones || {};
      const exile: any[] = Array.isArray(zones?.[targetPlayer]?.exile) ? zones[targetPlayer].exile : [];
      const dmg = exile.length;
      if (dmg <= 0) return true;

      applyDamageToPlayer(ctx, targetPlayer as any, dmg);
      modifyLifeLikeStack(ctx, controller, dmg);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (dmg=${dmg})`);
      return true;
    }

    case "NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS": {
      const m = text.match(/^nicol bolas deals 7 damage to each opponent\. you draw seven cards\.?$/i);
      if (!m) return false;

      const opponents = getOpponents(ctx, controller);
      const sourcePermanentId = String(triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || '');
      const sourceCreature = findCreatureOnBattlefieldById(ctx, sourcePermanentId);
      for (const opp of opponents) {
        if (sourceCreature) recordCreatureDealtDamageToPlayerThisTurn(ctx, sourceCreature, opp, 7);
        applyDamageToPlayer(ctx, opp, 7);
      }
      drawCardsFromZone(ctx, controller, 7);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (opponents=${opponents.length})`);
      return true;
    }

    case "NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS": {
      const m = text.match(
        /^nicol bolas deals 7 damage to target opponent, creature an opponent controls, or planeswalker an opponent controls\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));
      if (isPlayer) {
        const sourcePermanentId = String(triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || '');
        const sourceCreature = findCreatureOnBattlefieldById(ctx, sourcePermanentId);
        if (sourceCreature) recordCreatureDealtDamageToPlayerThisTurn(ctx, sourceCreature, targetId as any, 7);
        applyDamageToPlayer(ctx, targetId as any, 7);
      } else {
        applyDamageToPermanent(ctx, String(targetId), 7);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE": {
      const m = text.match(/^chandra deals 3 damage to each non-elemental creature\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes('elemental')) continue;
        applyDamageToPermanent(ctx, String(perm.id), 3);
        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected=${affected})`);
      return true;
    }

    case "CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS": {
      const m = text.match(
        /^chandra(?: nalaar)? deals (\d+) damage to target player or planeswalker and each creature that player or that planeswalker['’]s controller controls\.?$/i
      );
      if (!m) return false;

      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const players: any[] = Array.isArray((state as any).players) ? (state as any).players : [];
      const isPlayer = players.some((p: any) => String(p?.id || '') === String(targetId));

      let affectedController: string | null = null;
      if (isPlayer) {
        affectedController = String(targetId);
        applyDamageToPlayer(ctx, targetId as any, n);
      } else {
        const battlefield = getBattlefield(ctx);
        const perm = battlefield.find((p: any) => p?.id === targetId);
        if (perm) affectedController = String(perm.controller || '');
        applyDamageToPermanent(ctx, String(targetId), n);
      }

      if (affectedController) {
        const battlefield = getBattlefield(ctx);
        for (const perm of battlefield) {
          if (!perm?.card) continue;
          if (String(perm.controller || '') !== affectedController) continue;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (!tl.includes('creature')) continue;
          applyDamageToPermanent(ctx, String(perm.id), n);
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (n=${n})`);
      return true;
    }

    case "CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE": {
      const m = text.match(/^chandra nalaar deals x damage to target creature\.?$/i);
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (!x || x <= 0) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      applyDamageToPermanent(ctx, String(targetId), x);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "YOU_GET_AN_ADVENTURING_PARTY": {
      const m = text.match(/^you get an adventuring party\.(?:\s*\([^)]*\))?\.?$/i);
      if (!m) return false;

      createToken(ctx, controller, 'Fighter', 1, 3, 3, { colors: ['R'], abilities: ['First strike'] });
      createToken(ctx, controller, 'Cleric', 1, 1, 1, { colors: ['W'], abilities: ['Lifelink'] });
      createToken(ctx, controller, 'Rogue', 1, 2, 2, { colors: ['B'], abilities: ['Hexproof'] });
      createToken(ctx, controller, 'Wizard', 1, 1, 1, { colors: ['U'], abilities: ['Flying'] });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "AMASS_ZOMBIES_N": {
      const m = text.match(/^amass zombies (\d+)\.(?:\s*\([^)]*\))?\.?$/i);
      if (!m) return false;

      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n) || n <= 0) return false;

      const battlefield = getBattlefield(ctx);
      const army = battlefield.find((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        return tl.includes('army') && tl.includes('creature');
      });

      let armyId: string | null = null;
      if (army?.id) {
        armyId = String(army.id);
        const tl = String(army.card?.type_line || '');
        if (!tl.toLowerCase().includes('zombie')) {
          (army.card as any).type_line = `${tl} Zombie`;
        }
      } else {
        const [createdId] = createToken(ctx, controller, 'Zombie Army', 1, 0, 0, { colors: ['B'] });
        if (createdId) armyId = String(createdId);
      }

      if (armyId) updateCounters(ctx, armyId, { '+1/+1': n });
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (n=${n})`);
      return true;
    }

    case "DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK": {
      const m = text.match(
        /^destroy up to six target nonland permanents, then create six 2\/2 green cat warrior creature tokens with forestwalk\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const targetIds = getTargets(triggerItem).slice(0, 6);
      const toDestroy: string[] = [];
      for (const id of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        toDestroy.push(String(id));
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      createToken(ctx, controller, 'Cat Warrior', 6, 2, 2, { colors: ['G'], abilities: ['Forestwalk'] });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed=${toDestroy.length})`);
      return true;
    }

    case "PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT": {
      const m = text.match(
        /^put three \+1\/\+1 counters on each creature you control\. those creatures gain trample until end of turn\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        updateCounters(ctx, String(perm.id), { '+1/+1': 3 });

        ;(perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Trample')) (perm as any).grantedAbilities.push('Trample');

        ;(perm as any).untilEndOfTurn =
          (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
        )
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
        }

        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected=${affected})`);
      return true;
    }

    case "ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN": {
      const m = text.match(/^rowan deals 1 damage to each of up to two target creatures\. those creatures can't block this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const targetIds = getTargets(triggerItem).slice(0, 2);

      for (const id of targetIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;

        applyDamageToPermanent(ctx, String(id), 1);

        ;(perm as any).tempAbilities = Array.isArray((perm as any).tempAbilities) ? (perm as any).tempAbilities : [];
        if (!(perm as any).tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't block"))) {
          (perm as any).tempAbilities.push("Can't block");
        }
      }

      if (targetIds.length > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return up to one target creature card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const creatureCards = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature'));
      if (creatureCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose up to one creature card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 0,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: creatureCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Creature',
          description: c.type_line || 'creature card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }
    default:
      return undefined;
  }
}
