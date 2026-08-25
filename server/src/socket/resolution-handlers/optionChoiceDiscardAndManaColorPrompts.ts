/**
 * socket/resolution-handlers/optionChoiceDiscardAndManaColorPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two remaining mid-chain OPTION_CHOICE prompts that hand the player a resource -
 * `optionalDiscardThenDrawChoice` ("you may discard a card; if you do, draw N": decline, report an
 * empty hand, or queue the DISCARD_SELECTION carrying the after-discard draw riders) and
 * `chooseManaColorsChoice` (pick one color at a time, re-queueing itself until every selection is
 * made, then add the mana - unrestricted into the pool, otherwise as restricted mana).
 * Public entry symbols: handleOptionalDiscardThenDrawChoice, handleChooseManaColorsChoice.
 *
 * The mana branch keeps its dynamic imports of `getOrInitManaPool` / `addRestrictedManaToPool` so
 * the util module stays lazily loaded. Both branches always returned, so each call site is
 * `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { getPlayerName } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "You may discard a card. If you do, draw N." */
export async function handleOptionalDiscardThenDrawChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const controllerId = (stepData.optionalDiscardThenDrawPlayerId as string | undefined) || playerId;
  const sourceName = (stepData.optionalDiscardThenDrawSourceName as string | undefined) || step.sourceName || 'Ability';
  const drawCount = Number(stepData.optionalDiscardThenDrawCount || 1);
  const drawCountIfDiscardedLand = Number(stepData.optionalDiscardThenDrawCountIfDiscardedLand || 0);

  if (!choiceId || choiceId === 'dont' || choiceId === 'decline') {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} chose not to discard.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  if (choiceId !== 'discard') {
    debugWarn(2, `[Resolution] optionalDiscardThenDrawChoice: unexpected choice ${choiceId}`);
    return;
  }

  const state = game.state || {};
  const zones = (state.zones = state.zones || {});
  const z = (zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
  const hand: any[] = z.hand || [];
  if (!hand.length) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, controllerId)} has no cards to discard.`,
      ts: Date.now(),
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DISCARD_SELECTION,
    playerId: controllerId,
    description: `${sourceName}: Discard 1 card`,
    mandatory: true,
    sourceName,
    discardCount: 1,
    hand: hand.map((c: any) => ({
      id: c.id,
      name: c.name,
      type_line: c.type_line,
      oracle_text: c.oracle_text,
      image_uris: c.image_uris,
      mana_cost: c.mana_cost,
      cmc: c.cmc,
      colors: c.colors,
    })),
    afterDiscardDrawCount: drawCount,
    ...(drawCountIfDiscardedLand > 0 ? { afterDiscardDrawCountIfDiscardedLand: drawCountIfDiscardedLand } : null),
  } as any);

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId: controllerId,
    sourceId: String(step.sourceId || '').trim(),
    queuedResolutionStep,
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

/** "Add N mana of any color(s)" - one color per prompt, re-queued until every selection is made. */
export async function handleChooseManaColorsChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const controllerId = (stepData.chooseManaColorsController as string | undefined) || playerId;
  const sourceName = (stepData.chooseManaColorsSourceName as string | undefined) || step.sourceName || 'Ability';
  const sourceId = (stepData.chooseManaColorsSourceId as string | undefined) || step.sourceId;
  const restriction = (stepData.chooseManaColorsRestriction as any) || 'unrestricted';
  const selectionsTotal = Math.max(1, Number(stepData.chooseManaColorsSelectionsTotal || 1));
  const amountPerSelection = Math.max(1, Number(stepData.chooseManaColorsAmountPerSelection || 1));
  const previouslyChosen: string[] = Array.isArray(stepData.chooseManaColorsChosen)
    ? stepData.chooseManaColorsChosen.map((c: any) => String(c).toLowerCase())
    : [];
  const isUnrestricted = restriction === 'unrestricted' || restriction === 'none' || restriction === null || restriction === undefined;

  const validColors = new Set(['white', 'blue', 'black', 'red', 'green']);
  const chosen = extractOptionChoiceSelectionId(response.selections);
  if (!chosen || !validColors.has(String(chosen).toLowerCase())) {
    debugWarn(2, `[Resolution] chooseManaColorsChoice: invalid color selection`);
    return;
  }
  const chosenColor = String(chosen).toLowerCase();
  const chosenColors = [...previouslyChosen, chosenColor];

  const options = [
    { id: 'white', label: 'White' },
    { id: 'blue', label: 'Blue' },
    { id: 'black', label: 'Black' },
    { id: 'red', label: 'Red' },
    { id: 'green', label: 'Green' },
  ];

  if (chosenColors.length < selectionsTotal) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controllerId,
      description: isUnrestricted
        ? `${sourceName}: Choose a color for the next mana`
        : `${sourceName}: Choose a color for the next mana (spend only to cast Dragon spells)`,
      mandatory: true,
      sourceName,
      options,
      minSelections: 1,
      maxSelections: 1,
      chooseManaColorsChoice: true,
      chooseManaColorsController: controllerId,
      chooseManaColorsSourceName: sourceName,
      chooseManaColorsSourceId: sourceId,
      chooseManaColorsRestriction: restriction,
      chooseManaColorsSelectionsTotal: selectionsTotal,
      chooseManaColorsAmountPerSelection: amountPerSelection,
      chooseManaColorsChosen: chosenColors,
    } as any);

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'chooseManaColorsChoiceResolve', {
        playerId,
        controllerId,
        sourceId: String(sourceId || '').trim() || undefined,
        sourceName,
        resolvedStepId: String(step.id || '').trim() || undefined,
        chosenColor,
        chosenColors,
        restriction,
        selectionsTotal,
        amountPerSelection,
        queuedResolutionStep,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(chooseManaColorsChoiceResolve) failed:', err);
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }

  if (isUnrestricted) {
    const { getOrInitManaPool } = await import('../util.js');
    const pool = getOrInitManaPool(game.state, controllerId) as any;
    for (const color of chosenColors) {
      pool[color] = (pool[color] || 0) + amountPerSelection;
    }
  } else {
    const { addRestrictedManaToPool } = await import('../util.js');
    for (const color of chosenColors) {
      addRestrictedManaToPool(game.state, controllerId, color as any, amountPerSelection, restriction, undefined, sourceId, sourceName);
    }
  }

  const colorSummary = chosenColors
    .reduce((acc: Record<string, number>, color: string) => {
      acc[color] = (acc[color] || 0) + amountPerSelection;
      return acc;
    }, {});
  const summaryText = Object.entries(colorSummary)
    .map(([color, amount]) => `${amount} ${color}`)
    .join(', ');

  try {
    await appendEvent(gameId, (game as any).seq || 0, 'chooseManaColorsChoiceResolve', {
      playerId,
      controllerId,
      sourceId: String(sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String(step.id || '').trim() || undefined,
      chosenColor,
      chosenColors,
      restriction,
      selectionsTotal,
      amountPerSelection,
      manaAdded: colorSummary,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(chooseManaColorsChoiceResolve) failed:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: isUnrestricted
      ? `${sourceName}: ${getPlayerName(game, controllerId)} added ${summaryText}.`
      : `${sourceName}: ${getPlayerName(game, controllerId)} added ${summaryText} that can be spent only to cast Dragon spells.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}
