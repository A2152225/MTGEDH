/**
 * Event watchers created by resolving Oracle IR:
 *  - connive triggers ("whenever a creature you control connives", "whenever ~ connives"),
 *  - regeneration riders ("When it regenerates this way, X"), fired once the shield is used,
 *  - "when that creature leaves the battlefield this turn, X" watchers.
 * Public: prepareIrEventWatchers, finalizeIrEventWatchers, pollIrEventWatchers.
 */
import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

const ABILITY_WORD = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;
const REGEN_RIDER = /^when (?:it|that creature|the creature) regenerates this way,?\s*(.+?)\.?$/i;
const LEAVES_RIDER = /^when (that|the targeted|the|this) (creature|artifact|permanent|enchantment) leaves the battlefield this turn,?\s*(.+?)\.?$/i;

export interface IrEventPending {
  regenRiders: string[];
}

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

function queueEffect(ctx: GameContext, sourceId: string, controllerId: string, cardName: string, effect: string, triggerType: string, targetPermanentId?: string): any | null {
  const text = String(effect || '').trim();
  if (!text) return null;
  const item = queueGenericTriggeredAbility(ctx, {
    permanentId: sourceId,
    controllerId,
    cardName: cardName || 'Unknown',
    effect: text,
    description: text,
    mandatory: !/^you may\b/i.test(text),
  }, triggerType, targetPermanentId ? { targetPermanentId } : undefined);
  if (item && targetPermanentId) (item as any).targetPermanentId = targetPermanentId;
  return item;
}

function rawOf(step: any): string {
  return String(step?.raw || '').trim();
}

/** Removes rider steps the executor must not run immediately; returns the steps to execute. */
export function prepareIrEventWatchers(steps: readonly any[]): { steps: any[]; pending: IrEventPending } {
  const pending: IrEventPending = { regenRiders: [] };
  const hasRegen = steps.some((s: any) => s?.kind === 'regenerate');
  const kept: any[] = [];
  for (const step of steps) {
    const m = REGEN_RIDER.exec(rawOf(step));
    if (m && hasRegen) {
      pending.regenRiders.push(m[1]);
      continue;
    }
    kept.push(step);
  }
  return { steps: kept, pending };
}

function stepTargetId(step: any, irCtx: any): string {
  const text = String(step?.target?.text || step?.raw || '').toLowerCase();
  if (/\btarget\b|\bthat creature\b|\bit\b/.test(text) && !/^(?:~|this creature)\b/.test(text)) {
    const t = String(irCtx?.targetPermanentId || irCtx?.targetCreatureId || '').trim();
    if (t) return t;
  }
  return String(irCtx?.sourceId || '').trim();
}

const CONNIVE_ANY = /^whenever a creature you control connives,?\s*(.+)$/i;
const CONNIVE_SELF = /^whenever (?:~|this creature) connives,?\s*(.+)$/i;
// Reflexive rider after the source's own connive (Psychic Pickpocket: "When this creature enters, it connives. When it connives this way, ...").
const CONNIVE_THIS_WAY = /^when (?:it|~|this creature) connives this way,?\s*(.+)$/i;

function queueConniveTriggers(ctx: GameContext, connivedId: string, sourceId = ''): void {
  const connived = battlefieldOf(ctx).find((p: any) => String(p?.id || '') === connivedId);
  if (!connived) return;
  const conniverController = String(connived.controller || '');
  for (const permanent of battlefieldOf(ctx)) {
    if (!permanent?.card || !canTrigger(ctx, permanent)) continue;
    for (const sentence of sentencesOf(permanent.card)) {
      const any = CONNIVE_ANY.exec(sentence);
      const self = CONNIVE_SELF.exec(sentence)
        || (sourceId === connivedId && String(permanent.id) === connivedId ? CONNIVE_THIS_WAY.exec(sentence) : null);
      const effect = any && String(permanent.controller || '') === conniverController
        ? any[1]
        : (self && String(permanent.id) === connivedId ? self[1] : '');
      if (!effect) continue;
      queueEffect(ctx, String(permanent.id), String(permanent.controller || ''), String(permanent.card?.name || ''), effect, 'connives', connivedId);
    }
  }
}

/** Registers watchers from the executed steps (call after the IR result is applied). */
export function finalizeIrEventWatchers(ctx: GameContext, steps: readonly any[], pending: IrEventPending, irCtx: any, result?: any): void {
  // A connive deferred to the player's discard choice triggers when that choice resumes the step.
  const deferredConnives = new Set<string>(
    (Array.isArray(result?.automationGaps) ? result.automationGaps : [])
      .filter((gap: any) => String(gap?.stepKind || '') === 'connive' && /player_choice/.test(String(gap?.reasonCode || '')))
      .map((gap: any) => String(gap?.raw || '')),
  );
  if ((ctx as any)?.isReplaying) return;
  const state = (ctx as any).state || {};
  const sourceId = String(irCtx?.sourceId || '').trim();
  const sourceName = String(irCtx?.sourceName || '').trim();
  const controller = String(irCtx?.controllerId || '').trim();
  for (const step of steps) {
    if (step?.kind === 'connive' && !deferredConnives.has(rawOf(step))) {
      const id = stepTargetId(step, irCtx);
      if (id) queueConniveTriggers(ctx, id, sourceId);
    }
    const leaves = LEAVES_RIDER.exec(rawOf(step).replace(/^.*?\b(?=when (?:that|the|this) )/i, ''));
    if (step?.kind === 'schedule_delayed_trigger' || leaves) {
      const m = leaves || LEAVES_RIDER.exec(rawOf(step));
      if (m) {
        const watchedId = m[1] === 'this' ? sourceId : String(irCtx?.targetPermanentId || irCtx?.targetCreatureId || '').trim();
        if (watchedId) {
          if (!Array.isArray(state.leavesThisTurnWatchers)) state.leavesThisTurnWatchers = [];
          state.leavesThisTurnWatchers.push({ watchedId, effect: m[3], sourceId, sourceName, controller, turn: state.turnNumber ?? state.turn });
        }
      }
    }
    if (step?.kind === 'schedule_delayed_trigger') {
      const r = REGEN_RIDER.exec(rawOf(step));
      if (r) pending.regenRiders.push(r[1]);
    }
  }
  const shields: any[] = Array.isArray(state.regenerationShields) ? state.regenerationShields : [];
  for (const rider of pending.regenRiders) {
    for (const shield of shields) {
      if (shield?.isUsed || shield?.riderChecked) continue;
      shield.rider = rider;
      shield.riderSourceId = sourceId;
      shield.riderSourceName = sourceName;
      shield.riderController = controller || String(shield.controllerId || '');
    }
  }
  for (const shield of shields) if (shield) shield.riderChecked = true;
  pollIrEventWatchers(ctx);
}

/** Fires regen riders for used shields and leave watchers whose permanent is gone. */
export function pollIrEventWatchers(ctx: GameContext): number {
  if ((ctx as any)?.isReplaying) return 0;
  const state = (ctx as any).state || {};
  let fired = 0;
  const shields: any[] = Array.isArray(state.regenerationShields) ? state.regenerationShields : [];
  for (const shield of shields) {
    if (!shield?.rider || !shield.isUsed || shield.riderFired) continue;
    shield.riderFired = true;
    if (queueEffect(ctx, String(shield.riderSourceId || shield.permanentId || ''), String(shield.riderController || ''), String(shield.riderSourceName || ''), shield.rider, 'regenerated', String(shield.permanentId || ''))) fired++;
  }
  const watchers: any[] = Array.isArray(state.leavesThisTurnWatchers) ? state.leavesThisTurnWatchers : [];
  if (watchers.length) {
    const turn = state.turnNumber ?? state.turn;
    const onField = new Set(battlefieldOf(ctx).map((p: any) => String(p?.id || '')));
    const keep: any[] = [];
    for (const w of watchers) {
      if (w.turn !== turn) continue;
      if (onField.has(String(w.watchedId))) {
        keep.push(w);
        continue;
      }
      if (queueEffect(ctx, String(w.sourceId || ''), String(w.controller || ''), String(w.sourceName || ''), w.effect, 'leaves_this_turn', String(w.watchedId))) fired++;
    }
    state.leavesThisTurnWatchers = keep;
  }
  return fired;
}
