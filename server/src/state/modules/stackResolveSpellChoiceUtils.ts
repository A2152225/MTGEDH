import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import {
  countControlledPermanentsOfChosenType,
  isCastCreatureTypeChoiceOracle,
  parseChosenTypeLookRevealTopLibrary,
  parseChosenTypeUntilEndOfTurnBuff,
} from './chosen-creature-type.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { destroyPermanent } from './counters_tokens.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import {
  resolveKindredChargeTokenCopies,
  resolveKindredSummonsFromLibrary,
} from './oracleIrSpellLegacyKindredRevealUtils.js';
import { queueChosenTypeTopLibraryRevealPrompt } from './oracleIrSpellLegacyLibrarySelectionUtils.js';
import { requiresEffectProgramOrchestration } from './oracleIrEffectProgramServer.js';
import { collectSpellResolutionEffectSteps } from './trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from './oracleIrCompiledOverlayLookup.js';
import { isSpellEffectOwnedByOracleIrPrimary } from './oracleIrSpellLegacyRouting.js';

function applyInstantSorceryChosenCreatureTypeEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
    existingChosenCreatureType: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;
  const existingChosenCreatureType = options.existingChosenCreatureType;

  const untilEotBuff = parseChosenTypeUntilEndOfTurnBuff(oracleText);
  if (untilEotBuff) {
    const battlefield = state.battlefield || [];
    let affected = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== controller) continue;
      if (!isCreatureNow(perm)) continue;
      if (!permanentHasCreatureTypeNow(perm, existingChosenCreatureType)) continue;
      perm.modifiers = Array.isArray(perm.modifiers) ? perm.modifiers : [];
      perm.modifiers.push({
        type: 'pt_buff',
        sourceId: String(item?.id || card?.id || effectiveCard.id || ''),
        power: untilEotBuff.power,
        toughness: untilEotBuff.toughness,
        keywords: untilEotBuff.abilities || [],
        duration: 'end_of_turn',
        appliedAt: Date.now(),
      } as any);
      affected += 1;
    }
    if (affected > 0) {
      debug(2, `[applyInstantSorceryChosenCreatureTypeEffects] ${effectiveCard.name}: applied ${existingChosenCreatureType} until-EOT buff to ${affected} creature(s)`);
    }
  }

  const spellNameLower = String(effectiveCard.name || '').toLowerCase();
  if (
    spellNameLower.includes('distant melody') ||
    /draw a card for each permanent you control of that type/i.test(oracleTextLower)
  ) {
    const drawCount = countControlledPermanentsOfChosenType(state, controller, existingChosenCreatureType);
    if (drawCount > 0) {
      const drawn = drawCardsFromZone(ctx, controller, drawCount);
      debug(2, `[applyInstantSorceryChosenCreatureTypeEffects] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s) for ${existingChosenCreatureType} permanents`);
    }
  }

  if (
    (spellNameLower.includes('kindred summons') ||
      /reveal cards from the top of your library until you reveal x creature cards of the chosen type/i.test(oracleTextLower))
    && !isSpellEffectOwnedByOracleIrPrimary(oracleText, String(effectiveCard.name || 'Spell'))
  ) {
    resolveKindredSummonsFromLibrary(ctx, controller, existingChosenCreatureType, String(effectiveCard.name || 'Kindred Summons'));
  }

  if (
    spellNameLower.includes('kindred dominance') ||
    /destroy all creatures that aren't of the chosen type/i.test(oracleTextLower)
  ) {
    const battlefield = state.battlefield || [];
    let destroyed = 0;
    for (const perm of battlefield) {
      if (!perm || !isCreatureNow(perm)) continue;
      if (permanentHasCreatureTypeNow(perm, existingChosenCreatureType)) continue;
      destroyPermanent(ctx, String(perm.id), true);
      destroyed += 1;
    }
    debug(2, `[applyInstantSorceryChosenCreatureTypeEffects] ${effectiveCard.name}: destroyed ${destroyed} creature(s) not of type ${existingChosenCreatureType}`);
  }

  if (
    spellNameLower.includes('kindred charge') ||
    /for each creature you control of the chosen type, create a token that/i.test(oracleTextLower)
  ) {
    resolveKindredChargeTokenCopies(
      ctx,
      controller,
      existingChosenCreatureType,
      String(effectiveCard.name || 'Kindred Charge'),
    );
  }

  const chosenTypeLookReveal = parseChosenTypeLookRevealTopLibrary(oracleText);
  if (chosenTypeLookReveal) {
    const queuedCount = queueChosenTypeTopLibraryRevealPrompt(ctx, controller, existingChosenCreatureType, {
      sourceId: String(item?.id || card?.id || effectiveCard.id || ''),
      sourceName: String(effectiveCard.name || 'Spell'),
      sourceImage: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      description: `${effectiveCard.name}: Look at the top ${chosenTypeLookReveal.lookCount} cards of your library. You may reveal any number of ${existingChosenCreatureType} cards from among them and put them into your hand. Put the rest on the bottom in a random order.`,
      lookCount: chosenTypeLookReveal.lookCount,
    });
    debug(2, `[applyInstantSorceryChosenCreatureTypeEffects] ${effectiveCard.name}: queued chosen-type top-library reveal (${queuedCount} card(s), type=${existingChosenCreatureType})`);
  }
}

function applyInstantSorceryChosenColorEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    oracleTextLower: string;
    existingChosenColor: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = options.oracleTextLower;
  const existingChosenColor = options.existingChosenColor;

  debug(2, `[applyInstantSorceryChosenColorEffects] ${effectiveCard.name} resolving with chosen color: ${existingChosenColor}`);

  // Brave: "White creatures … protection from the chosen color"
  // Borg Incursion: "artifact creatures … protection from the color of your choice"
  const protectionPattern = /(?:(artifact|enchantment|land|white|blue|black|red|green)\s+)?creatures?\s+(?:you control\s+)?(?:gains?|have)\s+protection from the (?:chosen colou?r|colou?r of your choice)\b/i;
  const protectionMatch = oracleTextLower.match(protectionPattern);

  if (!protectionMatch) {
    return;
  }

  const restrictionWord = String(protectionMatch[1] || '').toLowerCase();
  const colorMap: Record<string, string> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  };
  const restrictionColorCode = colorMap[restrictionWord] || '';
  const restrictionType = (!restrictionColorCode && restrictionWord) ? restrictionWord : '';
  const battlefield = state.battlefield || [];
  let affectedCount = 0;
  // Borg Incursion / token swarms: share one protection entry + grantedAbility string
  // across hundreds of identical creatures so SBA fingerprints and replay patch
  // clones stay batched instead of allocating unique arrays per permanent.
  const sharedProtection = {
    from: existingChosenColor,
    untilEndOfTurn: true,
    source: effectiveCard.name,
    grantedBy: card?.id,
  };
  const sharedGrantedAbility = `Protection from ${existingChosenColor} (until end of turn)`;
  const sharedProtectionList = [sharedProtection];
  const sharedGrantedList = [sharedGrantedAbility];

  for (const perm of battlefield) {
    if (!perm || perm.controller !== controller) continue;

    const permTypeLine = String(perm?.card?.type_line || '').toLowerCase();
    if (!permTypeLine.includes('creature')) continue;

    if (restrictionType && !permTypeLine.includes(restrictionType)) continue;

    if (restrictionColorCode) {
      const permColors = (perm?.card?.colors || []) as string[];
      if (!permColors.includes(restrictionColorCode)) continue;
    }

    if (!Array.isArray(perm.temporaryProtection) || perm.temporaryProtection.length === 0) {
      perm.temporaryProtection = sharedProtectionList;
    } else {
      perm.temporaryProtection.push(sharedProtection);
    }

    if (!Array.isArray(perm.grantedAbilities) || perm.grantedAbilities.length === 0) {
      perm.grantedAbilities = sharedGrantedList;
    } else {
      perm.grantedAbilities.push(sharedGrantedAbility);
    }
    affectedCount += 1;
  }

  debug(2, `[applyInstantSorceryChosenColorEffects] ${effectiveCard.name} granted protection from ${existingChosenColor} to ${affectedCount} creature(s)`);
}

export function tryResolveInstantSorceryPreResolutionChoices(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
    isReplaying: boolean;
  },
): boolean {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;
  const isReplaying = options.isReplaying;

  const hasCreatureTypeChoiceSpell = isCastCreatureTypeChoiceOracle(oracleText);
  const existingChosenCreatureType = String(card?.chosenCreatureType || item?.chosenCreatureType || '').trim();

  if (hasCreatureTypeChoiceSpell && !existingChosenCreatureType && !isReplaying) {
    const spellSteps = collectSpellResolutionEffectSteps(
      oracleText,
      String(effectiveCard.name || 'Spell'),
      buildOracleOverlayCollectOptions({
        cardName: String(effectiveCard.name || 'Spell'),
        card,
        effectiveCard,
        sourceItem: item,
      }),
    );
    if (requiresEffectProgramOrchestration(spellSteps)) {
      return false;
    }

    debug(2, `[tryResolveInstantSorceryPreResolutionChoices] ${effectiveCard.name} requires creature type choice, adding resolution step`);

    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: controller,
      description: `Choose a creature type for ${effectiveCard.name}`,
      mandatory: true,
      sourceId: card?.id || effectiveCard.id,
      sourceName: effectiveCard.name || 'Spell',
      sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
      spellId: item?.id || card?.id,
      cardName: effectiveCard.name || 'Spell',
      oracleText,
    } as any);

    state.stack = state.stack || [];
    state.stack.push(item);
    return true;
  }

  if (hasCreatureTypeChoiceSpell && existingChosenCreatureType) {
    applyInstantSorceryChosenCreatureTypeEffects(ctx, {
      controller,
      card,
      effectiveCard,
      item,
      oracleText,
      oracleTextLower,
      existingChosenCreatureType,
    });
  }

  // Leading "Choose a color." (Brave) or embedded "color of your choice" (Borg Incursion).
  const hasColorChoiceSpell = /^choose a colou?r\b/i.test(oracleTextLower.trim())
    || /\bcolou?r of your choice\b/i.test(oracleTextLower);
  const existingChosenColor = card?.chosenColor || item?.chosenColor;

  if (hasColorChoiceSpell && !existingChosenColor && !isReplaying) {
    const spellSteps = collectSpellResolutionEffectSteps(
      oracleText,
      String(effectiveCard.name || 'Spell'),
      buildOracleOverlayCollectOptions({
        cardName: String(effectiveCard.name || 'Spell'),
        card,
        effectiveCard,
        sourceItem: item,
      }),
    );
    // Effect Program owns choose_color compounds (e.g. Brave the Elements).
    // Do not also queue a stack COLOR_CHOICE — that doubles the prompt.
    if (requiresEffectProgramOrchestration(spellSteps)) {
      return false;
    }

    debug(2, `[tryResolveInstantSorceryPreResolutionChoices] ${effectiveCard.name} requires color choice, adding resolution step`);

    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.COLOR_CHOICE,
      playerId: controller,
      description: `Choose a color for ${effectiveCard.name}`,
      mandatory: true,
      sourceId: card?.id || effectiveCard.id,
      sourceName: effectiveCard.name || 'Spell',
      sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
      colors: ['white', 'blue', 'black', 'red', 'green'],
      spellId: item?.id || card?.id,
      oracleText,
    } as any);

    state.stack = state.stack || [];
    state.stack.push(item);
    return true;
  }

  if (hasColorChoiceSpell && existingChosenColor) {
    applyInstantSorceryChosenColorEffects(ctx, {
      controller,
      card,
      effectiveCard,
      oracleTextLower,
      existingChosenColor,
    });
    const spellSteps = collectSpellResolutionEffectSteps(
      oracleText,
      String(effectiveCard.name || 'Spell'),
      buildOracleOverlayCollectOptions({
        cardName: String(effectiveCard.name || 'Spell'),
        card,
        effectiveCard,
        sourceItem: item,
      }),
    );
    // Effect Program already queued the choose_color prompt. After applyEvent stamps
    // chosenColor, finish here so fallback does not start a second program.
    if (requiresEffectProgramOrchestration(spellSteps)) {
      return true;
    }
  }

  return false;
}
