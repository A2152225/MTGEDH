/**
 * Look/reveal-from-top choices that put the chosen card onto the battlefield
 * ("Reveal cards ... until you reveal a creature card. Put that card onto the battlefield").
 *
 * Player-zone commits only know library/hand/graveyard/exile, so a battlefield
 * destination silently fell back to the library. Mirror search_library: remove the
 * chosen cards from the library and create permanents, honoring entry replacements.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveBattlefieldEntryFromOracleIrContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { readPlayerZoneCards, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { createBattlefieldPermanentsFromCards } from './oracleIRExecutorZoneOps';

export function putLookChosenCardsOntoBattlefield(args: {
  readonly state: GameState;
  readonly playerId: PlayerID;
  readonly player: any;
  readonly cards: readonly any[];
  readonly entersTapped?: boolean;
  readonly ctx?: OracleIRExecutionContext;
  readonly stepKind: string;
}): { state: GameState; halted: boolean; movedCards: any[] } {
  const cards = args.cards.filter(Boolean);
  const chosenIds = new Set(cards.map((card) => String(card?.id || '').trim()).filter(Boolean));
  if (chosenIds.size === 0) return { state: args.state, halted: false, movedCards: [] };

  const library = readPlayerZoneCards(args.state, args.playerId, args.player, 'library');
  writePlayerZoneCards(
    args.state,
    args.playerId,
    args.player,
    'library',
    library.filter((card: any) => !chosenIds.has(String(card?.id || '').trim())),
  );

  const entered: any[] = [];
  for (const card of cards) {
    const resolved = resolveBattlefieldEntryFromOracleIrContext(
      args.state,
      card,
      args.playerId,
      { entersTapped: Boolean(args.entersTapped) },
      args.ctx ? { ctx: args.ctx, stepKind: args.stepKind, cause: 'oracle_ir:look_choose_from_top' } : undefined,
    );
    if ('halted' in resolved) return { state: args.state, halted: true, movedCards: [] };
    entered.push(
      ...createBattlefieldPermanentsFromCards(
        [{ ...card, ownerId: args.playerId, owner: args.playerId }],
        args.playerId,
        args.playerId,
        resolved.entersTapped,
        resolved.entersFaceDown,
        resolved.withCounters,
        'library',
      ),
    );
  }

  return {
    state: { ...(args.state as any), battlefield: [...(args.state.battlefield || []), ...entered] } as GameState,
    halted: false,
    movedCards: cards.map((card) => ({ ...card, zone: 'battlefield' })),
  };
}