// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateHandPutPumpControl.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD .. GAIN_CONTROL_OF_TARGET_ARTIFACT
// Public entry symbols: tryLoyaltyTemplateHandPutPumpControl
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, getGameId, modifyLifeLikeStack, parseCountTokenWord } from "../utils.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { toAvailableCard, isCreatureOfSubtype } from "./loyaltyTemplateRuntimeHelpers.js";
import { syncPreparedPermanentAfterControlChange } from "../../../modules/prepared.js";

export function tryLoyaltyTemplateHandPutPumpControl(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put an artifact card from your hand or graveyard onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('artifact');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put an artifact card from your hand or graveyard onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `an artifact card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD": {
      const m = text.match(/^you may put an equipment card from your hand or graveyard onto the battlefield\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('equipment');
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put an Equipment card from your hand or graveyard onto the battlefield`,
        mandatory: false,
        sourceName,
        searchCriteria: `an Equipment card`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS": {
      const m = text.match(
        /^you may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two \+1\/\+1 counters on it\.?$/i
      );
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying) return false;

      const battlefield = getBattlefield(ctx);
      const landsYouControl = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes('land');
      }).length;

      const zones = (state as any)?.zones || {};
      const hand: any[] = Array.isArray(zones?.[controller]?.hand) ? zones[controller].hand : [];
      const graveyard: any[] = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
      const combined = [...hand, ...graveyard];
      if (combined.length === 0) return true;

      const available = combined.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        const mvRaw = (c as any)?.cmc;
        const mv = typeof mvRaw === 'number' ? mvRaw : parseFloat(String(mvRaw));
        if (!Number.isFinite(mv)) return false;
        return mv <= landsYouControl;
      });
      if (available.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: You may put a creature card with MV ≤ ${landsYouControl} from your hand or graveyard onto the battlefield with two +1/+1 counters on it`,
        mandatory: false,
        sourceName,
        searchCriteria: `a creature card with mana value ${landsYouControl} or less`,
        minSelections: 0,
        maxSelections: 1,
        destination: 'battlefield',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'none',
        searchZones: ['hand', 'graveyard'],
        addCounters: { p1p1: 2 },
        availableCards: available.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL": {
      const m = text.match(/^you gain (\d+) life for each ([a-z][a-z-]*) you control\.?$/i);
      if (!m) return false;

      const lifePer = parseInt(m[1], 10);
      const subtype = String(m[2] || '').toLowerCase();
      if (!Number.isFinite(lifePer) || lifePer <= 0 || !subtype) return false;

      const battlefield = getBattlefield(ctx);
      let count = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes(subtype)) continue;
        count += 1;
      }

      if (count > 0) {
        modifyLifeLikeStack(ctx, controller, lifePer * count);
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (count=${count})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain haste(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes("Haste")) (perm as any).grantedAbilities.push("Haste");

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Haste')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Haste');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain trample(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes("Trample")) (perm as any).grantedAbilities.push("Trample");

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Trample')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Trample');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^until your next turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain lifelink\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      const stateAny = ctx.state as any;

      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;

        ;(perm as any).untilNextTurnPtMods = Array.isArray((perm as any).untilNextTurnPtMods)
          ? (perm as any).untilNextTurnPtMods
          : [];
        ;(perm as any).untilNextTurnPtMods.push({
          power: powerMod,
          toughness: toughnessMod,
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: 'pt_mod',
        });

        ;(perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Lifelink')) (perm as any).grantedAbilities.push('Lifelink');

        ;(perm as any).untilNextTurnGrants = Array.isArray((perm as any).untilNextTurnGrants)
          ? (perm as any).untilNextTurnGrants
          : [];
        ;(perm as any).untilNextTurnGrants.push({
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          grantedAbilities: ['Lifelink'],
          sourceName,
          kind: 'gain_lifelink',
        });

        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+) and gain flying(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

        (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        if (!(perm as any).grantedAbilities.includes('Flying')) (perm as any).grantedAbilities.push('Flying');

        (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn && typeof (perm as any).untilEndOfTurn === 'object' ? (perm as any).untilEndOfTurn : {};
        ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray(((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];
        if (!((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
          ((perm as any).untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
        }

        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_EOT": {
      const m = text.match(/^(?:until end of turn, )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: until end of turn)?\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT": {
      const m = text.match(/^creatures you control with flying get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;

        const typeLine = String(perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
        const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
        const hasFlying = oracleTextLower.includes('flying') || granted.some((a: any) => String(a).toLowerCase().includes('flying'));
        if (!hasFlying) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }

      if (affected > 0) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "SUBTYPE_YOU_CONTROL_GET_PT_EOT": {
      const m = text.match(/^([a-z]+)s you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const subtype = String(m[1] || "").toLowerCase();
      const powerMod = parseInt(m[2], 10);
      const toughnessMod = parseInt(m[3], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        if (!isCreatureOfSubtype(perm, subtype)) continue;

        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${subtype}, affected ${affected})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_PERMANENTS": {
      const m = text.match(/^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target permanents?\.?$/i);
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      for (const id of targets) {
        const p = battlefield.find((x: any) => x?.id === id);
        if (!p) continue;
        p.tapped = false;
      }
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${targets.length})`);
      return true;
    }

    case "UNTAP_TWO_TARGET_LANDS": {
      const m = text.match(/^untap two target lands\.?$/i);
      if (!m) return false;

      const targets = getTargets(triggerItem).slice(0, 2);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const p = battlefield.find((x: any) => x?.id === id);
        if (!p?.card) continue;
        const tl = String(p.card?.type_line || "").toLowerCase();
        if (!tl.includes("land")) continue;
        p.tapped = false;
        untapped++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE": {
      const isUpToTwoNonland =
        /^tap up to two target nonland permanents?\. they don't untap during their controller's next untap step\.?$/i.test(text);
      const maxTargets = isUpToTwoNonland ? 2 : 1;
      const requireNonland = isUpToTwoNonland;

      const targets = getTargets(triggerItem).slice(0, maxTargets);
      if (!targets.length) return false;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const targetPermanentId of targets) {
        const p = battlefield.find((x: any) => x?.id === targetPermanentId);
        if (!p?.card) continue;

        if (requireNonland) {
          const typeLineLower = String(p.card?.type_line || "").toLowerCase();
          if (typeLineLower.includes("land")) continue;
        }

        p.tapped = true;
        (p as any).doesntUntapNextTurn = true;
        affected++;
      }

      if (affected === 0) return false;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS": {
      const m = text.match(/^tap target creature\. put two stun counters on it\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return false;

      perm.tapped = true;
      perm.counters = perm.counters && typeof perm.counters === "object" ? perm.counters : {};
      perm.counters.stun = (perm.counters.stun || 0) + 2;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT": {
      const m = text.match(/^tap target permanent, then untap another target permanent\.?$/i);
      if (!m) return false;

      const [tapId, untapId] = getTargets(triggerItem);
      if (!tapId || !untapId) return false;

      const battlefield = getBattlefield(ctx);
      const tapPerm = battlefield.find((x: any) => x?.id === tapId);
      const untapPerm = battlefield.find((x: any) => x?.id === untapId);
      if (!tapPerm || !untapPerm) return false;

      tapPerm.tapped = true;
      untapPerm.tapped = false;
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^until your next turn, you may cast sorcery spells as though they had flash\.?$/i);
      if (!m) return false;

      const stateAny = ctx.state as any;
      stateAny.untilNextTurnPlayerGrants = Array.isArray(stateAny.untilNextTurnPlayerGrants) ? stateAny.untilNextTurnPlayerGrants : [];
      stateAny.untilNextTurnPlayerGrants.push({
        kind: "cast_sorceries_as_though_flash",
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(
        /^until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      // Best-effort legality check: must be controlled by an opponent.
      if (target.controller === controller) {
        return true;
      }

      const stateAny = ctx.state as any;
      const grantText = "Prevent all damage to and dealt by this permanent (until your next turn)";

      (target as any).grantedAbilities = Array.isArray((target as any).grantedAbilities) ? (target as any).grantedAbilities : [];
      if (!(target as any).grantedAbilities.includes(grantText)) {
        (target as any).grantedAbilities.push(grantText);
      }

      (target as any).untilNextTurnGrants = Array.isArray((target as any).untilNextTurnGrants) ? (target as any).untilNextTurnGrants : [];
      (target as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [grantText],
        sourceName,
        kind: "prevent_all_damage_to_and_from",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT": {
      const m = text.match(/^until your next turn, up to one target creature gets ([+-]\d+)\/([+-]\d+)\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: powerMod,
        toughness: toughnessMod,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN": {
      const m = text.match(/^up to one target creature gets ([+-]\d+)\/([+-]\d+) until your next turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true; // up to one

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: powerMod,
        toughness: toughnessMod,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED": {
      const m = text.match(
        /^until your next turn, up to one target creature gets -3\/-0 and its activated abilities can't be activated\.?$/i
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
      ;(target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      ;(target as any).untilNextTurnPtMods.push({
        power: -3,
        toughness: 0,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      ;(target as any).untilNextTurnCantActivateAbilities = Array.isArray((target as any).untilNextTurnCantActivateAbilities)
        ? (target as any).untilNextTurnCantActivateAbilities
        : [];
      ;(target as any).untilNextTurnCantActivateAbilities.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "cant_activate_abilities",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES": {
      const m = text.match(
        /^until your next turn, up to two target creatures each have base power and toughness 0\/3 and lose all abilities\.?$/i
      );
      if (!m) return false;

      const targetIds = getTargets(triggerItem).slice(0, 2);
      if (targetIds.length === 0) return true;

      const battlefield = getBattlefield(ctx);
      const stateAny = ctx.state as any;

      for (const targetPermanentId of targetIds) {
        const target = battlefield.find((x: any) => x?.id === targetPermanentId);
        if (!target) continue;

        const typeLine = String(target?.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        // Represent set-base-P/T by a base override that expires at the start of our next turn.
        ;(target as any).untilNextTurnBasePtOverrides = Array.isArray((target as any).untilNextTurnBasePtOverrides)
          ? (target as any).untilNextTurnBasePtOverrides
          : [];
        ;(target as any).untilNextTurnBasePtOverrides.push({
          power: 0,
          toughness: 3,
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: "base_pt_override",
        });

        // Mark that this permanent's abilities are suppressed (best-effort) until our next turn.
        ;(target as any).untilNextTurnLoseAllAbilities = Array.isArray((target as any).untilNextTurnLoseAllAbilities)
          ? (target as any).untilNextTurnLoseAllAbilities
          : [];
        ;(target as any).untilNextTurnLoseAllAbilities.push({
          controllerId: controller,
          turnApplied: stateAny.turnNumber || 0,
          sourceName,
          kind: "lose_all_abilities",
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES": {
      const m = text.match(
        /^target creature becomes a treasure artifact with\s+"?\{t\},\s*sacrifice this artifact:\s*add one mana of any color"?\s+and loses all other card types and abilities\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target?.card) return false;

      const typeLineLower = String(target.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('creature')) return true;

      const treasureOracle = '{T}, Sacrifice this artifact: Add one mana of any color.';

      // Best-effort: overwrite the permanent's card characteristics to behave like a Treasure.
      // This is intentionally simple (no layer system); it matches the template and enables existing Treasure support.
      (target as any).card = {
        ...(target as any).card,
        type_line: 'Artifact — Treasure',
        oracle_text: treasureOracle,
        colors: [],
      };

      // Clear cached creature stats/abilities (best-effort).
      delete (target as any).basePower;
      delete (target as any).baseToughness;
      (target as any).grantedAbilities = [];
      (target as any).keywords = [];

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (treasureify ${targetPermanentId})`);
      return true;
    }

    case "TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3": {
      const m = text.match(
        /^target (?:artifact or creature|artifact|creature) loses all abilities and becomes a green elk creature with base power and toughness 3\/3\.?$/i
      );
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target?.card) return false;

      const typeLineLower = String(target.card?.type_line || '').toLowerCase();
      if (!(typeLineLower.includes('artifact') || typeLineLower.includes('creature'))) return true;

      // Best-effort: overwrite characteristics.
      (target as any).card = {
        ...(target as any).card,
        type_line: 'Creature — Elk',
        oracle_text: '',
        colors: ['G'],
        power: '3',
        toughness: '3',
      };
      (target as any).basePower = 3;
      (target as any).baseToughness = 3;
      (target as any).grantedAbilities = [];
      (target as any).keywords = [];

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (elkify ${targetPermanentId})`);
      return true;
    }

    case "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING": {
      const m = text.match(/^until your next turn, up to one target creature gets -2\/-0 and loses flying\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;
      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const stateAny = ctx.state as any;

      // P/T mod until next turn
      (target as any).untilNextTurnPtMods = Array.isArray((target as any).untilNextTurnPtMods)
        ? (target as any).untilNextTurnPtMods
        : [];
      (target as any).untilNextTurnPtMods.push({
        power: -2,
        toughness: 0,
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        sourceName,
        kind: "pt_mod",
      });

      // Keyword removal marker until next turn
      const grantText = "This creature loses flying (until your next turn)";
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
        kind: "keyword_loss",
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_CREATURE": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) return true;

      const previousController = String(target.controller || '');
      target.controller = controller;
      syncPreparedPermanentAfterControlChange(ctx.state, target, previousController);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "GAIN_CONTROL_OF_TARGET_ARTIFACT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const typeLine = String(target?.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("artifact")) return true;

      const previousController = String(target.controller || '');
      target.controller = controller;
      syncPreparedPermanentAfterControlChange(ctx.state, target, previousController);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }
    default:
      return undefined;
  }
}
