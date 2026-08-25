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
import { ResolutionStepType, type ResolutionStep, type ResolutionStepResponse } from "../../state/resolution/index.js";
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
  if (status !== 'completed') return;

  const metadata = readEffectProgramQueueMetadata(step);
  const stepAny = step as any;
  const spellLookupId = String(
    stepAny.spellId
    || metadata?.effectProgramSourceId
    || step.sourceId
    || '',
  ).trim();
  if (!spellLookupId) return;

  const rawSelection = response.selections as any;
  const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
  const colorLower = String(selection || '').toLowerCase();
  const validColors = ['white', 'blue', 'black', 'red', 'green'];
  if (!validColors.includes(colorLower)) return;

  const state = game.state || {};
  const stack: any[] = Array.isArray(state.stack) ? state.stack : [];
  const spellOnStack = stack.find((s: any) =>
    s && (
      String(s.id || '') === spellLookupId
      || String(s.cardId || '') === spellLookupId
      || String(s.card?.id || '') === spellLookupId
    ),
  );
  if (!spellOnStack) {
    debugWarn(1, `[Resolution] EffectProgram color choice completed but spell not on stack (${spellLookupId})`);
    return;
  }

  spellOnStack.chosenColor = colorLower;
  if (spellOnStack.card && typeof spellOnStack.card === 'object') {
    spellOnStack.card.chosenColor = colorLower;
  }

  const cardName = String(stepAny.cardName || step.sourceName || spellOnStack.card?.name || 'Spell');
  const pid = response.playerId;

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'colorChoice', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      resolvedStepType: String(step.type || '').trim(),
      spellId: String(spellOnStack.id || spellLookupId),
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

  if (persistAndResolveTopOfStack(game, gameId, {
    playerId: pid,
    spellId: String(spellOnStack.id || spellLookupId),
    cardName,
    reason: 'effectProgramSpellColorChoice',
  })) {
    debug(2, `[Resolution] Resumed stack resolution after EffectProgram spell color choice for ${cardName}`);
  }
}
