import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';

export function queuePlayableFromExileChoiceStep(
  ctx: GameContext,
  controller: string,
  sourceName: string,
  count: number,
  options: {
    playableUntilTurn: number;
    playWindowText: string;
  },
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') {
    return false;
  }

  const stateAny = (ctx.state || {}) as any;
  const libraries = (ctx as any).libraries;
  const lib = libraries?.get(controller);
  if (!Array.isArray(lib) || lib.length === 0) {
    return true;
  }

  const zones = stateAny.zones || (stateAny.zones = {});
  const z = (zones[controller] = zones[controller] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
  z.exile = Array.isArray(z.exile) ? z.exile : [];

  const exiledCards: any[] = [];
  const exiledCardIds: string[] = [];
  const actual = Math.max(0, Math.min(count, lib.length));

  for (let i = 0; i < actual; i++) {
    const topCard = lib.shift();
    const cardId = String((topCard as any)?.id || uid('c'));
    const exiled = {
      ...topCard,
      id: cardId,
      zone: 'exile',
      exiledBy: sourceName,
    };

    z.exile.push(exiled);
    exiledCards.push(exiled);
    exiledCardIds.push(cardId);
  }

  libraries?.set(controller, lib);
  z.libraryCount = lib.length;
  z.exileCount = z.exile.length;

  if (exiledCardIds.length === 0) {
    return true;
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    description: `${sourceName}: Choose an exiled card. You may play it ${options.playWindowText}.`,
    mandatory: true,
    sourceName,
    options: exiledCards.map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Exiled card'),
      description: String(card.type_line || ''),
    })),
    minSelections: 1,
    maxSelections: 1,
    grantPlayableFromExileChoice: true,
    grantPlayableFromExileController: controller,
    grantPlayableFromExileSourceName: sourceName,
    grantPlayableFromExileCardIds: exiledCardIds,
    grantPlayableFromExileUntilTurn: options.playableUntilTurn,
    grantPlayableFromExileWindowText: options.playWindowText,
  } as any);

  (ctx as any).bumpSeq?.();
  debug(2, `[executeTriggerEffect] ${sourceName}: exiled ${exiledCardIds.length} card(s) and queued a playable-from-exile choice (${options.playWindowText})`);
  return true;
}
