import { appendEvent } from '../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../state/resolution/index.js';
import { validateLifePayment } from '../state/utils.js';
import {
  broadcastGame,
  calculateTotalAvailableMana,
  getPlayerName,
  getOrInitManaPool,
  parseManaCost,
  validateManaPayment,
} from './util.js';

type PendingOptionalPaymentCallbackEntry = {
  onPay: () => Promise<void>;
  onDecline?: () => Promise<void>;
};

type OptionalPaymentValidationFailure = {
  code: string;
  message: string;
};

type OptionalPaymentValidationKind = 'mana' | 'life' | 'none';

type QueueOptionalPaymentStepOptions = {
  playerId: string;
  sourceName: string;
  description: string;
  onPay: () => Promise<void>;
  onDecline?: () => Promise<void>;
  sourceId?: string;
  sourceImage?: string;
  payChoiceId: string;
  payLabel: string;
  payDescription?: string;
  declineChoiceId: string;
  declineLabel: string;
  declineDescription?: string;
  mandatory?: boolean;
  minSelections?: number;
  maxSelections?: number;
  priority?: number;
  validationKind?: OptionalPaymentValidationKind;
  manaCost?: string;
  lifeAmount?: number;
  stepData?: Record<string, unknown>;
};

const pendingOptionalPaymentCallbacks = new Map<string, Map<string, PendingOptionalPaymentCallbackEntry>>();

export function registerOptionalPaymentCallback(
  gameId: string,
  onPay: () => Promise<void>,
  onDecline?: () => Promise<void>
): string {
  if (!pendingOptionalPaymentCallbacks.has(gameId)) {
    pendingOptionalPaymentCallbacks.set(gameId, new Map());
  }

  const id = `optional_payment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingOptionalPaymentCallbacks.get(gameId)!.set(id, { onPay, onDecline });
  return id;
}

export function consumeOptionalPaymentCallback(
  gameId: string,
  callbackId: string
): PendingOptionalPaymentCallbackEntry | undefined {
  const gameCallbacks = pendingOptionalPaymentCallbacks.get(gameId);
  if (!gameCallbacks || !callbackId) {
    return undefined;
  }

  const entry = gameCallbacks.get(callbackId);
  if (!entry) {
    return undefined;
  }

  gameCallbacks.delete(callbackId);
  return entry;
}

export function clearOptionalPaymentCallbacks(gameId: string): void {
  pendingOptionalPaymentCallbacks.delete(gameId);
}

export function isOptionalPaymentPromptStep(stepData: any): boolean {
  return stepData?.optionalPaymentPrompt === true;
}

export function isOptionalPaymentPayChoice(stepData: any, choiceId: string | null | undefined): boolean {
  const normalizedChoiceId = String(choiceId || '').trim();
  const payChoiceId = String(stepData?.optionalPaymentPayChoiceId || 'pay').trim();
  return normalizedChoiceId.length > 0 && normalizedChoiceId === payChoiceId;
}

export function getOptionalPaymentValidationFailure(
  game: any,
  playerId: string,
  stepData: any,
  choiceId: string | null | undefined
): OptionalPaymentValidationFailure | null {
  if (!isOptionalPaymentPromptStep(stepData) || !isOptionalPaymentPayChoice(stepData, choiceId)) {
    return null;
  }

  const validationKind = String(stepData?.optionalPaymentValidationKind || 'none').trim().toLowerCase();
  if (validationKind === 'mana') {
    const manaCost = String(stepData?.optionalPaymentManaCost || stepData?.manaCost || '').trim();
    if (!manaCost) {
      return { code: 'UNSUPPORTED_COST', message: 'Missing mana cost.' };
    }
    if (!/\{[^}]+\}/.test(manaCost)) {
      return { code: 'UNSUPPORTED_COST', message: `Unsupported mana cost (${manaCost || 'unknown'}).` };
    }

    try {
      const parsed = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, playerId) as any;
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const message = validateManaPayment(totalAvailable, parsed.colors, parsed.generic);
      return message ? { code: 'INSUFFICIENT_MANA', message } : null;
    } catch {
      return { code: 'UNSUPPORTED_COST', message: 'Unable to validate mana payment.' };
    }
  }

  if (validationKind === 'life') {
    const lifeAmount = Number(stepData?.optionalPaymentLifeAmount || stepData?.payLifeAmount || 0);
    const currentLife = Number(game?.state?.life?.[playerId] ?? game?.life?.[playerId] ?? game?.state?.startingLife ?? 40);
    const message = validateLifePayment(currentLife, lifeAmount, String(stepData?.sourceName || stepData?.cardName || 'card'));
    return message ? { code: 'INSUFFICIENT_LIFE', message } : null;
  }

  return null;
}

export function queueOptionalPaymentStep(gameId: string, options: QueueOptionalPaymentStepOptions): void {
  const callbackId = registerOptionalPaymentCallback(gameId, options.onPay, options.onDecline);
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: options.playerId,
    description: options.description,
    mandatory: options.mandatory ?? false,
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    sourceImage: options.sourceImage,
    options: [
      {
        id: options.payChoiceId,
        label: options.payLabel,
        description: options.payDescription,
      },
      {
        id: options.declineChoiceId,
        label: options.declineLabel,
        description: options.declineDescription,
      },
    ],
    minSelections: options.minSelections ?? 1,
    maxSelections: options.maxSelections ?? 1,
    priority: options.priority,
    optionalPaymentPrompt: true,
    optionalPaymentValidationKind: options.validationKind ?? 'none',
    optionalPaymentManaCost: options.manaCost,
    optionalPaymentLifeAmount: options.lifeAmount,
    optionalPaymentPayChoiceId: options.payChoiceId,
    optionalPaymentDeclineChoiceId: options.declineChoiceId,
    pendingOptionalPaymentCallbackId: callbackId,
    ...(options.stepData || {}),
  } as any);
}

export function queueShockLandPaymentStep(
  io: any,
  game: any,
  gameId: string,
  playerId: string,
  permanent: any,
  cardName: string,
  sourceImage?: string
): void {
  const permanentId = String(permanent?.id || '').trim();
  if (!permanentId) {
    return;
  }

  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((s: any) => (s as any)?.shockLandChoice === true && String((s as any)?.permanentId || '') === permanentId);
  if (existing) {
    return;
  }

  const currentLife = (game.state as any)?.life?.[playerId] ?? (game as any)?.life?.[playerId] ?? 40;
  queueOptionalPaymentStep(gameId, {
    playerId,
    sourceName: cardName,
    sourceId: permanentId,
    sourceImage,
    description: `${cardName}: You may pay 2 life. If you don't, it enters tapped. (Life: ${currentLife})`,
    mandatory: true,
    payChoiceId: 'pay_2_life',
    payLabel: 'Pay 2 life (enter untapped)',
    declineChoiceId: 'enter_tapped',
    declineLabel: 'Have it enter tapped',
    validationKind: 'life',
    lifeAmount: 2,
    stepData: {
      shockLandChoice: true,
      permanentId,
      payLifeAmount: 2,
      cardName,
    },
    onPay: async () => {
      (game.state as any).life = (game.state as any).life || {};
      const startingLife = Number((game.state as any).life[playerId] ?? (game as any)?.life?.[playerId] ?? 40);
      const newLife = startingLife - 2;
      (game.state as any).life[playerId] = newLife;
      if ((game as any).life) {
        (game as any).life[playerId] = newLife;
      }

      const players = game.state?.players || [];
      const player = players.find((p: any) => p.id === playerId);
      if (player) {
        (player as any).life = newLife;
      }

      (permanent as any).tapped = false;

      io?.to?.(gameId)?.emit?.('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)} pays 2 life for ${cardName} to enter untapped. (${startingLife} → ${newLife})`,
        ts: Date.now(),
      });

      try {
        await appendEvent(gameId, (game as any).seq || 0, 'shockLandChoice', {
          playerId,
          permanentId,
          payLife: true,
          cardName,
        });
      } catch (e) {
        // best-effort persistence only
      }

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      if (io) {
        broadcastGame(io, game as any, gameId);
      }
    },
    onDecline: async () => {
      (permanent as any).tapped = true;

      io?.to?.(gameId)?.emit?.('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, playerId)}'s ${cardName} enters the battlefield tapped.`,
        ts: Date.now(),
      });

      try {
        await appendEvent(gameId, (game as any).seq || 0, 'shockLandChoice', {
          playerId,
          permanentId,
          payLife: false,
          cardName,
        });
      } catch (e) {
        // best-effort persistence only
      }

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      if (io) {
        broadcastGame(io, game as any, gameId);
      }
    },
  });
}