import { getPermanentWardCost } from '../../state/modules/faceDownWardKeyword.js';
/**
 * socket/resolution-handlers/targetSelectionWardPromptHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the "targets were just chosen, do any of them have ward?" pass. For each opposing
 * target with a ward cost it queues the matching payment prompt - Ward-Blight N (TARGET_SELECTION),
 * mana ward (MANA_PAYMENT_CHOICE), or the pay-life / discard / sacrifice templates (OPTION_CHOICE) -
 * and counters the spell or ability outright when the cost is unpayable or unrecognized.
 * Public entry symbols: maybeQueueWardPaymentPromptsForTargetSelection.
 *
 * Returns true when the caller must stop (the stack item was countered, or the ward prompts are now
 * the player's next decision); false when the target-selection flow should keep going.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { canPlayerPayLife } from "../../state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js";
import { counterStackItem, getWardCost } from "../../state/modules/stack-mechanics.js";
import {
  createResolutionStep,
  ResolutionQueueManager,
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { asThoughAbilitySuppressedForTarget } from "../../rules-engine/targeting-handlers/targetingProtectionKeywordStaticOverride.js";
import { resolveWardCasterForTargetSelection } from "../resolutionWardUtils.js";
import { broadcastGame, getPlayerName } from "../util.js";

function parseBlightN(cost: string): number | null {
  const m = String(cost || '').match(/\bblight\s*(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function parseCountToken(token: string): number | null {
  const raw = String(token || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'a' || raw === 'an' || raw === 'one') return 1;
  if (raw === 'two') return 2;
  if (raw === 'three') return 3;
  if (raw === 'four') return 4;
  if (raw === 'five') return 5;
  if (raw === 'six') return 6;
  if (raw === 'seven') return 7;
  if (raw === 'eight') return 8;
  if (raw === 'nine') return 9;
  if (raw === 'ten') return 10;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return null;
}

/**
 * Ward payment prompts for a just-answered TARGET_SELECTION step.
 *
 * When a spell/ability on the stack gains targets, check if any target has Ward.
 * If so, enqueue a payment prompt for the caster/activator. Declining (or being unable to pay)
 * counters the spell/ability.
 * Supports Ward—Blight N, mana ward costs like Ward {2} / Ward—{1}{U}, and common non-mana
 * ward costs like "Ward—Discard a card", "Ward—Pay 3 life", "Ward—Sacrifice a permanent".
 */
export function maybeQueueWardPaymentPromptsForTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  args: {
    pid: string;
    selections: string[];
    spellCastContext: any;
  },
): boolean {
  const { pid, selections, spellCastContext } = args;
  const sourceId = (step as any)?.sourceId as string | undefined;
  const wardSource = sourceId
    ? resolveWardCasterForTargetSelection(game, sourceId, String(pid || ''))
    : null;
  if (!wardSource) {
    // Non-stack target-selection steps do not participate in Ward handling.
    return false;
  }

  const { casterId, stackItem } = wardSource;

  const battlefield = game.state?.battlefield || [];
  const queuedWardSteps: ResolutionStep[] = [];

  const queueWardStep = (stepConfig: Record<string, unknown>) => {
    const queuedStep = createResolutionStep(stepConfig as any);
    queuedWardSteps.push(queuedStep as any);
    return queuedStep;
  };

  for (const targetId of selections) {
    const targetPerm = battlefield.find((p: any) => p && p.id === targetId);
    if (!targetPerm) continue;

    // Ward triggers only for opponents; if we're targeting our own permanent, ignore.
    if (String(targetPerm.controller || '') === casterId) continue;

    if (asThoughAbilitySuppressedForTarget(targetPerm, game.state, casterId, 'ward')) {
      continue;
    }

    const wardCost = getPermanentWardCost(targetPerm);
    if (!wardCost) continue;

    const normalizedWardCost = String(wardCost || '').trim().replace(/[\s\t]+/g, ' ').replace(/[.;,]+$/g, '').trim();
    const lowerWardCost = normalizedWardCost.toLowerCase();

    // ---- Ward—Blight N ----
    const blightN = parseBlightN(normalizedWardCost);
    if (blightN) {
      const validTargets = battlefield
        .filter((p: any) => p && String(p.controller || '') === casterId)
        .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (validTargets.length === 0) {
        const ctx = {
          state: game.state,
          bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
          zones: game.state?.zones,
          gameId,
        } as unknown as GameContext;

        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — Blight ${blightN}: ${getPlayerName(game, casterId)} couldn't pay ward and the spell/ability was countered.`,
          ts: Date.now(),
        });

        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      queueWardStep({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: casterId as any,
        status: ResolutionStepStatus.PENDING,
        sourceId,
        sourceName: stackItem?.card?.name || stackItem?.sourceName || 'Ward',
        description: `${targetPerm.card?.name || 'Ward'} — Blight ${blightN}: Choose a creature you control to put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on it (or cancel to be countered).`,
        mandatory: false,
        createdAt: Date.now(),
        priority: 0,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',

        keywordBlight: true,
        keywordBlightStage: 'ward_payment',
        keywordBlightController: casterId,
        keywordBlightN: blightN,
        keywordBlightSourceName: `${targetPerm.card?.name || 'Ward'} — Blight ${blightN}`,
        keywordBlightTriggeredBy: sourceId,
        keywordBlightWardController: String(targetPerm.controller || ''),
      } as any);

      continue;
    }

    // ---- Mana ward costs (Ward {2} / Ward—{1}{U}) ----
    if (/\{[^}]+\}/.test(normalizedWardCost)) {
      queueWardStep({
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: casterId as any,
        status: ResolutionStepStatus.PENDING,
        sourceId,
        sourceName: targetPerm.card?.name || 'Ward',
        description: `${targetPerm.card?.name || 'Ward'} has ward ${normalizedWardCost}. Pay ${normalizedWardCost} or the spell/ability will be countered.`,
        mandatory: false,
        createdAt: Date.now(),
        priority: 0,
        cardName: `${targetPerm.card?.name || 'Ward'} Ward`,
        manaCost: normalizedWardCost,
        wardPayment: true,
        wardPaymentType: 'mana',
        wardCost: normalizedWardCost,
        wardPermanentId: String(targetPerm.id || ''),
        wardPermanentName: String(targetPerm.card?.name || 'Ward'),
        wardPermanentController: String(targetPerm.controller || ''),
        wardTriggeredBy: sourceId,
      } as any);

      continue;
    }

    // ---- Non-mana ward costs (discard/pay life/sacrifice) ----
    // Conservative: only implement the most common one-action templates.
    // If the ward cost is present but unrecognized, treat it as unpayable (counter).
    const makeCounterCtx = () =>
      ({
        state: game.state,
        bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
        zones: game.state?.zones,
        gameId,
      }) as unknown as GameContext;

    const lifeMatch = lowerWardCost.match(/\bpay\s+(\w+)\s+life\b/);
    if (lifeMatch) {
      const lifeAmount = parseCountToken(lifeMatch[1]);
      if (!lifeAmount || lifeAmount <= 0) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ward cost unsupported and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      const startingLife = game.state.startingLife || 40;
      game.state.life = game.state.life || {};
      const currentLife = game.state.life?.[casterId] ?? startingLife;
      if (currentLife < lifeAmount || !canPlayerPayLife(makeCounterCtx(), casterId)) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ${getPlayerName(game, casterId)} couldn't pay ward and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      queueWardStep({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: casterId as any,
        status: ResolutionStepStatus.PENDING,
        sourceId,
        sourceName: stackItem?.card?.name || stackItem?.sourceName || 'Ward',
        description: `${targetPerm.card?.name || 'Ward'} has ward—${normalizedWardCost}. Pay ${normalizedWardCost} or the spell/ability will be countered.`,
        mandatory: true,
        createdAt: Date.now(),
        priority: 0,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_ward_cost', label: `Pay ${normalizedWardCost}` },
          { id: 'decline_ward_cost', label: 'Decline (counter)' },
        ],
        wardPayment: true,
        wardPaymentType: 'life',
        wardCost: normalizedWardCost,
        wardLifeAmount: lifeAmount,
        wardPermanentId: String(targetPerm.id || ''),
        wardPermanentName: String(targetPerm.card?.name || 'Ward'),
        wardPermanentController: String(targetPerm.controller || ''),
        wardTriggeredBy: sourceId,
      } as any);

      continue;
    }

    const discardMatch = lowerWardCost.match(/\bdiscard\s+(\w+)\s+cards?\b/);
    if (discardMatch) {
      const discardCount = parseCountToken(discardMatch[1]);
      if (!discardCount || discardCount <= 0) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ward cost unsupported and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      const zones = game.state?.zones?.[casterId];
      const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
      if (hand.length < discardCount) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ${getPlayerName(game, casterId)} couldn't pay ward and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      queueWardStep({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: casterId as any,
        status: ResolutionStepStatus.PENDING,
        sourceId,
        sourceName: stackItem?.card?.name || stackItem?.sourceName || 'Ward',
        description: `${targetPerm.card?.name || 'Ward'} has ward—${normalizedWardCost}. Pay ${normalizedWardCost} or the spell/ability will be countered.`,
        mandatory: true,
        createdAt: Date.now(),
        priority: 0,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_ward_cost', label: `Pay ${normalizedWardCost}` },
          { id: 'decline_ward_cost', label: 'Decline (counter)' },
        ],
        wardPayment: true,
        wardPaymentType: 'discard',
        wardCost: normalizedWardCost,
        wardDiscardCount: discardCount,
        wardPermanentId: String(targetPerm.id || ''),
        wardPermanentName: String(targetPerm.card?.name || 'Ward'),
        wardPermanentController: String(targetPerm.controller || ''),
        wardTriggeredBy: sourceId,
      } as any);

      continue;
    }

    const sacrificeMatch = lowerWardCost.match(/\bsacrifice\s+(\w+)\s+(nonland permanent|permanent|creature|artifact|enchantment|land)\b/);
    if (sacrificeMatch) {
      const sacCount = parseCountToken(sacrificeMatch[1]);
      const sacKind = String(sacrificeMatch[2] || '').trim().toLowerCase();
      if (!sacCount || sacCount <= 0 || !sacKind) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ward cost unsupported and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      const eligible = battlefield
        .filter((p: any) => p && String(p.controller || '') === casterId)
        .filter((p: any) => {
          const tl = String(p.card?.type_line || '').toLowerCase();
          if (sacKind === 'permanent') return true;
          if (sacKind === 'nonland permanent') return !tl.includes('land');
          return tl.includes(sacKind);
        })
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line || 'permanent',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (eligible.length < sacCount) {
        const ctx = makeCounterCtx();
        counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ${getPlayerName(game, casterId)} couldn't pay ward and the spell/ability was countered.`,
          ts: Date.now(),
        });
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
        return true;
      }

      queueWardStep({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: casterId as any,
        status: ResolutionStepStatus.PENDING,
        sourceId,
        sourceName: stackItem?.card?.name || stackItem?.sourceName || 'Ward',
        description: `${targetPerm.card?.name || 'Ward'} has ward—${normalizedWardCost}. Pay ${normalizedWardCost} or the spell/ability will be countered.`,
        mandatory: true,
        createdAt: Date.now(),
        priority: 0,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_ward_cost', label: `Pay ${normalizedWardCost}` },
          { id: 'decline_ward_cost', label: 'Decline (counter)' },
        ],
        wardPayment: true,
        wardPaymentType: 'sacrifice',
        wardCost: normalizedWardCost,
        wardSacrificeCount: sacCount,
        wardSacrificeKind: sacKind,
        wardPermanentId: String(targetPerm.id || ''),
        wardPermanentName: String(targetPerm.card?.name || 'Ward'),
        wardPermanentController: String(targetPerm.controller || ''),
        wardTriggeredBy: sourceId,
      } as any);

      continue;
    }

    // Unknown ward cost (non-mana and non-blight). Fail closed.
    {
      const ctx = makeCounterCtx();
      counterStackItem(ctx, sourceId, String(targetPerm.controller || 'system'));
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${targetPerm.card?.name || 'Ward'} — ${normalizedWardCost}: ward cost unsupported and the spell/ability was countered.`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      return true;
    }
  }

  if (queuedWardSteps.length > 0) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'targetSelectionWardPrompt', {
        playerId: casterId,
        sourceId,
        targets: Array.isArray((stackItem as any)?.targets)
          ? (stackItem as any).targets.map((targetId: any) => String(targetId))
          : selections.map((targetId: string) => String(targetId)),
        ...(queuedWardSteps.length === 1
          ? { queuedResolutionStep: { ...(queuedWardSteps[0] as any) } }
          : { queuedResolutionSteps: queuedWardSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })) }),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(targetSelectionWardPrompt) failed:', err);
    }

    for (const queuedWardStep of queuedWardSteps) {
      ResolutionQueueManager.addStep(gameId, queuedWardStep as any);
    }

    if (!spellCastContext) {
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      broadcastGame(io, game, gameId);
      return true;
    }
  }

  return false;
}
