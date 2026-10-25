// server/src/socket/ai-handlers/aiBatch24OptionChoices.ts
// AI picks for the Batch 24 OPTION_CHOICE steps:
//   amplifyRevealChoice (reveal any number) -> reveal every eligible card (more counters is never worse).
//   optionalDrawStepSkipChoice (Fasting "you may skip that step instead. If you do, you gain N life")
//     -> skip when the hand is already full enough (3+) or life is low (10 or less); drawing also
//        destroys Fasting, so skipping keeps the life engine around. Otherwise draw.
// Public entry symbols: chooseAIBatch24OptionSelection.

type Selection = { selections: string[]; cancelled: boolean };

function handSize(game: any, playerId: string): number {
  const zone = game?.state?.zones?.[playerId];
  if (Array.isArray(zone?.hand)) return zone.hand.length;
  return Number(zone?.handCount || 0) || 0;
}

function lifeOf(game: any, playerId: string): number {
  const fromMap = Number(game?.state?.life?.[playerId]);
  if (Number.isFinite(fromMap)) return fromMap;
  const player = (Array.isArray(game?.state?.players) ? game.state.players : []).find((p: any) => String(p?.id) === playerId);
  const life = Number(player?.life);
  return Number.isFinite(life) ? life : 40;
}

export function chooseAIBatch24OptionSelection(
  game: any,
  playerId: string,
  step: any,
  options: readonly any[],
  resolveOptionId: (option: any) => string,
): Selection | null {
  if (step?.amplifyRevealChoice === true) {
    const ids = options.map(resolveOptionId).filter(Boolean);
    const max = Number(step?.maxSelections);
    return { selections: Number.isFinite(max) && max >= 0 ? ids.slice(0, max) : ids, cancelled: false };
  }
  if (step?.optionalDrawStepSkipChoice === true) {
    const pid = String(playerId || '');
    const wantSkip = handSize(game, pid) >= 3 || lifeOf(game, pid) <= 10;
    const ids = options.map(resolveOptionId);
    const pick = wantSkip ? 'skip' : 'draw';
    return { selections: [ids.includes(pick) ? pick : ids[0]], cancelled: false };
  }
  return null;
}
