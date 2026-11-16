// server/src/state/modules/diceExchangeBasePTPrompt.ts
// Vedalken Squirrel-Whacker: after a matching die roll, offer an OPTION_CHOICE
// to exchange the result with the creature's base power or base toughness.

import type { PlayerID } from '../../../../shared/src/index.js';
import { parseDiceExchangeWithBasePT } from './batch103Parsers.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { debugWarn } from '../../utils/debug.js';

export const DICE_EXCHANGE_BASE_PT_FLAG = 'diceExchangeBasePT';

function controlledWhacker(state: any, playerId: string, sides: number): any | null {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    if (String(permanent.controller || '') !== String(playerId)) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    const parsed = parseDiceExchangeWithBasePT(oracle);
    if (parsed && parsed.sides === sides) return permanent;
  }
  return null;
}

export function maybeQueueDiceExchangeFromLastDieRoll(ctx: any, state: any = ctx?.state, result?: { appliedSteps?: readonly any[] }): boolean {
  const applied = Array.isArray(result?.appliedSteps) ? result.appliedSteps : null;
  if (applied && !applied.some((step: any) => step && String(step.kind || '') === 'roll_die')) return false;
  const roll = state?.lastDieRoll;
  if (!roll || roll.diceExchangeQueued === true) return false;
  const playerId = String(roll.playerId || '');
  const sides = Math.floor(Number(roll.sides || 0));
  const rollResult = Math.floor(Number(roll.result || 0));
  if (!playerId || sides < 2 || rollResult <= 0) return false;
  const queued = queueDiceExchangeBasePTPrompt({
    ctx: { ...(ctx || {}), state, gameId: ctx?.gameId },
    playerId,
    sides,
    result: rollResult,
  });
  if (queued && state?.lastDieRoll) state.lastDieRoll.diceExchangeQueued = true;
  return queued;
}

export function queueDiceExchangeBasePTPrompt(args: {
  ctx: any;
  playerId: string;
  sides: number;
  result: number;
}): boolean {
  const ctx = args.ctx;
  const state = ctx?.state;
  const gameId = String(ctx?.gameId || '').trim();
  const sides = Math.floor(Number(args.sides || 0));
  const result = Math.floor(Number(args.result || 0));
  if (!state || !gameId || sides < 2 || result <= 0) return false;
  const permanent = controlledWhacker(state, args.playerId, sides);
  if (!permanent) return false;
  const name = String(permanent.card?.name || 'Creature');
  const currentPower = Number(permanent.basePower ?? permanent.card?.power ?? permanent.power ?? 0);
  const currentToughness = Number(permanent.baseToughness ?? permanent.card?.toughness ?? permanent.toughness ?? 0);
  try {
    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: args.playerId as PlayerID,
      sourceId: String(permanent.id || ''),
      sourceName: name,
      description: `${name}: You may exchange the die result (${result}) with this creature's base power (${currentPower}) or base toughness (${currentToughness}).`,
      mandatory: false,
      options: [
        { id: 'keep', label: 'Keep the die result' },
        { id: 'exchange-power', label: `Exchange with base power (${currentPower})` },
        { id: 'exchange-toughness', label: `Exchange with base toughness (${currentToughness})` },
      ],
      minSelections: 1,
      maxSelections: 1,
      [DICE_EXCHANGE_BASE_PT_FLAG]: true,
      dieResult: result,
      dieSides: sides,
      diceExchangePermanentId: String(permanent.id || ''),
      currentBasePower: currentPower,
      currentBaseToughness: currentToughness,
    } as any);
    return true;
  } catch (err) {
    debugWarn(1, 'queueDiceExchangeBasePTPrompt failed', err);
    return false;
  }
}

function writeBasePT(permanent: any, power: number, toughness: number): void {
  permanent.basePower = power;
  permanent.baseToughness = toughness;
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.power = String(power);
    permanent.card.toughness = String(toughness);
  }
}

export function tryHandleDiceExchangeBasePTChoice(
  io: any,
  game: any,
  gameId: string,
  step: any,
  response: any,
): boolean {
  if (!step || step[DICE_EXCHANGE_BASE_PT_FLAG] !== true) return false;
  if (response?.cancelled) return true;
  const choice = String((Array.isArray(response?.selections) ? response.selections[0] : response?.selections) || 'keep').trim();
  const permanentId = String(step.diceExchangePermanentId || step.sourceId || '').trim();
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
  if (!permanent) return true;
  const dieResult = Math.floor(Number(step.dieResult || 0));
  const currentPower = Number(permanent.basePower ?? step.currentBasePower ?? 0);
  const currentToughness = Number(permanent.baseToughness ?? step.currentBaseToughness ?? 0);
  let nextResult = dieResult;
  if (choice === 'exchange-power') {
    writeBasePT(permanent, dieResult, currentToughness);
    nextResult = currentPower;
  } else if (choice === 'exchange-toughness') {
    writeBasePT(permanent, currentPower, dieResult);
    nextResult = currentToughness;
  }
  const state = game.state as any;
  if (state?.lastDieRoll && String(state.lastDieRoll.playerId || '') === String(step.playerId || '')) {
    state.lastDieRoll = { ...state.lastDieRoll, result: nextResult, exchanged: choice !== 'keep' };
  }
  const byPlayer = state?.lastDieRollByPlayer?.[String(step.playerId || '')];
  if (byPlayer) {
    state.lastDieRollByPlayer[String(step.playerId)] = { ...byPlayer, result: nextResult, exchanged: choice !== 'keep' };
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  return true;
}
