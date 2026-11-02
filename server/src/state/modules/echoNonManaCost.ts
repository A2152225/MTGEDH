// server/src/state/modules/echoNonManaCost.ts
// B40: Echo with a non-mana cost ("Echo\u2014Discard a card." Deepcavern Imp, Rakdos Headliner; also "Echo\u2014Pay N life.").
// Detection (upkeepTriggerDetect) builds "<Cost> or sacrifice"; resolution (triggerOptionalPaymentQueueUtils)
// queues the same pay/sacrifice optional-payment prompt as mana echo. Paying a discard cost queues the
// existing DISCARD_SELECTION step (mandatory, reason 'effect') so madness / discard triggers still apply.
// Public entry symbols: parseEchoNonManaCost, maybeQueueEchoNonManaCostTrigger.

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { broadcastGame } from '../../socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { markEchoPaid, sacrificePermanent } from './upkeep-triggers.js';
import { equipDiscardCandidates, payEquipLifeCost } from './equipNonManaCosts.js';

import { parseEchoNonManaCost } from './echoNonManaCostParse.js';
export { parseEchoNonManaCost };

function refresh(ctx: GameContext, gameId: string): void {
  const io = (ctx as any).io;
  if (io) broadcastGame(io as any, ctx as any, gameId);
}

export function maybeQueueEchoNonManaCostTrigger(
  ctx: GameContext, item: any, triggerController: PlayerID, sourceName: string, sourceId: string, description: string,
): boolean {
  const trimmed = String(description || '').trim();
  if (!/ or sacrifice\b/i.test(trimmed)) return false;
  const parsed = parseEchoNonManaCost(trimmed);
  if (!parsed) return false;
  const permanentId = String((item as any).source || sourceId || '').trim();
  const gameId = String((ctx as any).gameId || '').trim();
  if (!permanentId) return false;
  if ((ctx as any).isReplaying) return true;
  if (!gameId || gameId === 'unknown') return false;
  const state = (ctx as any).state;
  const { cost, label } = parsed;
  const lifeAmount = cost.kind === 'life' ? cost.amount : 0;

  queueOptionalPaymentStep(gameId, {
    playerId: triggerController,
    sourceName,
    sourceId: permanentId,
    sourceImage: (item as any).sourceImage,
    description: `${sourceName}: ${trimmed}`,
    mandatory: true,
    payChoiceId: 'pay_echo',
    payLabel: label,
    payDescription: `${label} to keep ${sourceName}.`,
    declineChoiceId: 'decline',
    declineLabel: 'Sacrifice it',
    declineDescription: `Sacrifice ${sourceName}.`,
    validationKind: cost.kind === 'life' ? 'life' : 'none',
    lifeAmount: lifeAmount || undefined,
    stepData: {
      echoChoice: true,
      echoNonManaCost: cost.kind,
      permanentId,
      cardName: sourceName,
      payLifeAmount: lifeAmount || undefined,
      triggerDescription: trimmed,
    },
    onPay: async () => {
      if (cost.kind === 'life') {
        payEquipLifeCost(state, String(triggerController), `Pay ${cost.amount} life`);
        markEchoPaid(ctx, permanentId);
      } else {
        const hand = equipDiscardCandidates(state, String(triggerController), 'Discard a card');
        if (hand.length === 0) {
          // Can't pay: the echo cost wasn't paid, so the permanent is sacrificed.
          sacrificePermanent(ctx, permanentId, triggerController);
        } else {
          markEchoPaid(ctx, permanentId);
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.DISCARD_SELECTION,
            playerId: triggerController,
            sourceId: permanentId,
            sourceName,
            description: `${sourceName}: Discard a card (echo cost)`,
            mandatory: true,
            hand: hand.map((c: any) => ({ id: c.id, label: c.name || 'Card', imageUrl: c.image_uris?.small || c.image_uris?.normal })),
            discardCount: 1,
            currentHandSize: hand.length,
            maxHandSize: Math.max(7, hand.length),
            reason: 'effect',
            echoDiscardCost: true,
          } as any);
        }
      }
      refresh(ctx, gameId);
    },
    onDecline: async () => {
      sacrificePermanent(ctx, permanentId, triggerController);
      refresh(ctx, gameId);
    },
  } as any);
  return true;
}

