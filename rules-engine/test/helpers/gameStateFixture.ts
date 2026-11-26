import type { GameState } from '../../../shared/src';

/**
 * Test fixtures describe only the slice of GameState a test exercises (often loose permanents with
 * type_line / power at the top level instead of a full card). This is the single documented boundary
 * where such a partial fixture is treated as a full GameState; `fixture as GameState` is rejected by
 * tsc (TS2352) because the shapes do not overlap. Known GameState keys stay discoverable via keyof.
 */
export type GameStateFixture = { readonly [K in keyof GameState]?: unknown } & { readonly [key: string]: unknown };

export function asGameState(fixture: GameStateFixture): GameState {
  return fixture as unknown as GameState;
}
