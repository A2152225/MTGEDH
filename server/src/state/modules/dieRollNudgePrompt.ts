// After a die roll, "you may remove a +1/+1 counter / pay N life. If you do,
// increase or decrease the result by 1." Optional OPTION_CHOICE, once per turn
// when the oracle says so. The roll's triggers wait until the choice is made.
// Origin: randomness.ts rollDie, beside diceExchangeBasePTPrompt.ts.
// Public: parseDieRollNudge, queueDieRollNudgePrompt, tryHandleDieRollNudgeChoice,
// runDieRollFollowups.

import type { PlayerID } from '../../../../shared/src/index.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { queueFreshDieRollTriggers } from './triggers/playLandSaddleDieRollHooks.js';
import { queueDiceExchangeBasePTPrompt } from './diceExchangeBasePTPrompt.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';

export const DIE_ROLL_NUDGE_FLAG = 'dieRollNudge';

const LIFE_WORDS: Record<string, number> = { a: 1, an: 1, one: 1 };

const COUNTER_RE = /after you roll a die, you may remove a \+1\/\+1 counter from (?:this creature|~)\. if you do, increase or decrease the result by 1/i;
const LIFE_RE = /after you roll a die, you may pay (\d+|a|an|one) life\. if you do, increase or decrease the result by 1/i;
const ONCE_RE = /do this only once each turn/i;

export type DieRollNudge =
  | { kind: 'counter'; oncePerTurn: boolean }
  | { kind: 'life'; life: number; oncePerTurn: boolean };

function normalize(text: unknown): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim();
}

export function parseDieRollNudge(oracle: unknown): DieRollNudge | null {
  const text = normalize(oracle);
  if (COUNTER_RE.test(text)) return { kind: 'counter', oncePerTurn: ONCE_RE.test(text) };
  const life = text.match(LIFE_RE);
  if (!life) return null;
  const token = String(life[1] || '').toLowerCase();
  const amount = /^\d+$/.test(token) ? Number(token) : (LIFE_WORDS[token] ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { kind: 'life', life: amount, oncePerTurn: ONCE_RE.test(text) };
}

function plusCounterCount(permanent: any): number {
  const counters = permanent?.counters || {};
  return Number(counters['+1/+1'] ?? counters.p1p1 ?? 0);
}

function playerLife(state: any, playerId: string): number {
  const fromMap = state?.life?.[playerId];
  if (Number.isFinite(Number(fromMap))) return Number(fromMap);
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  return Number(player?.life ?? state?.startingLife ?? 40);
}

function currentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? state?.turnCount ?? 0) || 0;
}

function alreadyUsedThisTurn(state: any, permanentId: string): boolean {
  return state?.dieRollNudgeUsedThisTurn?.[permanentId] === currentTurn(state);
}

function asked(roll: any): string[] {
  return Array.isArray(roll?.nudgeAsked) ? roll.nudgeAsked.map((id: unknown) => String(id)) : [];
}

function eligibleNudge(state: any, playerId: string): { permanent: any; nudge: DieRollNudge } | null {
  const roll = state?.lastDieRoll;
  const skipped = new Set(asked(roll));
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    if (String(permanent.controller || '') !== String(playerId)) continue;
    const id = String(permanent.id || '');
    if (!id || skipped.has(id)) continue;
    const nudge = parseDieRollNudge(permanent.card?.oracle_text || permanent.oracle_text);
    if (!nudge) continue;
    if (nudge.oncePerTurn && alreadyUsedThisTurn(state, id)) continue;
    if (nudge.kind === 'counter' && plusCounterCount(permanent) < 1) continue;
    if (nudge.kind === 'life' && playerLife(state, playerId) < nudge.life) continue;
    return { permanent, nudge };
  }
  return null;
}

export function queueDieRollNudgePrompt(args: { ctx: any; playerId: string }): boolean {
  const ctx = args.ctx;
  const state = ctx?.state;
  if (!state || (ctx as any).isReplaying) return false;
  const gameId = String(ctx.gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;
  const found = eligibleNudge(state, args.playerId);
  if (!found) return false;
  const { permanent, nudge } = found;
  const id = String(permanent.id || '');
  const roll = state.lastDieRoll || {};
  roll.nudgeAsked = [...asked(roll), id];
  state.lastDieRoll = roll;
  const result = Math.floor(Number(roll.result || 0));
  const name = String(permanent.card?.name || 'Creature');
  const costLabel = nudge.kind === 'counter'
    ? 'remove a +1/+1 counter from this creature'
    : `pay ${nudge.life} life`;
  try {
    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: args.playerId as PlayerID,
      sourceId: id,
      sourceName: name,
      description: `${name}: You rolled ${result}. You may ${costLabel}. If you do, increase or decrease the result by 1.`,
      mandatory: false,
      options: [
        { id: 'decline', label: 'Leave the result unchanged' },
        { id: 'increase', label: `Pay and increase the result to ${result + 1}` },
        { id: 'decrease', label: `Pay and decrease the result to ${result - 1}` },
      ],
      minSelections: 1,
      maxSelections: 1,
      [DIE_ROLL_NUDGE_FLAG]: true,
      dieRollNudgeKind: nudge.kind,
      dieRollNudgeLife: nudge.kind === 'life' ? nudge.life : 0,
      dieRollNudgeOnce: nudge.oncePerTurn === true,
      dieRollNudgePermanentId: id,
      dieResult: result,
    } as any);
    return true;
  } catch (err) {
    debugWarn(1, 'queueDieRollNudgePrompt failed', err);
    return false;
  }
}

function selectedChoice(response: any): string {
  if (response?.cancelled) return 'decline';
  const selections = response?.selections;
  if (Array.isArray(selections) && selections[0]) return String(selections[0]?.id || selections[0]);
  if (typeof selections === 'string') return selections;
  return String(response?.selectedOption || response?.optionId || 'decline');
}

function removeOnePlusCounter(permanent: any): void {
  const counters = permanent.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  const key = counters['+1/+1'] != null ? '+1/+1' : (counters.p1p1 != null ? 'p1p1' : '+1/+1');
  const next = Math.max(0, Number(counters[key] || 0) - 1);
  if (next <= 0) delete counters[key];
  else counters[key] = next;
  permanent.counters = counters;
}

function writeResult(state: any, playerId: string, delta: number): number {
  const roll = state?.lastDieRoll;
  const next = Math.floor(Number(roll?.result || 0)) + delta;
  if (roll && String(roll.playerId || '') === playerId) {
    state.lastDieRoll = { ...roll, result: next, nudged: delta !== 0 };
  }
  const byPlayer = state?.lastDieRollByPlayer?.[playerId];
  if (byPlayer) state.lastDieRollByPlayer[playerId] = { ...byPlayer, result: next };
  const history = state?.dieRollsThisTurn?.[playerId];
  if (Array.isArray(history) && history.length > 0) {
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, result: next };
  }
  return next;
}

export function applyDieRollNudgeToState(state: any, args: {
  playerId: string;
  permanentId: string;
  kind: string;
  life: number;
  delta: number;
  oncePerTurn: boolean;
}): number {
  const playerId = String(args.playerId || '');
  const permanentId = String(args.permanentId || '');
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
  if (args.kind === 'counter' && permanent) removeOnePlusCounter(permanent);
  if (args.kind === 'life' && args.life > 0 && playerId) {
    state.life = state.life || {};
    const current = playerLife(state, playerId);
    const nextLife = current - args.life;
    state.life[playerId] = nextLife;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '') === playerId);
    if (player) player.life = nextLife;
  }
  if (args.oncePerTurn && permanentId) {
    state.dieRollNudgeUsedThisTurn = state.dieRollNudgeUsedThisTurn || {};
    state.dieRollNudgeUsedThisTurn[permanentId] = currentTurn(state);
  }
  return writeResult(state, playerId, args.delta);
}

export function runDieRollFollowups(io: any, game: any, gameId: string, playerId: string): boolean {
  const state = game?.state;
  const roll = state?.lastDieRoll;
  if (!roll || roll.followupsFired === true) return false;
  roll.followupsFired = true;
  void io;
  let changed = false;
  try {
    if (queueFreshDieRollTriggers(game, playerId).length > 0) changed = true;
  } catch { /* best-effort */ }
  try {
    if (queueDiceExchangeBasePTPrompt({
      ctx: { ...game, gameId, state },
      playerId,
      sides: Math.floor(Number(roll.sides || 0)),
      result: Math.floor(Number(roll.result || 0)),
    })) changed = true;
  } catch { /* best-effort */ }
  return changed;
}

export function tryHandleDieRollNudgeChoice(
  io: any,
  game: any,
  gameId: string,
  step: any,
  response: any,
): boolean {
  if (!step || step[DIE_ROLL_NUDGE_FLAG] !== true) return false;
  const choice = selectedChoice(response);
  const playerId = String(step.playerId || response?.playerId || '');
  const state = game?.state;
  if (!state) return true;
  const paying = choice === 'increase' || choice === 'decrease';
  const delta = choice === 'increase' ? 1 : choice === 'decrease' ? -1 : 0;
  let result = Math.floor(Number(state.lastDieRoll?.result || step.dieResult || 0));
  if (paying) {
    result = applyDieRollNudgeToState(state, {
      playerId,
      permanentId: String(step.dieRollNudgePermanentId || step.sourceId || ''),
      kind: String(step.dieRollNudgeKind || ''),
      life: Math.max(0, Math.floor(Number(step.dieRollNudgeLife || 0))),
      delta,
      oncePerTurn: step.dieRollNudgeOnce === true,
    });
  }
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'dieRollNudgeResolve', {
      playerId,
      resolvedStepId: String(step.id || ''),
      permanentId: String(step.dieRollNudgePermanentId || step.sourceId || ''),
      kind: String(step.dieRollNudgeKind || ''),
      declined: !paying,
      lifeDelta: paying && String(step.dieRollNudgeKind || '') === 'life' ? -Math.max(0, Math.floor(Number(step.dieRollNudgeLife || 0))) : 0,
      removePlusCounter: paying && String(step.dieRollNudgeKind || '') === 'counter',
      resultDelta: paying ? delta : 0,
      oncePerTurn: paying && step.dieRollNudgeOnce === true,
    });
  } catch (err) {
    debugWarn(1, 'appendEvent(dieRollNudgeResolve) failed', err);
  }
  if (paying) {
    try {
      io?.to?.(gameId)?.emit?.('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${step.sourceName || 'A permanent'}: the die result is now ${result}.`,
        ts: Date.now(),
      });
    } catch { /* best-effort */ }
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  if (!queueDieRollNudgePrompt({ ctx: { ...game, gameId, state }, playerId })) {
    runDieRollFollowups(io, game, gameId, playerId);
  }
  return true;
}
