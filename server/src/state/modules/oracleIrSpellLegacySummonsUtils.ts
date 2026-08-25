import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { cardManaValue } from '../utils.js';
import { applyMillReplacements } from './game-state-effects.js';
import { addCreatureType } from './triggerDelayedEffectUtils.js';
import { createToken, updateCounters } from './counters_tokens.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

function cardTypeLine(card: any): string {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase();
}

export function filterMilledCardsForMayCast(
  milledCards: readonly any[],
  cardTypes: readonly string[],
  maxManaValue: number,
): any[] {
  const types = (Array.isArray(cardTypes) ? cardTypes : [])
    .map((typeWord) => String(typeWord || '').trim().toLowerCase())
    .filter(Boolean);
  const cap = Number.isFinite(maxManaValue) ? maxManaValue : Number.POSITIVE_INFINITY;
  return (Array.isArray(milledCards) ? milledCards : []).filter((card: any) => {
    const typeLine = cardTypeLine(card);
    if (types.length > 0 && !types.some((typeWord) => typeLine.includes(typeWord))) return false;
    return cardManaValue(card) <= cap;
  });
}

export function queueMayCastFromAmongMilledCards(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    sourceName: string;
    sourceId: string;
    sourceImage?: string;
    milledCards?: readonly any[];
    cardTypes?: readonly string[];
    maxManaValue: number;
    eligibleCards?: readonly any[];
  },
): void {
  const x = Math.max(0, Math.floor(Number(options.maxManaValue) || 0));
  const cardTypes = options.cardTypes && options.cardTypes.length > 0
    ? options.cardTypes
    : ['instant', 'sorcery'];
  const eligibleCards = Array.isArray(options.eligibleCards)
    ? [...options.eligibleCards]
    : filterMilledCardsForMayCast(options.milledCards || [], cardTypes, x);

  const gameId = String((ctx as any).gameId || 'unknown');
  const isReplaying = Boolean((ctx as any).isReplaying);
  if (eligibleCards.length === 0 || !gameId || gameId === 'unknown' || isReplaying) {
    return;
  }

  const typeLabel = cardTypes.join(' or ');
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.GRAVEYARD_SELECTION,
    playerId: options.controller,
    description: `${options.sourceName}: You may cast ${typeLabel === 'instant or sorcery' ? 'an instant or sorcery' : `a ${typeLabel}`} spell milled this way with mana value ${x} or less without paying its mana cost.`,
    mandatory: false,
    sourceId: options.sourceId || undefined,
    sourceName: options.sourceName,
    sourceImage: options.sourceImage,
    targetPlayerId: options.controller,
    destination: 'cast',
    minTargets: 1,
    maxTargets: 1,
    title: `Choose a spell to cast with ${options.sourceName}`,
    validTargets: eligibleCards.map((card: any) => ({
      id: String(card.id || card?.card?.id || ''),
      label: String(card.name || card?.card?.name || 'Card'),
      description: String(card.type_line || card?.card?.type_line || 'Card'),
      imageUrl: card.image_uris?.small || card.image_uris?.normal || card?.card?.image_uris?.small || card?.card?.image_uris?.normal,
      zoneOwnerId: options.controller,
    })),
    triggeredAbilityGraveyardSelection: true,
    triggeredAbilityCastFromGraveyard: true,
    triggeredAbilityCastWithoutPayingManaCost: true,
    triggeredAbilityMayCastFromGraveyard: true,
    triggeredAbilityEffectText: `${options.sourceName}: You may cast ${typeLabel === 'instant or sorcery' ? 'an instant or sorcery' : `a ${typeLabel}`} spell with mana value ${x} or less from among the milled cards without paying its mana cost.`,
  } as any);

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: String(options.controller),
    sourceId: options.sourceId || String((step as any)?.sourceId || '').trim(),
    queuedResolutionStep: step,
  });
}

export function applySummonsOfSarumanEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  sourceId: string,
  sourceImage: string | undefined,
  xValue: number,
): void {
  const x = Math.max(0, Math.floor(Number(xValue) || 0));
  const stateAny: any = (ctx as any).state || {};
  stateAny.battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];

  let army = stateAny.battlefield.find((permanent: any) =>
    permanent
    && String(permanent.controller || '') === String(controller)
    && String(permanent.card?.type_line || '').toLowerCase().includes('army')
  );

  if (!army) {
    const createdIds = createToken(ctx, controller, 'Orc Army', 1, 0, 0, {
      colors: ['B'],
      typeLine: 'Token Creature — Orc Army',
      ...(x > 0 ? { withCounters: { '+1/+1': x } } : {}),
    }) as any[];
    const createdId = String(createdIds?.[0] || '');
    army = createdId
      ? stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === createdId)
      : undefined;
  } else {
    addCreatureType(army, 'Orc');
    if (x > 0) {
      updateCounters(ctx, String(army.id || ''), { '+1/+1': x });
    }
  }

  const zonesByPlayer = stateAny.zones = stateAny.zones || {};
  const controllerZones = zonesByPlayer[controller] = zonesByPlayer[controller] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    library: [],
    libraryCount: 0,
  };
  controllerZones.graveyard = Array.isArray(controllerZones.graveyard) ? controllerZones.graveyard : [];

  const replacementResult = applyMillReplacements(ctx, x, String(controller), String(controller));
  const millCount = Math.max(0, Math.floor(Number(replacementResult?.finalCount ?? x) || 0));
  const library = ((ctx as any).libraries?.get?.(controller) || controllerZones.library || []) as any[];
  const milledCards: any[] = [];

  for (let index = 0; index < millCount && library.length > 0; index += 1) {
    const milled = library.shift();
    if (!milled) continue;
    pushCardToPlayerGraveyardWithReplacements(ctx, String(controller), milled, controllerZones.graveyard);
    milledCards.push({ ...(milled as any), zone: 'graveyard' });
  }

  if ((ctx as any).libraries?.set) {
    (ctx as any).libraries.set(controller, library);
  }
  controllerZones.library = library;
  controllerZones.libraryCount = library.length;
  controllerZones.graveyardCount = controllerZones.graveyard.length;

  const eligibleCards = filterMilledCardsForMayCast(milledCards, ['instant', 'sorcery'], x);

  queueMayCastFromAmongMilledCards(ctx, {
    controller,
    sourceName,
    sourceId,
    sourceImage,
    milledCards,
    cardTypes: ['instant', 'sorcery'],
    maxManaValue: x,
    eligibleCards,
  });

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  debug(2, `[resolveTopOfStack] ${sourceName}: amassed Orcs ${x}, milled ${milledCards.length} card(s), eligible free-cast spells ${eligibleCards.length}`);
}
