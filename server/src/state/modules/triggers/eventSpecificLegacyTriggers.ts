/**
 * Event-specific trigger emission for detector families that had a detector but no event hook:
 * self-discard ("when you discard this card", "when a spell or ability an opponent controls
 * causes you to discard this card"), "whenever you roll a N", "whenever a creature you control
 * explores", "whenever you activate a loyalty ability of ... planeswalker", and
 * "whenever this creature crews a Vehicle".
 * Public: queueSelfDiscardTriggers, resolveDiscardCauseController, queueDieRollResultTriggers,
 *   queueCreatureExploresTriggers, queueLoyaltyActivationTriggers, queueCrewVehicleTriggers.
 */
import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
import { queueFreshDieRollTriggers } from './playLandSaddleDieRollHooks.js';

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

function triggerSentences(oracleText: string): string[] {
  return String(oracleText || '')
    .replace(/\([^)]*\)/g, '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    .map((s) => s.replace(ABILITY_WORD, '').trim())
    .filter(Boolean);
}

function effectOf(raw: string): string {
  return String(raw || '').trim();
}

function isMandatory(effect: string): boolean {
  return !/^you may\b/i.test(effect);
}

function replaying(ctx: GameContext): boolean {
  return Boolean((ctx as any)?.isReplaying);
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

function queueFromPermanent(ctx: GameContext, permanent: any, effect: string, triggerType: string, effectData?: Record<string, unknown>): any | null {
  return queueGenericTriggeredAbility(ctx, {
    permanentId: String(permanent?.id || ''),
    controllerId: String(permanent?.controller || ''),
    cardName: String(permanent?.card?.name || 'Unknown'),
    effect,
    description: effect,
    mandatory: isMandatory(effect),
  }, triggerType, effectData);
}

const SELF_DISCARD = /^when (?:this creature dies and when )?you discard this card,\s*(.+)$/i;

/** The cycle half of "When you cast or cycle ~" (the cast half is the spell-cast detector's). */
const CAST_OR_CYCLE = /^when you cast or cycle (?:~|this card),\s*(.+)$/i;

/** Whole lines, so a reflexive "When you do" rider stays with its trigger. */
function triggerLines(oracleText: string): string[] {
  return String(oracleText || '').replace(/\([^)]*\)/g, '').split(/\n+/).map((s) => s.replace(ABILITY_WORD, '').trim()).filter(Boolean);
}
const OPPONENT_CAUSED_SELF_DISCARD = /^when a spell or ability an opponent controls causes you to discard this card,\s*(.+)$/i;

/** Who controls the spell or ability behind a discard step, when it can be told. */
export function resolveDiscardCauseController(state: any, step: any): string {
  const explicit = String(step?.sourceControllerId || step?.sourceController || step?.causeControllerId || '').trim();
  if (explicit) return explicit;
  const sourceId = String(step?.sourceId || '').trim();
  if (!sourceId) return '';
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = bf.find((p: any) => String(p?.id || '') === sourceId);
  if (perm?.controller) return String(perm.controller);
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const item = stack.find((s: any) => String(s?.id || '') === sourceId || String(s?.source || s?.sourceId || '') === sourceId);
  return String(item?.controller || '').trim();
}

/** The discarded card's own "when you discard this card" abilities (CR 603.6 look-back from the graveyard). */
export function queueSelfDiscardTriggers(
  ctx: GameContext,
  discardingPlayerId: string,
  discardedCards: readonly any[],
  options?: { causeControllerId?: string; fromCycling?: boolean },
): any[] {
  if (replaying(ctx) || !discardingPlayerId) return [];
  const cause = String(options?.causeControllerId || '').trim();
  const queued: any[] = [];
  for (const card of Array.isArray(discardedCards) ? discardedCards : []) {
    if (!card) continue;
    const faces = Array.isArray(card.card_faces) && card.card_faces.length > 0 ? card.card_faces : [card];
    for (const face of faces) {
      for (const sentence of triggerLines(String(face?.oracle_text || ''))) {
        let effect = '';
        const self = SELF_DISCARD.exec(sentence);
        if (self) effect = effectOf(self[1]);
        const faceName = String(face?.name || card.name || '');
        const castOrCycle = options?.fromCycling ? CAST_OR_CYCLE.exec(faceName ? sentence.split(faceName).join('~') : sentence) : null;
        if (castOrCycle) effect = effectOf(castOrCycle[1]);
        const opp = OPPONENT_CAUSED_SELF_DISCARD.exec(sentence);
        if (opp) {
          if (!cause || cause === String(discardingPlayerId)) continue;
          effect = effectOf(opp[1]);
        }
        if (!effect) continue;
        const cardId = String(card.id || '');
        const snapshot = { id: cardId, controller: String(discardingPlayerId), owner: String(card.owner || discardingPlayerId), card: { ...card }, zone: 'graveyard' };
        const item = queueGenericTriggeredAbility(ctx, {
          permanentId: cardId,
          controllerId: String(discardingPlayerId),
          cardName: String(card.name || face?.name || 'Unknown'),
          effect,
          description: effect,
          mandatory: isMandatory(effect),
          _sourceSnapshot: snapshot,
        }, opp ? 'opponent_caused_self_discard' : castOrCycle ? 'cycled_self' : 'self_discard', {
          discardingPlayerId: String(discardingPlayerId),
          discardedCardId: cardId,
          sourceZone: 'graveyard',
          ...(cause ? { causeControllerId: cause } : null),
        });
        if (item) queued.push(item);
      }
    }
  }
  return queued;
}

const ROLL_N = /^whenever you roll a (\d+)(?! or),\s*(.+)$/i;

/** "Whenever you roll a N": one trigger per die whose result is N. */
export function queueDieRollResultTriggers(ctx: GameContext, playerId: string, results: readonly number[]): any[] {
  if (replaying(ctx) || !playerId) return [];
  // A recorded roll goes through the shared once-per-roll path (all result templates).
  const recorded = (ctx as any)?.state?.lastDieRollByPlayer?.[String(playerId)];
  if (recorded && typeof recorded === 'object') return queueFreshDieRollTriggers(ctx, String(playerId));
  const rolled = (Array.isArray(results) ? results : []).map((r) => Number(r)).filter((r) => Number.isFinite(r));
  if (rolled.length === 0) return [];
  const queued: any[] = [];
  for (const permanent of battlefieldOf(ctx)) {
    if (String(permanent?.controller || '') !== String(playerId) || !permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of triggerSentences(String(permanent.card.oracle_text || ''))) {
      const m = ROLL_N.exec(sentence);
      if (!m) continue;
      const wanted = Number(m[1]);
      for (const result of rolled) {
        if (result !== wanted) continue;
        const item = queueFromPermanent(ctx, permanent, effectOf(m[2]), 'die_roll_single_result', { playerId, result });
        if (item) queued.push(item);
      }
    }
  }
  return queued;
}

const EXPLORES = /^whenever a creature you control explores(?: a (land|nonland) card)?,\s*(.+)$/i;

/** "Whenever a creature you control explores [a land/nonland card]". */
export function queueCreatureExploresTriggers(ctx: GameContext, playerId: string, explorerPermanentId: string, revealedIsLand: boolean): any[] {
  if (replaying(ctx) || !playerId) return [];
  const queued: any[] = [];
  for (const permanent of battlefieldOf(ctx)) {
    if (String(permanent?.controller || '') !== String(playerId) || !permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of triggerSentences(String(permanent.card.oracle_text || ''))) {
      const m = EXPLORES.exec(sentence);
      if (!m) continue;
      if (m[1] && (m[1].toLowerCase() === 'land') !== Boolean(revealedIsLand)) continue;
      const item = queueFromPermanent(ctx, permanent, effectOf(m[2]), 'creature_explores', { playerId, explorerPermanentId, revealedIsLand: Boolean(revealedIsLand) });
      if (item) queued.push(item);
    }
  }
  return queued;
}

const LOYALTY = /^whenever you activate a loyalty ability of (?:(enchanted) planeswalker|(?:a |an )?(?:([a-z][a-z'-]*) )?planeswalker),\s*(.+)$/i;

/** "Whenever you activate a loyalty ability of [a Chandra / enchanted] planeswalker". */
export function queueLoyaltyActivationTriggers(ctx: GameContext, playerId: string, planeswalker: any, stackItemId?: string): any[] {
  if (replaying(ctx) || !playerId || !planeswalker) return [];
  const typeLine = String(planeswalker?.card?.type_line || '').toLowerCase();
  const pwId = String(planeswalker.id || '');
  const queued: any[] = [];
  for (const permanent of battlefieldOf(ctx)) {
    if (String(permanent?.controller || '') !== String(playerId) || !permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of triggerSentences(String(permanent.card.oracle_text || ''))) {
      const m = LOYALTY.exec(sentence);
      if (!m) continue;
      if (m[1]) {
        if (String(permanent.attachedTo || '') !== pwId) continue;
      } else if (m[2] && !new RegExp('\\b' + m[2].toLowerCase() + '\\b').test(typeLine.split(/[\u2014-]/).slice(1).join(' '))) {
        continue;
      }
      const item = queueFromPermanent(ctx, permanent, effectOf(m[3]), 'loyalty_ability_activated', {
        playerId,
        planeswalkerId: pwId,
        ...(stackItemId ? { triggeringStackItemId: stackItemId } : null),
      });
      if (item) {
        if (stackItemId) (item as any).triggeringStackItemId = stackItemId;
        queued.push(item);
      }
    }
  }
  return queued;
}

const CREWS = /^whenever (?:this creature|~) (?:saddles a mount or )?crews a vehicle( during your main phase)?,\s*(.+)$/i;

/** "Whenever this creature crews a Vehicle [during your main phase]". */
export function queueCrewVehicleTriggers(ctx: GameContext, crewerIds: readonly string[], vehicleId: string): any[] {
  if (replaying(ctx)) return [];
  const state = (ctx as any).state || {};
  const step = String(state.step || state.phase || '').toLowerCase();
  const queued: any[] = [];
  for (const id of Array.isArray(crewerIds) ? crewerIds : []) {
    const permanent = battlefieldOf(ctx).find((p: any) => String(p?.id || '') === String(id));
    if (!permanent?.card || !canTrigger(ctx, permanent)) continue;
    const name = String(permanent.card.name || '');
    for (const raw of triggerSentences(String(permanent.card.oracle_text || ''))) {
      const sentence = name ? raw.split(name).join('~') : raw;
      const m = CREWS.exec(sentence);
      if (!m) continue;
      if (m[1]) {
        const mine = String(state.turnPlayer || state.activePlayer || '') === String(permanent.controller || '');
        if (!mine || !/main/.test(step)) continue;
      }
      const item = queueFromPermanent(ctx, permanent, effectOf(m[2]), 'crew_vehicle', { vehicleId, crewerId: String(id), targetPermanentId: vehicleId });
      if (item) queued.push(item);
    }
  }
  return queued;
}
