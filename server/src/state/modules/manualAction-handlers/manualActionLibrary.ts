// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: library-family manual verbs (draw, mill, scry, shuffle, search).
// Public entry symbols: applyManualLibraryVerb.

import type { GameContext } from '../../context.js';
import type { ManualActionPayload } from '../../../../../shared/src/manualAction.js';
import {
  extractLibraryCardsByIds,
  pickMutablePlayerLibrary,
  writePlayerLibrary,
} from '../applyEventReplayCardMoveLibraryHelpers.js';
import { cardIdOf, getOrInitPlayerZones } from './manualActionFind.js';
import { placeCardInZone, relocateManualObject } from './manualActionRelocate.js';
import type { ManualActionResult } from './manualActionTypes.js';

function topCards(lib: any[], count: number): any[] {
  const n = Math.max(0, Math.floor(Number(count || 0)));
  return lib.slice(0, Math.min(n, lib.length));
}

function namesOf(cards: any[]): string {
  return cards.map((c) => String(c?.name || c?.id || 'card')).join(', ');
}

export function applyManualLibraryVerb(
  ctx: GameContext,
  payload: ManualActionPayload,
): ManualActionResult | null {
  const playerId = String(payload.targetPlayerId || payload.actorId || '').trim();
  const count = Math.max(0, Math.floor(Number(payload.count ?? 1)));

  switch (payload.verb) {
    case 'draw_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const z = getOrInitPlayerZones(ctx, playerId);
      let drawn: any[] = [];
      if (Array.isArray(payload.drawnCardIds) && payload.drawnCardIds.length > 0) {
        const extracted = extractLibraryCardsByIds(lib, payload.drawnCardIds);
        drawn = extracted.extracted;
        writePlayerLibrary(ctx, playerId, extracted.remainder);
      } else {
        drawn = lib.splice(0, Math.min(count, lib.length));
        writePlayerLibrary(ctx, playerId, lib);
        payload.drawnCardIds = drawn.map((c) => cardIdOf(c)).filter(Boolean);
      }
      for (const card of drawn) z.hand.push({ ...card, zone: 'hand' });
      z.handCount = z.hand.length;
      return { ok: true, summary: `drew ${drawn.length} (${namesOf(drawn) || 'nothing'})` };
    }
    case 'look_at_top_x':
    case 'reveal_top_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const peeked = topCards(lib, count);
      return {
        ok: true,
        summary: payload.verb === 'reveal_top_x'
          ? `revealed top ${peeked.length}: ${namesOf(peeked) || 'nothing'}`
          : `looked at top ${peeked.length}`,
        peekedCards: peeked.map((c) => ({
          id: cardIdOf(c),
          name: String(c?.name || ''),
          type_line: c?.type_line,
          image_uris: c?.image_uris || c?.card_faces?.[0]?.image_uris,
        })),
        publicPeek: payload.verb === 'reveal_top_x',
      };
    }
    case 'mill_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const z = getOrInitPlayerZones(ctx, playerId);
      let milled: any[] = [];
      if (Array.isArray(payload.drawnCardIds) && payload.drawnCardIds.length > 0) {
        const extracted = extractLibraryCardsByIds(lib, payload.drawnCardIds);
        milled = extracted.extracted;
        writePlayerLibrary(ctx, playerId, extracted.remainder);
      } else {
        milled = lib.splice(0, Math.min(count, lib.length));
        writePlayerLibrary(ctx, playerId, lib);
        payload.drawnCardIds = milled.map((c) => cardIdOf(c)).filter(Boolean);
      }
      for (const card of milled) z.graveyard.push({ ...card, zone: 'graveyard' });
      z.graveyardCount = z.graveyard.length;
      return { ok: true, summary: `milled ${milled.length}: ${namesOf(milled) || 'nothing'}` };
    }
    case 'exile_from_top': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const z = getOrInitPlayerZones(ctx, playerId);
      let exiled: any[] = [];
      if (Array.isArray(payload.drawnCardIds) && payload.drawnCardIds.length > 0) {
        const extracted = extractLibraryCardsByIds(lib, payload.drawnCardIds);
        exiled = extracted.extracted;
        writePlayerLibrary(ctx, playerId, extracted.remainder);
      } else {
        exiled = lib.splice(0, Math.min(count, lib.length));
        writePlayerLibrary(ctx, playerId, lib);
        payload.drawnCardIds = exiled.map((c) => cardIdOf(c)).filter(Boolean);
      }
      for (const card of exiled) {
        z.exile.push({ ...card, zone: 'exile', faceDown: payload.faceDown === true });
      }
      z.exileCount = z.exile.length;
      return { ok: true, summary: `exiled top ${exiled.length}: ${namesOf(exiled) || 'nothing'}` };
    }
    case 'shuffle': {
      const lib = pickMutablePlayerLibrary(ctx, playerId).slice();
      if (Array.isArray(payload.libraryOrder) && payload.libraryOrder.length > 0) {
        const extracted = extractLibraryCardsByIds(lib, payload.libraryOrder);
        writePlayerLibrary(ctx, playerId, [...extracted.extracted, ...extracted.remainder]);
      } else {
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(ctx.rng() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        payload.libraryOrder = lib.map((c) => cardIdOf(c)).filter(Boolean);
        writePlayerLibrary(ctx, playerId, lib);
      }
      payload.shuffled = true;
      return { ok: true, summary: 'shuffled library' };
    }
    case 'search_library': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const query = String(payload.searchName || '').trim().toLowerCase();
      const want = Math.max(1, count || 1);
      const matches: any[] = [];
      if (Array.isArray(payload.objectIds) && payload.objectIds.length > 0) {
        const extracted = extractLibraryCardsByIds(lib, payload.objectIds);
        matches.push(...extracted.extracted);
        writePlayerLibrary(ctx, playerId, extracted.remainder);
      } else if (query) {
        const remainder: any[] = [];
        for (const card of lib) {
          if (matches.length < want && String(card?.name || '').toLowerCase().includes(query)) {
            matches.push(card);
          } else {
            remainder.push(card);
          }
        }
        writePlayerLibrary(ctx, playerId, remainder);
        payload.objectIds = matches.map((c) => cardIdOf(c)).filter(Boolean);
      } else {
        return { ok: false, error: 'Name a card or pick library cards to search.', summary: 'search failed' };
      }
      const dest = payload.toZone || 'hand';
      for (const card of matches) {
        placeCardInZone(ctx, card, playerId, dest, payload, {
          tapped: payload.tapped,
          controllerId: payload.controllerId || playerId,
        });
      }
      const after = pickMutablePlayerLibrary(ctx, playerId).slice();
      for (let i = after.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1));
        [after[i], after[j]] = [after[j], after[i]];
      }
      if (Array.isArray(payload.libraryOrder) && payload.libraryOrder.length > 0) {
        const extracted = extractLibraryCardsByIds(after, payload.libraryOrder);
        writePlayerLibrary(ctx, playerId, [...extracted.extracted, ...extracted.remainder]);
      } else {
        payload.libraryOrder = after.map((c) => cardIdOf(c)).filter(Boolean);
        writePlayerLibrary(ctx, playerId, after);
      }
      payload.shuffled = true;
      return { ok: true, summary: `searched, moved ${matches.length} to ${dest}: ${namesOf(matches) || 'nothing'}` };
    }
    case 'scry_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const keepIds = Array.isArray(payload.keepTopIds) ? payload.keepTopIds : [];
      const bottomIds = Array.isArray(payload.bottomIds) ? payload.bottomIds : [];
      const n = keepIds.length + bottomIds.length || count;
      const window = lib.splice(0, Math.min(n, lib.length));
      const byId = new Map(window.map((c) => [cardIdOf(c), c]));
      const keep = keepIds.map((id) => byId.get(String(id))).filter(Boolean);
      const bottom = bottomIds.map((id) => byId.get(String(id))).filter(Boolean);
      const used = new Set([...keepIds, ...bottomIds].map(String));
      const leftover = window.filter((c) => !used.has(cardIdOf(c)));
      writePlayerLibrary(ctx, playerId, [...keep, ...leftover, ...lib, ...bottom]);
      return { ok: true, summary: `scried ${window.length} (top ${keep.length}, bottom ${bottom.length})` };
    }
    case 'surveil_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const z = getOrInitPlayerZones(ctx, playerId);
      const keepIds = Array.isArray(payload.keepTopIds) ? payload.keepTopIds : [];
      const gyIds = Array.isArray(payload.graveyardIds) ? payload.graveyardIds : [];
      const n = keepIds.length + gyIds.length || count;
      const window = lib.splice(0, Math.min(n, lib.length));
      const byId = new Map(window.map((c) => [cardIdOf(c), c]));
      const keep = keepIds.map((id) => byId.get(String(id))).filter(Boolean);
      const gy = gyIds.map((id) => byId.get(String(id))).filter(Boolean);
      const used = new Set([...keepIds, ...gyIds].map(String));
      const leftover = window.filter((c) => !used.has(cardIdOf(c)));
      for (const card of gy) z.graveyard.push({ ...card, zone: 'graveyard' });
      z.graveyardCount = z.graveyard.length;
      writePlayerLibrary(ctx, playerId, [...keep, ...leftover, ...lib]);
      return { ok: true, summary: `surveiled ${window.length} (top ${keep.length}, graveyard ${gy.length})` };
    }
    case 'rearrange_top_x': {
      const lib = pickMutablePlayerLibrary(ctx, playerId);
      const order = Array.isArray(payload.keepTopIds) ? payload.keepTopIds : payload.libraryOrder || [];
      const n = order.length || count;
      const window = lib.splice(0, Math.min(n, lib.length));
      const extracted = extractLibraryCardsByIds(window, order);
      writePlayerLibrary(ctx, playerId, [...extracted.extracted, ...extracted.remainder, ...lib]);
      payload.keepTopIds = [...extracted.extracted, ...extracted.remainder].map((c) => cardIdOf(c)).filter(Boolean);
      return { ok: true, summary: `rearranged top ${n}` };
    }
    default:
      return null;
  }
}

export function applyManualPutLibrary(
  ctx: GameContext,
  payload: ManualActionPayload,
): ManualActionResult {
  const ids = Array.isArray(payload.objectIds) ? payload.objectIds : [];
  const playerId = String(payload.targetPlayerId || payload.actorId || '').trim();
  const position = payload.verb === 'put_on_bottom' ? 'bottom' : payload.verb === 'put_nth_from_top' ? 'nth' : 'top';
  const moved: string[] = [];
  for (const id of ids) {
    const result = relocateManualObject(ctx, id, 'library', payload, {
      position,
      nth: payload.nth,
      controllerId: playerId,
    });
    if (result.ok) moved.push(result.name);
  }
  if (payload.verb === 'shuffle_into') {
    const lib = pickMutablePlayerLibrary(ctx, playerId).slice();
    if (Array.isArray(payload.libraryOrder) && payload.libraryOrder.length > 0) {
      const extracted = extractLibraryCardsByIds(lib, payload.libraryOrder);
      writePlayerLibrary(ctx, playerId, [...extracted.extracted, ...extracted.remainder]);
    } else {
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
      payload.libraryOrder = lib.map((c) => cardIdOf(c)).filter(Boolean);
      writePlayerLibrary(ctx, playerId, lib);
    }
    payload.shuffled = true;
    return { ok: true, summary: `shuffled ${moved.join(', ') || 'cards'} into library` };
  }
  return { ok: true, summary: `put ${moved.join(', ') || 'cards'} ${position === 'nth' ? `${payload.nth} from top` : `on ${position}`}` };
}
