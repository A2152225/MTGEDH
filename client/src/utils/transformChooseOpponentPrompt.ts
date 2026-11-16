/**
 * Shinryu / Zenos: as-transforms "choose an opponent" is a TARGET_SELECTION
 * step (transformChooseOpponent). Reuse PlayerTargetSelectionModal when that
 * flag is set so the existing player picker is used instead of relying only
 * on the generic target grid.
 */
export type TransformChooseOpponentPlayer = {
  id: string;
  name: string;
  isSelf: false;
  isOpponent: true;
  life?: number;
};

export type TransformChooseOpponentPromptData = {
  stepId: string;
  title: string;
  description: string;
  source: { name: string; imageUrl?: string };
  players: TransformChooseOpponentPlayer[];
  opponentOnly: true;
  isOptional: false;
};

export function isTransformChooseOpponentTargetStep(step: any): boolean {
  if (!step || step.transformChooseOpponent !== true) return false;
  const type = String(step.type || '').toLowerCase();
  return type === 'target_selection' || type === 'player_choice';
}

export function toTransformChooseOpponentPlayerPrompt(
  step: any,
  view?: { life?: Record<string, number>; players?: Array<{ id?: string; name?: string }> } | null,
): TransformChooseOpponentPromptData | null {
  if (!isTransformChooseOpponentTargetStep(step)) return null;
  const raw = Array.isArray(step.validTargets) && step.validTargets.length
    ? step.validTargets
    : (Array.isArray(step.players) ? step.players : []);
  const players: TransformChooseOpponentPlayer[] = raw
    .map((entry: any) => {
      const id = String(entry?.id || entry?.playerId || '').trim();
      if (!id) return null;
      const named = (Array.isArray(view?.players) ? view!.players : []).find((player) => String(player?.id || '') === id);
      const life = view?.life?.[id] ?? (typeof entry?.life === 'number' ? entry.life : undefined);
      return {
        id,
        name: String(entry?.label || entry?.name || named?.name || id),
        isSelf: false as const,
        isOpponent: true as const,
        ...(typeof life === 'number' ? { life } : {}),
      };
    })
    .filter(Boolean) as TransformChooseOpponentPlayer[];
  if (!players.length) return null;
  return {
    stepId: String(step.id || ''),
    title: String(step.sourceName || 'Choose an opponent'),
    description: String(step.description || 'As this creature transforms, choose an opponent.'),
    source: {
      name: String(step.sourceName || 'Permanent'),
      imageUrl: step.sourceImage,
    },
    players,
    opponentOnly: true,
    isOptional: false,
  };
}
