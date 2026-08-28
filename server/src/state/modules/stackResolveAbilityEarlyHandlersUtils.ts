import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';
import { millCardsFromLibrary } from './triggerLibraryMillUtils.js';
import { tryApplyOracleIRToActivatedAbility } from './oracleIrAbilityExecution.js';
import type { StackActivatedAbilityHandlerContext } from './stackResolveSharedTypes.js';

export type { StackActivatedAbilityHandlerContext } from './stackResolveSharedTypes.js';

function resolveFetchLandAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const sourceName = item?.sourceName || 'Unknown';
  debug(2, `[resolveFetchLandAbility] Resolving fetch land ability from ${sourceName} for ${controller}`);

  const oracleText = String(
    item?.activatedAbilityText
    || item?.card?.oracle_text
    || item?.description
    || '',
  ).trim();
  if (oracleText) {
    const irResult = tryApplyOracleIRToActivatedAbility(ctx, {
      controller,
      sourceName,
      oracleText,
      sourcePermanentId: String(item?.source || ''),
      stackItemId: String(item?.id || ''),
      sourceItem: item,
      card: item?.card,
      allowOptional: false,
    });
    if (irResult.handled) {
      debug(2, `[resolveFetchLandAbility] Oracle IR resolved fetch land from ${sourceName} (${irResult.applied} step(s))`);
      return;
    }
  }

  const searchParams = item?.searchParams || {};
  enqueueLibrarySearchStep(ctx, controller, {
    searchFor: searchParams.searchDescription || 'a land card',
    description: `${sourceName}: Search your library for ${searchParams.searchDescription || 'a land'}`,
    destination: 'battlefield',
    entersTapped: searchParams.entersTapped || false,
    optional: false,
    sourceId: String(item?.source || ''),
    source: sourceName,
    shuffleAfter: true,
    filter: searchParams.filter || { types: ['land'] },
    maxSelections: searchParams.maxSelections || 1,
    minSelections: 1,
    persistLibrarySearchResolveAbilityId: String(item?.abilityId || ''),
  });

  const searchDesc = searchParams.searchDescription || 'a land card';
  const maxSel = searchParams.maxSelections || 1;
  const tappedStatus = searchParams.entersTapped ? ' (enters tapped)' : '';
  const selectionText = maxSel > 1 ? ` (up to ${maxSel})` : '';
  debug(2, `[resolveFetchLandAbility] Fetch land ${sourceName}: ${controller} may search for ${searchDesc}${selectionText}${tappedStatus}`);
}

function resolveCyclingAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const abilityType = item?.abilityType;
  const sourceName = item?.sourceName || 'Unknown';
  debug(2, `[resolveCyclingAbility] Resolving ${abilityType} ability from ${sourceName} for ${controller}`);

  try {
    const stateAny = state as any;
    const key = String(controller);
    stateAny.cycleCountThisTurn = stateAny.cycleCountThisTurn || {};
    stateAny.cycleCountThisTurn[key] = (stateAny.cycleCountThisTurn[key] ?? 0) + 1;
    stateAny.cardsCycledThisTurn = stateAny.cardsCycledThisTurn || {};
    stateAny.cardsCycledThisTurn[key] = stateAny.cycleCountThisTurn[key];
    stateAny.cycledCardsThisTurn = stateAny.cycledCardsThisTurn || {};
    stateAny.cycledCardsThisTurn[key] = stateAny.cycleCountThisTurn[key];
  } catch {
    // best-effort only
  }

  const zones = state?.zones?.[controller];
  if (!zones) {
    debug(2, `[resolveCyclingAbility] Cycling: player ${controller} has no zones`);
    return;
  }

  const players = state.players || [];
  const player = players.find((entry: any) => entry.id === controller);
  const playerName = player?.name || controller;

  if (abilityType === 'typecycling') {
    const searchCriteria = String(item?.searchCriteria || 'a card');
    const searchFilter = (item?.searchFilter && typeof item.searchFilter === 'object')
      ? { ...(item.searchFilter as any) }
      : {};

    enqueueLibrarySearchStep(ctx, controller, {
      searchFor: searchCriteria,
      description: `${sourceName}: Search your library for ${searchCriteria}`,
      destination: 'hand',
      optional: false,
      source: sourceName || 'Typecycling',
      shuffleAfter: true,
      maxSelections: 1,
      minSelections: 1,
      reveal: true,
      filter: searchFilter,
      persistLibrarySearchResolve: true,
      persistLibrarySearchResolveReason: 'stack_resolution',
    });

    (ctx as any).io?.to((ctx as any).gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId: (ctx as any).gameId,
      from: 'system',
      message: `${playerName} is searching their library from ${sourceName}.`,
      ts: Date.now(),
    });
    return;
  }

  const lib = zones.library || [];
  if (lib.length > 0) {
    const drawnCard = lib.shift();
    zones.hand = zones.hand || [];
    zones.hand.push({ ...drawnCard, zone: 'hand' });
    zones.handCount = zones.hand.length;
    zones.libraryCount = lib.length;

    (ctx as any).io?.to((ctx as any).gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId: (ctx as any).gameId,
      from: 'system',
      message: `${playerName} drew a card from cycling ${sourceName}.`,
      ts: Date.now(),
    });

    debug(2, `[resolveCyclingAbility] Cycling ${sourceName}: ${controller} drew a card`);
    return;
  }

  (ctx as any).io?.to((ctx as any).gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId: (ctx as any).gameId,
    from: 'system',
    message: `${playerName} cycled ${sourceName} but had no cards to draw.`,
    ts: Date.now(),
  });

  debug(2, `[resolveCyclingAbility] Cycling ${sourceName}: ${controller} had no cards to draw`);
}

function resolveOpponentHandSizeMillAbility(
  ctx: GameContext,
  item: any,
  controller: PlayerID,
): boolean {
  const texts = [
    String(item?.description || ''),
    String(item?.activatedAbilityText || ''),
  ].map((text) => text.trim()).filter(Boolean);

  const matchesHandSizeMill = texts.some((text) =>
    /each\s+opponent\s+mills?\s+cards?\s+equal\s+to\s+the\s+number\s+of\s+cards\s+in\s+their\s+hand/i.test(text),
  );
  if (!matchesHandSizeMill) {
    return false;
  }

  const state = (ctx as any).state;
  const players = Array.isArray(state?.players) ? state.players : [];
  for (const player of players) {
    const opponentId = String(player?.id || '').trim();
    if (!opponentId || opponentId === String(controller) || player?.hasLost) {
      continue;
    }

    const zones = state?.zones?.[opponentId];
    const handCount = Array.isArray(zones?.hand)
      ? zones.hand.length
      : Math.max(0, Number(zones?.handCount || 0));
    if (handCount <= 0) {
      continue;
    }

    millCardsFromLibrary(state, opponentId as PlayerID, handCount, ctx);
    debug(2, `[resolveOpponentHandSizeMillAbility] ${item?.sourceName || 'Ability'}: milled ${handCount} card(s) from ${opponentId}`);
  }

  return true;
}

export function tryResolveStackActivatedAbilityEarlyHandlers(
  ctx: GameContext,
  options: StackActivatedAbilityHandlerContext,
): boolean {
  const { item, controller } = options;
  if (item?.type !== 'ability') return false;

  const abilityType = item?.abilityType;
  if (abilityType === 'fetch-land') {
    resolveFetchLandAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }

  if (abilityType === 'cycling' || abilityType === 'typecycling') {
    resolveCyclingAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }

  if (resolveOpponentHandSizeMillAbility(ctx, item, controller)) {
    ctx.bumpSeq();
    return true;
  }

  return false;
}

