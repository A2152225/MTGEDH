/**
 * Batch 14: face-down permanents are revealed to all players when they leave the battlefield
 * (CR 708.9) and at game end (CR 708.10 / masking is lifted when state.gameOver).
 * Each reveal is appended to state.faceDownReveals (capped), which the view sends to everyone.
 */
export interface FaceDownRevealEntry {
  revealId: string;
  permanentId: string;
  controller: string;
  owner: string;
  reason: 'left_battlefield' | 'game_end';
  turn: number;
  card: { id: string; name: string; type_line?: string; mana_cost?: string; oracle_text?: string; image_uris?: any };
}

const MAX_REVEALS = 30;

function publicCard(card: any): FaceDownRevealEntry['card'] {
  return {
    id: String(card?.id || ''),
    name: String(card?.name || ''),
    type_line: card?.type_line,
    mana_cost: card?.mana_cost,
    oracle_text: card?.oracle_text,
    image_uris: card?.image_uris,
  };
}

export function recordFaceDownReveal(state: any, perm: any, reason: FaceDownRevealEntry['reason'] = 'left_battlefield'): FaceDownRevealEntry | null {
  if (!state || !perm || perm.isFaceDown !== true || !perm.faceUpCard) return null;
  const list: FaceDownRevealEntry[] = Array.isArray(state.faceDownReveals) ? state.faceDownReveals : [];
  const turn = Number(state.turn ?? state.turnNumber ?? 0) || 0;
  const entry: FaceDownRevealEntry = {
    revealId: `fdr_${String(perm.id)}_${list.length}_${turn}`,
    permanentId: String(perm.id || ''),
    controller: String(perm.controller || ''),
    owner: String(perm.owner || perm.controller || ''),
    reason,
    turn,
    card: publicCard(perm.faceUpCard),
  };
  list.push(entry);
  state.faceDownReveals = list.slice(-MAX_REVEALS);
  return entry;
}

// Game-end reveal is done by the view: faceDownViewMasking unmasks every face-down permanent once
// state.gameOver is true (revealedAtGameEnd: true), so no log entry is needed.
