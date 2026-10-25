/**
 * Event hooks for trigger families whose detectors existed without a runtime:
 * the land half of "whenever you play a land (from exile) or cast a spell (from exile)",
 * the saddle half of "whenever this creature saddles a Mount or crews a Vehicle",
 * and die-roll result triggers ("roll a N", "a N or M", "N or higher", "natural N", "your third die")
 * for rolls made by spells, abilities, and manual rolls.
 * Public: queuePlayLandOrCastLandTriggers, queueSaddleMountTriggers, matchDieRollTrigger,
 *   queueFreshDieRollTriggers.
 */
import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

function sentencesOf(card: any): string[] {
  const name = String(card?.name || '');
  return String(card?.oracle_text || '')
    .replace(/\([^)]*\)/g, '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((s) => s.replace(ABILITY_WORD, '').trim())
    .map((s) => (name ? s.split(name).join('~') : s))
    .filter(Boolean);
}

function battlefieldOf(ctx: GameContext): any[] {
  const bf = (ctx as any)?.state?.battlefield;
  return Array.isArray(bf) ? bf : [];
}

function canTrigger(ctx: GameContext, permanent: any): boolean {
  try {
    return permanentHasTriggeredAbilities(permanent, (ctx as any).state, { event: 'other' } as any);
  } catch {
    return true;
  }
}

function queue(ctx: GameContext, permanent: any, effect: string, triggerType: string, effectData?: Record<string, unknown>): any | null {
  const text = String(effect || '').trim();
  return queueGenericTriggeredAbility(ctx, {
    permanentId: String(permanent?.id || ''),
    controllerId: String(permanent?.controller || permanent?.owner || ''),
    cardName: String(permanent?.card?.name || 'Unknown'),
    effect: text,
    description: text,
    mandatory: !/^you may\b/i.test(text),
  }, triggerType, effectData);
}

const PLAY_LAND_OR_CAST = /^whenever you play a land( from exile)? or cast a spell(?: from exile)?,\s*(.+)$/i;

/** Land half of "whenever you play a land [from exile] or cast a spell [from exile]". */
export function queuePlayLandOrCastLandTriggers(ctx: GameContext, playerId: string, landId: string, playedFromExile: boolean): any[] {
  if ((ctx as any)?.isReplaying || !playerId) return [];
  const queued: any[] = [];
  for (const permanent of battlefieldOf(ctx)) {
    if (String(permanent?.controller || '') !== String(playerId) || !permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of sentencesOf(permanent.card)) {
      const m = PLAY_LAND_OR_CAST.exec(sentence);
      if (!m) continue;
      if (m[1] && !playedFromExile) continue;
      const item = queue(ctx, permanent, m[2], 'play_land_or_cast', { triggeringLandId: landId, playerId });
      if (item) {
        (item as any).triggeringLandId = landId;
        queued.push(item);
      }
    }
  }
  return queued;
}

const SADDLES = /^whenever (?:this creature|~) saddles a mount(?: or crews a vehicle)?( during your main phase)?,\s*(.+)$/i;

/** "Whenever this creature saddles a Mount [or crews a Vehicle] [during your main phase]" (saddle half). */
export function queueSaddleMountTriggers(ctx: GameContext, saddlerIds: readonly string[], mountId: string): any[] {
  if ((ctx as any)?.isReplaying || !mountId) return [];
  const state = (ctx as any).state || {};
  const step = String(state.step || state.phase || '').toLowerCase();
  const queued: any[] = [];
  for (const id of Array.isArray(saddlerIds) ? saddlerIds : []) {
    const permanent = battlefieldOf(ctx).find((p: any) => String(p?.id || '') === String(id));
    if (!permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of sentencesOf(permanent.card)) {
      const m = SADDLES.exec(sentence);
      if (!m) continue;
      if (m[1]) {
        const mine = String(state.turnPlayer || state.activePlayer || '') === String(permanent.controller || '');
        if (!mine || !/main/.test(step)) continue;
      }
      const item = queue(ctx, permanent, m[2], 'saddle_mount', { mountId, saddlerId: String(id), targetPermanentId: mountId });
      if (item) queued.push(item);
    }
  }
  return queued;
}

export interface DieRollTriggerMatch {
  readonly effect: string;
  readonly accepts: (result: number, rollIndexThisTurn: number) => boolean;
}

/** Recognises a die-roll result trigger sentence; null when it is not one. */
export function matchDieRollTrigger(sentence: string): DieRollTriggerMatch | null {
  const s = String(sentence || '').trim();
  let m = /^when(?:ever)? you roll a (\d+) or (\d+),\s*(.+)$/i.exec(s);
  if (m) { const a = Number(m[1]); const b = Number(m[2]); return { effect: m[3], accepts: (r) => r === a || r === b }; }
  m = /^when(?:ever)? you roll an? (\d+) or higher,\s*(.+)$/i.exec(s);
  if (m) { const n = Number(m[1]); return { effect: m[2], accepts: (r) => r >= n }; }
  m = /^when(?:ever)? you roll a natural (\d+),\s*(.+)$/i.exec(s);
  if (m) { const n = Number(m[1]); return { effect: m[2], accepts: (r) => r === n }; }
  m = /^whenever you roll your third die each turn,\s*(.+)$/i.exec(s);
  if (m) return { effect: m[1], accepts: (_r, idx) => idx === 3 };
  m = /^when(?:ever)? you roll a (\d+),\s*(.+)$/i.exec(s);
  if (m) { const n = Number(m[1]); return { effect: m[2], accepts: (r) => r === n }; }
  return null;
}

function rollsThisTurn(state: any, playerId: string): number {
  const list = state?.dieRollsThisTurn?.[playerId];
  if (!Array.isArray(list)) return 0;
  return list.reduce((sum: number, rec: any) => sum + Math.max(1, Number(rec?.count) || (Array.isArray(rec?.results) ? rec.results.length : 1)), 0);
}

/**
 * Queues result triggers for each player's latest die roll exactly once (the roll record is marked),
 * so spell, ability, and manual roll paths can all call this without double-queueing.
 */
export function queueFreshDieRollTriggers(ctx: GameContext, onlyPlayerId?: string): any[] {
  const state = (ctx as any)?.state;
  if (!state || (ctx as any)?.isReplaying) return [];
  const byPlayer = state.lastDieRollByPlayer || {};
  const queued: any[] = [];
  for (const playerId of Object.keys(byPlayer)) {
    if (onlyPlayerId && playerId !== onlyPlayerId) continue;
    const roll = byPlayer[playerId];
    if (!roll || typeof roll !== 'object' || roll.resultTriggersQueued) continue;
    roll.resultTriggersQueued = true;
    const results = (Array.isArray(roll.results) ? roll.results : [roll.result]).map(Number).filter(Number.isFinite);
    if (results.length === 0) continue;
    const total = rollsThisTurn(state, playerId);
    const firstIndex = Math.max(1, total - results.length + 1);
    const sources: any[] = battlefieldOf(ctx).filter((p: any) => String(p?.controller || '') === playerId && p?.card && canTrigger(ctx, p));
    const player = (Array.isArray(state.players) ? state.players : []).find((p: any) => String(p?.id || '') === playerId);
    const zoneGy = state.zones?.[playerId]?.graveyard || player?.graveyard || [];
    for (const card of Array.isArray(zoneGy) ? zoneGy : []) {
      if (/^when you roll a natural/im.test(String(card?.oracle_text || ''))) {
        sources.push({ id: card.id, controller: playerId, owner: playerId, card, fromGraveyard: true });
      }
    }
    for (const source of sources) {
      for (const sentence of sentencesOf(source.card)) {
        const match = matchDieRollTrigger(sentence);
        if (!match) continue;
        if (!source.fromGraveyard && /natural/i.test(sentence)) continue;
        results.forEach((result: number, i: number) => {
          if (!match.accepts(result, firstIndex + i)) return;
          const item = queue(ctx, source, match.effect, 'die_roll_single_result', { playerId, result, amount: result, ...(source.fromGraveyard ? { graveyardCardId: source.id } : {}) });
          if (item) {
            (item as any).xValue = result;
            queued.push(item);
          }
        });
      }
    }
  }
  return queued;
}
