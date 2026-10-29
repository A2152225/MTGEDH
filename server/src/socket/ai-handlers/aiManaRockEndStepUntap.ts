/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 *
 * Cluster moved: end-step payment to untap a mana rock that skips the untap step
 * (Basalt Monolith, Grim Monolith).
 *
 * Public entry symbols: isEndStepBeforePlayersTurn, findManaRockToReadyBeforeNextTurn,
 * tryAIReadyManaRockBeforeNextTurn, findManaRocksToTapBecauseOtherPlayersUntapThem,
 * tryAITapManaRocksOtherPlayersWillUntap.
 *
 * The rock was tapped on a prior turn. On the end step immediately before this
 * player's turn, spare mana that would empty — or lands that untap on their
 * upcoming untap step — pays to ready it. Leaving it tapped is fine when that
 * mana is not available. Main-phase tap-then-untap is not this path.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  isManaRockSelfUntapAbility,
  permanentSkipsControllerUntapStep,
} from "../../../../rules-engine/src/aiEngineActivatedAbilitySupport.js";
import { permanentUntapsOnOtherPlayersTurns } from "../../state/modules/triggers/turn-phases-handlers/turnPhaseUntapStepEffects.js";
import { parseManaCost } from "../../state/modules/mana-check.js";
import { calculateManaProduction } from "../util.js";
import { hasManaAbility } from "./aiManaCostHelpers.js";
import { executeAIActivateAbility } from "./aiActivateAbilityHandlers.js";

const POOL_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

function nextAlivePlayerId(state: any, activePlayerId: string): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const alive = (id: string): boolean => {
    const player = players.find((entry: any) => String(entry?.id || '') === id);
    if (!player) return true;
    return !player.hasLost && !player.eliminated && !player.conceded && !player.isSpectator;
  };
  const order = (Array.isArray(state?.turnOrder) ? state.turnOrder : players.map((entry: any) => entry?.id))
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean);
  const start = order.indexOf(String(activePlayerId || ''));
  if (start < 0) return '';
  for (let offset = 1; offset <= order.length; offset += 1) {
    const id = order[(start + offset) % order.length];
    if (alive(id)) return id;
  }
  return '';
}

/** End step of the turn immediately before `playerId`'s turn. Not their own end step, not cleanup. */
export function isEndStepBeforePlayersTurn(state: any, playerId: string): boolean {
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toUpperCase();
  if (phase !== 'ending' && phase !== 'end') return false;
  if (step !== 'END' && step !== 'ENDSTEP' && step !== 'END_STEP') return false;
  const active = String(state?.turnPlayer || '');
  if (!active || active === String(playerId)) return false;
  return nextAlivePlayerId(state, active) === String(playerId);
}

function manaRockSelfUntapLine(oracleText: string, cardName: string): string {
  for (const line of String(oracleText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isManaRockSelfUntapAbility(trimmed, oracleText, cardName)) return trimmed;
  }
  return '';
}

function activationManaValue(abilityText: string): number {
  const costText = String(abilityText || '').split(':')[0] || '';
  const parsed = parseManaCost(costText);
  const colored = Object.values(parsed?.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  return Number(parsed?.generic || 0) + colored;
}

function floatingMana(state: any, playerId: string): number {
  const pool = state?.manaPool?.[playerId] || {};
  return POOL_KEYS.reduce((sum, key) => sum + Number(pool[key] || 0), 0);
}

/**
 * Mana that can pay the untap now without staying spent on their next turn:
 * floating mana (it empties) and untapped sources that will untap on their turn.
 * Other "doesn't untap" rocks are not spent to ready this one.
 */
export function spareManaBeforeOwnUntap(game: any, playerId: string, excludePermanentIds: string[]): number {
  const state = game?.state || {};
  let total = floatingMana(state, playerId);
  const excluded = new Set(excludePermanentIds.map((id) => String(id || '')).filter(Boolean));
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== String(playerId)) continue;
    if (permanent.tapped) continue;
    if (excluded.has(String(permanent.id || ''))) continue;
    const oracleText = String(permanent.card?.oracle_text || '');
    if (permanentSkipsControllerUntapStep(oracleText)) continue;
    if (!hasManaAbility(permanent.card)) continue;
    const produced = calculateManaProduction(state, permanent, String(playerId));
    total += Math.max(0, Number(produced?.totalAmount || 0));
  }
  return total;
}

export function findManaRockToReadyBeforeNextTurn(
  game: any,
  playerId: string,
): { permanentId: string; cardName: string; abilityText: string } | null {
  const state = game?.state;
  if (!isEndStepBeforePlayersTurn(state, playerId)) return null;
  if (Array.isArray(state?.stack) && state.stack.length > 0) return null;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== String(playerId)) continue;
    if (!permanent.tapped) continue;
    const oracleText = String(permanent.card?.oracle_text || '');
    const cardName = String(permanent.card?.name || '');
    if (!permanentSkipsControllerUntapStep(oracleText)) continue;
    const abilityText = manaRockSelfUntapLine(oracleText, cardName);
    if (!abilityText) continue;
    const cost = activationManaValue(abilityText);
    if (cost <= 0) continue;
    const excludeIds = battlefield
      .filter((entry: any) => entry && (
        String(entry.id || '') === String(permanent.id || '')
        || permanentSkipsControllerUntapStep(String(entry.card?.oracle_text || ''))
      ))
      .map((entry: any) => String(entry.id || ''));
    if (spareManaBeforeOwnUntap(game, playerId, excludeIds) < cost) continue;
    return {
      permanentId: String(permanent.id || ''),
      cardName,
      abilityText,
    };
  }
  return null;
}

function tapForManaLine(oracleText: string): string {
  for (const line of String(oracleText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    if (!/\{T\}/i.test(match[1])) continue;
    if (!/\badd\b/i.test(match[2])) continue;
    return trimmed;
  }
  return '';
}

function refreshedManaTapWindow(state: any): string {
  return `${Number(state?.turnNumber || 0)}:${String(state?.turnPlayer || '')}`;
}

/**
 * A rock that skips its own untap step, but Unwinding Clock / Seedborn Muse / a similar
 * effect untaps it on other players' turns. Tap it for mana once each turn while it is untapped.
 */
export function findManaRocksToTapBecauseOtherPlayersUntapThem(
  game: any,
  playerId: string,
): Array<{ permanentId: string; cardName: string; abilityText: string }> {
  const state = game?.state;
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toLowerCase();
  const isMain = phase.includes('main') || step.includes('main');
  if (!isMain) return [];
  if (Array.isArray(state?.stack) && state.stack.length > 0) return [];

  const attempted = state?.aiRefreshedManaRockTaps?.[playerId];
  const windowKey = refreshedManaTapWindow(state);
  const already = attempted?.window === windowKey && Array.isArray(attempted.ids)
    ? new Set(attempted.ids.map((id: unknown) => String(id || '')))
    : new Set<string>();

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const choices: Array<{ permanentId: string; cardName: string; abilityText: string }> = [];
  for (const permanent of battlefield) {
    if (!permanent || String(permanent.controller || '') !== String(playerId)) continue;
    if (permanent.tapped) continue;
    const permanentId = String(permanent.id || '');
    if (!permanentId || already.has(permanentId)) continue;
    const oracleText = String(permanent.card?.oracle_text || '');
    const cardName = String(permanent.card?.name || '');
    if (!permanentSkipsControllerUntapStep(oracleText)) continue;
    if (!permanentUntapsOnOtherPlayersTurns(state, permanent)) continue;
    const abilityText = tapForManaLine(oracleText);
    if (!abilityText) continue;
    choices.push({ permanentId, cardName, abilityText });
  }
  return choices;
}

export async function tryAITapManaRocksOtherPlayersWillUntap(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  game: any,
): Promise<boolean> {
  const choices = findManaRocksToTapBecauseOtherPlayersUntapThem(game, playerId);
  if (choices.length === 0) return false;
  const choice = choices[0];
  const state = game?.state;
  if (state) {
    const windowKey = refreshedManaTapWindow(state);
    const prior = state.aiRefreshedManaRockTaps?.[playerId];
    const ids = prior?.window === windowKey && Array.isArray(prior.ids) ? prior.ids.map((id: unknown) => String(id)) : [];
    state.aiRefreshedManaRockTaps = state.aiRefreshedManaRockTaps || {};
    state.aiRefreshedManaRockTaps[playerId] = { window: windowKey, ids: [...ids, choice.permanentId] };
  }
  return executeAIActivateAbility(io, gameId, playerId, {
    activate: true,
    permanentId: choice.permanentId,
    cardName: choice.cardName,
    abilityText: choice.abilityText,
  });
}

export async function tryAIReadyManaRockBeforeNextTurn(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  game: any,
): Promise<boolean> {
  const choice = findManaRockToReadyBeforeNextTurn(game, playerId);
  if (!choice) return false;
  return executeAIActivateAbility(io, gameId, playerId, {
    activate: true,
    permanentId: choice.permanentId,
    cardName: choice.cardName,
    abilityText: choice.abilityText,
  });
}
