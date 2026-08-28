// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateP1P1FightDamage.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT .. DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER
// Public entry symbols: tryLoyaltyTemplateP1P1FightDamage
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, modifyLifeLikeStack, parseCountTokenWord, getGameId } from "../utils.js";
import { destroyPermanents, applyDamageToPermanent, applyDamageToPlayer, getPlayerById, recordCreatureDamagedByCreatureThisTurn, getControlConstraint, getManaValueConstraint, isCreatureOfSubtype, satisfiesManaValueConstraint, exilePermanents } from "./loyaltyTemplateRuntimeHelpers.js";
import { getActualPowerToughness, uid } from "../../../utils.js";
import { updateCounters, movePermanentToExile } from "../../../modules/counters_tokens.js";
import { applyFightDamageBetweenCreatures } from "../../../modules/combat-damage-processing.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { permanentHasCreatureTypeNow } from "../../../creatureTypeNow.js";
import { normalizeCreatureTypeWord } from "../../../../../../shared/src/creatureTypes.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateP1P1FightDamage(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains indestructible until end of turn\.?$/i
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
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("indestructible"))) {
        perm.grantedAbilities.push("Indestructible");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("Indestructible")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("Indestructible");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains first strike until end of turn\.?$/i
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
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes("first strike"))) {
        perm.grantedAbilities.push("First strike");
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === "object" ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes("First strike")) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push("First strike");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT": {
      const m = text.match(
        /^put a \+1\/\+1 counter on up to one target creature\. it gains vigilance until end of turn\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      updateCounters(ctx, targetId, { '+1/+1': 1 });

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: string) => String(a).toLowerCase().includes('vigilance'))) {
        perm.grantedAbilities.push('Vigilance');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Vigilance')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Vigilance');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE": {
      const m = text.match(/^exile target tapped creature\. you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i);
      if (!m) return false;

      const life = parseCountTokenWord(m[1]);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return true;
      if (!perm.tapped) return true;

      movePermanentToExile(ctx, targetId);
      modifyLifeLikeStack(ctx, controller, life);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE": {
      const m = text.match(/^target creature you control fights another target creature\.?$/i);
      if (!m) return false;

      const [aId, bId] = getTargets(triggerItem);
      if (!aId || !bId) return false;

      const battlefield = getBattlefield(ctx);
      const a = battlefield.find((p: any) => p?.id === aId);
      const b = battlefield.find((p: any) => p?.id === bId);
      if (!a || !b) return false;

      if (a.controller !== controller) return true;

      const aTL = String(a?.card?.type_line || "").toLowerCase();
      const bTL = String(b?.card?.type_line || "").toLowerCase();
      if (!aTL.includes("creature") || !bTL.includes("creature")) return true;

      const aPT = getActualPowerToughness(a, (ctx as any).state);
      const bPT = getActualPowerToughness(b, (ctx as any).state);

      // Simultaneous damage (best-effort): each deals damage equal to its power to the other.
      const dmgToB = Math.max(0, aPT.power | 0);
      const dmgToA = Math.max(0, bPT.power | 0);
      recordCreatureDamagedByCreatureThisTurn(ctx, String(aId), String(bId), dmgToB);
      recordCreatureDamagedByCreatureThisTurn(ctx, String(bId), String(aId), dmgToA);
      applyFightDamageBetweenCreatures(ctx, a, dmgToB, b, dmgToA, 'damageMarked');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL": {
      const m = text.match(/^target creature you control fights target creature you don't control\.?$/i);
      if (!m) return false;

      const [aId, bId] = getTargets(triggerItem);
      if (!aId || !bId) return false;

      const battlefield = getBattlefield(ctx);
      const a = battlefield.find((p: any) => p?.id === aId);
      const b = battlefield.find((p: any) => p?.id === bId);
      if (!a || !b) return false;

      if (a.controller !== controller) return true;
      if (b.controller === controller) return true;

      const aTL = String(a?.card?.type_line || "").toLowerCase();
      const bTL = String(b?.card?.type_line || "").toLowerCase();
      if (!aTL.includes("creature") || !bTL.includes("creature")) return true;

      const aPT = getActualPowerToughness(a, (ctx as any).state);
      const bPT = getActualPowerToughness(b, (ctx as any).state);

      const dmgToB = Math.max(0, aPT.power | 0);
      const dmgToA = Math.max(0, bPT.power | 0);
      recordCreatureDamagedByCreatureThisTurn(ctx, String(aId), String(bId), dmgToB);
      recordCreatureDamagedByCreatureThisTurn(ctx, String(bId), String(aId), dmgToA);
      applyFightDamageBetweenCreatures(ctx, a, dmgToB, b, dmgToA, 'damageMarked');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL": {
      const m = text.match(
        /^target ([a-z]+) you control deals damage equal to its power to target creature you don't control\.?$/i
      );
      if (!m) return false;

      const subtypeLower = String(m[1] || "").trim().toLowerCase();

      const [sourceCreatureId, targetCreatureId] = getTargets(triggerItem);
      if (!sourceCreatureId || !targetCreatureId) return false;

      const battlefield = getBattlefield(ctx);
      const source = battlefield.find((p: any) => p?.id === sourceCreatureId);
      const target = battlefield.find((p: any) => p?.id === targetCreatureId);
      if (!source || !target) return false;

      if (source.controller !== controller) return true;
      if (target.controller === controller) return true;

      if (!isCreatureOfSubtype(source, subtypeLower)) return true;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return true;

      const power = getActualPowerToughness(source, (ctx as any).state).power;
      recordCreatureDamagedByCreatureThisTurn(ctx, String(sourceCreatureId), String(targetCreatureId), power);
      applyDamageToPermanent(ctx, targetCreatureId, Math.max(0, power | 0));
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (power=${power})`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL": {
      const m = text.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target ([a-z]+) you control\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const subtype = String(m[2] || "").toLowerCase();

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return true; // up to one

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!p || p.controller !== controller) return false;
      if (!isCreatureOfSubtype(p, subtype)) return false;

      updateCounters(ctx, targetPermanentId, { "+1/+1": n });
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${n} on ${subtype})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PT_EOT": {
      const m = text.match(
        /^(?:until end of turn,?\s*)?(?:up to (?:one|two|three|four|five|\d+) )?target (?:[a-z][a-z-]* )?creatures? gets? ([+-]\d+)\/([+-]\d+)(?: and gains ([^.]+?))?(?:\.|$| until end of turn)$/i
      );
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);
      const gainsRaw = (m[3] || '').trim();
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!p) return false;

      (p as any).ptModsEOT = Array.isArray((p as any).ptModsEOT) ? (p as any).ptModsEOT : [];
      (p as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });

      if (gainsRaw) {
        const gainsLower = gainsRaw.toLowerCase();

        const known: Array<[RegExp, string]> = [
          [/\bflying\b/i, 'Flying'],
          [/\bfirst strike\b/i, 'First strike'],
          [/\bdouble strike\b/i, 'Double strike'],
          [/\bvigilance\b/i, 'Vigilance'],
          [/\blifelink\b/i, 'Lifelink'],
          [/\bdeathtouch\b/i, 'Deathtouch'],
          [/\btrample\b/i, 'Trample'],
          [/\bhaste\b/i, 'Haste'],
          [/\breach\b/i, 'Reach'],
          [/\bmenace\b/i, 'Menace'],
          [/\bhexproof\b/i, 'Hexproof'],
          [/\bindestructible\b/i, 'Indestructible'],
        ];

        const grantedToAdd: string[] = [];
        for (const [rx, label] of known) {
          if (rx.test(gainsLower)) grantedToAdd.push(label);
        }

        if (grantedToAdd.length === 0) {
          grantedToAdd.push(gainsRaw);
        }

        ;(p as any).grantedAbilities = Array.isArray((p as any).grantedAbilities) ? (p as any).grantedAbilities : [];
        p.untilEndOfTurn = p.untilEndOfTurn && typeof p.untilEndOfTurn === 'object' ? p.untilEndOfTurn : {};
        ;(p.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((p.untilEndOfTurn as any).grantedAbilitiesToRemove)
          ? (p.untilEndOfTurn as any).grantedAbilitiesToRemove
          : [];

        for (const abilityText of grantedToAdd) {
          if (!(p as any).grantedAbilities.includes(abilityText)) {
            (p as any).grantedAbilities.push(abilityText);
          }
          if (!(p.untilEndOfTurn as any).grantedAbilitiesToRemove.includes(abilityText)) {
            (p.untilEndOfTurn as any).grantedAbilitiesToRemove.push(abilityText);
          }
        }
      }

      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${powerMod}/${toughnessMod})`);
      return true;
    }

    case "REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM": {
      const m = text.match(
        /^reveal the top card of your library\. if it's a creature or planeswalker card, put it into your hand\. otherwise, you may put it on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      const lib: any[] = Array.isArray(z.library) ? z.library : [];
      if (lib.length === 0) return true;

      const top = lib[0];
      const tl = String(top?.type_line || '').toLowerCase();
      const isCreatureOrPw = tl.includes('creature') || tl.includes('planeswalker');

      if (isCreatureOrPw) {
        drawCardsFromZone(ctx as any, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew top card)`);
        return true;
      }

      // "Otherwise, you may put it on the bottom" — conservative default: do nothing.
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (left top card as-is)`);
      return true;
    }

    case "REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM": {
      const m = text.match(
        /^reveal the top card of your library\. if it(?:'|’)s a creature card, put it into your hand\. otherwise, put it on the bottom of your library\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z =
        zones[controller] ||
        (zones[controller] = {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        } as any);

      z.library = Array.isArray(z.library) ? z.library : [];
      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const top = lib[0];
      const tl = String(top?.type_line || '').toLowerCase();
      const isCreature = tl.includes('creature');

      if (isCreature) {
        drawCardsFromZone(ctx as any, controller, 1);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (drew top card)`);
        return true;
      }

      // Mandatory: put that top card on the bottom of the library.
      const moved = lib.shift();
      if (moved) lib.push(moved);
      z.libraryCount = lib.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (moved top card to bottom)`);
      return true;
    }

    case "REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND": {
      const m = text.match(
        /^reveal the top two cards of your library\. put all land cards from among them onto the battlefield and the rest into your hand\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];

      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const revealCount = Math.min(2, lib.length);
      const revealed = lib.splice(0, revealCount);

      const battlefield = getBattlefield(ctx);
      for (const card of revealed) {
        const tl = String(card?.type_line || '').toLowerCase();
        if (tl.includes('land')) {
          const newPermanent: any = {
            id: uid('perm'),
            card: { ...(card as any), zone: 'battlefield' },
            controller,
            owner: (card as any)?.owner || controller,
            tapped: false,
            summoningSickness: false,
            counters: {},
            attachedTo: undefined,
          };
          battlefield.push(newPermanent);
        } else {
          z.hand.unshift({ ...(card as any), zone: 'hand' });
        }
      }

      z.libraryCount = lib.length;
      z.handCount = z.hand.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD": {
      const m = text.match(
        /^reveal the top four cards of your library\. put all land cards revealed this way into your hand and the rest into your graveyard\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones[controller] || (zones[controller] = { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
      z.library = Array.isArray(z.library) ? z.library : [];
      z.hand = Array.isArray(z.hand) ? z.hand : [];
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      const lib: any[] = z.library;
      if (lib.length === 0) return true;

      const revealCount = Math.min(4, lib.length);
      const revealed = lib.splice(0, revealCount);

      for (const card of revealed) {
        const tl = String(card?.type_line || '').toLowerCase();
        if (tl.includes('land')) {
          z.hand.unshift({ ...(card as any), zone: 'hand' });
        } else {
          z.graveyard.unshift({ ...(card as any), zone: 'graveyard' });
        }
      }

      z.libraryCount = lib.length;
      z.handCount = z.hand.length;
      z.graveyardCount = z.graveyard.length;

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND": {
      const m = text.match(/^return target artifact card from your graveyard to your hand\.?$/i);
      if (!m) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const zones = (state as any)?.zones || {};
      const gy: any[] = zones[controller]?.graveyard || [];
      const artifactCards = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('artifact'));
      if (artifactCards.length === 0) return true;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: controller,
        description: `${sourceName}: Choose an artifact card in your graveyard to return to your hand`,
        mandatory: true,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'move_graveyard_card_to_hand',
        fromPlayerId: controller,
        validTargets: artifactCards.map((c: any) => ({
          id: c.id,
          label: c.name || 'Artifact',
          description: c.type_line || 'artifact card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: controller,
        })),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL": {
      const m = text.match(/^target creature gets \+x\/\+x until end of turn, where x is the number of creatures you control\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes("creature");
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: x, toughness: x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL": {
      const m = text.match(/^target creature gets \+x\/-x until end of turn, where x is the number of artifacts you control\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes("artifact");
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: x, toughness: -x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL":
    case "TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_TYPED_YOU_CONTROL": {
      const m = text.match(/^target creature gets -x\/-x until end of turn, where x is the number of ([a-z]+)s? you control\.?$/i);
      if (!m) return false;
      const subtype = normalizeCreatureTypeWord(String(m[1] || 'zombie')) || String(m[1] || 'zombie').toLowerCase();

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const target = battlefield.find((x: any) => x?.id === targetPermanentId);
      if (!target) return false;

      const targetTL = String(target?.card?.type_line || "").toLowerCase();
      if (!targetTL.includes("creature")) return false;

      const x = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        return permanentHasCreatureTypeNow(p, subtype);
      }).length;

      (target as any).ptModsEOT = Array.isArray((target as any).ptModsEOT) ? (target as any).ptModsEOT : [];
      (target as any).ptModsEOT.push({ power: -x, toughness: -x, sourceName });
      (ctx as any).bumpSeq?.();

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (x=${x})`);
      return true;
    }

    case "DESTROY_TARGET_NONCREATURE_PERMANENT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || typeLine.includes("creature")) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_TAPPED_CREATURE": {
      const m = text.match(/^destroy target tapped creature\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || !typeLine.includes("creature")) return false;

      if (!(p as any).tapped) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || !typeLine.includes("creature")) return false;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && p.controller !== controller) return false;
      if (control === 'not_you' && p.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(p, mv)) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^destroy target creature or planeswalker\.?$/i);
      if (!m) return false;

      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p) return false;
      if (!(typeLine.includes("creature") || typeLine.includes("planeswalker"))) return false;

      destroyPermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_POWER_GE_N": {
      const m = text.match(/^destroy all creatures with power (\d+) or greater\.?$/i);
      if (!m) return false;

      const threshold = parseInt(m[1], 10);
      const battlefield = getBattlefield(ctx);

      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        const pwr = parseInt(String(perm.card?.power ?? perm.basePower ?? 0), 10) || 0;
        if (pwr >= threshold) toDestroy.push(perm.id);
      }

      destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_NON_ZOMBIE_CREATURES":
    case "DESTROY_ALL_NON_DRAGON_CREATURES":
    case "DESTROY_ALL_NON_TYPED_CREATURES": {
      const m = text.match(/^destroy all non-([a-z]+) creatures\.?$/i);
      if (!m) return false;
      const excluded = String(m[1] || 'dragon').toLowerCase();

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        if (tl.includes(excluded)) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_YOU_DONT_CONTROL": {
      const m = text.match(/^destroy all creatures (?:you don't|[a-z0-9 ,'-]+ doesn't) control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) === String(controller)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS": {
      const m = text.match(/^destroy all other permanents except for lands and tokens\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;

      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (sourceId && String(perm.id) === String(sourceId)) continue;
        if ((perm as any).isToken === true) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        toDestroy.push(perm.id);
      }

      if (toDestroy.length > 0) destroyPermanents(ctx, toDestroy);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER": {
      const m = text.match(
        /^destroy all creatures target opponent controls\.?\s*(?:[a-z0-9 ,'-]+|it) deals damage to that player equal to their total power\.?$/i
      );
      if (!m) return false;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const targetPlayer = getPlayerById(ctx, targetPlayerId as any);
      if (!targetPlayer) return false;
      if (String(targetPlayerId) === String(controller)) return false; // effect says opponent

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      let totalPower = 0;

      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (String(perm.controller) !== String(targetPlayerId)) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        toDestroy.push(perm.id);
        const pt = getActualPowerToughness(ctx as any, perm);
        totalPower += Math.max(0, pt.power | 0);
      }

      if (toDestroy.length > 0) {
        destroyPermanents(ctx, toDestroy);
      }
      if (totalPower > 0) {
        applyDamageToPlayer(ctx, targetPlayerId as any, totalPower);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length}, damage ${totalPower})`);
      return true;
    }

    case "EXILE_TARGET_NONLAND_PERMANENT": {
      const [targetPermanentId] = getTargets(triggerItem);
      if (!targetPermanentId) return false;

      const battlefield = getBattlefield(ctx);
      const p = battlefield.find((x: any) => x?.id === targetPermanentId);
      const typeLine = (p?.card?.type_line || "").toLowerCase();
      if (!p || typeLine.includes("land")) return false;

      const lower = text.toLowerCase();
      const control = getControlConstraint(lower);
      if (control === 'you' && p.controller !== controller) return false;
      if (control === 'not_you' && p.controller === controller) return false;

      const mv = getManaValueConstraint(lower);
      if (!satisfiesManaValueConstraint(p, mv)) return false;

      exilePermanents(ctx, [targetPermanentId]);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DEALS_DAMAGE_TO_ANY_TARGET": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to any target\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to player)`);
        return true;
      }

      applyDamageToPermanent(ctx, targetId, amount);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to permanent)`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE": {
      const m = text.match(/^([a-z0-9 ,'-]+) deals (\d+) damage to any target\. you gain \2 life\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
      } else {
        applyDamageToPermanent(ctx, targetId, amount);
      }

      modifyLifeLikeStack(ctx, controller, amount);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} dmg + ${amount} life)`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target player and each creature and planeswalker they control\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const [targetPlayerId] = getTargets(triggerItem);
      if (!targetPlayerId) return false;

      const player = getPlayerById(ctx, targetPlayerId as any);
      if (!player) return false; // effect says target player

      applyDamageToPlayer(ctx, targetPlayerId as any, amount);

      const battlefield = getBattlefield(ctx);
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== targetPlayerId) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature') && !tl.includes('planeswalker')) continue;
        applyDamageToPermanent(ctx, perm.id, amount);
      }

      ;(ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target player or planeswalker\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const player = getPlayerById(ctx, targetId as any);
      if (player) {
        applyDamageToPlayer(ctx, targetId as any, amount);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to player)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return false;
      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes('planeswalker')) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to planeswalker)`);
      return true;
    }
    default:
      return undefined;
  }
}
