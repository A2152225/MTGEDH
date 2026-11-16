// When a land may be played as a special action (CR 305.1, 116.2a):
// your main phase, stack empty, and a land play still available.
// Public entry: landPlayTimingBlockReason.

export function landPlayTimingBlockReason(args: {
  you?: string | null;
  turnPlayer?: string | null;
  phase?: string | null;
  stackCount?: number;
  landsPlayedThisTurn?: number;
  maxLandsPerTurn?: number;
}): string | null {
  if (!args.you) return 'No game state';
  if (!args.turnPlayer || args.turnPlayer !== args.you) return 'Not your turn';
  if (!args.phase || !String(args.phase).toLowerCase().includes('main')) {
    return 'Can only play lands during your main phase';
  }
  if ((args.stackCount ?? 0) > 0) {
    return "Can't play a land while there are spells or abilities on the stack";
  }
  const played = Number(args.landsPlayedThisTurn ?? 0);
  const max = Number(args.maxLandsPerTurn ?? 1);
  if (played >= max) {
    return max > 1
      ? `You have already played ${played} land(s) this turn (max ${max})`
      : 'You have already played a land this turn';
  }
  return null;
}
