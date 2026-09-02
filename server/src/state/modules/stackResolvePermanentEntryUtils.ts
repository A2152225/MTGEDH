import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { mergeRetainedCountersForBattlefieldEntry } from '../../../../shared/src/zoneRetainedCounters.js';
import { detectEntersWithCounters } from './detectEntersWithCounters.js';
import { deriveSelfEntryCountersFromOracleIR } from '../../../../rules-engine/src/oracleIRSelfEntryCounters.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
import { checkPermanentEntersTapped } from './triggerPermanentEntersTapped.js';
import { creatureWillHaveHaste } from './creatureEntryHasteUtils.js';
import { applyCounterModifications } from './counters_tokens.js';
import { evaluateBattlefieldEntryReplacementEvent } from './replacement-effects.js';
import { applyTriggeredReanimationEntryRiders } from './triggerReanimationRiders.js';
import { scheduleWarpDelayedExileOnPermanentEntry } from './warpDelayedEffects.js';
import {
  scheduleKeywordCastDelayedEffectsOnPermanentEntry,
  spellWasCastWithBlitzPaid,
  spellWasCastWithDashPaid,
} from './keywordCastDelayedEffects.js';
import { applySneakPermanentBattlefieldEntry } from './sneakCastUtils.js';
import { selfLeaveBattlefieldReplacementDestination } from './leaveBattlefieldReplacementHint.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import {
  createMutatedPermanent,
  getMutatedPermanentAbilities,
  getMutatedPermanentCharacteristics,
} from '../../../../rules-engine/src/keywordAbilities/mutate.js';
import { syncArcaneAdaptationForNewCreature } from './chosen-creature-type.js';
import { applyMetallicMimicEntryBonus } from './triggerChosenTypeSpellUtils.js';
import { applyGraveyardTypeEntryCounterGrants } from './graveyardTypeEntryCounterBonus.js';
import { cardEntersPrepared, setPermanentPrepared } from './prepared.js';
import { hydratePermanentCardOracleInPlace, hydrateCardOracleInPlace } from './cardOracleHydration.js';
import { inferLeaveBattlefieldExileReplacement, applyLeaveBattlefieldExileReplacementStamp } from './leaveBattlefieldReplacementStamp.js';
import { lookupLocalCardByNameSync } from '../../services/localCardLookup.js';
import { queueMutateTriggeredAbilities as queueMutateTriggeredAbilitiesImpl } from './stackResolvePermanentEntryUtils-handlers/queueMutateTriggeredAbilities.js';
import type {
  PermanentBattlefieldEntryOptions,
  PermanentBattlefieldEntryOutcome,
} from './stackResolveSharedTypes.js';

export type { PermanentBattlefieldEntryOutcome } from './stackResolveSharedTypes.js';

function readPrintedLoyalty(source: unknown): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const raw = (source as { loyalty?: unknown }).loyalty;
  if (raw == null || String(raw).trim() === '') return undefined;
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readControllerLifeTotal(state: unknown, controller: unknown): number | undefined {
  const stateAny = state as { life?: Record<string, unknown>; players?: Array<{ id?: unknown; life?: unknown }> } | undefined;
  const id = String(controller || '').trim();
  if (!id || !stateAny) return undefined;

  const fromMap = Number(stateAny.life?.[id]);
  if (Number.isFinite(fromMap)) return Math.floor(fromMap);

  const player = Array.isArray(stateAny.players)
    ? stateAny.players.find((entry) => String(entry?.id || '').trim() === id)
    : undefined;
  const fromPlayer = Number(player?.life);
  return Number.isFinite(fromPlayer) ? Math.floor(fromPlayer) : undefined;
}

function loyaltyEqualsControllerLifeTotal(card: any): boolean {
  const oracleText = String(card?.oracle_text || card?.oracleText || '')
    .replace(/\s+/g, ' ')
    .trim();
  return /loyalty counters?\s+on (?:it|him|her)\s+equal to (?:your|its controller'?s) life total/i.test(oracleText);
}

function getEnteringPlaneswalkerLoyaltyValue(state: unknown, controller: unknown, card: any): number | undefined {
  if (!card || typeof card !== 'object') return undefined;

  hydrateCardOracleInPlace(card);

  if (loyaltyEqualsControllerLifeTotal(card)) {
    const lifeTotal = readControllerLifeTotal(state, controller);
    if (typeof lifeTotal === 'number' && Number.isFinite(lifeTotal)) return Math.max(0, lifeTotal);
  }

  const direct = readPrintedLoyalty(card);
  if (direct != null) return direct;

  const faces = Array.isArray((card as any).card_faces) ? (card as any).card_faces : [];
  for (const face of faces) {
    const faceLoyalty = readPrintedLoyalty(face);
    if (faceLoyalty != null) return faceLoyalty;
  }

  const cardName = String((card as any).name || '').trim();
  if (!cardName) return undefined;

  const record = lookupLocalCardByNameSync(cardName);
  const fromLookup = readPrintedLoyalty(record);
  if (fromLookup != null) return fromLookup;

  const lookupFaces = Array.isArray(record?.card_faces) ? record.card_faces : [];
  for (const face of lookupFaces) {
    const faceLoyalty = readPrintedLoyalty(face);
    if (faceLoyalty != null) return faceLoyalty;
  }

  return undefined;
}

export function queueMutateTriggeredAbilities(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  queueMutateTriggeredAbilitiesImpl(ctx, permanent, controller);
}

export function resolvePermanentSpellBattlefieldEntry(
  ctx: GameContext,
  options: PermanentBattlefieldEntryOptions,
): PermanentBattlefieldEntryOutcome {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const effectiveTypeLine = options.effectiveTypeLine;
  const item = options.item;
  const targets = options.targets;
  const fallbackOracleText = options.fallbackOracleText;

  // Permanent spell resolves - move to battlefield
  const tl = (effectiveTypeLine || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isPlaneswalker = /\bplaneswalker\b/.test(tl);
  
  // Check if this was cast with morph (face-down)
  const wasCastWithMorph = (item as any).wasCastWithMorph || false;
  const morphCost = wasCastWithMorph ? (item as any).morphCost : undefined;
  
  let baseP: number | undefined;
  let baseT: number | undefined;
  
  if (wasCastWithMorph) {
    // Face-down creatures are always 2/2 colorless
    baseP = 2;
    baseT = 2;
  } else {
    baseP = isCreature ? parsePT((effectiveCard as any).power) : undefined;
    baseT = isCreature ? parsePT((effectiveCard as any).toughness) : undefined;
  }
  
  // Check if the creature has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const gainsHasteUntilEndOfTurnFromManaSpent = isCreature && (
    (item as any).gainsHasteUntilEndOfTurnFromManaSpent === true ||
    (item as any).card?.gainsHasteUntilEndOfTurnFromManaSpent === true
  );
  const hasHaste = isCreature && (
    gainsHasteUntilEndOfTurnFromManaSpent ||
    spellWasCastWithDashPaid(item, effectiveCard) ||
    spellWasCastWithBlitzPaid(item, effectiveCard) ||
    creatureWillHaveHaste(effectiveCard, controller, battlefield)
  );
  
  // Creatures have summoning sickness when they enter (unless they have haste)
  // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
  // activated unless the creature has been under controller's control since 
  // their most recent turn began.
  const hasSummoningSickness = isCreature && !hasHaste;
  
  // Initialize counters - planeswalkers enter with loyalty counters equal to their printed loyalty
  const initialCounters: Record<string, number> = {};
  if (isPlaneswalker) {
    const startingLoyalty = getEnteringPlaneswalkerLoyaltyValue(state, controller, effectiveCard);
    if (typeof startingLoyalty === 'number' && !Number.isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
      debug(2, `[resolveTopOfStack] Planeswalker ${effectiveCard.name} enters with ${startingLoyalty} loyalty`);
    }
  }
  
  // Special handling for Jeska, Thrice Reborn and similar cards
  // "Jeska enters with a loyalty counter on her for each time you've cast a commander from the command zone this game."
  const oracleTextLower = String((effectiveCard as any)?.oracle_text || fallbackOracleText || '').toLowerCase();
  if (isPlaneswalker && (
    oracleTextLower.includes("enters with a loyalty counter") && 
    oracleTextLower.includes("for each time") && 
    oracleTextLower.includes("commander from the command zone")
  )) {
    // Same authoritative CZ-cast count as Hatut-style "copy it for each time you've cast your commander..."
    // (taxById sum / 2, with explicit commanderCastsFromCommandZoneThisGame fallback).
    const totalCommanderCasts = resolveCommanderCastsFromCommandZoneThisGame(state as any, controller);
    
    // Add loyalty for each commander cast (including Jeska herself if she was just cast from command zone)
    if (totalCommanderCasts > 0) {
      initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
    }
  }
  
  // Check for "enters with counters" patterns (Zack Fair, modular creatures, sagas, etc.)
  const etbCounters = detectEntersWithCounters(effectiveCard);
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s)`);
  }

  const spellXValue = Number((item as any)?.xValue ?? (item as any)?.card?.xValue ?? (effectiveCard as any)?.xValue);
  const wasCastKicked = (item as any)?.wasKicked === true
    || (item as any)?.card?.wasKicked === true
    || (effectiveCard as any)?.wasKicked === true
    || Number((item as any)?.timesKicked ?? (item as any)?.card?.timesKicked ?? (effectiveCard as any)?.timesKicked) > 0
    || Number((item as any)?.kickerPaidCount ?? (item as any)?.card?.kickerPaidCount ?? (effectiveCard as any)?.kickerPaidCount) > 0;
  const irEntryCounters = deriveSelfEntryCountersFromOracleIR({
    oracleText: String((effectiveCard as any)?.oracle_text || fallbackOracleText || ''),
    cardName: String((effectiveCard as any)?.name || (item as any)?.cardName || ''),
    xValue: Number.isFinite(spellXValue) ? spellXValue : undefined,
    wasKicked: wasCastKicked,
  });
  if (irEntryCounters) {
    for (const [counterType, rawCount] of Object.entries(irEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      initialCounters[counterType] = Math.max(Number(initialCounters[counterType] || 0), count);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s) from self-entry replacement`);
    }
  }

  const explicitEntryCounters = ((item as any).entersBattlefieldWithCounters && typeof (item as any).entersBattlefieldWithCounters === 'object')
    ? (item as any).entersBattlefieldWithCounters as Record<string, number>
    : ((effectiveCard as any)?.entersBattlefieldWithCounters && typeof (effectiveCard as any).entersBattlefieldWithCounters === 'object')
      ? (effectiveCard as any).entersBattlefieldWithCounters as Record<string, number>
      : undefined;
  if (explicitEntryCounters) {
    for (const [counterType, rawCount] of Object.entries(explicitEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      // Cast-time metadata like escape counters may also be recognizable from Oracle text.
      // Merge by max so a duplicated source does not double-count on entry.
      initialCounters[counterType] = Math.max(Number(initialCounters[counterType] || 0), count);
    }
  }
  
  // Yuna, Grand Summoner: "When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
  if (isCreature && (state as any).yunaNextCreatureFlags?.[controller]) {
    initialCounters['+1/+1'] = (initialCounters['+1/+1'] || 0) + 2;
    debug(2, `[resolveTopOfStack] Yuna's Grand Summon: ${effectiveCard.name} enters with 2 additional +1/+1 counters`);
    // Clear the flag
    delete (state as any).yunaNextCreatureFlags[controller];
  }
  
  // Check if this creature should enter tapped due to effects like Authority of the Consuls, Blind Obedience, etc.
  const shouldEnterTapped = checkPermanentEntersTapped(state.battlefield || [], controller, effectiveCard);
  
  state.battlefield = state.battlefield || [];
  // Prefer the stack item id so live ETB choices and event-log replay share one stable permanent id.
  const newPermId =
    String(options.preferredPermanentId || (item as any)?.id || '').trim() || uid("perm");
  
  // Apply counter modifiers (Doubling Season, Vorinclex, etc.) to ETB counters
  // Need to create a temporary permanent to apply modifiers
  const retainedEntryCounters = mergeRetainedCountersForBattlefieldEntry(
    effectiveCard,
    String((item as any).source || (effectiveCard as any)?.castSourceZone || 'hand'),
    initialCounters
  ) || {};
  const tempPerm = { id: newPermId, controller, counters: {} };
  state.battlefield.push(tempPerm as any);
  const modifiedCounters = applyCounterModifications(state, newPermId, retainedEntryCounters);
  state.battlefield.pop(); // Remove temp permanent
  const copiedPermanentSpellBecomesToken = (item as any).isCopy === true;
  const entryReplacement = evaluateBattlefieldEntryReplacementEvent({
    state,
    card: effectiveCard,
    controllerId: String(controller),
    entersTapped: shouldEnterTapped,
    entryCounters: modifiedCounters,
    entersTransformed: Boolean((effectiveCard as any)?.transformed || (item as any)?.transformed),
    entersFaceDown: wasCastWithMorph,
    copySourceId: copiedPermanentSpellBecomesToken ? String((item as any).copiedFromStackItemId || (item as any).copiedFromPermanentId || '') : undefined,
    cause: 'spell_resolution',
  });
  
  const newPermanent: any = {
    id: newPermId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    ...(copiedPermanentSpellBecomesToken ? { isToken: true } : {}),
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
    ...(entryReplacement.applied ? { battlefieldEntryReplacement: entryReplacement } : {}),
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    ...(isCreature ? { enteredThisTurn: true } : {}),
    card: wasCastWithMorph ? { 
      // Face-down card - show generic 2/2 colorless creature
      name: "Face-down Creature",
      type_line: "Creature",
      zone: "battlefield",
      power: "2",
      toughness: "2",
    } : (() => {
      const nextCard: any = { ...effectiveCard, zone: "battlefield" };
      if ('counters' in nextCard) delete nextCard.counters;
      return nextCard;
    })(),
    // Preserve isCommander flag from stack item if it exists
    isCommander: (item as any).card?.isCommander || (effectiveCard as any).isCommander || false,
  };

  if (copiedPermanentSpellBecomesToken && newPermanent.card) {
    // A copy of a permanent spell becomes a token with its own object identity.
    // Retaining the physical source card id makes zone/idempotency checks mistake
    // the token for the original card (and can leave or scrub a ghost in hand).
    (newPermanent.card as any).copiedFromCardId = String((effectiveCard as any)?.id || '').trim() || undefined;
    (newPermanent.card as any).id = newPermId;
    (newPermanent.card as any).isToken = true;
  }

  const leaveBattlefieldReplacementDestination = String(
    (effectiveCard as any)?.leaveBattlefieldReplacementDestination
    || (item as any)?.leaveBattlefieldReplacementDestination
    || (item as any)?.card?.leaveBattlefieldReplacementDestination
    || ''
  ).trim().toLowerCase();
  const leaveBattlefieldReplacementSourceName = String(
    (effectiveCard as any)?.leaveBattlefieldReplacementSourceName
    || (item as any)?.leaveBattlefieldReplacementSourceName
    || (item as any)?.card?.leaveBattlefieldReplacementSourceName
    || ''
  ).trim();
  const leaveBattlefieldReplacementLifeGain = Number(
    (effectiveCard as any)?.leaveBattlefieldReplacementLifeGain
    || (item as any)?.leaveBattlefieldReplacementLifeGain
    || (item as any)?.card?.leaveBattlefieldReplacementLifeGain
    || 0
  );
  const fromSelfReplacement = selfLeaveBattlefieldReplacementDestination(
    String((effectiveCard as any)?.oracle_text || (effectiveCard as any)?.oracleText || ''),
  );
  if (leaveBattlefieldReplacementDestination === 'exile' || fromSelfReplacement === 'exile') {
    (newPermanent as any).leaveBattlefieldReplacementDestination = 'exile';
    (newPermanent.card as any).leaveBattlefieldReplacementDestination = 'exile';
    if (leaveBattlefieldReplacementSourceName) {
      (newPermanent as any).leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
      (newPermanent.card as any).leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
    }
    if (leaveBattlefieldReplacementLifeGain > 0) {
      (newPermanent as any).leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
      (newPermanent.card as any).leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
    }
  }

  // Propagate relevant cast metadata from the stack item onto the permanent/card.
  // This enables ETB intervening-if clauses like "if {R} was spent to cast it".
  if ((item as any).manaColorsSpent && Array.isArray((item as any).manaColorsSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaColorsSpent = (item as any).manaColorsSpent;
    (newPermanent.card as any).manaColorsSpent = (item as any).manaColorsSpent;
  }

  if (typeof (item as any).manaSpentTotal === 'number' && !Number.isNaN((item as any).manaSpentTotal) && !wasCastWithMorph) {
    (newPermanent as any).manaSpentTotal = (item as any).manaSpentTotal;
    (newPermanent.card as any).manaSpentTotal = (item as any).manaSpentTotal;
  }

  if ((item as any).manaSpentBreakdown && typeof (item as any).manaSpentBreakdown === 'object' && !wasCastWithMorph) {
    (newPermanent as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
    (newPermanent.card as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
  }

  // Alternate-cost id (e.g., surge/spectacle/madness/prowl) for intervening-if and other templates.
  if (typeof (item as any).alternateCostId === 'string' && (item as any).alternateCostId.length > 0 && !wasCastWithMorph) {
    (newPermanent as any).alternateCostId = (item as any).alternateCostId;
    (newPermanent.card as any).alternateCostId = (item as any).alternateCostId;
  }

  // Convoke-derived metadata: how many creatures contributed mana.
  if (typeof (item as any).manaFromCreaturesSpent === 'number' && !Number.isNaN((item as any).manaFromCreaturesSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
    (newPermanent.card as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
  }
  if (Array.isArray((item as any).convokeTappedCreatures) && !wasCastWithMorph) {
    (newPermanent as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
    (newPermanent.card as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
  }

  // Track cast origin (best-effort) for intervening-if clauses like "if you cast it" / "if you cast it from your hand".
  // Only set these on permanents created from resolving a stack item.
  (newPermanent as any).enteredFromCast = true;
  (newPermanent.card as any).enteredFromCast = true;
  // Propagate as-enters choices already chosen on the stack/card (replay restore + spell-time choices).
  const chosenCreatureType = String(
    (item as any)?.chosenCreatureType
    || (effectiveCard as any)?.chosenCreatureType
    || (item as any)?.card?.chosenCreatureType
    || '',
  ).trim();
  if (chosenCreatureType) {
    (newPermanent as any).chosenCreatureType = chosenCreatureType;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenCreatureType = chosenCreatureType;
    }
  }
  const chosenColor = String(
    (item as any)?.chosenColor
    || (effectiveCard as any)?.chosenColor
    || (item as any)?.card?.chosenColor
    || '',
  ).trim();
  if (chosenColor) {
    (newPermanent as any).chosenColor = chosenColor;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenColor = chosenColor;
    }
  }
  const chosenCardName = String(
    (item as any)?.chosenCardName
    || (effectiveCard as any)?.chosenCardName
    || (item as any)?.card?.chosenCardName
    || '',
  ).trim();
  if (chosenCardName) {
    (newPermanent as any).chosenCardName = chosenCardName;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenCardName = chosenCardName;
    }
  }
  const chosenPlayer = String(
    (item as any)?.chosenPlayer
    || (effectiveCard as any)?.chosenPlayer
    || (item as any)?.card?.chosenPlayer
    || '',
  ).trim();
  if (chosenPlayer) {
    (newPermanent as any).chosenPlayer = chosenPlayer;
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).chosenPlayer = chosenPlayer;
    }
  }
  if (typeof (item as any).castFromHand === 'boolean') {
    (newPermanent as any).castFromHand = (item as any).castFromHand;
    (newPermanent.card as any).castFromHand = (item as any).castFromHand;
  }
  if (typeof (item as any).source === 'string' && (item as any).source.length > 0) {
    (newPermanent as any).castSourceZone = (item as any).source;
    (newPermanent.card as any).castSourceZone = (item as any).source;
  }
  if (String((effectiveCard as any)?.castWithAbility || (item as any)?.card?.castWithAbility || '').trim().toLowerCase() === 'escape') {
    (newPermanent as any).escapedFrom = 'graveyard';
    (newPermanent.card as any).escapedFrom = 'graveyard';
  }
  if (gainsHasteUntilEndOfTurnFromManaSpent) {
    (newPermanent as any).temporaryAbilities = Array.isArray((newPermanent as any).temporaryAbilities)
      ? (newPermanent as any).temporaryAbilities
      : [];
    const alreadyHasTemporaryHaste = (newPermanent as any).temporaryAbilities.some((entry: any) =>
      String(entry?.ability || entry?.keyword || entry?.name || '').toLowerCase() === 'haste'
    );
    if (!alreadyHasTemporaryHaste) {
      (newPermanent as any).temporaryAbilities.push({ ability: 'haste', expiresAt: 'end_of_turn' });
    }
    newPermanent.summoningSickness = false;
  }
  
  // Store face-down information
  if (wasCastWithMorph) {
    newPermanent.isFaceDown = true;
    newPermanent.faceDownType = 'morph';
    newPermanent.faceUpCard = effectiveCard; // Store the actual card hidden
    newPermanent.morphCost = morphCost;
  }
  
  // Add loyalty metadata only for planeswalkers
  if (isPlaneswalker) {
    const resolvedLoyalty = modifiedCounters.loyalty
      ?? initialCounters.loyalty
      ?? getEnteringPlaneswalkerLoyaltyValue(state, controller, effectiveCard);
    if (typeof resolvedLoyalty === 'number' && resolvedLoyalty > 0) {
      newPermanent.loyalty = resolvedLoyalty;
      newPermanent.baseLoyalty = resolvedLoyalty;
      if (!newPermanent.counters || typeof newPermanent.counters !== 'object') {
        newPermanent.counters = { loyalty: resolvedLoyalty };
      } else if ((newPermanent.counters as any).loyalty == null) {
        (newPermanent.counters as any).loyalty = resolvedLoyalty;
      }
    } else {
      debugWarn(1, `[PLANESWALKER] ${effectiveCard.name} entering without loyalty counters`);
    }
    debug(1, `[PLANESWALKER DEBUG] ${effectiveCard.name} entering battlefield:`, {
      loyalty: newPermanent.loyalty,
      baseLoyalty: newPermanent.baseLoyalty,
      counters: newPermanent.counters,
      hasOracleText: !!effectiveCard.oracle_text,
      oracleTextLength: effectiveCard.oracle_text?.length || 0,
    });
  }

  applyTriggeredReanimationEntryRiders(
    ctx,
    newPermanent,
    String(effectiveCard?.name || (item as any)?.card?.name || 'Permanent'),
    controller,
    String(effectiveCard?.oracle_text || ''),
  );

  scheduleWarpDelayedExileOnPermanentEntry(
    ctx,
    newPermanent,
    controller,
    String(effectiveCard?.name || (item as any)?.card?.name || 'Permanent'),
    item,
  );

  scheduleKeywordCastDelayedEffectsOnPermanentEntry(
    ctx,
    newPermanent,
    controller,
    String(effectiveCard?.name || (item as any)?.card?.name || 'Permanent'),
    item,
  );

  applySneakPermanentBattlefieldEntry(newPermanent, item);

  hydratePermanentCardOracleInPlace(newPermanent);

  if (
    (item as any)?.castFromGraveyard === true
    || (effectiveCard as any)?.castFromGraveyard === true
    || (item as any)?.card?.castFromGraveyard === true
    || ['graveyard', 'gy'].includes(
      String(
        (item as any)?.fromZone
        || (item as any)?.castSourceZone
        || (item as any)?.card?.fromZone
        || (item as any)?.card?.castSourceZone
        || '',
      ).trim().toLowerCase(),
    )
  ) {
    (newPermanent as any).castFromGraveyard = true;
    (newPermanent as any).fromZone = 'graveyard';
    if (newPermanent.card && typeof newPermanent.card === 'object') {
      (newPermanent.card as any).castFromGraveyard = true;
      (newPermanent.card as any).fromZone = 'graveyard';
    }
    const permissionSourceName = String(
      (item as any)?.graveyardPermissionSourceName
      || (item as any)?.card?.graveyardPermissionSourceName
      || (effectiveCard as any)?.graveyardPermissionSourceName
      || '',
    ).trim();
    if (permissionSourceName) {
      (newPermanent as any).graveyardPermissionSourceName = permissionSourceName;
      if (newPermanent.card && typeof newPermanent.card === 'object') {
        (newPermanent.card as any).graveyardPermissionSourceName = permissionSourceName;
      }
    }
  }
  applyLeaveBattlefieldExileReplacementStamp(
    newPermanent,
    inferLeaveBattlefieldExileReplacement(newPermanent, state, item),
  );

  const isMutatingSpell =
    !wasCastWithMorph &&
    isCreature &&
    (
      (effectiveCard as any)?.isMutating === true ||
      String((item as any)?.alternateCostId || (effectiveCard as any)?.alternateCostId || '').toLowerCase().trim() === 'mutate'
    );

  if (isMutatingSpell) {
    const mutateTargetId = String((effectiveCard as any)?.mutateTarget || targets?.[0] || '').trim();
    const mutateOnTop = Boolean((effectiveCard as any)?.mutateOnTop);
    const mutateTarget = mutateTargetId
      ? (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === mutateTargetId)
      : null;
    const mutateTargetTypeLine = String(mutateTarget?.card?.type_line || '').toLowerCase();
    const spellOwner = String(controller || '').trim();
    const targetOwner = String((mutateTarget as any)?.owner || (mutateTarget as any)?.controller || '').trim();
    const legalMutateTarget = Boolean(
      mutateTarget &&
      isCreatureNow(mutateTarget) &&
      !mutateTargetTypeLine.includes('human') &&
      targetOwner &&
      targetOwner === spellOwner
    );

    if (legalMutateTarget) {
      const existingMutatedStack = Array.isArray((mutateTarget as any).mutatedStack)
        ? ((mutateTarget as any).mutatedStack as any[])
        : [];
      const mutatingCardId = String((effectiveCard as any)?.id || '').trim();
      const alreadyMerged = Boolean(mutatingCardId) && existingMutatedStack.some((entry: any) => String(entry?.id || '') === mutatingCardId);

      if (!alreadyMerged) {
        const existingMutation = existingMutatedStack.length > 0
          ? {
              permanentId: String((mutateTarget as any).id || mutateTargetId),
              controller: String((mutateTarget as any).controller || controller),
              owner: targetOwner,
              cardStack: existingMutatedStack.map((entry: any) => ({
                id: String(entry?.id || ''),
                name: String(entry?.name || ''),
                typeLine: String(entry?.typeLine || ''),
                oracleText: String(entry?.oracleText || ''),
                power: entry?.power,
                toughness: entry?.toughness,
                manaCost: entry?.manaCost,
                isOriginal: entry?.isOriginal === true,
                isCommander: entry?.isCommander === true,
              })),
              mutationCount: Number((mutateTarget as any).mutationCount || Math.max(1, existingMutatedStack.length - 1)),
              summoningSicknessInherited: !(mutateTarget as any).summoningSickness,
            }
          : undefined;

        const mutatedPermanent = createMutatedPermanent(
          mutateTarget,
          {
            ...(effectiveCard as any),
            isCommander: (item as any).card?.isCommander || (effectiveCard as any).isCommander || false,
          },
          mutateOnTop,
          existingMutation as any,
        );
        const topCharacteristics = getMutatedPermanentCharacteristics(mutatedPermanent);
        const combinedAbilities = getMutatedPermanentAbilities(mutatedPermanent);
        const topCardEntry = mutatedPermanent.cardStack[0];

        (mutateTarget as any).mutatedStack = mutatedPermanent.cardStack.map((entry: any) => ({
          id: entry.id,
          name: entry.name,
          typeLine: entry.typeLine,
          oracleText: entry.oracleText,
          power: entry.power,
          toughness: entry.toughness,
          manaCost: entry.manaCost,
          isOriginal: entry.isOriginal,
          isCommander: entry.isCommander,
          imageUrl: entry.id === mutatingCardId
            ? ((effectiveCard as any)?.image_uris?.small || (effectiveCard as any)?.image_uris?.normal)
            : undefined,
        }));
        (mutateTarget as any).mutationCount = mutatedPermanent.mutationCount;
        (mutateTarget as any).timesMutated = mutatedPermanent.mutationCount;
        (mutateTarget as any).card = {
          ...((mutateTarget as any).card || {}),
          ...(mutateOnTop ? { ...(effectiveCard as any) } : {}),
          id: topCardEntry?.id || (mutateTarget as any).card?.id,
          name: topCharacteristics.name || (mutateTarget as any).card?.name,
          type_line: topCharacteristics.typeLine || (mutateTarget as any).card?.type_line,
          power: topCharacteristics.power ?? (mutateTarget as any).card?.power,
          toughness: topCharacteristics.toughness ?? (mutateTarget as any).card?.toughness,
          mana_cost: topCharacteristics.manaCost ?? (mutateTarget as any).card?.mana_cost,
          oracle_text: combinedAbilities.join('\n') || (mutateTarget as any).card?.oracle_text || '',
          zone: 'battlefield',
        };

        const parsedTopPower = parsePT(topCharacteristics.power);
        const parsedTopToughness = parsePT(topCharacteristics.toughness);
        if (parsedTopPower !== undefined) {
          (mutateTarget as any).basePower = parsedTopPower;
        }
        if (parsedTopToughness !== undefined) {
          (mutateTarget as any).baseToughness = parsedTopToughness;
        }
        (mutateTarget as any).isCommander = mutatedPermanent.cardStack.some((entry: any) => entry?.isCommander === true);

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId && mutatingCardId && !(ctx as any).isReplaying) {
            appendEvent(replayGameId, (state as any).seq ?? 0, 'mutatePermanent', {
              playerId: controller,
              targetPermanentId: String((mutateTarget as any).id || mutateTargetId),
              targetPermanentName: String((mutateTarget as any).card?.name || 'Creature'),
              onTop: mutateOnTop,
              mutatingCard: {
                ...(effectiveCard as any),
                zone: 'battlefield',
              },
            });
          }
        } catch (err) {
          debugWarn(1, '[resolveTopOfStack] appendEvent(mutatePermanent) failed:', err);
        }

        queueMutateTriggeredAbilities(ctx, mutateTarget, controller);

        debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Mutating creature'} merged with ${String((mutateTarget as any).card?.name || mutateTargetId)}`);
      }

      return { mutateResolved: true };
    }

    debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Mutating creature'} has no legal mutate target on resolution; resolving as a normal creature`);
  }
  
  state.battlefield.push(newPermanent);
  syncArcaneAdaptationForNewCreature(state, newPermanent);
  applyMetallicMimicEntryBonus(ctx, newPermanent, controller as PlayerID);
  applyGraveyardTypeEntryCounterGrants(state, newPermanent, String(controller));

  if (cardEntersPrepared(newPermanent.card)) {
    setPermanentPrepared(state, newPermanent);
  }
  
  // Handle Aura and bestow-style enchantment attachments.
  // Bestow permanents stay enchantment creatures in this model but still attach
  // to a target creature while bestowed.
  // IMPORTANT: This must be done AFTER pushing to battlefield so the permanent exists
  const isAura = tl.includes('enchantment') && tl.includes('aura');
  const isBestowAttachment = tl.includes('enchantment') && tl.includes('creature') && /\bbestow\b/i.test(String(effectiveCard.oracle_text || ''));
  const isEquipment = tl.includes('equipment');
  if ((isAura || isBestowAttachment || isEquipment) && targets && targets.length > 0) {
    const targetId = targets[0];
    const targetPerm = state.battlefield.find((p: any) => p?.id === targetId);
    
    if (targetPerm) {
      // Set attachedTo on the aura/equipment
      newPermanent.attachedTo = targetId;
      
      // Track attachment on the target permanent
      // Use attachedEquipment for equipment (existing pattern) and attachments for auras
      if (isEquipment) {
        (targetPerm as any).attachedEquipment = (targetPerm as any).attachedEquipment || [];
        if (!(targetPerm as any).attachedEquipment.includes(newPermId)) {
          (targetPerm as any).attachedEquipment.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] Equipment ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
      } else {
        // For Auras and bestowed enchantment creatures, use the standard attachments field.
        (targetPerm as any).attachments = (targetPerm as any).attachments || [];
        if (!(targetPerm as any).attachments.includes(newPermId)) {
          (targetPerm as any).attachments.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] ${isBestowAttachment ? 'Bestow permanent' : 'Aura'} ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId && !(ctx as any).isReplaying) {
            appendEvent(replayGameId, (state as any).seq ?? 0, 'attachEnchantmentPermanent', {
              playerId: controller,
              enchantmentId: newPermId,
              enchantmentName: effectiveCard.name || 'Enchantment',
              targetPermanentId: targetId,
              targetPermanentName: targetPerm.card?.name || 'Permanent',
            });
          }
        } catch (err) {
          debugWarn(1, '[resolveTopOfStack] appendEvent(attachEnchantmentPermanent) failed:', err);
        }
      }
    } else {
      debugWarn(2, `[resolveTopOfStack] ${isEquipment ? 'Equipment' : (isBestowAttachment ? 'Bestow permanent' : 'Aura')} ${effectiveCard.name} target ${targetId} not found on battlefield`);
    }
  }
  
  // Build a readable status message for logging
  let statusNote = '';
  if (shouldEnterTapped) {
    statusNote = ' (enters tapped)';
  } else if (hasSummoningSickness) {
    statusNote = ' (summoning sickness)';
  } else if (hasHaste) {
    statusNote = ' (haste)';
  }
  debug(2, `[resolveTopOfStack] Permanent ${effectiveCard.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);


  return {
    mutateResolved: false,
    newPermanent,
    newPermId,
    isCreature,
    shouldEnterTapped,
    hasSummoningSickness,
    hasHaste,
  };
}
