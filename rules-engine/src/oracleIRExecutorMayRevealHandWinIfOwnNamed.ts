/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: applyMayRevealHandWinIfOwnNamedStep — optional reveal-hand then
 *   win if the chooser owns a card with this source's current name in exile,
 *   hand, graveyard, and battlefield (Hedron Alignment family). Dry-run /
 *   apply always returns player_choice_required; win is stamped after Reveal.
 * Public: applyMayRevealHandWinIfOwnNamedStep, playerOwnsNamedCardInFourWinZones,
 *   applyWinIfOwnNamedInFourZones
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import type { GameState } from '../../shared/src';
import { opponentsHaveCantWinEffect } from './winEffectCards';

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cardNameOf(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const record = card as { name?: unknown; card?: { name?: unknown } };
  return normalizeName(record.name || record.card?.name);
}

function readChooserZoneCards(state: GameState, playerId: string, zone: 'hand' | 'graveyard' | 'exile'): readonly any[] {
  const player = Array.isArray(state.players)
    ? state.players.find((entry) => String(entry?.id || '').trim() === playerId)
    : undefined;
  const onPlayer: unknown = player ? Reflect.get(player, zone) : undefined;
  const fromPlayer: readonly unknown[] = Array.isArray(onPlayer) ? onPlayer : [];
  const inZones: unknown = state.zones?.[playerId] ? Reflect.get(state.zones[playerId], zone) : undefined;
  const fromZones: readonly unknown[] = Array.isArray(inZones) ? inZones : [];
  return fromPlayer.length > 0 ? fromPlayer : fromZones;
}

function zoneHasOwnedNamedCard(cards: readonly any[], requiredName: string): boolean {
  return cards.some((card) => cardNameOf(card) === requiredName);
}

function battlefieldHasOwnedNamedCard(state: GameState, playerId: string, requiredName: string): boolean {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.some((permanent) => {
    const owner = String((permanent as { owner?: string; controller?: string })?.owner
      || (permanent as { controller?: string })?.controller
      || '').trim();
    if (owner !== playerId) return false;
    return cardNameOf(permanent) === requiredName
      || cardNameOf((permanent as { card?: unknown }).card) === requiredName;
  });
}

export function playerOwnsNamedCardInFourWinZones(
  state: GameState,
  playerId: string,
  cardName: string,
): boolean {
  const requiredName = normalizeName(cardName);
  if (!requiredName || !playerId) return false;
  if (!zoneHasOwnedNamedCard(readChooserZoneCards(state, playerId, 'exile'), requiredName)) return false;
  if (!zoneHasOwnedNamedCard(readChooserZoneCards(state, playerId, 'hand'), requiredName)) return false;
  if (!zoneHasOwnedNamedCard(readChooserZoneCards(state, playerId, 'graveyard'), requiredName)) return false;
  return battlefieldHasOwnedNamedCard(state, playerId, requiredName);
}

export function applyWinIfOwnNamedInFourZones(
  state: GameState,
  playerId: string,
  cardName: string,
  winReason: string,
): GameState {
  if (!state || !playerId) return state;
  const cantWin = opponentsHaveCantWinEffect(
    playerId as any,
    (state.battlefield || []) as any,
    state.players as any,
    ((state as any).winLossEffects || []) as any,
  );
  if (cantWin.hasCantWin) return state;
  if (!playerOwnsNamedCardInFourWinZones(state, playerId, cardName)) return state;
  return {
    ...state,
    winner: playerId,
    status: 'finished' as any,
    winReason: String(winReason || 'You win the game') as any,
  } as GameState;
}

export function applyMayRevealHandWinIfOwnNamedStep(
  _state: GameState,
  step: Extract<OracleEffectStep, { kind: 'may_reveal_hand_then_win_if_own_named_in_zones' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const sourceName = String(ctx.sourceName || '').trim() || 'this card';
  return {
    applied: false,
    message: `You may reveal your hand. If you do, you win the game if you own a card named ${sourceName} in exile, in your hand, in your graveyard, and on the battlefield: ${step.raw}`,
    reason: 'player_choice_required',
    options: { classification: 'player_choice' },
  };
}
