// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateCreateTokens.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: tryResolvePlaneswalkerLoyaltyTemplate switch cases
//   CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE .. PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL
// Public entry symbols: tryLoyaltyTemplateCreateTokens
// Returns handled boolean, or undefined to fall through to later families.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";
import { createToken, updateCounters } from "../../../modules/counters_tokens.js";
import { getBattlefield, parseCreateTokenDescriptor, getGameId, getTargets, parseCountTokenWord, getPlaneswalkerX } from "../utils.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { ResolutionStepType } from "../../../resolution/types.js";
import { millCards, getOpponents } from "./loyaltyTemplateRuntimeHelpers.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";

export function tryLoyaltyTemplateCreateTokens(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  state: any,
  text: string,
): boolean | undefined {
  switch (match.id) {
    case "CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE": {
      const m = text.match(
        /^create a 3\/3 green beast creature token\.\s*then if an opponent controls more creatures than you, put a loyalty counter on [a-z0-9 ,'-]+\.?$/i
      );
      if (!m) return false;

      const { colors } = parseCreateTokenDescriptor("green Beast creature token");
      createToken(ctx, controller, "Beast", 1, 3, 3, {
        colors,
        typeLine: "Token Creature — Beast",
      });

      const battlefield = getBattlefield(ctx);
      const countCreatures = (pid: any): number => {
        let n = 0;
        for (const perm of battlefield) {
          if (!perm?.card) continue;
          if ((perm as any).controller !== pid) continue;
          const tl = String((perm as any).card?.type_line || "").toLowerCase();
          if (tl.includes("creature")) n++;
        }
        return n;
      };

      const youCount = countCreatures(controller);
      const opponents = getOpponents(ctx, controller);
      const anyOpponentMore = opponents.some((oppId: any) => countCreatures(oppId) > youCount);

      if (anyOpponentMore) {
        const sourceId =
          triggerItem?.sourceId ||
          triggerItem?.sourcePermanentId ||
          triggerItem?.planeswalker?.id ||
          triggerItem?.source;

        const sourcePerm =
          (sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null) ||
          battlefield.find(
            (p: any) =>
              p?.controller === controller &&
              String(p?.card?.name || "").toLowerCase() === String(sourceName || "").toLowerCase() &&
              String(p?.card?.type_line || "").toLowerCase().includes("planeswalker")
          );

        if (sourcePerm) {
          updateCounters(ctx, String(sourcePerm.id), { loyalty: 1 });
        }
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (oppMore=${anyOpponentMore})`);
      return true;
    }

    case "CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER": {
      const m = text.match(
        /^create a 3\/3 green beast creature token\.\s*put your choice of a vigilance counter, a reach counter, or a trample counter on it\.?$/i
      );
      if (!m) return false;

      const { colors } = parseCreateTokenDescriptor("green Beast creature token");
      const [tokenPermanentId] = createToken(ctx, controller, "Beast", 1, 3, 3, {
        colors,
        typeLine: "Token Creature — Beast",
      });

      // Best-effort fallback if we can't ask the player.
      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === "unknown" || isReplaying || !tokenPermanentId) {
        const battlefield = getBattlefield(ctx);
        const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
        if (tokenPerm) {
          tokenPerm.counters = tokenPerm.counters || {};
          tokenPerm.counters.vigilance = (tokenPerm.counters.vigilance || 0) + 1;
          tokenPerm.grantedAbilities = Array.isArray(tokenPerm.grantedAbilities) ? tokenPerm.grantedAbilities : [];
          if (!tokenPerm.grantedAbilities.includes("vigilance")) tokenPerm.grantedAbilities.push("vigilance");
          tokenPerm.card = tokenPerm.card || {};
          tokenPerm.card.keywords = tokenPerm.card.keywords || [];
          if (!tokenPerm.card.keywords.includes("Vigilance")) tokenPerm.card.keywords.push("Vigilance");
          (ctx as any).bumpSeq?.();
        }

        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (fallback=vigilance)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MODAL_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a counter type to put on the Beast token`,
        mandatory: true,
        sourceName,
        sourceImage: triggerItem?.card?.image_uris?.small || triggerItem?.card?.image_uris?.normal,
        promptTitle: "Choose Counter Type",
        promptDescription: "Put which keyword counter on the Beast token?",
        options: [
          { id: "vigilance", label: "Vigilance" },
          { id: "reach", label: "Reach" },
          { id: "trample", label: "Trample" },
        ],
        minSelections: 1,
        maxSelections: 1,
        keywordCounterChoiceData: {
          targetPermanentId: tokenPermanentId,
          targetName: 'Beast',
          allowedKeywords: ['vigilance', 'reach', 'trample'],
        },
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL": {
      const m = text.match(
        /^create a green treefolk creature token with reach and "this token(?:'|’)s power and toughness are each equal to the number of lands you control\."\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const landsYouControl = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const tl = String(p.card?.type_line || "").toLowerCase();
        return tl.includes('land');
      }).length;

      const { name, colors, abilities } = parseCreateTokenDescriptor('green Treefolk creature token with reach');
      createToken(ctx, controller, name, 1, landsYouControl, landsYouControl, { colors, abilities });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${landsYouControl}/${landsYouControl} ${name})`);
      return true;
    }

    case "CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND": {
      const m = text.match(
        /^create a blue dog illusion creature token with "this token(?:'|’)s power and toughness are each equal to twice the number of cards in your hand\."\.?$/i
      );
      if (!m) return false;

      const zones = (state as any)?.zones || {};
      const z = zones?.[controller] || {};
      const handCountRaw = (z as any).handCount;
      const handCount = Number.isFinite(handCountRaw)
        ? Number(handCountRaw)
        : Array.isArray((z as any).hand)
          ? ((z as any).hand as any[]).length
          : 0;
      const pt = Math.max(0, 2 * handCount);

      const { name, colors, abilities } = parseCreateTokenDescriptor(
        'blue Dog Illusion creature token with "This token\'s power and toughness are each equal to twice the number of cards in your hand."'
      );
      createToken(ctx, controller, name, 1, pt, pt, { colors, abilities });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${pt}/${pt} ${name})`);
      return true;
    }

    case "CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL": {
      const m = text.match(
        /^create a white avatar creature token\. it has "this token(?:'|’)s power and toughness are each equal to your life total\."\.?$/i
      );
      if (!m) return false;

      const startingLife = (state as any)?.startingLife ?? 40;
      const lifeTotal = ((state as any)?.life && (state as any).life[controller] != null)
        ? Number((state as any).life[controller])
        : Number((state as any)?.players?.find?.((p: any) => p?.id === controller)?.life ?? startingLife);
      const pt = Number.isFinite(lifeTotal) ? Math.max(0, lifeTotal) : startingLife;

      const { name, colors } = parseCreateTokenDescriptor('white Avatar creature token');
      createToken(ctx, controller, name, 1, pt, pt, {
        colors,
        abilities: ["This token's power and toughness are each equal to your life total."],
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${pt}/${pt} ${name})`);
      return true;
    }

    case "CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT": {
      const m = text.match(
        /^create a white aura enchantment token named mask attached to another target permanent\. the token has enchant permanent and umbra armor\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const createdIds = createToken(ctx, controller, 'Mask', 1, undefined, undefined, {
        colors: ['W'],
        typeLine: 'Token Enchantment — Aura',
        abilities: ['Enchant permanent', 'Umbra armor'],
      });

      const battlefield = getBattlefield(ctx);
      const tokenId = createdIds[0];
      if (tokenId) {
        const auraPerm = battlefield.find((p: any) => p?.id === tokenId);
        if (auraPerm) (auraPerm as any).attachedTo = targetId;
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN": {
      const m = text.match(
        /^create a colorless equipment artifact token named stoneforged blade\. it has indestructible, "equipped creature gets \+5\/\+5 and has double strike," and equip \{0\}\.?$/i
      );
      if (!m) return false;

      createToken(ctx, controller, 'Stoneforged Blade', 1, undefined, undefined, {
        colors: [],
        typeLine: 'Token Artifact — Equipment',
        abilities: ['Indestructible', 'Equipped creature gets +5/+5 and has double strike', 'Equip {0}'],
        isArtifact: true,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER": {
      const m = text.match(/^create two tokens that are copies of jace, except they(?:'|’)re not legendary\.?$/i);
      if (!m) return false;

      const sourceCard = triggerItem?.card;
      const sourceTypeLine = String(sourceCard?.type_line || '');
      if (!sourceCard || !sourceTypeLine) return false;

      const cleanedTypeLine = sourceTypeLine
        .replace(/\blegendary\b\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      const tokenTypeLine = `Token ${cleanedTypeLine}`.trim();
      const colors = Array.isArray((sourceCard as any).colors) ? (sourceCard as any).colors : [];
      const keywords = Array.isArray((sourceCard as any).keywords) ? (sourceCard as any).keywords : [];

      const createdIds = createToken(ctx, controller, String((sourceCard as any).name || 'Token Copy'), 2, undefined, undefined, {
        colors,
        typeLine: tokenTypeLine,
        abilities: keywords,
        isArtifact: tokenTypeLine.toLowerCase().includes('artifact'),
      });

      const loyaltyValue = parseInt(String((sourceCard as any).loyalty ?? ''), 10);
      const battlefield = getBattlefield(ctx);
      for (const id of createdIds) {
        const perm = battlefield.find((p: any) => p?.id === id);
        if (!perm) continue;

        perm.card = perm.card || {};
        perm.card.name = String((sourceCard as any).name || perm.card.name || 'Token Copy');
        perm.card.type_line = cleanedTypeLine;
        perm.card.oracle_text = String((sourceCard as any).oracle_text || perm.card.oracle_text || '');
        perm.card.colors = colors;
        perm.card.keywords = keywords;

        if (Number.isFinite(loyaltyValue) && loyaltyValue > 0) {
          // Initialize printed loyalty via updateCounters so undo/replay persists it.
          updateCounters(ctx, String(perm.id), { loyalty: loyaltyValue });
          perm.baseLoyalty = loyaltyValue;
        }
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${createdIds.length})`);
      return true;
    }

    case "CREATE_TOKEN_BASIC": {
      const m = text.match(
        /^(?:create|put) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (tapped )?(\d+)\/(\d+) ([^\.]+?) (?:creature\s+)?tokens?(?: with ([\s\S]+?))?(?:\s+onto the battlefield)?\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const isTapped = !!m[2];
      const power = parseInt(m[3], 10);
      const toughness = parseInt(m[4], 10);
      const descriptor = `${m[5].trim()}${m[6] ? ` with ${m[6].trim()}` : ""}`;
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
        (ctx as any).bumpSeq?.();
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} ${power}/${toughness} ${name})`);
      return true;
    }

    case "CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO": {
      const m = text.match(/^create a 2\/2 black zombie creature token\.\s*mill two cards\.?$/i);
      if (!m) return false;

      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor('black Zombie creature token');
      createToken(ctx, controller, name, 1, 2, 2, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      millCards(ctx, controller, 2);
      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD": {
      const m = text.match(/^create a 2\/2 blue wizard creature token\.\s*draw a card, then discard a card\.?$/i);
      if (!m) return false;

      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor('blue Wizard creature token');
      createToken(ctx, controller, name, 1, 2, 2, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      // Reuse existing draw+discard pattern (queue discard selection if possible).
      drawCardsFromZone(ctx, controller, 1);

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no interaction)`);
        return true;
      }

      const zones = (state as any)?.zones || {};
      const hand: any[] = zones?.[controller]?.hand || [];
      if (!hand.length) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (empty hand)`);
        return true;
      }

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

    case "CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS": {
      const m = text.match(/^create a 1\/1 human wizard creature token that(?:'|’)s all colors\.?$/i);
      if (!m) return false;

      createToken(ctx, controller, 'Human Wizard', 1, 1, 1, {
        colors: ['W', 'U', 'B', 'R', 'G'],
        abilities: [],
        typeLine: 'Token Creature — Human Wizard',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT": {
      const m = text.match(/^create a 1\/1 white kor soldier creature token\.\s*you may attach an equipment you control to it\.?$/i);
      if (!m) return false;

      const [tokenPermanentId] = createToken(ctx, controller, 'Kor Soldier', 1, 1, 1, {
        colors: ['W'],
        abilities: [],
        typeLine: 'Token Creature — Kor Soldier',
      });

      const gameId = getGameId(ctx);
      const isReplaying = !!(ctx as any).isReplaying;
      if (!gameId || gameId === 'unknown' || isReplaying || !tokenPermanentId) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no interaction)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const controlsEquipment = battlefield.some(
        (p: any) => p && p.controller === controller && String(p.card?.type_line || '').toLowerCase().includes('equipment')
      );
      if (!controlsEquipment) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (no equipment)`);
        return true;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: controller,
        description: `${sourceName}: You may attach an Equipment you control to the created Kor Soldier token.`,
        mandatory: false,
        sourceName,
        options: [
          { id: 'attach', label: 'Attach an Equipment' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        attachEquipmentToPermanentChoice: true,
        attachEquipmentToPermanentTargetPermanentId: tokenPermanentId,
        attachEquipmentToPermanentController: controller,
        attachEquipmentToPermanentSourceName: sourceName,
        attachEquipmentToPermanentTargetName: 'Kor Soldier token',
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (queued)`);
      return true;
    }

    case "CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE": {
      const m = text.match(
        /^create x 1\/1 red devil creature tokens? with\s+"when this creature dies, it deals 1 damage to any target\."\.?$/i
      );
      if (!m) return false;

      const x = getPlaneswalkerX(triggerItem);
      if (x === null) return false;
      if (x <= 0) return true;

      createToken(ctx, controller, 'Devil', x, 1, 1, {
        colors: ['R'],
        abilities: ["When this creature dies, it deals 1 damage to any target."],
        typeLine: 'Token Creature — Devil',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x})`);
      return true;
    }

    case "CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY": {
      const m = text.match(
        /^create an x\/x green phyrexian horror creature token, where x is [a-z0-9 ,'-]+(?:'|’)s loyalty\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id || triggerItem?.source;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      const loyalty = Number((sourcePerm as any)?.counters?.loyalty ?? (sourcePerm as any)?.loyalty ?? 0) || 0;
      if (loyalty <= 0) return true;

      createToken(ctx, controller, 'Phyrexian Horror', 1, loyalty, loyalty, {
        colors: ['G'],
        abilities: [],
        typeLine: 'Token Creature — Phyrexian Horror',
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${loyalty})`);
      return true;
    }

    case "CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP": {
      const m = text.match(
        /^create a token that['’]s a copy of target creature you control, except it has haste and\s+"at the beginning of the end step, sacrifice this token\."\.?$/i
      );
      if (!m) return false;

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const orig = battlefield.find((p: any) => p?.id === targetId);
      if (!orig?.card) return false;
      if (orig.controller !== controller) return false;

      const origTypeLine = String(orig.card?.type_line || '').trim();
      const origTypeLineLower = origTypeLine.toLowerCase();
      if (!origTypeLineLower.includes('creature')) return false;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
        ? stateAny.pendingSacrificeAtNextEndStep
        : [];

      const origCard = (orig as any)?.card || {};
      const basePower = Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0;
      const baseToughness = Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0;
      const colors = Array.isArray(origCard?.colors)
        ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];

      const tokenTypeLine = `Token ${origTypeLine}`.trim();

      const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine: tokenTypeLine,
        abilities: ['Haste', 'At the beginning of the end step, sacrifice this token.'],
      });
      if (!tokenPermanentId) return true;

      const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
      if (tokenPerm?.card) {
        const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
        (tokenPerm as any).card = {
          ...(origCard as any),
          id: tokenCardId || (tokenPerm as any).card?.id,
          zone: 'battlefield',
          type_line: tokenTypeLine,
        };

        (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
          (tokenPerm as any).grantedAbilities.push('Haste');
        }
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('sacrifice this token'))) {
          (tokenPerm as any).grantedAbilities.push('At the beginning of the end step, sacrifice this token.');
        }
      }

      stateAny.pendingSacrificeAtNextEndStep.push({
        permanentId: tokenPermanentId,
        fireAtTurnNumber,
        maxManaValue: 0,
        sourceName,
        createdBy: controller,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created 1)`);
      return true;
    }

    case "CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL": {
      const m = text.match(
        /^create a (\d+)\/(\d+) ([a-z]+(?: and [a-z]+)*) ([a-z][a-z-]*(?: [a-z][a-z-]*)*) creature tokens? for each land you control\.?$/i
      );
      if (!m) return false;

      const power = parseInt(m[1], 10);
      const toughness = parseInt(m[2], 10);
      if (!Number.isFinite(power) || !Number.isFinite(toughness)) return false;

      const descriptor = `${m[3].trim()} ${m[4].trim()} creature token`;
      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor(descriptor);

      const battlefield = getBattlefield(ctx);
      let landCount = 0;
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        if (perm.controller !== controller) continue;
        const tl = String(perm.card?.type_line || "").toLowerCase();
        if (tl.includes("land")) landCount++;
      }

      if (landCount <= 0) {
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (0 lands)`);
        return true;
      }

      createToken(ctx, controller, name, landCount, power, toughness, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(" ") : name}`,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${landCount}x ${power}/${toughness} ${name})`);
      return true;
    }

    case "CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP": {
      const m = text.match(
        /^create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) 1\/1 ([a-z]+) elemental creature tokens?\.\s*they gain haste\.\s*sacrifice them at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const count = parseCountTokenWord(m[1]);
      const colorWord = String(m[2] || '').trim();
      if (!Number.isFinite(count) || count <= 0) return true;

      const descriptor = `${colorWord} Elemental creature token with haste`;
      const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor(descriptor);

      const createdIds = createToken(ctx, controller, name, count, 1, 1, {
        colors,
        abilities,
        typeLine: `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`,
      });

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
        ? stateAny.pendingSacrificeAtNextEndStep
        : [];
      for (const id of createdIds) {
        stateAny.pendingSacrificeAtNextEndStep.push({
          permanentId: id,
          fireAtTurnNumber,
          maxManaValue: 0,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${count} 1/1 ${name}, sac next end)`);
      return true;
    }

    case "FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP": {
      const m = text.match(
        /^for each artifact you control, create a token that['’]s a copy of it\.\s*those tokens gain haste\.\s*exile those tokens at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const artifactsSnapshot = battlefield.filter((p: any) => {
        if (!p?.card) return false;
        if (p.controller !== controller) return false;
        const typeLineLower = String(p.card?.type_line || '').toLowerCase();
        return typeLineLower.includes('artifact');
      });

      if (artifactsSnapshot.length === 0) return true;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
        ? stateAny.pendingExileAtNextEndStep
        : [];

      const createdTokenIds: string[] = [];
      for (const orig of artifactsSnapshot) {
        const origCard = (orig as any)?.card || {};
        const origTypeLine = String(origCard?.type_line || '').trim();
        if (!origTypeLine) continue;

        const typeLineLower = origTypeLine.toLowerCase();
        const isCreature = typeLineLower.includes('creature');
        const basePower = isCreature ? (Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0) : undefined;
        const baseToughness = isCreature ? (Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0) : undefined;
        const colors = Array.isArray(origCard?.colors)
          ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
          : [];

        const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
          colors,
          typeLine: `Token ${origTypeLine}`.trim(),
          abilities: ['Haste'],
          isArtifact: true,
        });
        if (!tokenPermanentId) continue;
        createdTokenIds.push(tokenPermanentId);

        const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
        if (tokenPerm?.card) {
          const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
          (tokenPerm as any).card = {
            ...(origCard as any),
            id: tokenCardId || (tokenPerm as any).card?.id,
            zone: 'battlefield',
            type_line: `Token ${origTypeLine}`.trim(),
          };

          (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
          if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
            (tokenPerm as any).grantedAbilities.push('Haste');
          }
        }

        stateAny.pendingExileAtNextEndStep.push({
          permanentId: tokenPermanentId,
          fireAtTurnNumber,
          sourceName,
          createdBy: controller,
        });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${createdTokenIds.length})`);
      return true;
    }

    case "CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP": {
      const m = text.match(
        /^create a token that['’]s a copy of target (?:artifact or creature|artifact|creature) you control(?:, except it(?:'|’)s an artifact in addition to its other types)?\.\s*that token gains haste\.\s*exile (?:it|that token) at the beginning of the next end step\.?$/i
      );
      if (!m) return false;

      const isArtifactAdded = /artifact in addition to its other types/i.test(text);

      const [targetId] = getTargets(triggerItem);
      if (!targetId) return false;

      const battlefield = getBattlefield(ctx);
      const orig = battlefield.find((p: any) => p?.id === targetId);
      if (!orig?.card) return false;
      if (orig.controller !== controller) return false;

      const origTypeLine = String(orig.card?.type_line || '').trim();
      const origTypeLineLower = origTypeLine.toLowerCase();
      if (!(origTypeLineLower.includes('artifact') || origTypeLineLower.includes('creature'))) return false;

      const stateAny = (ctx as any).state as any;
      const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
      const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
      const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
      const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
      const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

      stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
        ? stateAny.pendingExileAtNextEndStep
        : [];

      const origCard = (orig as any)?.card || {};
      const isCreature = origTypeLineLower.includes('creature');
      const basePower = isCreature ? (Number((orig as any)?.basePower ?? origCard?.power ?? 0) || 0) : undefined;
      const baseToughness = isCreature ? (Number((orig as any)?.baseToughness ?? origCard?.toughness ?? 0) || 0) : undefined;
      const colors = Array.isArray(origCard?.colors)
        ? origCard.colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean)
        : [];

      let tokenTypeLine = `Token ${origTypeLine}`.trim();
      if (isArtifactAdded && !tokenTypeLine.toLowerCase().includes('artifact')) {
        tokenTypeLine = `Token Artifact ${origTypeLine}`.trim();
      }

      const [tokenPermanentId] = createToken(ctx, controller, String(origCard?.name || 'Token Copy'), 1, basePower, baseToughness, {
        colors,
        typeLine: tokenTypeLine,
        abilities: ['Haste'],
        isArtifact: isArtifactAdded || origTypeLineLower.includes('artifact'),
      });
      if (!tokenPermanentId) return true;

      const tokenPerm = battlefield.find((p: any) => p?.id === tokenPermanentId);
      if (tokenPerm?.card) {
        const tokenCardId = String((tokenPerm as any).card?.id || '').trim();
        (tokenPerm as any).card = {
          ...(origCard as any),
          id: tokenCardId || (tokenPerm as any).card?.id,
          zone: 'battlefield',
          type_line: tokenTypeLine,
        };

        (tokenPerm as any).grantedAbilities = Array.isArray((tokenPerm as any).grantedAbilities) ? (tokenPerm as any).grantedAbilities : [];
        if (!(tokenPerm as any).grantedAbilities.some((a: any) => String(a).toLowerCase().includes('haste'))) {
          (tokenPerm as any).grantedAbilities.push('Haste');
        }
      }

      stateAny.pendingExileAtNextEndStep.push({
        permanentId: tokenPermanentId,
        fireAtTurnNumber,
        sourceName,
        createdBy: controller,
      });

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created 1)`);
      return true;
    }

    case "CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED": {
      // Grist, the Hunger Tide:
      // "Create a 1/1 black and green Insect creature token, then mill a card.
      //  If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process."
      const m = text.match(
        /^create a 1\/1 black and green insect creature token, then mill a card\. if an insect card was milled this way, put a loyalty counter on [a-z0-9 ,'-]+ and repeat this process\.?$/i
      );
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;

      const MAX_ITERS = 200;
      let iters = 0;
      let created = 0;
      let milledTotal = 0;

      while (iters++ < MAX_ITERS) {
        // Create the Insect token
        createToken(ctx, controller, "Insect", 1, 1, 1, {
          colors: ["B", "G"],
          typeLine: "Token Creature — Insect",
        });
        created++;

        // Mill one card
        const milled = millCards(ctx, controller, 1);
        milledTotal += milled.length;
        if (milled.length === 0) break;

        const milledCard = milled[0];
        const typeLineLower = String(milledCard?.type_line || "").toLowerCase();
        const isInsectCard = typeLineLower.includes("insect");
        if (!isInsectCard) break;

        // Put a loyalty counter on the source planeswalker (best-effort)
        if (sourcePerm) {
          updateCounters(ctx, String(sourcePerm.id), { loyalty: 1 });
        }
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (created ${created}, milled ${milledTotal})`);
      return true;
    }

    case "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL": {
      const m = text.match(/^put a loyalty counter on ([a-z0-9 ,'-]+) for each creature you control\.?$/i);
      if (!m) return false;

      const battlefield = getBattlefield(ctx);
      const sourceId = triggerItem?.sourceId || triggerItem?.sourcePermanentId || triggerItem?.planeswalker?.id;
      const sourcePerm = sourceId ? battlefield.find((p: any) => p?.id === sourceId) : null;
      if (!sourcePerm) return false;

      let count = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if ((perm as any).controller !== controller) continue;
        const typeLineLower = String((perm as any)?.card?.type_line || "").toLowerCase();
        if (typeLineLower.includes("creature")) count++;
      }

      if (count > 0) {
        updateCounters(ctx, String(sourcePerm.id), { loyalty: count });
      }

      (ctx as any).bumpSeq?.();
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (+${count})`);
      return true;
    }
    default:
      return undefined;
  }
}
