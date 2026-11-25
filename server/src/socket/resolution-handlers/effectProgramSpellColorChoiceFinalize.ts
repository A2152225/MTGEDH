/**
 * socket/resolution-handlers/effectProgramSpellColorChoiceFinalize.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse EffectProgram prefix).
 * Cluster moved: finalizeEffectProgramSpellColorChoiceAfterResume.
 * Public entry symbols: finalizeEffectProgramSpellColorChoiceAfterResume.
 *
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { readEffectProgramQueueMetadata } from "../../state/effects/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getPlayerName, persistAndResolveTopOfStack } from "../util.js";

export async function finalizeEffectProgramSpellColorChoiceAfterResume(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  resumed: { status?: string; runResult?: { status?: string } },
): Promise<void> {
  if (step.type !== ResolutionStepType.COLOR_CHOICE) return;

  const status = resumed.status || resumed.runResult?.status;
  // Also stamp+resolve when EP re-pauses on choose_color after an answer
  // (waiting_for_choice). Skipping that case left Borg Incursion re-queuing
  // color_choice forever (gate shard 298 tick-timeout, seqΔ≈50k).
  if (status !== 'completed' && status !== 'waiting_for_choice') return;

  const metadata = readEffectProgramQueueMetadata(step);
  const stepAny = step as any;
  const spellLookupId = String(
    stepAny.spellId
    || metadata?.effectProgramSourceId
    || step.sourceId
    || '',
  ).trim();
  const sourceName = String(stepAny.cardName || step.sourceName || '').trim();

  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  const colorLower = String(selection || '').toLowerCase();
  const validColors = ['white', 'blue', 'black', 'red', 'green'];
  if (!validColors.includes(colorLower)) return;

  const state = game.state || {};
  const stack: any[] = Array.isArray(state.stack) ? state.stack : [];
  let spellOnStack = spellLookupId
    ? stack.find((s: any) =>
      s && (
        String(s.id || '') === spellLookupId
        || String(s.cardId || '') === spellLookupId
        || String(s.card?.id || '') === spellLookupId
      )
    )
    : undefined;
  if (!spellOnStack && stack.length > 0 && sourceName) {
    const top = stack[stack.length - 1];
    const topName = String(top?.sourceName || top?.card?.name || top?.name || '').trim();
    if (topName.toLowerCase() === sourceName.toLowerCase()) {
      spellOnStack = top;
    }
  }
  if (!spellOnStack) {
    if (status === 'completed') {
      debugWarn(1, `[Resolution] EffectProgram color choice completed but spell not on stack (${spellLookupId || sourceName})`);
    }
    return;
  }

  spellOnStack.chosenColor = colorLower;
  if (spellOnStack.card && typeof spellOnStack.card === 'object') {
    spellOnStack.card.chosenColor = colorLower;
  }

  const cardName = String(sourceName || spellOnStack.card?.name || 'Spell');
  const pid = response.playerId;
  const resolvedSpellId = String(spellOnStack.id || spellLookupId);

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'colorChoice', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      resolvedStepType: String(step.type || '').trim(),
      spellId: resolvedSpellId,
      cardName,
      color: colorLower,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] Failed to persist EffectProgram spell color choice event:', e);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} chose ${colorLower} for ${cardName}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  // Drop any choose_color EP re-queue so stamp+resolve is not racing a fresh prompt.
  // Match by name, spellId, or EP source metadata — sourceName alone missed Borg Incursion
  // re-queues and persistAndResolveTopOfStack then refused (blocking color_choice).
  const cardNameLower = cardName.toLowerCase();
  const spellIds = new Set(
    [resolvedSpellId, spellLookupId, String(stepAny.spellId || ''), String(step.sourceId || '')]
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  for (const pending of [...(ResolutionQueueManager.getQueue(gameId)?.steps || [])]) {
    if (!pending || pending.type !== ResolutionStepType.COLOR_CHOICE) continue;
    if (String(pending.id || '') === String(step.id || '')) continue;
    const pendingAny = pending as any;
    const pendingName = String(
      pending.sourceName || pendingAny.cardName || pendingAny.effectProgramSourceName || '',
    ).trim().toLowerCase();
    const pendingSpellId = String(
      pendingAny.spellId || pendingAny.effectProgramSourceId || pending.sourceId || '',
    ).trim();
    const nameMatch = Boolean(cardNameLower) && pendingName === cardNameLower;
    const idMatch = Boolean(pendingSpellId) && spellIds.has(pendingSpellId);
    if (nameMatch || idMatch) {
      ResolutionQueueManager.cancelStep(gameId, String(pending.id || ''));
    }
  }
  if (status === 'waiting_for_choice') {
    debugWarn(1, `[Resolution] EffectProgram color_choice re-paused after answer; forcing stack resolve for ${cardName}`);
  }

  if (persistAndResolveTopOfStack(game, gameId, {
    playerId: pid,
    spellId: resolvedSpellId,
    cardName,
    reason: 'effectProgramSpellColorChoice',
  }, { bypassBlockingPromptCheck: true })) {
    debug(2, `[Resolution] Resumed stack resolution after EffectProgram spell color choice for ${cardName}`);
  }
}
