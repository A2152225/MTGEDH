// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster: move_zone to hand when the target is a spell still on the stack
// (Sink into Stupor: "Return target spell or nonland permanent an opponent
// controls to its owner's hand."). Removes that spell so it does not resolve.
// Public entry symbol: tryApplyMoveZoneStackSpellToHand.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { getControllerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';

function whatNamesATargetSpell(whatText: string): boolean {
  return /\btarget\s+spell\b/i.test(whatText);
}

function isStackSpellEntry(entry: any): boolean {
  const type = String(entry?.type || '').trim().toLowerCase();
  if (type === 'triggered_ability' || type === 'activated_ability' || type === 'ability' || type === 'mana_ability') {
    return false;
  }
  if (type === 'spell') return true;
  return Boolean(entry?.card) && type !== 'land';
}

function stackEntryMatchesId(entry: any, wantedId: string): boolean {
  if (!wantedId) return false;
  const id = String(entry?.id || '').trim();
  const cardId = String(entry?.card?.id || '').trim();
  return id === wantedId || cardId === wantedId;
}

export function tryApplyMoveZoneStackSpellToHand(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): MoveZoneStepHandlerResult | undefined {
  if (step.to !== 'hand') return undefined;
  const whatText = String(
    (step.what as { text?: string; raw?: string } | undefined)?.text
      || (step.what as { raw?: string } | undefined)?.raw
      || step.raw
      || '',
  ).trim();
  if (!whatNamesATargetSpell(whatText)) return undefined;

  const targetSpellId = resolveOracleIrBoundTargetSpellId(ctx);
  if (!targetSpellId) return undefined;

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const spellIndex = stack.findIndex(
    (entry) => isStackSpellEntry(entry) && stackEntryMatchesId(entry, targetSpellId),
  );
  if (spellIndex < 0) {
    return {
      applied: false,
      message: `Skipped move zone (target spell unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  const spell = stack[spellIndex];
  const controllerId = getControllerId(ctx);
  const spellController = String(spell?.controller || spell?.card?.controller || '').trim();
  if (/\ban opponent controls\b/i.test(whatText) && spellController && controllerId && spellController === controllerId) {
    return {
      applied: false,
      message: `Skipped move zone (target spell is not an opponent's): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  const ownerId = String(
    spell?.owner
      || spell?.ownerId
      || spell?.card?.owner
      || spell?.controller
      || controllerId,
  ).trim() as PlayerID;
  const card = {
    ...(spell?.card && typeof spell.card === 'object' ? spell.card : {}),
    id: String(spell?.card?.id || `${targetSpellId}-card`),
    name: String(spell?.card?.name || spell?.name || 'Returned Spell'),
    type_line: String(spell?.card?.type_line || 'Instant'),
    owner: ownerId,
    zone: 'hand',
  };
  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
    return { ...player, hand };
  });
  const updatedStack = stack.filter((_, index) => index !== spellIndex);
  const spellName = String(card.name || 'spell');

  return buildAppliedResult({
    state: { ...(state as any), stack: updatedStack, players: updatedPlayers } as GameState,
    log: [`Returned ${spellName} to its owner's hand`],
    movedCards: [card],
    fromZone: 'stack',
    toZone: 'hand',
  }, ctx);
}
