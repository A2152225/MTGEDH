/**
 * Batch 13: socket 'turnFaceUp' special action for morph / megamorph / disguise
 * (and manifest / cloak creature cards). Doesn't use the stack; legal whenever the
 * controller has priority, at any step, with or without spells on the stack.
 *
 * Client -> server: 'turnFaceUp' { gameId, permanentId, revealCardId?, costChoices? }
 *   costChoices (Batch 14): { reveal?: cardId, return?: permanentId[], sacrifice?: permanentId[], discard?: cardId[] }
 *   'turnFaceUpCostPrompt' { gameId, permanentId, component, description, count, candidateIds } (return/sacrifice/discard)
 *   cardRevealed is emitted on EVERY turn-face-up (the turned card is public), plus once per revealed hand card.
 * Server -> client (requesting socket only):
 *   'turnFaceUpRevealPrompt' { gameId, permanentId, colorWord, candidateCardIds }  (reveal costs)
 *   'error' { code, message }   codes: NOT_FOUND, NOT_FACE_DOWN, NOT_CONTROLLER, NO_PRIORITY,
 *            NO_TURN_UP_COST, CANNOT_PAY_TURN_FACE_UP, NO_REVEAL_CARD, BAD_REVEAL_CARD, CANNOT_PAY_LIFE
 * Server -> room: 'chat' (system line, including the revealed card), 'cardRevealed'
 *   { gameId, playerId, card, reason: 'turn_face_up' } for reveal costs, then the normal state broadcast.
 * Persisted event: 'morphTurnFaceUp' { playerId, permanentId, actualCard, specialAction: true,
 *   tappedPermanentIds?, lifePaid?, revealedCardId? }.
 */
import type { Server, Socket } from 'socket.io';
import { appendEvent } from '../../db/index.js';
import { debug, debugError, debugWarn } from '../../utils/debug.js';
import { broadcastGame, ensureGame, getPlayerName, payManaCostWithAvailableSources } from '../util.js';
import { processFaceUpTriggers } from '../../state/modules/triggerEmissionFamilyUtils.js';
import { validateTurnFaceUp } from '../../state/modules/turnFaceUpCore.js';
import { applyTurnFaceUpCostEffects, planTurnFaceUpNonManaCost, type TurnFaceUpCostChoices } from '../../state/modules/turnFaceUpCostPayment.js';
import type { TurnFaceUpCostComponent } from '../../state/modules/turnFaceUpCostComponents.js';
import type { EnsureInGameRoom } from './gameActionsSocketRoomGuard.js';

export interface TurnFaceUpPayload {
  gameId?: unknown;
  permanentId?: unknown;
  revealCardId?: unknown;
  costChoices?: unknown;
}

function componentsOf(cost: any): TurnFaceUpCostComponent[] {
  if (Array.isArray(cost?.components) && cost.components.length) return cost.components;
  const out: TurnFaceUpCostComponent[] = [];
  if (cost?.manaCost) out.push({ type: 'mana', manaCost: cost.manaCost });
  if (cost?.revealColor) out.push({ type: 'reveal', color: cost.revealColor, colorWord: cost.revealColorWord });
  if (typeof cost?.lifeCost === 'number') out.push({ type: 'life', amount: cost.lifeCost });
  return out;
}

function readChoices(payload: TurnFaceUpPayload | undefined, revealCardId?: string): TurnFaceUpCostChoices {
  const raw: any = payload?.costChoices && typeof payload.costChoices === 'object' ? payload.costChoices : {};
  const list = (v: any) => (Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : typeof v === 'string' ? [v] : undefined);
  return {
    reveal: typeof raw.reveal === 'string' ? raw.reveal : revealCardId,
    return: list(raw.return),
    sacrifice: list(raw.sacrifice),
    discard: list(raw.discard),
  };
}

export async function handleTurnFaceUpRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: TurnFaceUpPayload,
): Promise<void> {
  const gameId = payload?.gameId;
  const permanentId = payload?.permanentId;
  if (!gameId || typeof gameId !== 'string') return;
  if (!permanentId || typeof permanentId !== 'string') return;
  const revealCardId = typeof payload?.revealCardId === 'string' ? payload.revealCardId : undefined;

  try {
    const game: any = ensureGame(gameId);
    const playerId = String((socket as any).data?.playerId || '');
    if (!game || !playerId) return;
    if (!ensureInGameRoom(gameId)) return;

    const v = validateTurnFaceUp(game.state, playerId, permanentId);
    if (!v.ok || !v.cost) {
      socket.emit('error', { code: v.code || 'TURN_FACE_UP_FAILED', message: v.error || 'Cannot turn that permanent face up.' });
      return;
    }
    const cost = v.cost;
    let tappedPermanentIds: string[] = [];
    const components = componentsOf(cost);
    // Plan (and prompt for) the non-mana parts before any mana is spent.
    const plan = planTurnFaceUpNonManaCost(game.state, playerId, permanentId, components, readChoices(payload, revealCardId));
    if (!plan.ok) {
      if (plan.prompt) {
        if (plan.prompt.component === 'reveal') {
          socket.emit('turnFaceUpRevealPrompt', { gameId, permanentId, colorWord: plan.prompt.colorWord, candidateCardIds: plan.prompt.candidateIds });
        } else {
          socket.emit('turnFaceUpCostPrompt', { gameId, permanentId, ...plan.prompt });
        }
        return;
      }
      socket.emit('error', { code: plan.code || 'CANNOT_PAY_TURN_FACE_UP', message: plan.error || 'Cannot pay the turn-face-up cost.' });
      return;
    }
    if (cost.manaCost) {
      const paid: any = payManaCostWithAvailableSources(game.state, playerId, cost.manaCost);
      if (!paid?.ok) {
        socket.emit('error', { code: 'CANNOT_PAY_TURN_FACE_UP', message: paid?.error || `Pay ${cost.manaCost} to turn it face up.` });
        return;
      }
      tappedPermanentIds = Array.isArray(paid.tappedPermanents) ? paid.tappedPermanents.slice() : [];
    }
    const effects = plan.effects || {};
    applyTurnFaceUpCostEffects((game.ctx || game) as any, playerId, effects, { replay: false });
    const lifePaid = effects.lifePaid || 0;
    const revealedCard: any = (plan.revealedCards || [])[0];

    const actualCard = { ...v.actualCard, zone: 'battlefield' };
    const ev: any = {
      type: 'morphTurnFaceUp',
      playerId,
      permanentId,
      actualCard,
      specialAction: true,
      ...(tappedPermanentIds.length ? { tappedPermanentIds } : {}),
      ...(lifePaid ? { lifePaid } : {}),
      ...(revealedCard ? { revealedCardId: String(revealedCard.id) } : {}),
      ...(effects.returnedPermanentIds?.length ? { returnedPermanentIds: effects.returnedPermanentIds } : {}),
      ...(effects.sacrificedPermanentIds?.length ? { sacrificedPermanentIds: effects.sacrificedPermanentIds } : {}),
      ...(effects.discardedCardIds?.length ? { discardedCardIds: effects.discardedCardIds } : {}),
    };
    // The live path already paid; replay re-applies payment fields from the persisted event.
    if (typeof game.applyEvent === 'function') {
      game.applyEvent({ ...ev, paymentAlreadyApplied: true });
    }
    const perm = (game.state.battlefield || []).find((p: any) => p && String(p.id) === permanentId);
    if (perm && perm.isFaceDown === true) {
      debugWarn(1, `[turnFaceUp] applyEvent left ${permanentId} face down`);
      return;
    }
    try {
      const { type: _t, ...persisted } = ev;
      appendEvent(gameId, game.seq ?? 0, 'morphTurnFaceUp', persisted);
    } catch (err) {
      debugWarn(1, '[turnFaceUp] appendEvent(morphTurnFaceUp) failed:', err);
    }

    // Turning a permanent face up is public: always reveal the turned card.
    io.to(gameId).emit('cardRevealed', {
      gameId, playerId, card: actualCard, reason: 'turn_face_up',
      permanentId, cardName: actualCard?.name ? String(actualCard.name) : undefined,
    });
    if (revealedCard) {
      io.to(gameId).emit('cardRevealed', {
        gameId, playerId, card: revealedCard, reason: 'turn_face_up_cost',
        permanentId, cardName: actualCard?.name ? String(actualCard.name) : undefined,
      });
    }
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} turned ${actualCard.name} face up${revealedCard ? ` (revealed ${revealedCard.name})` : ''}${lifePaid ? ` (paid ${lifePaid} life)` : ''}.`,
      ts: Date.now(),
    });

    try {
      if (perm) processFaceUpTriggers((game.ctx || game) as any, perm);
    } catch (err) {
      debugWarn(1, '[turnFaceUp] processFaceUpTriggers failed:', err);
    }
    debug(1, `[turnFaceUp] ${playerId} turned ${actualCard.name} (${permanentId}) face up`);
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugError(1, `turnFaceUp error for game ${gameId}:`, err);
  }
}