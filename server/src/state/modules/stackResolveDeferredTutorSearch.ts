/**
 * state/modules/stackResolveDeferredTutorSearch.ts
 *
 * CR 602.2 / 608.2: an activated tutor ability searches when it resolves, not when it is activated
 * (Navigation Orb, Wayfarer's Bauble). The battlefield activation path marks its stack item
 * `searchOnResolution` and leaves the search to this module, which queues the LIBRARY_SEARCH from
 * the item's `searchParams`. The answer is persisted as librarySearchResolve (replay pops the stack
 * item only). Items without the flag (older event logs, the AI legacy path) keep the search queued
 * at activation.
 *
 * Public entry symbols: queueDeferredTutorAbilitySearch.
 */

import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { filterLibraryCardsForSearch } from '../../socket/library-search.js';
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';

export function queueDeferredTutorAbilitySearch(ctx: GameContext, item: any): boolean {
  if (item?.searchOnResolution !== true) return false;
  try {
    const controller = String(item?.controller || '').trim();
    const gameId = String((ctx as any).gameId || '').trim();
    if (!controller || !gameId) return false;
    const params = item?.searchParams || {};
    const filter = params.filter || {};
    const isSplit = params.splitDestination === true;
    const rawDestination = String(params.destination || 'hand');
    const destination = rawDestination === 'battlefield' || rawDestination === 'battlefield_tapped'
      ? 'battlefield'
      : rawDestination === 'exile' ? 'exile' : 'hand';
    const fromMap = (ctx as any).libraries?.get?.(controller);
    const library = Array.isArray(fromMap) ? fromMap : ((ctx as any).state?.zones?.[controller]?.library || []);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: controller as any,
      sourceId: String(item?.source || '').trim() || undefined,
      sourceName: String(item?.sourceName || 'Library Search'),
      description: params.searchCriteria ? `Search for: ${params.searchCriteria}` : 'Search your library',
      searchCriteria: params.searchCriteria || 'any card',
      minSelections: 0,
      maxSelections: params.maxSelections === 'rest' ? 'rest' : (Number(params.maxSelections) || (isSplit ? 2 : 1)),
      mandatory: false,
      destination,
      reveal: false,
      shuffleAfter: true,
      availableCards: filterLibraryCardsForSearch(library, filter, (ctx as any).state, controller),
      filter,
      splitDestination: isSplit,
      toBattlefield: params.toBattlefield || 1,
      toHand: params.toHand || 1,
      entersTapped: params.entersTapped || false,
      persistLibrarySearchResolve: true,
      persistLibrarySearchResolveReason: 'stack_resolution',
      persistLibrarySearchResolveAbilityId: String(item?.abilityId || ''),
    } as any);
    return true;
  } catch (err) {
    reportHookFailure('stack.deferredTutorSearch', err, {
      gameId: String((ctx as any).gameId || ''),
      cardName: String(item?.sourceName || ''),
    });
    return false;
  }
}
