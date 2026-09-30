import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { getTokenDoublerMultiplier } from './counters_tokens.js';
import { getCurrentPowerToughness } from './currentPowerToughness.js';
import { sumLongDurationPtModifiers } from './longDurationPtModifiers.js';
import { getTokenImageUrls } from '../../services/tokens.js';
import { isCelestialReunionOracle } from './chosen-creature-type.js';
import { triggerETBEffectsForToken } from './triggerEtbEntryEffects.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';
import { checkOpponentHasMoreLands } from './stackLandCountUtils.js';
import {
  detectTutorSpell,
  parseLibrarySearchFilter,
  resolveCelestialReunionLibrarySearch,
} from './oracleIrSpellLegacyTutorUtils.js';
import {
  cardMatchesRevealKind,
  detectRevealUntilHandSpell,
  summarizeLibraryCard,
} from './oracleIrSpellLegacyKindredRevealUtils.js';
import {
  shouldSkipLegacySpellBodyHandlers,
  skipRetiredSpellLegacyHandler,
} from './oracleIrSpellLegacyRouting.js';

function hasIrBridgedLibrarySearchForSpell(ctx: GameContext, spellName: string): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;
  const normalizedName = String(spellName || '').trim();
  return (ResolutionQueueManager.getQueue(gameId).steps || []).some(
    (step) => step.type === ResolutionStepType.LIBRARY_SEARCH
      && Boolean((step as any).oracleIrChoiceStepJson)
      && String((step as any).sourceName || '').trim() === normalizedName,
  );
}

export function hasOracleIrQueuedLibrarySearch(ctx: GameContext, spellName: string): boolean {
  return hasIrBridgedLibrarySearchForSpell(ctx, spellName);
}

function computeGreatestControlledCreaturePower(state: any, controller: PlayerID): number {
  const battlefield = state.battlefield || [];
  let greatestPower = 0;

  for (const perm of battlefield) {
    if (perm.controller !== controller) continue;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;

    // Shared current power (anthems, pumps, set-base effects, counters), same as the battlefield badge.
    try {
      const current = getCurrentPowerToughness(perm, state);
      if (current) {
        greatestPower = Math.max(greatestPower, Math.max(0, current.power));
        continue;
      }
    } catch {
      // fall back to the legacy estimate below
    }

    let basePower = perm.basePower ?? (parseInt(String(perm.card?.power ?? '0'), 10) || 0);

    if (typeof perm.card?.power === 'string' && perm.card.power.includes('*')) {
      if (typeof perm.basePower === 'number') {
        basePower = perm.basePower;
      }
    }

    const plusCounters = perm.counters?.['+1/+1'] || 0;
    const minusCounters = perm.counters?.['-1/-1'] || 0;
    const counterDelta = plusCounters - minusCounters;

    let otherCounterPower = 0;
    if (perm.counters) {
      for (const [counterType, count] of Object.entries(perm.counters)) {
        if (counterType === '+1/+1' || counterType === '-1/-1') continue;
        const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
        if (counterMatch) {
          const pMod = parseInt(counterMatch[1], 10);
          otherCounterPower += pMod * (count as number);
        }
      }
    }

    // Only pumps that are still active count (expired/end-of-turn entries are handled elsewhere).
    const modifierPower = sumLongDurationPtModifiers(perm, state).power;

    const effectivePower = Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower);
    if (effectivePower > greatestPower) {
      greatestPower = effectivePower;
    }
  }

  return greatestPower;
}

export function applyInstantSorceryTokenForEachCreatureHandler(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    oracleTextLower: string;
  },
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleTextLower, spellName)) {
    return;
  }
  // P1c: IR primary owns token-for-each compounds — skip legacy token rider.
  if (shouldSkipLegacySpellBodyHandlers(options.oracleTextLower, spellName)) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = options.oracleTextLower;

  const tokenForEachCreaturePattern = /create\s+(?:a|an|(\d+))\s+(\d+)\/(\d+)\s+(\w+)(?:\s+(\w+))?\s+(?:(\w+)\s+)?creature\s+tokens?\s+(?:with\s+[\w\s]+\s+)?for\s+each\s+creature\s+you\s+control/i;
  const tokenForEachMatch = oracleTextLower.match(tokenForEachCreaturePattern);
  if (!tokenForEachMatch) {
    return;
  }

  const battlefield = state.battlefield || [];
  let creatureCount = 0;
  for (const perm of battlefield) {
    if (!perm) continue;
    if (perm.controller !== controller) continue;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) {
      creatureCount++;
    }
  }

  const tokenQuantity = tokenForEachMatch[1] ? parseInt(tokenForEachMatch[1], 10) : 1;
  const tokenPower = parseInt(tokenForEachMatch[2], 10);
  const tokenToughness = parseInt(tokenForEachMatch[3], 10);
  const tokenColor = tokenForEachMatch[4]?.toLowerCase() || 'white';
  const tokenSubtype1 = tokenForEachMatch[5] || '';
  const tokenSubtype2 = tokenForEachMatch[6] || '';
  const tokenType = tokenSubtype2 || tokenSubtype1 || 'Soldier';

  const colorNameToCode: Record<string, string> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: '',
  };
  const colorCode = colorNameToCode[tokenColor] || 'W';
  const colors = colorCode ? [colorCode] : [];

  const tokensPerCreature = tokenQuantity;
  const totalBaseTokens = creatureCount * tokensPerCreature;
  const totalTokens = totalBaseTokens * getTokenDoublerMultiplier(controller, state);

  debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Creating ${totalTokens} ${tokenPower}/${tokenToughness} ${tokenColor} ${tokenType} tokens for ${controller} (${creatureCount} creatures x ${tokensPerCreature} tokens x doublers)`);

  for (let i = 0; i < totalTokens; i++) {
    const tokenId = uid('token');
    const typeLine = `Token Creature \u2014 ${tokenType}`;
    const imageUrls = getTokenImageUrls(tokenType, tokenPower, tokenToughness, colors);

    const token = {
      id: tokenId,
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower: tokenPower,
      baseToughness: tokenToughness,
      summoningSickness: true,
      isToken: true,
      card: {
        id: tokenId,
        name: tokenType,
        type_line: typeLine,
        power: String(tokenPower),
        toughness: String(tokenToughness),
        zone: 'battlefield',
        colors,
        image_uris: imageUrls,
      },
    };

    state.battlefield.push(token as any);
    triggerETBEffectsForToken(ctx, token, controller);
  }

  debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Created ${totalTokens} ${tokenType} tokens for ${controller}`);
}

export function applyInstantSorceryLibrarySearchSpellHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
  },
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }
  // P1c: IR primary owns tutor / library-search compounds — skip legacy library riders.
  if (shouldSkipLegacySpellBodyHandlers(options.oracleText, spellName)) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;

  // Celestial: skip legacy tutor when IR already queued LIBRARY_SEARCH (primary or uncategorized fallback).
  if (isCelestialReunionOracle(oracleText)) {
    if (hasOracleIrQueuedLibrarySearch(ctx, spellName)) {
      debug(
        2,
        `[resolveTopOfStack] ${spellName}: skipping legacy Celestial library search (Oracle IR choice already queued)`,
      );
    } else {
      resolveCelestialReunionLibrarySearch(ctx, controller, item, card, effectiveCard);
    }
  }

  const tutorInfo = isCelestialReunionOracle(oracleText) ? { isTutor: false } : detectTutorSpell(oracleText);
  if (tutorInfo.isTutor && hasOracleIrQueuedLibrarySearch(ctx, spellName)) {
    debug(
      2,
      `[resolveTopOfStack] ${spellName}: skipping legacy tutor library search (Oracle IR choice already queued)`,
    );
  } else if (tutorInfo.isTutor) {
    const isVampiric = (effectiveCard.name || '').toLowerCase().trim() === 'vampiric tutor';
    const tutorFilter = parseLibrarySearchFilter(tutorInfo.searchCriteria || '');
    enqueueLibrarySearchStep(ctx, controller, {
      searchFor: tutorInfo.searchCriteria || 'a card',
      description: `${effectiveCard.name}: Search your library for ${tutorInfo.searchCriteria || 'a card'}`,
      destination: tutorInfo.destination || 'hand',
      entersTapped: tutorInfo.entersTapped === true,
      optional: tutorInfo.optional || false,
      source: effectiveCard.name || 'Tutor',
      shuffleAfter: true,
      filter: tutorFilter,
      maxSelections: tutorInfo.maxSelections || 1,
      minSelections: tutorInfo.optional ? 0 : 1,
      splitDestination: tutorInfo.splitDestination || false,
      toBattlefield: tutorInfo.toBattlefield,
      toHand: tutorInfo.toHand,
      lifeLoss: isVampiric ? 2 : undefined,
    });
    debug(2, `[resolveTopOfStack] Tutor spell ${effectiveCard.name}: ${controller} may search for ${tutorInfo.searchCriteria || 'a card'} (destination: ${tutorInfo.destination}, split: ${tutorInfo.splitDestination || false})`);
  }

  const revealUntilHandInfo = detectRevealUntilHandSpell(
    oracleText,
    String((effectiveCard as any).abundantChoice || (item as any)?.targets?.abundantChoice || (item as any)?.abundantChoice || ''),
  );
  if (revealUntilHandInfo) {
    const lib = ((ctx as any).libraries as Map<string, any[]>)?.get(controller) || [];
    const availableCards: any[] = [];
    const nonSelectableCards: any[] = [];

    for (const libCard of lib) {
      const summary = summarizeLibraryCard(libCard);
      if (availableCards.length === 0 && cardMatchesRevealKind(libCard, revealUntilHandInfo.revealKind)) {
        availableCards.push(summary);
        break;
      }
      nonSelectableCards.push(summary);
    }

    ResolutionQueueManager.addStep((ctx as any).gameId || 'unknown', {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: controller,
      description: `${effectiveCard.name}: Reveal cards from the top of your library until you reveal a ${revealUntilHandInfo.revealKind} card. Put that card into your hand and the rest on the bottom of your library in a random order.`,
      mandatory: availableCards.length > 0,
      sourceName: effectiveCard.name || 'Reveal Until',
      searchCriteria: `${revealUntilHandInfo.revealKind} card`,
      minSelections: availableCards.length > 0 ? 1 : 0,
      maxSelections: availableCards.length > 0 ? 1 : 0,
      destination: 'hand',
      reveal: true,
      shuffleAfter: false,
      availableCards,
      nonSelectableCards,
      revealedCards: [...nonSelectableCards, ...availableCards],
      remainderDestination: 'bottom',
      remainderRandomOrder: true,
      persistLibrarySearchResolve: true,
      persistLibrarySearchResolveReason: 'stack_resolution',
    } as any);
    debug(2, `[resolveTopOfStack] ${effectiveCard.name}: queued reveal-until-${revealUntilHandInfo.revealKind} selection with ${availableCards.length} matching card(s)`);
  }

  const isGamble = effectiveCard.name?.toLowerCase().trim() === 'gamble';
  if (isGamble) {
    enqueueLibrarySearchStep(ctx, controller, {
      searchFor: 'a card',
      description: 'Gamble: Search your library for a card',
      destination: 'hand',
      optional: false,
      source: 'Gamble',
      shuffleAfter: true,
      maxSelections: 1,
    });
    debug(2, `[resolveTopOfStack] Gamble: ${controller} will search for a card (discard handled separately)`);
  }

  const isGiftOfEstates = effectiveCard.name?.toLowerCase().includes('gift of estates')
    || (
      oracleTextLower.includes('if an opponent controls more lands than you')
      && oracleTextLower.includes('search')
      && oracleTextLower.includes('plains')
      && !/\b(?:when|whenever|at)\b[^,]*,\s*if\s+an\s+opponent\s+controls\s+more\s+lands/i.test(oracleTextLower)
    );

  if (isGiftOfEstates) {
    const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(state, controller);

    if (anyOpponentHasMoreLands) {
      enqueueLibrarySearchStep(ctx, controller, {
        searchFor: 'Plains cards',
        description: `${effectiveCard.name}: Search for up to three Plains cards`,
        destination: 'hand',
        optional: true,
        source: effectiveCard.name || 'Gift of Estates',
        shuffleAfter: true,
        maxSelections: 3,
        filter: { subtypes: ['plains'] },
        minSelections: 0,
      });
      debug(2, `[resolveTopOfStack] Gift of Estates: Condition met (opponent has more lands) - ${controller} may search for up to 3 Plains`);
    } else {
      debug(2, `[resolveTopOfStack] Gift of Estates: Condition NOT met - ${controller} has ${myLandCount} lands, no opponent has more`);
    }
  }

  const isTraverseOutlands = effectiveCard.name?.toLowerCase().includes('traverse the outlands')
    || (
      oracleTextLower.includes('search your library')
      && oracleTextLower.includes('greatest power')
      && oracleTextLower.includes('basic land')
    );

  if (isTraverseOutlands) {
    const greatestPower = computeGreatestControlledCreaturePower(state, controller);
    enqueueLibrarySearchStep(ctx, controller, {
      searchFor: 'basic land cards',
      description: `${effectiveCard.name}: Search for up to ${greatestPower} basic lands`,
      destination: 'battlefield',
      entersTapped: true,
      optional: true,
      source: effectiveCard.name || 'Traverse the Outlands',
      shuffleAfter: true,
      maxSelections: greatestPower,
      filter: { types: ['land'], supertypes: ['basic'] },
      minSelections: 0,
    });
    debug(2, `[resolveTopOfStack] Traverse the Outlands: ${controller} may search for up to ${greatestPower} basic lands (greatest power with counters/modifiers)`);
  }

  const isBoundlessRealms = effectiveCard.name?.toLowerCase().includes('boundless realms')
    || (
      oracleTextLower.includes('search your library')
      && oracleTextLower.includes('number of lands you control')
      && oracleTextLower.includes('basic land')
    );

  if (isBoundlessRealms) {
    const battlefield = state.battlefield || [];
    const landCount = battlefield.filter((p: any) =>
      p.controller === controller
      && (p.card?.type_line || '').toLowerCase().includes('land'),
    ).length;

    enqueueLibrarySearchStep(ctx, controller, {
      searchFor: 'basic land cards',
      description: `${effectiveCard.name}: Search for up to ${landCount} basic lands`,
      destination: 'battlefield',
      entersTapped: true,
      optional: true,
      source: effectiveCard.name || 'Boundless Realms',
      shuffleAfter: true,
      maxSelections: landCount,
      filter: { types: ['land'], supertypes: ['basic'] },
      minSelections: 0,
    });
    debug(2, `[resolveTopOfStack] Boundless Realms: ${controller} may search for up to ${landCount} basic lands (lands controlled)`);
  }
}
