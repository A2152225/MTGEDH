// Kitchen-table manual mutations. Origin: new feature (not extracted).
// Cluster: applyManualAction dispatcher over library / battlefield / state verbs.
// Public entry symbols: applyManualAction, peekManualZone.

import type { GameContext } from '../context.js';
import {
  isManualVerbId,
  type ManualActionPayload,
  type ManualZone,
} from '../../../../shared/src/manualAction.js';
import {
  applyManualBattlefieldVerb,
  applyManualLibraryVerb,
  applyManualPutLibrary,
  applyManualStateVerb,
  getOrInitPlayerZones,
} from './manualAction-handlers/index.js';
import { pickMutablePlayerLibrary } from './applyEventReplayCardMoveLibraryHelpers.js';
import type { ManualActionResult } from './manualAction-handlers/manualActionTypes.js';
import { cardIdOf } from './manualAction-handlers/manualActionFind.js';

const PUT_LIBRARY_VERBS = new Set(['put_on_top', 'put_on_bottom', 'put_nth_from_top', 'shuffle_into']);
const PRIVATE_PEEK_VERBS = new Set(['look_at_top_x', 'look_at_hand']);

export function applyManualAction(ctx: GameContext, payload: ManualActionPayload): ManualActionResult {
  if (!payload || !isManualVerbId(payload.verb)) {
    return { ok: false, error: 'Unknown manual verb.', summary: 'invalid verb' };
  }

  const library = applyManualLibraryVerb(ctx, payload);
  if (library) return commit(ctx, payload, library);
  if (PUT_LIBRARY_VERBS.has(payload.verb)) {
    return commit(ctx, payload, applyManualPutLibrary(ctx, payload));
  }
  const battlefield = applyManualBattlefieldVerb(ctx, payload);
  if (battlefield) return commit(ctx, payload, battlefield);
  const state = applyManualStateVerb(ctx, payload);
  if (state) return commit(ctx, payload, state);
  return { ok: false, error: `Verb ${payload.verb} is not implemented.`, summary: 'unimplemented' };
}

function commit(
  ctx: GameContext,
  payload: ManualActionPayload,
  result: ManualActionResult,
): ManualActionResult {
  if (result.ok && !PRIVATE_PEEK_VERBS.has(payload.verb)) ctx.bumpSeq();
  return result;
}

export function peekManualZone(
  ctx: GameContext,
  playerId: string,
  zone: ManualZone | 'library_top',
  count?: number,
): ManualActionResult {
  const z = getOrInitPlayerZones(ctx, playerId);
  if (zone === 'library' || zone === 'library_top') {
    const lib = pickMutablePlayerLibrary(ctx, playerId);
    const n = zone === 'library_top' ? Math.max(1, Math.floor(Number(count ?? 1))) : lib.length;
    const cards = lib.slice(0, Math.min(n, lib.length));
    return {
      ok: true,
      summary: `peeked ${cards.length} from library`,
      peekedCards: cards.map((c) => ({
        id: cardIdOf(c),
        name: String(c?.name || ''),
        type_line: c?.type_line,
        image_uris: c?.image_uris,
      })),
    };
  }
  const list = zone === 'hand' ? z.hand : zone === 'graveyard' ? z.graveyard : zone === 'exile' ? z.exile : [];
  return {
    ok: true,
    summary: `peeked ${list.length} from ${zone}`,
    peekedCards: list.map((c: any) => ({
      id: cardIdOf(c),
      name: String(c?.name || ''),
      type_line: c?.type_line,
      image_uris: c?.image_uris,
    })),
  };
}
