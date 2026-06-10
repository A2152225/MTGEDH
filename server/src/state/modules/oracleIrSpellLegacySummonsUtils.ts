import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { cardManaValue } from '../utils.js';
import { applyMillReplacements } from './game-state-effects.js';
import { addCreatureType, createToken, updateCounters } from './counters_tokens.js';
import { checkGraveyardTrigger } from './triggered-abilities.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

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
    const graveyardCard = { ...(milled as any), zone: 'graveyard' };
    controllerZones.graveyard.push(graveyardCard);
    milledCards.push(graveyardCard);
    recordCardPutIntoGraveyardThisTurn(ctx, String(controller), graveyardCard, { fromBattlefield: false });
    checkGraveyardTrigger(ctx, graveyardCard, String(controller));
  }

  if ((ctx as any).libraries?.set) {
    (ctx as any).libraries.set(controller, library);
  }
  controllerZones.library = library;
  controllerZones.libraryCount = library.length;
  controllerZones.graveyardCount = controllerZones.graveyard.length;

  const eligibleCards = milledCards.filter((card: any) => {
    const typeLine = String(card?.type_line || '').toLowerCase();
    if (!typeLine.includes('instant') && !typeLine.includes('sorcery')) return false;
    return cardManaValue(card) <= x;
  });

  const gameId = String((ctx as any).gameId || 'unknown');
  const isReplaying = Boolean((ctx as any).isReplaying);
  if (eligibleCards.length > 0 && gameId && gameId !== 'unknown' && !isReplaying) {
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: controller,
      description: `${sourceName}: You may cast an instant or sorcery spell milled this way with mana value ${x} or less without paying its mana cost.`,
      mandatory: false,
      sourceId: sourceId || undefined,
      sourceName,
      sourceImage,
      targetPlayerId: controller,
      destination: 'cast',
      minTargets: 1,
      maxTargets: 1,
      title: `Choose a spell to cast with ${sourceName}`,
      validTargets: eligibleCards.map((card: any) => ({
        id: String(card.id || ''),
        label: String(card.name || 'Card'),
        description: String(card.type_line || 'Card'),
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
        zoneOwnerId: controller,
      })),
      triggeredAbilityGraveyardSelection: true,
      triggeredAbilityCastFromGraveyard: true,
      triggeredAbilityCastWithoutPayingManaCost: true,
      triggeredAbilityMayCastFromGraveyard: true,
      triggeredAbilityEffectText: `${sourceName}: You may cast an instant or sorcery spell with mana value ${x} or less from among the milled cards without paying its mana cost.`,
    } as any);

    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String(controller),
      sourceId: sourceId || String((step as any)?.sourceId || '').trim(),
      queuedResolutionStep: step,
    });
  }

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  debug(2, `[resolveTopOfStack] ${sourceName}: amassed Orcs ${x}, milled ${milledCards.length} card(s), eligible free-cast spells ${eligibleCards.length}`);
}
