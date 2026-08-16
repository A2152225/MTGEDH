import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { movePermanentToHand } from './zones.js';

const MANA_COST_PATTERN = '(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)';

export function parseMayhemCost(oracleText: unknown): string | undefined {
  return String(oracleText || '').match(new RegExp(`\\bmayhem\\s*[—-]?\\s*${MANA_COST_PATTERN}`, 'i'))?.[1]?.trim();
}

export function cardMayBeCastWithMayhem(state: any, playerId: PlayerID, card: any): boolean {
  const cost = parseMayhemCost(card?.oracle_text || card?.oracleText);
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  return Boolean(
    cost
    && Number(card?.discardedOnTurn ?? card?.discardedTurnNumber ?? -1) === currentTurn
    && String(card?.discardedByPlayerId || '') === String(playerId || ''),
  );
}

export function parseWebSlingingCost(oracleText: unknown): string | undefined {
  return String(oracleText || '').match(new RegExp(`\\bweb-slinging\\s*[—-]?\\s*${MANA_COST_PATTERN}`, 'i'))?.[1]?.trim();
}

export function calculateWebSlingingOptions(state: any, playerId: PlayerID, card: any) {
  const cost = parseWebSlingingCost(card?.oracle_text || card?.oracleText);
  const availableCreatures = (Array.isArray(state?.battlefield) ? state.battlefield : [])
    .filter((permanent: any) =>
      permanent
      && String(permanent.controller || permanent.owner || '') === String(playerId || '')
      && permanent.tapped === true
      && /\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || '')),
    )
    .map((permanent: any) => ({
      id: String(permanent.id || ''),
      name: String(permanent?.card?.name || 'Creature'),
      imageUrl: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
    }))
    .filter((entry: any) => entry.id);

  return { cost, availableCreatures };
}

export function validateWebSlingingReturnedCreature(
  state: any,
  playerId: PlayerID,
  permanentId: string,
): { ok: true; permanent: any } | { ok: false; code: string; message: string } {
  const permanent = (Array.isArray(state?.battlefield) ? state.battlefield : [])
    .find((entry: any) => String(entry?.id || '') === String(permanentId || ''));
  if (!permanent || String(permanent.controller || permanent.owner || '') !== String(playerId || '')) {
    return { ok: false, code: 'WEB_SLINGING_CREATURE_NOT_FOUND', message: 'Select a tapped creature you control to return for web-slinging.' };
  }
  if (permanent.tapped !== true) {
    return { ok: false, code: 'WEB_SLINGING_CREATURE_UNTAPPED', message: 'Web-slinging requires a tapped creature you control.' };
  }
  if (!/\bcreature\b/i.test(String(permanent?.card?.type_line || permanent?.type_line || ''))) {
    return { ok: false, code: 'WEB_SLINGING_NOT_CREATURE', message: 'Web-slinging requires returning a creature you control.' };
  }
  return { ok: true, permanent };
}

export function applyWebSlingingReturnedCreatureCost(
  ctx: GameContext,
  permanentId: string,
): boolean {
  return movePermanentToHand(ctx, String(permanentId || ''));
}
