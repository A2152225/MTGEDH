// rules-engine/src/grantedVehicleCrew.ts
// Shared by the server crew activation, the server AI resolver and the rules-engine AI candidates.
// Granted crew (CR 702.122): "Vehicles you control have crew N" (Kotori, Pilot Prodigy-style grants)
// and "Each Vehicle you control has crew N". A Vehicle may use its own crew or any granted crew;
// the cheapest available value is used.
// Public entry symbols: getGrantedVehicleCrewValue, resolveCrewPowerRequirement.

const GRANT_RES = [
  /\bvehicles you control have crew (\d+)\b/g,
  /\beach vehicle you control has crew (\d+)\b/g,
];

function oracleOf(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function getGrantedVehicleCrewValue(battlefield: readonly any[], controllerId: string, vehicle: any): number | null {
  const typeLine = String(vehicle?.card?.type_line || vehicle?.type_line || '').toLowerCase();
  if (!/\bvehicle\b/.test(typeLine)) return null;
  let best: number | null = null;
  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(controllerId || '')) continue;
    const oracle = oracleOf(perm);
    if (!oracle.includes('crew')) continue;
    for (const re of GRANT_RES) {
      for (const m of oracle.matchAll(re)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && (best === null || n < best)) best = n;
      }
    }
  }
  return best;
}

/** Own crew value (from the ability text) vs granted crew; returns the cheapest, or 0 when none. */
export function resolveCrewPowerRequirement(ownText: string, battlefield: readonly any[], controllerId: string, vehicle: any): number {
  const own = String(ownText || '').match(/crew\s*(\d+)/i);
  const ownValue = own ? parseInt(own[1], 10) : null;
  const granted = getGrantedVehicleCrewValue(battlefield, controllerId, vehicle);
  const values = [ownValue, granted].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return values.length ? Math.min(...values) : 0;
}
