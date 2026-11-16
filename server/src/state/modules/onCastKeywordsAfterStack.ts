/**
 * After a spell is on the stack: copy for paid casualty/conspire, and
 * queue the demonstrate option (printed or granted).
 * Public: applyOnCastKeywordsAfterSpellStacked, copyStackItemForOnCastKeyword.
 */
import {
  applyCasualtyXCopyModifiers,
  buildDemonstrateChoiceStep,
  hasDemonstrate,
  shouldCopyForOnCastKeyword,
  stampOnCastKeywordFlags,
} from "./onCastKeywordPrompts.js";
import { maybeGrantTwelfthDoctorDemonstrate } from "./twelfthDoctorDemonstrate.js";
import { copyStackItem } from "./stack-mechanics.js";
import { ResolutionQueueManager } from "../resolution/index.js";
import { queueSpellCopiedTriggers } from "./triggers/spell-copied.js";
import { appendEvent } from '../../db/index.js';

function ctxOf(game: any, gameId?: string): any {
  const ctx = (game?.ctx || game) as any;
  if (gameId) ctx.gameId = gameId;
  if (game?.state) ctx.state = game.state;
  if (!ctx.libraries && game?.libraries) ctx.libraries = game.libraries;
  if (typeof ctx.bumpSeq !== 'function' && typeof game?.bumpSeq === 'function') {
    ctx.bumpSeq = (...inner: any[]) => game.bumpSeq(...inner);
  }
  return ctx;
}

export function copyStackItemForOnCastKeyword(
  game: any,
  gameId: string,
  stackItem: any,
  controllerId: string,
  reason: string,
): any | null {
  if (!stackItem?.id) return null;
  const flag = `copiedFor${reason}`;
  if (stackItem[flag] === true) return null;
  const ctx = ctxOf(game, gameId);
  const result = copyStackItem(ctx, String(stackItem.id), String(controllerId));
  if (!result?.success || !result.copy) return null;
  if (reason === 'Casualty') applyCasualtyXCopyModifiers(result.copy, stackItem);
  stackItem[flag] = true;
  try {
    appendEvent(gameId, Number((game as any).seq ?? ctx.seq ?? 0), 'onCastKeywordCopy', {
      sourceStackItemId: String(stackItem.id),
      copiedStackItemId: String(result.copy.id),
      controllerId: String(controllerId),
      reason,
      copy: result.copy,
    });
  } catch { /* persist optional; live copy already applied */ }
  try {
    queueSpellCopiedTriggers(ctx, String(result.copy.id), gameId);
  } catch { /* triggers optional */ }
  return result.copy;
}

export function applyOnCastKeywordsAfterSpellStacked(args: {
  game: any;
  gameId?: string;
  playerId: string;
  stackItem: any;
}): void {
  const item = args.stackItem;
  if (!item) return;
  const gameId = String(args.gameId || args.game?.id || args.game?.gameId || '').trim();
  const playerId = String(args.playerId || item.controller || '');
  const paid = shouldCopyForOnCastKeyword(item);
  if (paid.casualty) copyStackItemForOnCastKeyword(args.game, gameId, item, playerId, 'Casualty');
  if (paid.conspire) copyStackItemForOnCastKeyword(args.game, gameId, item, playerId, 'Conspire');

  maybeGrantTwelfthDoctorDemonstrate({
    state: args.game?.state,
    playerId,
    cardOrItem: item,
    fromZone: item.fromZone || item.sourceZone || item.castFromZone || item.card?.fromZone,
  });
  const card = item.card || item;
  if (!(hasDemonstrate(card) || hasDemonstrate(item)) || item.demonstrateResolved === true || card.demonstrateResolved === true) return;
  if (!gameId) return;
  const players: any[] = Array.isArray(args.game?.state?.players) ? args.game.state.players : [];
  const opponents = players
    .filter((p: any) => p && String(p.id || '') !== playerId)
    .map((p: any) => ({ id: String(p.id), name: String(p.username || p.name || 'Opponent') }));
  if (opponents.length === 0) {
    stampOnCastKeywordFlags(item, { demonstrateResolved: true, demonstratePaid: false });
    return;
  }
  ResolutionQueueManager.addStep(gameId, buildDemonstrateChoiceStep({
    playerId,
    cardId: String(card.id || item.sourceId || item.id),
    cardName: String(card.name || item.sourceName || 'Spell'),
    sourceId: String(item.id),
    sourceImage: card.image_uris?.small || card.image_uris?.normal,
    opponents,
  }) as any);
}
