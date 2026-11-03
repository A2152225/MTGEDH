/**
 * Star Trek (trk/trc) player-event triggers and counts.
 * - FACE A DILEMMA: you face a dilemma as you choose one or more modes for a spell or ability
 *   (cast, activation, or trigger). Several modes at once is one dilemma; zero modes is none.
 *   It still counts if the spell is later countered. Per-turn count: state.dilemmasFacedThisTurn.
 * - BATTLEFRONT: distinct opponents you declared attacks against this turn (player-only list
 *   state.attackedPlayersThisTurnByPlayer, kept across combats).
 * Origin: round 37. Public: recordDilemmaFaced, getDilemmasFacedThisTurn, getBattlefrontCount.
 */

import { uid } from '../../utils.js';

const DILEMMA = /(?:^|\n)whenever you face a dilemma,\s*([^\n]+)/i;

function dilemmaEffect(card: any): string {
  const m = DILEMMA.exec(String(card?.oracle_text || ''));
  return m ? m[1].replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
}

function pushTrigger(state: any, controller: string, card: any, permanent: any | null, effect: string, zone: string): void {
  state.stack = state.stack || [];
  state.stack.push({
    id: uid('trigger'),
    type: 'triggered_ability',
    controller,
    source: permanent?.id || card?.id,
    permanentId: permanent?.id,
    sourceName: card?.name || 'Dilemma trigger',
    description: effect,
    effect,
    triggerType: 'face_a_dilemma',
    mandatory: !/\byou may\b/i.test(effect),
    card: card ? { ...card } : undefined,
    ...(permanent ? { sourcePermanentSnapshot: { ...permanent, card: { ...(permanent.card || {}) } } } : { sourceZone: zone }),
  });
}

/** Records one dilemma for `playerId` and puts that player's "whenever you face a dilemma" triggers on the stack. */
export function recordDilemmaFaced(ctx: any, playerId: string, selectedModeCount = 1): void {
  const state = ctx?.state;
  const pid = String(playerId || '');
  if (!state || !pid || !(selectedModeCount > 0)) return;
  state.dilemmasFacedThisTurn = state.dilemmasFacedThisTurn || {};
  state.dilemmasFacedThisTurn[pid] = (Number(state.dilemmasFacedThisTurn[pid]) || 0) + 1;
  if (ctx?.isReplaying || (ctx as any)?.game?.isReplaying) return;
  for (const perm of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (String(perm?.controller || '') !== pid) continue;
    const effect = dilemmaEffect(perm?.card);
    if (effect && !/from your graveyard/i.test(effect)) pushTrigger(state, pid, perm.card, perm, effect, 'battlefield');
  }
  // Graveyard-only abilities (Gabriel Lorca: "return this card from your graveyard to your hand").
  const graveyard = state.zones?.[pid]?.graveyard;
  for (const card of Array.isArray(graveyard) ? graveyard : []) {
    const effect = dilemmaEffect(card);
    if (effect && /from your graveyard/i.test(effect)) pushTrigger(state, pid, card, null, effect, 'graveyard');
  }
}

export function getDilemmasFacedThisTurn(state: any, playerId: string): number {
  return Number(state?.dilemmasFacedThisTurn?.[String(playerId || '')]) || 0;
}

/** BATTLEFRONT: distinct opponents attacked this turn; players who left the game still count. */
export function getBattlefrontCount(state: any, playerId: string): number {
  const pid = String(playerId || '');
  const list = state?.attackedPlayersThisTurnByPlayer?.[pid];
  const ids = new Set((Array.isArray(list) ? list : []).map((id: any) => String(id || '')).filter((id: string) => id && id !== pid));
  return ids.size;
}

/** Records a dilemma once per stack item (activated/triggered abilities whose modes were preselected). */
export function recordDilemmaFacedOnce(ctx: any, controller: unknown, item: any, modeCount: number): void {
  if (modeCount <= 0) return;
  if (item && typeof item === 'object') {
    if (item.dilemmaRecorded) return;
    item.dilemmaRecorded = true;
  }
  recordDilemmaFaced(ctx, String(controller || ''), modeCount);
}

/** Records a dilemma when an EffectProgram choose_mode prompt is answered (modes chosen during resolution). */
export function recordDilemmaFacedForModeChoice(game: any, step: any, response: any): void {
  const payload = step?.choiceEvent?.payload;
  const isModeChoice = String(step?.type || '') === 'mode_selection' || String(payload?.oracleStepKind || '') === 'choose_mode';
  if (!isModeChoice || response?.cancelled) return;
  const selections = Array.isArray(response?.selections) ? response.selections : [];
  if (selections.length > 0) recordDilemmaFaced(game, String(step?.playerId || response?.playerId || ''), selections.length);
}
