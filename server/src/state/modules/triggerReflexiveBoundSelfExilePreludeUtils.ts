/**
 * Extracted from triggerReflexiveWhenYouDoQueueUtils.ts.
 * Flitting Guerrilla–style “each player mills N. Then you may exile this card…”
 * prelude before the reflexive self-exile ask.
 * Entry: executeReflexiveBoundSelfExilePrelude.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { executeSpellEffectRecorded } from './executeSpellEffectRecorded.js';
import { REFLEXIVE_BOUND_GRAVEYARD_SELF_EXILE_PRELUDE_MILL_REASON } from './executeSpellEffectMillCards.js';

const WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseNumberWord(word: string | undefined, defaultValue: number = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export function executeReflexiveBoundSelfExilePrelude(
  ctx: GameContext,
  preludeText: string | undefined,
  triggerController: PlayerID,
  sourceName: string,
  sourcePermanentId: string,
): boolean {
  const normalizedPrelude = String(preludeText || '').replace(/\s+/g, ' ').trim();
  if (!normalizedPrelude) return true;

  const eachPlayerMillsMatch = normalizedPrelude.match(/^each player mills? (?:a card|([a-z]+|\d+) cards?)$/i);
  if (!eachPlayerMillsMatch) {
    debug(2, `[resolveTopOfStack] Reflexive bound graveyard exile prelude for ${sourceName} is not automated: ${normalizedPrelude}`);
    return false;
  }

  const millCount = eachPlayerMillsMatch[1]
    ? parseNumberWord(eachPlayerMillsMatch[1], 1)
    : 1;
  if (millCount <= 0) return false;

  const stateAny = (ctx as any).state || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const playerIds = players
    .filter((player: any) => player && player.id && player.hasLost !== true)
    .map((player: any) => String(player.id));

  for (const playerId of playerIds) {
    executeSpellEffectRecorded(
      ctx,
      { id: String(sourcePermanentId || ''), cardId: String(sourcePermanentId || ''), card: { name: sourceName }, targets: [] },
      {
        kind: 'MillCards',
        playerId: playerId as PlayerID,
        count: millCount,
        reason: REFLEXIVE_BOUND_GRAVEYARD_SELF_EXILE_PRELUDE_MILL_REASON,
      } as any,
      triggerController,
      sourceName,
      sourcePermanentId || null,
    );
  }

  return true;
}
