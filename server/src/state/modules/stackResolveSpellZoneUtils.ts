import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { normalizeOracleResolutionText } from './oracleIrSpellLegacySupplemental.js';
import { shouldExileStackCardInsteadOfGraveyard } from './stack-zone-replacements.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { queueInitiativeVentureTrigger, resolveVentureProgress } from './triggerVentureUtils.js';
import {
  queueResolvedSpellCopyChoice,
  shouldQueueResolvedSpellCopyChoice,
} from './stackResolveSpellCopyChoiceUtils.js';
import { repairCardIdAwayFromZones } from './stackReplayUtils.js';

type ResolvedInstantOrSorceryDestination = 'graveyard' | 'exile' | 'library' | 'ceased';

function persistMoveResolvedInstantOrSorceryEvent(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    destination: ResolvedInstantOrSorceryDestination;
  },
): void {
  if ((ctx as any).isReplaying) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const cardId = String(options.card?.id || '').trim();
  if (!cardId) return;

  try {
    // Prefer the live game seq so replay ordering matches surrounding events.
    // Previously this often persisted as seq=0 during Oracle IR resolution, which
    // made reconnect/replay miss the graveyard move.
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
    const seq = Number(
      (ctx as any).seq
      ?? (ctx as any).game?.seq
      ?? (ctx.state as any)?.seq
      ?? 0,
    );
    appendEvent(
      gameId,
      seq,
      'moveResolvedInstantOrSorcery',
      {
        controller: options.controller,
        playerId: options.controller,
        cardId,
        destination: options.destination,
        card: { ...options.card },
      },
    );
  } catch (err) {
    debugWarn(1, '[moveResolvedInstantOrSorcery] appendEvent failed:', err);
  }
}

export function tryResolveApproachOfTheSecondSunAfterEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    oracleTextLower: string;
  },
): boolean {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const oracleTextLower = String(options.oracleTextLower || '');

  const isApproach = (effectiveCard?.name || '').toLowerCase().includes('approach of the second sun')
    || (oracleTextLower.includes('put it into its owner\'s library seventh from the top')
      && oracleTextLower.includes('you win the game'));

  if (!isApproach) {
    return false;
  }

  const stateAny = state as any;
  stateAny.approachCastHistory = stateAny.approachCastHistory || {};
  stateAny.approachCastHistory[controller] = stateAny.approachCastHistory[controller] || [];
  stateAny.approachCastHistory[controller].push({
    timestamp: Date.now(),
    castFromHand: true,
  });

  const castCount = stateAny.approachCastHistory[controller].length;
  if (castCount >= 2) {
    debug(2, `[tryResolveApproachOfTheSecondSunAfterEffects] ${controller} wins! Approach of the Second Sun cast for the second time!`);
    stateAny.winner = controller;
    stateAny.gameOver = true;
    stateAny.winCondition = 'Approach of the Second Sun';
    return true;
  }

  const lib = ctx.libraries?.get(controller) || [];
  const insertPosition = Math.min(6, lib.length);
  (lib as any[]).splice(insertPosition, 0, { ...card, zone: 'library' });
  ctx.libraries?.set(controller, lib);

  const zones = state?.zones || {};
  const z = zones[controller];
  if (z) {
    z.libraryCount = lib.length;
  }

  state.life = state.life || {};
  state.life[controller] = (state.life[controller] || 40) + 7;
  const player = (state.players || []).find((p: any) => p.id === controller);
  if (player) player.life = state.life[controller];

  debug(2, `[tryResolveApproachOfTheSecondSunAfterEffects] Approach of the Second Sun: ${controller} gained 7 life, card put 7th from top (cast #${castCount})`);
  return true;
}

export function applyResolvedInstantSorceryInitiativeVentureRiders(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    card: any;
    oracleTextLower: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const card = options.card;
  const oracleTextLower = String(options.oracleTextLower || '');

  const spellSourceId = String(item?.id || card?.id || '').trim();
  if (oracleTextLower.includes('take the initiative') || oracleTextLower.includes('you take the initiative')) {
    (state as any).initiative = controller;
    queueInitiativeVentureTrigger(ctx, controller, spellSourceId);
  } else if (oracleTextLower.includes('venture into undercity')) {
    resolveVentureProgress(ctx, controller, effectiveCard?.name || 'Spell', spellSourceId, 'undercity');
  } else if (oracleTextLower.includes('venture into the dungeon')) {
    resolveVentureProgress(ctx, controller, effectiveCard?.name || 'Spell', spellSourceId, 'dungeon');
  }
}

export function finalizeResolvedInstantOrSorceryResolution(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    oracleTextLower: string;
  },
): boolean {
  if (tryResolveApproachOfTheSecondSunAfterEffects(ctx, options)) {
    return true;
  }

  if (shouldQueueResolvedSpellCopyChoice(options.item, options.oracleText)) {
    queueResolvedSpellCopyChoice(
      ctx,
      options.item,
      options.controller,
      String(options.effectiveCard?.name || options.card?.name || 'Spell').trim() || 'Spell',
    );
  }

  moveResolvedInstantOrSorceryAfterResolution(ctx, options);
  applyResolvedInstantSorceryInitiativeVentureRiders(ctx, options);
  return false;
}

export function moveResolvedInstantOrSorceryAfterResolution(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = String(options.oracleText || '');

  const zones = state?.zones || {};
  const playerZones = zones[controller];
  if (!playerZones) return;

  const layout = (card as any)?.layout;
  const wasAdventure = item?.castAsAdventure === true;

  const hasRebound = /\brebound\b/i.test(oracleText);
  const wasCastFromHand = item?.castFromHand === true || item?.source === 'hand';
  const wasCastFromRebound = item?.castFromRebound === true;
  const castWithAbility = String(item?.card?.castWithAbility || item?.castWithAbility || '').trim().toLowerCase();
  const shouldExileAfterResolutionFromGraveyardAbility = shouldExileStackCardInsteadOfGraveyard(item);

  const hasParadigm = /\bparadigm\b/i.test(oracleText);
  const stateAny = state as any;
  const normalizedParadigmName = normalizeOracleResolutionText(String(card?.name || effectiveCard?.name || ''));
  const paradigmResolvedNames = (stateAny.paradigmResolvedSpellNames = stateAny.paradigmResolvedSpellNames || {});
  const controllerParadigmNames = (paradigmResolvedNames[controller] = paradigmResolvedNames[controller] || {});
  const firstParadigmResolution = Boolean(
    hasParadigm && normalizedParadigmName && controllerParadigmNames[normalizedParadigmName] !== true,
  );

  if ((card as any)?.ceaseOnResolution === true) {
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] Copied spell ${effectiveCard?.name || 'unnamed'} ceased to exist after resolution`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card,
      destination: 'ceased',
    });
    return;
  }

  if (layout === 'adventure' && wasAdventure) {
    playerZones.exile = playerZones.exile || [];
    const exiledAdventureCard = {
      ...card,
      zone: 'exile',
      onAdventure: true,
      // Legacy alias — some playability checks historically looked for adventureUsed.
      adventureUsed: true,
      adventureCaster: controller,
    };
    (playerZones.exile as any[]).push(exiledAdventureCard);
    playerZones.exileCount = (playerZones.exile as any[]).length;
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] Adventure spell ${effectiveCard?.name || 'unnamed'} resolved and exiled for ${controller}`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: exiledAdventureCard,
      destination: 'exile',
    });
    return;
  }

  if (hasParadigm) {
    playerZones.exile = playerZones.exile || [];
    if (firstParadigmResolution) {
      controllerParadigmNames[normalizedParadigmName] = true;
    }
    (playerZones.exile as any[]).push({
      ...card,
      zone: 'exile',
      paradigmActive: firstParadigmResolution,
      paradigmController: controller,
      paradigmNameKey: normalizedParadigmName,
    });
    playerZones.exileCount = (playerZones.exile as any[]).length;
    debug(
      2,
      `[moveResolvedInstantOrSorceryAfterResolution] Paradigm spell ${effectiveCard?.name || 'unnamed'} exiled for ${controller}${firstParadigmResolution ? ' and activated for future precombat main phases' : ''}`,
    );
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: {
        ...card,
        zone: 'exile',
        paradigmActive: firstParadigmResolution,
        paradigmController: controller,
        paradigmNameKey: normalizedParadigmName,
      },
      destination: 'exile',
    });
    return;
  }

  if (shouldExileAfterResolutionFromGraveyardAbility) {
    playerZones.exile = playerZones.exile || [];
    (playerZones.exile as any[]).push({
      ...card,
      zone: 'exile',
    });
    playerZones.exileCount = (playerZones.exile as any[]).length;
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] ${castWithAbility || 'graveyard-cast'} spell ${effectiveCard?.name || 'unnamed'} exiled for ${controller} after resolution`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: { ...card, zone: 'exile' },
      destination: 'exile',
    });
    return;
  }

  if (hasRebound && wasCastFromHand && !wasCastFromRebound) {
    playerZones.exile = playerZones.exile || [];
    (playerZones.exile as any[]).push({
      ...card,
      zone: 'exile',
      reboundPending: true,
      reboundController: controller,
      reboundTurn: stateAny.turnNumber || 1,
    });
    playerZones.exileCount = (playerZones.exile as any[]).length;
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] Rebound spell ${effectiveCard?.name || 'unnamed'} exiled for ${controller} - will trigger at beginning of next upkeep`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: {
        ...card,
        zone: 'exile',
        reboundPending: true,
        reboundController: controller,
        reboundTurn: stateAny.turnNumber || 1,
      },
      destination: 'exile',
    });
    return;
  }

  playerZones.graveyard = playerZones.graveyard || [];
  if (pushCardToPlayerGraveyardWithReplacements(ctx, controller, card, playerZones.graveyard)) {
    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    const resolvedCardId = String(card?.id || '').trim();
    if (resolvedCardId) {
      // Cast can leave a same-id ghost in hand/library (zones.library especially).
      repairCardIdAwayFromZones(ctx, String(controller), resolvedCardId, [
        'hand',
        'exile',
        'library',
      ]);
    }
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] Spell ${card?.name || 'unnamed'} resolved and moved to graveyard for ${controller}`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: { ...card, zone: 'graveyard' },
      destination: 'graveyard',
    });
  } else {
    debug(2, `[moveResolvedInstantOrSorceryAfterResolution] ${card?.name} self-shuffled into library instead of graveyard for ${controller}`);
    persistMoveResolvedInstantOrSorceryEvent(ctx, {
      controller,
      card: { ...card, zone: 'library' },
      destination: 'library',
    });
  }
}
