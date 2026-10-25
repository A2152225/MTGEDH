// Typed shape for state.lastingEffects stamps (this-turn / until-your-next-turn grants written by the
// rules-engine Oracle IR executors and read by the server: attack/block taxes, free hand casts,
// prevent life gain, protection overrides, attack prohibitions). Extra per-type fields stay open.
// Public: LastingEffectStamp.

export interface LastingEffectStamp {
  type: string;
  duration?: string;
  source?: string;
  sourceId?: string;
  sourceName?: string;
  controllerId?: string;
  playerId?: string;
  defenderId?: string;
  amount?: number;
  global?: boolean;
  turnApplied?: number;
  [key: string]: unknown;
}