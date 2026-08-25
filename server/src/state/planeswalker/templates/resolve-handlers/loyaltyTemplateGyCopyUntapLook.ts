// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateGyCopyUntapLook.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY .. LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM
// Public entry symbols: tryLoyaltyTemplateGyCopyUntapLook
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { getBattlefield, getTargets, parseCountTokenWord, getGameId } from "../utils.js";
import { toAvailableCard, addUnrestrictedManaSymbols, applyDamageToPermanent, applyDamageToPlayer, getPlayerById } from "./loyaltyTemplateRuntimeHelpers.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { createToken } from "../../../modules/counters_tokens.js";
import { recordCardLeftGraveyardThisTurn } from "../../../modules/turn-tracking.js";

export function tryLoyaltyTemplateGyCopyUntapLook(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY": {
      const m = text.match(
        /^exile target nonland permanent card with mana value x from your graveyard\. create a token that['’]s a copy of that card\.?$/i
      );
      if (!m) return false;

      const [targetCardId] = getTargets(triggerItem);
      if (!targetCardId) return false;

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
      z.exile = Array.isArray(z.exile) ? z.exile : [];

      const graveyard: any[] = z.graveyard as any[];
      const idx = graveyard.findIndex((c: any) => String(c?.id) === String(targetCardId));
      if (idx < 0) return true;

      const [card] = graveyard.splice(idx, 1);
      // Turn-tracking for intervening-if templates.
      recordCardLeftGraveyardThisTurn(ctx as any, String(controller), card);
      const tl = String((card as any)?.type_line || '').toLowerCase();
      if (tl.includes('land')) {
        // Put it back; spec says nonland
        graveyard.splice(idx, 0, card);
        return true;
      }
      const isPermanent = tl.includes('artifact') || tl.includes('creature') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('battle');
      if (!isPermanent) {
        graveyard.splice(idx, 0, card);
        return true;
      }

      const exiled = { ...(card as any), zone: 'exile', exiledBy: sourceName, faceDown: false };
      (z.exile as any[]).push(exiled);
      z.graveyardCount = (z.graveyard as any[]).length;
      z.exileCount = (z.exile as any[]).length;

      const isCreature = tl.includes('creature');
      const basePower = isCreature ? parseInt(String((card as any)?.power ?? '0'), 10) : undefined;
      const baseToughness = isCreature ? parseInt(String((card as any)?.toughness ?? '0'), 10) : undefined;

      const colors = Array.isArray((card as any)?.colors)
        ? (card as any).colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];
      const keywords = Array.isArray((card as any)?.keywords)
        ? (card as any).keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
        : [];
      const typeLine = `Token ${String((card as any)?.type_line || '').trim()}`.trim();

      createToken(ctx, controller, String((card as any)?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine,
        abilities: keywords,
        isArtifact: tl.includes('artifact'),
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_TARGET_PERMANENT": {
      const m = text.match(/^untap target permanent\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      perm.tapped = false;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT": {
      const m = text.match(/^untap all creatures you control\. those creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10) || 0;
      const toughnessMod = parseInt(m[2], 10) || 0;

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        perm.tapped = false;
        (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
        (perm as any).ptModsEOT.push({ power: powerMod, toughness: toughnessMod, sourceName });
        affected++;
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT": {
      const m = text.match(
        /^untap target land you control\.\s*you may have it become a 3\/3 elemental creature with haste and menace until end of turn\.\s*it's still a land\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) return true;
      if (perm.controller !== controller) return true;

      // Untap
      perm.tapped = false;

      // Animate until end of turn (track original type line for cleanup)
      const originalTypeLine = String(perm.card?.type_line || 'Land');
      (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn || {};
      const u = (perm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      // P/T until end of turn (lands usually have 0/0 baseline here)
      (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
      (perm as any).ptModsEOT.push({ power: 3, toughness: 3, sourceName });

      // Grant abilities until end of turn
      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      u.grantedAbilitiesToRemove = Array.isArray(u.grantedAbilitiesToRemove) ? u.grantedAbilitiesToRemove : [];

      for (const ability of ['Haste', 'Menace']) {
        if (!perm.grantedAbilities.includes(ability)) perm.grantedAbilities.push(ability);
        if (!u.grantedAbilitiesToRemove.includes(ability)) u.grantedAbilitiesToRemove.push(ability);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT": {
      const m = text.match(
        /^untap target mountain\.\s*it becomes a 4\/4 red elemental creature until end of turn\.\s*it's still a land\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land') || !tl.includes('mountain')) return true;
      if (perm.controller !== controller) return true;

      perm.tapped = false;

      const originalTypeLine = String(perm.card?.type_line || 'Land');
      (perm as any).untilEndOfTurn = (perm as any).untilEndOfTurn || {};
      const u = (perm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      (perm as any).ptModsEOT = Array.isArray((perm as any).ptModsEOT) ? (perm as any).ptModsEOT : [];
      (perm as any).ptModsEOT.push({ power: 4, toughness: 4, sourceName });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE": {
      const m = text.match(/^target land you control becomes a 4\/4 elemental creature with trample\.(?:\s*it's still a land\.)?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) return true;
      if (perm.controller !== controller) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Land');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} Creature`;
      if (!/\bElemental\b/i.test(newTypeLine)) newTypeLine = `${newTypeLine} — Elemental`;
      perm.card.type_line = newTypeLine;

      perm.basePower = 4;
      perm.baseToughness = 4;
      perm.card.power = '4';
      perm.card.toughness = '4';

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.includes('Trample')) perm.grantedAbilities.push('Trample');

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N": {
      const m = text.match(/^target artifact becomes an artifact creature with base power and toughness (\d+)\/(\d+)\.?$/i);
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('artifact')) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Artifact');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) {
        if (newTypeLine.includes('—')) {
          const parts = newTypeLine.split('—');
          const left = (parts[0] || '').trim();
          const right = parts.slice(1).join('—').trim();
          newTypeLine = right.length > 0 ? `${left} Creature — ${right}` : `${left} Creature`;
        } else {
          newTypeLine = `${newTypeLine} Creature`;
        }
      }
      perm.card.type_line = newTypeLine;

      perm.basePower = power;
      perm.baseToughness = toughness;
      perm.card.power = String(power);
      perm.card.toughness = String(toughness);

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power}/${toughness})`);
      return true;
    }

    case "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N": {
      const m = text.match(
        /^target artifact becomes an artifact creature\.\s*if it isn't a vehicle, it has base power and toughness (\d+)\/(\d+)\.?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm?.card) return true;

      const typeLineLower = String(perm.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('artifact')) return true;

      // Permanent animation (no duration specified)
      const originalTypeLine = String(perm.card?.type_line || 'Artifact');
      let newTypeLine = originalTypeLine;
      if (!/\bCreature\b/i.test(newTypeLine)) {
        if (newTypeLine.includes('—')) {
          const parts = newTypeLine.split('—');
          const left = (parts[0] || '').trim();
          const right = parts.slice(1).join('—').trim();
          newTypeLine = right.length > 0 ? `${left} Creature — ${right}` : `${left} Creature`;
        } else {
          newTypeLine = `${newTypeLine} Creature`;
        }
      }
      perm.card.type_line = newTypeLine;

      // Vehicles already have printed P/T; this clause only sets P/T for non-Vehicles.
      if (!typeLineLower.includes('vehicle')) {
        perm.basePower = power;
        perm.baseToughness = toughness;
        perm.card.power = String(power);
        perm.card.toughness = String(toughness);
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${power}/${toughness})`);
      return true;
    }

    case "UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT": {
      const m = text.match(
        /^until end of turn,\s*[a-z0-9 ,'-]+ becomes a (\d+)\/(\d+) ([a-z0-9 ,'-]+) creature(?: with indestructible)? that's still a planeswalker\.\s*prevent all damage that would be dealt to (?:him|her|it) this turn\.(?:\s*\(he can't attack if he was cast this turn\.\))?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      const rawCreatureDescriptor = String(m[3] || '').trim();
      const hasIndestructible = /\bwith indestructible\b/i.test(text) || /\bgains indestructible\b/i.test(text);

      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;

      const sourcePerm =
        (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
        battlefield.find((p: any) =>
          p?.controller === controller &&
          String(p?.card?.name || '').toLowerCase() === String(sourceName || '').toLowerCase() &&
          String(p?.card?.type_line || '').toLowerCase().includes('planeswalker')
        );

      if (!sourcePerm?.card) return false;

      const typeLineLower = String(sourcePerm.card?.type_line || '').toLowerCase();
      if (!typeLineLower.includes('planeswalker')) return true;

      // Track original type line so turn cleanup can restore it.
      const originalTypeLine = String(sourcePerm.card?.type_line || 'Planeswalker');
      (sourcePerm as any).untilEndOfTurn = (sourcePerm as any).untilEndOfTurn || {};
      const u = (sourcePerm as any).untilEndOfTurn as any;
      if (typeof u.originalTypeLine !== 'string') u.originalTypeLine = originalTypeLine;

      // Ensure it's a creature.
      let left = originalTypeLine;
      let right = '';
      if (originalTypeLine.includes('—')) {
        const parts = originalTypeLine.split('—');
        left = parts[0]?.trim() || originalTypeLine;
        right = parts.slice(1).join('—').trim();
      }
      if (!/\bCreature\b/i.test(left)) left = `${left} Creature`;

      // Append creature types (best-effort; ignore color adjectives).
      const colorWords = new Set(['white', 'blue', 'black', 'red', 'green', 'colorless']);
      const creatureTypes = rawCreatureDescriptor
        .split(/\s+/)
        .map(t => String(t || '').trim())
        .filter(Boolean)
        .filter(t => !colorWords.has(t.toLowerCase()));

      const rightCombined = [right, creatureTypes.join(' ')].map(x => String(x || '').trim()).filter(Boolean).join(' ');
      sourcePerm.card.type_line = rightCombined ? `${left} — ${rightCombined}` : left;

      // P/T until end of turn.
      (sourcePerm as any).ptModsEOT = Array.isArray((sourcePerm as any).ptModsEOT) ? (sourcePerm as any).ptModsEOT : [];
      (sourcePerm as any).ptModsEOT.push({ power, toughness, sourceName });

      // Grant indestructible if present in the oracle text (until EOT).
      sourcePerm.grantedAbilities = Array.isArray(sourcePerm.grantedAbilities) ? sourcePerm.grantedAbilities : [];
      u.grantedAbilitiesToRemove = Array.isArray(u.grantedAbilitiesToRemove) ? u.grantedAbilitiesToRemove : [];
      if (hasIndestructible) {
        if (!sourcePerm.grantedAbilities.includes('Indestructible')) sourcePerm.grantedAbilities.push('Indestructible');
        if (!u.grantedAbilitiesToRemove.includes('Indestructible')) u.grantedAbilitiesToRemove.push('Indestructible');
      }

      // Prevent damage to this permanent (until end of turn).
      const stateAny = ctx.state as any;
      const preventText = 'Prevent all damage to this permanent (until end of turn)';

      if (!sourcePerm.grantedAbilities.includes(preventText)) sourcePerm.grantedAbilities.push(preventText);
      if (!u.grantedAbilitiesToRemove.includes(preventText)) u.grantedAbilitiesToRemove.push(preventText);

      (sourcePerm as any).untilNextTurnGrants = Array.isArray((sourcePerm as any).untilNextTurnGrants)
        ? (sourcePerm as any).untilNextTurnGrants
        : [];
      (sourcePerm as any).untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: stateAny.turnNumber || 0,
        grantedAbilities: [preventText],
        sourceName,
        kind: 'prevent_all_damage_to',
        expiresAtCleanup: true,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE": {
      const m = text.match(/^untap up to one target artifact or creature\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes("artifact") && !tl.includes("creature")) return true;

      perm.tapped = false;
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_ARTIFACTS": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target artifacts?\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('artifact')) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_CREATURES": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target creatures?\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE": {
      const m = text.match(
        /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target (plains?|islands?|swamps?|mountains?|forests?)\.?$/i
      );
      if (!m) return false;

      const maxN = parseCountTokenWord(m[1]);
      const landWord = String(m[2] || '').toLowerCase();
      const subtype = landWord.endsWith('s') ? landWord.slice(0, -1) : landWord;

      const targets = getTargets(triggerItem).slice(0, Math.max(0, maxN));
      if (!targets.length) return true;

      const battlefield = getBattlefield(ctx);
      let untapped = 0;
      for (const id of targets) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm?.card) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (!tl.includes('land')) continue;
        if (!tl.includes(subtype)) continue;
        perm.tapped = false;
        untapped++;
      }
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (untapped ${untapped})`);
      return true;
    }

    case "TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^target creature can't be blocked this turn\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || "").toLowerCase();
      if (!tl.includes('creature')) return true;

      // Use tempAbilities so cleanup-step removal is automatic.
      perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
      if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
        perm.tempAbilities.push("Can't be blocked");
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^creatures you control can't be blocked this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);

      let changed = false;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== controller) continue;

        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
        if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
          perm.tempAbilities.push("Can't be blocked");
          changed = true;
        }
      }

      if (changed) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATURES_CANT_BE_BLOCKED_THIS_TURN": {
      const m = text.match(/^creatures (?:can't|cannot) be blocked this turn\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);

      let changed = false;
      for (const perm of battlefield) {
        if (!perm?.card) continue;

        const tl = String(perm?.card?.type_line || "").toLowerCase();
        if (!tl.includes("creature")) continue;

        // Use tempAbilities so cleanup-step removal is automatic.
        perm.tempAbilities = Array.isArray(perm.tempAbilities) ? perm.tempAbilities : [];
        if (!perm.tempAbilities.some((a: any) => String(a).toLowerCase().includes("can't be blocked"))) {
          perm.tempAbilities.push("Can't be blocked");
          changed = true;
        }
      }

      if (changed) (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT": {
      const m = text.match(/^target creature gains flying and double strike until end of turn\.?$/i);
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return true;

      perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
      if (!perm.grantedAbilities.some((a: any) => String(a).toLowerCase().includes('flying'))) {
        perm.grantedAbilities.push('Flying');
      }
      if (!perm.grantedAbilities.some((a: any) => String(a).toLowerCase().includes('double strike'))) {
        perm.grantedAbilities.push('Double strike');
      }

      perm.untilEndOfTurn = perm.untilEndOfTurn && typeof perm.untilEndOfTurn === 'object' ? perm.untilEndOfTurn : {};
      (perm.untilEndOfTurn as any).grantedAbilitiesToRemove = Array.isArray((perm.untilEndOfTurn as any).grantedAbilitiesToRemove)
        ? (perm.untilEndOfTurn as any).grantedAbilitiesToRemove
        : [];
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Flying')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Flying');
      }
      if (!(perm.untilEndOfTurn as any).grantedAbilitiesToRemove.includes('Double strike')) {
        (perm.untilEndOfTurn as any).grantedAbilitiesToRemove.push('Double strike');
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER": {
      const m = text.match(/^[a-z0-9 ,'-]+ deals (\d+) damage to target creature or planeswalker\.?$/i);
      if (!m) return false;

      const amount = parseInt(m[1], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      applyDamageToPermanent(ctx, targetId, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount})`);
      return true;
    }

    case "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER": {
      const m = text.match(/^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to target player\.?$/i);
      if (!m) return false;

      const symbols = String(m[1] || '').toUpperCase();
      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      addUnrestrictedManaSymbols(state, controller, symbols);
      applyDamageToPlayer(ctx, targetId as any, amount);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, ${amount} dmg)`);
      return true;
    }

    case "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER": {
      const m = text.match(
        /^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to up to one target player or planeswalker\.?$/i
      );
      if (!m) return false;

      const symbols = String(m[1] || '').toUpperCase();
      const amount = parseInt(m[2], 10);
      if (!Number.isFinite(amount)) return false;

      const [targetId] = getTargets(triggerItem);

      addUnrestrictedManaSymbols(state, controller, symbols);

      // Up to one target: can be omitted.
      if (targetId) {
        const player = getPlayerById(ctx, targetId as any);
        if (player) {
          applyDamageToPlayer(ctx, targetId as any, amount);
        } else {
          const battlefield = getBattlefield(ctx);
          const perm = battlefield.find((p: any) => p?.id === targetId);
          if (perm) {
            const tl = String(perm?.card?.type_line || "").toLowerCase();
            if (tl.includes('planeswalker')) {
              applyDamageToPermanent(ctx, targetId, amount);
            }
          }
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${symbols}, ${amount} dmg)`);
      return true;
    }

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) creature cards? from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const maxCreatures = parseCountTokenWord(m[2]);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const selectable = revealed.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature'));
      const nonSelectable = revealed.filter((c: any) => !String(c?.type_line || '').toLowerCase().includes('creature'));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal up to ${Math.min(maxCreatures, revealed.length)} creature card(s) and put them into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `up to ${maxCreatures} creature card(s)` ,
        minSelections: 0,
        maxSelections: Math.min(Math.max(0, maxCreatures | 0), selectable.length),
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

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal a ([a-zA-Z][a-zA-Z\-]*) card and\/or an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i
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
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal a ${type1} card and/or an ${type2} card and put them into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `a ${type1} card and/or an ${type2} card` ,
        minSelections: 0,
        maxSelections: Math.min(2, selectable.length),
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

    case "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM": {
      const m = text.match(
        /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i
      );
      if (!m) return false;

      const n = parseCountTokenWord(m[1]);
      const type1 = String(m[2] || '').trim();
      const type1Lower = type1.toLowerCase();
      if (!type1Lower) return false;

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) return false;

      const lib: any[] = (ctx as any).libraries?.get(controller) || [];
      if (!Array.isArray(lib) || lib.length === 0) return true;

      const revealed = lib.slice(0, Math.max(0, n));
      if (revealed.length === 0) return true;

      const matchesType = (c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes(type1Lower);
      };

      const selectable = revealed.filter(matchesType);
      const nonSelectable = revealed.filter((c: any) => !matchesType(c));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller as any,
        description: `${sourceName}: Look at top ${revealed.length} (you may reveal an ${type1} card and put it into your hand)` ,
        mandatory: false,
        sourceName,
        searchCriteria: `an ${type1} card` ,
        minSelections: 0,
        maxSelections: Math.min(1, selectable.length),
        destination: 'hand',
        reveal: true,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: true,
        maxTypes: {
          [type1Lower]: 1,
        },
        availableCards: selectable.map(toAvailableCard),
        nonSelectableCards: nonSelectable.map(toAvailableCard),
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }
    default:
      return undefined;
  }
}
