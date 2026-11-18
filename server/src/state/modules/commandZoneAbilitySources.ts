/**
 * Synthetic ability sources for command-zone cards that are not battlefield
 * permanents: the face-up plane / phenomenon and ongoing schemes.
 *
 * Public: asCommandZoneAbilitySource, listCommandZoneAbilitySources,
 * getActivePlaneCard, listOngoingSchemeCards.
 */

import {
  isOngoingSchemeTypeLine,
  isPhenomenonTypeLine,
  isPlaneTypeLine,
  isSchemeTypeLine,
  normalizePlanechaseOracleText,
} from './planechaseOracleNormalize.js';

export type CommandZoneAbilitySourceKind = 'plane' | 'phenomenon' | 'scheme';

export function getActivePlaneCard(state: any): any | null {
  const plane = state?.activePlane || state?.currentPlane;
  if (!plane) return null;
  if (typeof plane === 'string') {
    return { id: 'active_plane', name: plane, oracle_text: '', type_line: 'Plane' };
  }
  return plane;
}

export function listOngoingSchemeCards(state: any): any[] {
  const schemes = Array.isArray(state?.activeSchemes)
    ? state.activeSchemes
    : Array.isArray(state?.ongoingSchemes)
      ? state.ongoingSchemes
      : [];
  return schemes.filter(Boolean);
}

/**
 * Shape a command-zone card like a battlefield permanent so existing trigger
 * emitters / IR can treat it as a source.
 */
export function asCommandZoneAbilitySource(
  card: any,
  controllerId: string,
  kind: CommandZoneAbilitySourceKind,
): any {
  const id = String(card?.id || `${kind}_${String(card?.name || 'unknown').replace(/\s+/g, '_').toLowerCase()}`);
  const typeLine = String(card?.type_line || card?.typeLine || (
    kind === 'plane' ? 'Plane' : kind === 'phenomenon' ? 'Phenomenon' : 'Scheme'
  ));
  const oracle = normalizePlanechaseOracleText(card?.oracle_text || card?.oracleText || card?.text || card?.effect || '');
  return {
    id,
    controller: controllerId,
    owner: String(card?.owner || controllerId),
    zone: 'command',
    commandZoneAbilitySource: true,
    commandZoneAbilityKind: kind,
    card: {
      ...card,
      id: String(card?.id || id),
      name: String(card?.name || kind),
      type_line: typeLine,
      oracle_text: oracle,
    },
    type_line: typeLine,
  };
}

export function listCommandZoneAbilitySources(state: any, controllerId?: string): any[] {
  const planarController = String(
    controllerId
    || state?.planarController
    || state?.turnPlayer
    || state?.activePlayer
    || '',
  ).trim();
  const out: any[] = [];

  const plane = getActivePlaneCard(state);
  if (plane) {
    const typeLine = String(plane.type_line || plane.typeLine || '');
    const kind: CommandZoneAbilitySourceKind =
      isPhenomenonTypeLine(typeLine) ? 'phenomenon'
        : isPlaneTypeLine(typeLine) || !typeLine ? 'plane'
          : 'plane';
    out.push(asCommandZoneAbilitySource(plane, planarController || String(plane.controller || ''), kind));
  }

  for (const scheme of listOngoingSchemeCards(state)) {
    const controller = String(scheme.controller || state?.archenemyPlayerId || planarController || '').trim();
    const typeLine = String(scheme.type_line || scheme.typeLine || 'Ongoing Scheme');
    if (!isSchemeTypeLine(typeLine) && !isOngoingSchemeTypeLine(typeLine) && !scheme.is_ongoing) {
      // Still include — ongoing schemes are stored by this path intentionally.
    }
    out.push(asCommandZoneAbilitySource(
      { ...scheme, type_line: typeLine || 'Ongoing Scheme', is_ongoing: true },
      controller,
      'scheme',
    ));
  }

  return out;
}
