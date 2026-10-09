// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: battlefield/stack/token/attachment manual verbs.
// Public entry symbols: applyManualBattlefieldVerb.

import type { GameContext } from '../../context.js';
import type { ManualActionPayload, ManualZone } from '../../../../../shared/src/manualAction.js';
import { canonicalizeCounterKey, updateCounters } from '../counters_tokens.js';
import { uid } from '../../utils.js';
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';
import { transformPermanentToFace } from '../day-night.js';
import { findManualObject, getOrInitPlayerZones } from './manualActionFind.js';
import { relocateManualObject } from './manualActionRelocate.js';
import type { ManualActionResult } from './manualActionTypes.js';

function namesOf(ids: string[], ctx: GameContext): string {
  return ids.map((id) => {
    const found = findManualObject(ctx, id);
    return String(found?.card?.name || found?.permanent?.card?.name || id);
  }).join(', ');
}

function moveMany(
  ctx: GameContext,
  payload: ManualActionPayload,
  toZone: ManualZone,
  extra?: { tapped?: boolean; controllerId?: string; faceDown?: boolean },
): ManualActionResult {
  const ids = Array.isArray(payload.objectIds) ? payload.objectIds : [];
  const moved: string[] = [];
  for (const id of ids) {
    const result = relocateManualObject(ctx, id, toZone, payload, extra);
    if (result.ok) moved.push(result.name);
  }
  if (moved.length === 0) return { ok: false, error: 'No matching objects found.', summary: 'nothing moved' };
  return { ok: true, summary: `moved ${moved.join(', ')} to ${toZone}` };
}

export function applyManualBattlefieldVerb(
  ctx: GameContext,
  payload: ManualActionPayload,
): ManualActionResult | null {
  const ids = Array.isArray(payload.objectIds) ? payload.objectIds : [];

  switch (payload.verb) {
    case 'discard':
      return moveMany(ctx, payload, 'graveyard');
    case 'bounce':
      return moveMany(ctx, payload, 'hand');
    case 'put_from_hand':
    case 'return_from_graveyard':
    case 'move_object':
      return moveMany(ctx, payload, payload.toZone || 'hand', {
        tapped: payload.tapped,
        controllerId: payload.controllerId,
        faceDown: payload.faceDown,
      });
    case 'reanimate':
    case 'put_onto_battlefield':
      return moveMany(ctx, payload, 'battlefield', {
        tapped: payload.tapped,
        controllerId: payload.controllerId,
      });
    case 'exile_from_graveyard':
    case 'exile':
      return moveMany(ctx, payload, 'exile', { faceDown: payload.faceDown });
    case 'exile_face_down':
      return moveMany(ctx, payload, 'exile', { faceDown: true });
    case 'put_into_graveyard':
    case 'destroy':
    case 'sacrifice':
      return moveMany(ctx, payload, 'graveyard');
    case 'counter_spell': {
      const moved: string[] = [];
      for (const id of ids) {
        const found = findManualObject(ctx, id);
        if (!found || found.zone !== 'stack') continue;
        const result = relocateManualObject(ctx, id, 'graveyard', payload);
        if (result.ok) moved.push(result.name);
      }
      if (moved.length === 0) return { ok: false, error: 'No stack objects found.', summary: 'nothing countered' };
      return { ok: true, summary: `countered ${moved.join(', ')}` };
    }
    case 'blink': {
      const returned: string[] = [];
      for (const id of ids) {
        const found = findManualObject(ctx, id);
        if (!found) continue;
        const controller = payload.controllerId || found.permanent?.controller || found.ownerId;
        const result = relocateManualObject(ctx, id, 'exile', payload);
        if (!result.ok || result.skippedToken) continue;
        const exiled = findManualObject(ctx, id) || findManualObject(ctx, String(found.card?.id || ''));
        if (!exiled) continue;
        relocateManualObject(ctx, exiled.objectId, 'battlefield', payload, {
          controllerId: controller,
          tapped: payload.tapped,
        });
        returned.push(result.name);
      }
      return { ok: true, summary: `blinked ${returned.join(', ') || 'nothing'}` };
    }
    case 'tap_untap': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const tapped = payload.tapped === true;
      const changed: string[] = [];
      for (const id of ids) {
        const perm = battlefield.find((p: any) => String(p?.id || '') === id || String(p?.card?.id || '') === id);
        if (!perm) continue;
        (perm as any).tapped = tapped;
        changed.push(String((perm as any).card?.name || id));
      }
      if (changed.length === 0) return { ok: false, error: 'No permanents found.', summary: 'nothing tapped' };
      return { ok: true, summary: `${tapped ? 'tapped' : 'untapped'} ${changed.join(', ')}` };
    }
    case 'attach': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const hostId = String(payload.attachToId || '').trim();
      const host = battlefield.find((p: any) => String(p?.id || '') === hostId);
      if (!host) return { ok: false, error: 'Attach host not found.', summary: 'attach failed' };
      const attached: string[] = [];
      for (const id of ids) {
        const perm = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm || perm === host) continue;
        perm.attachedTo = hostId;
        host.attachedEquipment = Array.isArray(host.attachedEquipment) ? host.attachedEquipment : [];
        if (!host.attachedEquipment.includes(id)) host.attachedEquipment.push(id);
        attached.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `attached ${attached.join(', ') || 'nothing'} to ${host.card?.name || hostId}` };
    }
    case 'unattach': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const cleared: string[] = [];
      for (const id of ids) {
        const perm = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm) continue;
        const hostId = String(perm.attachedTo || '');
        perm.attachedTo = undefined;
        if (hostId) {
          const host = battlefield.find((p: any) => String(p?.id || '') === hostId);
          if (host && Array.isArray(host.attachedEquipment)) {
            host.attachedEquipment = host.attachedEquipment.filter((entry: any) => String(entry) !== id);
          }
        }
        cleared.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `unattached ${cleared.join(', ') || 'nothing'}` };
    }
    case 'transform': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const flipped: string[] = [];
      for (const id of ids) {
        const perm: any = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm) continue;
        const nextFace: 0 | 1 = perm.transformed === true ? 0 : 1;
        // Omit ctx so transform does not fire replacement effects or triggers.
        transformPermanentToFace(perm, nextFace);
        flipped.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `transformed ${flipped.join(', ') || 'nothing'}` };
    }
    case 'turn_face': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const faceDown = payload.faceDown === true;
      const changed: string[] = [];
      for (const id of ids) {
        const perm: any = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm) continue;
        perm.faceDown = faceDown;
        perm.isFaceDown = faceDown;
        if (perm.card) perm.card.faceDown = faceDown;
        changed.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `turned ${faceDown ? 'face down' : 'face up'}: ${changed.join(', ') || 'nothing'}` };
    }
    case 'gain_control': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const controllerId = String(payload.controllerId || payload.targetPlayerId || payload.actorId || '').trim();
      const changed: string[] = [];
      for (const id of ids) {
        const perm = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm || !controllerId) continue;
        perm.controller = controllerId;
        changed.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `gave control of ${changed.join(', ') || 'nothing'} to ${controllerId}` };
    }
    case 'phase_out':
    case 'phase_in': {
      const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
      const phasedOut = payload.verb === 'phase_out';
      const changed: string[] = [];
      for (const id of ids) {
        const perm = battlefield.find((p: any) => String(p?.id || '') === id);
        if (!perm) continue;
        perm.phasedOut = phasedOut;
        changed.push(String(perm.card?.name || id));
      }
      return { ok: true, summary: `${phasedOut ? 'phased out' : 'phased in'} ${changed.join(', ') || 'nothing'}` };
    }
    case 'add_counters': {
      const amount = Math.floor(Number(payload.amount ?? 1));
      const counterType = canonicalizeCounterKey(String(payload.counterType || '+1/+1'));
      const changed: string[] = [];
      for (const id of ids) {
        const found = findManualObject(ctx, id);
        if (!found?.permanent) continue;
        updateCounters(ctx, String(found.permanent.id), { [counterType]: amount }, {
          skipEventPersistence: true,
          skipCounterPlacedTriggers: true,
          skipCounterModifications: true,
        });
        changed.push(String(found.permanent.card?.name || id));
      }
      return { ok: true, summary: `${amount >= 0 ? 'added' : 'removed'} ${Math.abs(amount)} ${counterType} on ${changed.join(', ') || 'nothing'}` };
    }
    case 'create_token': {
      const controller = String(payload.controllerId || payload.targetPlayerId || payload.actorId || '').trim();
      const n = Math.max(1, Math.floor(Number(payload.count ?? 1)));
      const name = String(payload.tokenName || 'Token').trim() || 'Token';
      const power = Number.isFinite(Number(payload.tokenPower)) ? Number(payload.tokenPower) : 1;
      const toughness = Number.isFinite(Number(payload.tokenToughness)) ? Number(payload.tokenToughness) : 1;
      const typeLine = String(payload.tokenTypeLine || `Token Creature — ${name}`).trim();
      const created: string[] = [];
      payload.createdPermanentIds = Array.isArray(payload.createdPermanentIds) ? payload.createdPermanentIds : [];
      for (let i = 0; i < n; i++) {
        const permanentId = payload.createdPermanentIds[i] || uid('tok');
        if (!payload.createdPermanentIds[i]) payload.createdPermanentIds.push(permanentId);
        const tokenPerm: any = {
          id: permanentId,
          controller,
          owner: controller,
          tapped: payload.tapped === true,
          counters: {},
          basePower: power,
          baseToughness: toughness,
          summoningSickness: /\bcreature\b/i.test(typeLine),
          isToken: true,
          card: {
            id: `${permanentId}-card`,
            name,
            type_line: typeLine,
            zone: 'battlefield',
            power: String(power),
            toughness: String(toughness),
          },
        };
        ctx.state.battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
        (ctx.state.battlefield as any[]).push(tokenPerm);
        stampPermanentEntryTimestamp(ctx.state as any, tokenPerm);
        created.push(name);
      }
      return { ok: true, summary: `created ${created.length} ${name} token${created.length === 1 ? '' : 's'}` };
    }
    case 'look_at_hand':
    case 'reveal_from_hand': {
      const playerId = String(payload.targetPlayerId || payload.actorId || '').trim();
      const z = getOrInitPlayerZones(ctx, playerId);
      const cards = Array.isArray(payload.objectIds) && payload.objectIds.length > 0
        ? z.hand.filter((c: any) => payload.objectIds!.includes(String(c?.id || '')))
        : z.hand;
      return {
        ok: true,
        summary: payload.verb === 'reveal_from_hand'
          ? `revealed ${cards.map((c: any) => c?.name).filter(Boolean).join(', ') || 'nothing'}`
          : `looked at ${playerId}'s hand (${cards.length} cards)`,
        peekedCards: cards.map((c: any) => ({
          id: String(c?.id || ''),
          name: String(c?.name || ''),
          type_line: c?.type_line,
          image_uris: c?.image_uris,
        })),
        publicPeek: payload.verb === 'reveal_from_hand',
      };
    }
    case 'wheel': {
      const count = Math.max(0, Math.floor(Number(payload.count ?? 7)));
      const players = Array.isArray(ctx.state.players) ? ctx.state.players : [];
      const discarded: string[] = [];
      for (const player of players) {
        const pid = String(player?.id || '').trim();
        if (!pid) continue;
        const z = getOrInitPlayerZones(ctx, pid);
        discarded.push(`${pid}:${z.hand.length}`);
        while (z.hand.length > 0) {
          const card = z.hand.shift();
          z.graveyard.push({ ...card, zone: 'graveyard' });
        }
        z.handCount = 0;
        z.graveyardCount = z.graveyard.length;
        const lib = (ctx as any).libraries?.get?.(pid) || z.library || [];
        const drawn = lib.splice(0, Math.min(count, lib.length));
        if ((ctx as any).libraries?.set) (ctx as any).libraries.set(pid, lib);
        z.library = lib;
        z.libraryCount = lib.length;
        for (const card of drawn) z.hand.push({ ...card, zone: 'hand' });
        z.handCount = z.hand.length;
      }
      return { ok: true, summary: `wheel: each player discarded, then drew ${count}` };
    }
    default:
      return null;
  }
}

export { namesOf };
