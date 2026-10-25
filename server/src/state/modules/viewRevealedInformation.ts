// server/src/state/modules/viewRevealedInformation.ts
// View-side application of state.revealedInformation ("play with hands / top card revealed": Telepathy,
// Revelation, Field of Dreams, Future Sight): marks revealed hand cards known for every viewer and sends the
// revealed library top card, each tagged with the sources that reveal it (revealedBy). Face-down cards stay
// hidden. Mutates only the per-viewer view zones it is given.
// Public entry symbols: applyRevealedInformationToZones, revealSourcesByPlayer.

import { computeRevealedInformation } from './revealedInformationFlags.js';

type Sources = { hand: Map<string, string[]>; top: Map<string, string[]> };

/** Which named sources reveal each player's hand / library top. */
export function revealSourcesByPlayer(state: any): Sources {
  const out: Sources = { hand: new Map(), top: new Map() };
  const info = state?.revealedInformation;
  if (!info) return out;
  const names = new Set<string>((info.sources || []).map(String));
  const add = (m: Map<string, string[]>, pid: string, name: string) => {
    const list = m.get(pid) || [];
    if (!list.includes(name)) list.push(name);
    m.set(pid, list);
  };
  for (const perm of state.battlefield || []) {
    const name = String(perm?.card?.name || '');
    if (!name || !names.has(name)) continue;
    let one: any;
    try { one = computeRevealedInformation({ ...state, battlefield: [perm], activePlane: undefined }); } catch { continue; }
    for (const pid of one.handsRevealed || []) add(out.hand, String(pid), name);
    for (const pid of one.libraryTopRevealed || []) add(out.top, String(pid), name);
  }
  // Plane / unattributed flags: fall back to every listed source.
  const all = [...names];
  for (const pid of info.handsRevealed || []) if (!out.hand.has(String(pid))) out.hand.set(String(pid), all);
  for (const pid of info.libraryTopRevealed || []) if (!out.top.has(String(pid))) out.top.set(String(pid), all);
  return out;
}

function topCardView(top: any): any {
  return {
    id: top.id, name: top.name, type_line: top.type_line, oracle_text: top.oracle_text, image_uris: top.image_uris,
    mana_cost: top.mana_cost, power: top.power, toughness: top.toughness, card_faces: top.card_faces, layout: top.layout,
    zone: 'library',
  };
}

export function applyRevealedInformationToZones(state: any, zones: Record<string, any>, topOf: (pid: string) => any): void {
  const info = state?.revealedInformation;
  if (!info || !zones) return;
  const src = revealSourcesByPlayer(state);
  for (const [pid, names] of src.hand) {
    const z = zones[pid];
    if (!z || !Array.isArray(z.hand)) continue;
    z.hand = z.hand.map((c: any) => (c && !c.faceDown ? { ...c, known: true, revealedBy: names } : c));
    z.handRevealedBy = names;
  }
  for (const [pid, names] of src.top) {
    const z = zones[pid];
    const top = topOf(pid);
    if (!z || !top) continue;
    z.libraryTop = { ...(z.libraryTop && z.libraryTop.id === top.id ? z.libraryTop : topCardView(top)), revealedToAll: true, revealedBy: names };
  }
}
