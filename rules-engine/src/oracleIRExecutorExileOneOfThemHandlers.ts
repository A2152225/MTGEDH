/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts: exile "one of them".
 * Public: tryApplyExileOneOfThemLookedCards
 *
 * After look_top, "Exile one of them face down" is a player choice when more
 * than one looked card remains. Targeted-player ids on chosenObjectIds are not
 * card picks and must not auto-exile the first looked card.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { collectContextualCardsLedgerFirst } from './oracleIRLedgerCardAccess';

type ExileOneOfThemResult =
  | {
      readonly applied: true;
      readonly state: GameState;
      readonly log: readonly string[];
      readonly lastMovedCards?: readonly any[];
      readonly lastExiledCards?: readonly any[];
      readonly lastExiledCardCount?: number;
    }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'player_choice_required';
      readonly options?: {
        readonly classification?: 'player_choice';
      };
    };

export function tryApplyExileOneOfThemLookedCards(
  state: GameState,
  ctx: OracleIRExecutionContext,
  options: {
    readonly target: string;
    readonly raw: string;
    readonly normalizedExileTarget: string;
  },
): ExileOneOfThemResult | null {
  const target = String(options.target || '').trim();
  const raw = String(options.raw || '').trim();
  const normalizedExileTarget = String(options.normalizedExileTarget || '').trim();
  if (target !== 'one of them' && normalizedExileTarget !== 'one of them') {
    return null;
  }

  const contextual = collectContextualCardsLedgerFirst(ctx) as any[];
  if (contextual.length === 0) {
    return { applied: true, state, log: ['No contextual cards to exile'] };
  }

  const faceDown = /\bface\s+down\b/i.test(target) || /\bface\s+down\b/i.test(raw);
  const ownerId = String(
    ctx.lastTopLibraryOwnerId || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.controllerId || 'p1'
  ).trim() as PlayerID;
  const rawChosenIds = [
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ...(Array.isArray((ctx as any).chosenObjectIds) ? (ctx as any).chosenObjectIds : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const matchingChosenId = rawChosenIds.find((id) =>
    contextual.some((card: any) => String(card?.id || '').trim() === id),
  );

  if (ctx.interactivePlayerChoices !== false && contextual.length > 1 && !matchingChosenId) {
    return {
      applied: false,
      message: `Exile one of the looked-at cards requires a player choice: ${raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenId = String(matchingChosenId || contextual[0]?.id || '').trim();
  const picked =
    contextual.find((card: any) => String(card?.id || '').trim() === chosenId) || contextual[0];
  const pickedId = String(picked?.id || '').trim();
  const updatedPlayers = (state.players || []).map((entry: any) => {
    if (String(entry?.id || '').trim() !== ownerId) return entry;
    const library = Array.isArray(entry?.library) ? [...entry.library] : [];
    const exile = Array.isArray(entry?.exile) ? [...entry.exile] : [];
    const exiledCard = {
      ...(library.find((card: any) => String(card?.id || '').trim() === pickedId) || picked),
      zone: 'exile',
      faceDown,
    };
    return {
      ...entry,
      library: library.filter((card: any) => String(card?.id || '').trim() !== pickedId),
      exile: [...exile, exiledCard],
    };
  });
  const restCards = contextual.filter((card: any) => String(card?.id || '').trim() !== pickedId);
  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    log: [`Exiled one looked-at card${faceDown ? ' face down' : ''}`],
    lastMovedCards: restCards,
    lastExiledCards: [{ ...(picked as any), zone: 'exile', faceDown }],
    lastExiledCardCount: 1,
  };
}
