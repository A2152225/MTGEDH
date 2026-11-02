/**
 * Star Trek (trk/trc) count bases and Assimilate helpers.
 *
 * - Strange new worlds: number of differently named lands you control (each name once).
 * - Federation: number of creature types among non-Borg creatures you control.
 * - Assimilate (701.x): the object becomes a Borg artifact creature, losing its other creature
 *   types but keeping supertypes, other card types and non-creature subtypes, with a +1/+1 counter.
 */
import type { BattlefieldPermanent, GameState } from '../../shared/src';
import { CREATURE_TYPES } from '../../shared/src/creatureTypes';

const NON_CREATURE_SUBTYPES = new Set<string>([
  // land types
  'plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'gate', 'lair', 'locus', 'mine', 'power-plant',
  'tower', 'urza\'s', 'cave', 'sphere', 'town', 'planet',
  // artifact types
  'attraction', 'blood', 'bobblehead', 'clue', 'contraption', 'equipment', 'food', 'fortification', 'gold',
  'incubator', 'junk', 'lander', 'map', 'powerstone', 'spacecraft', 'treasure', 'vehicle',
  // enchantment types
  'aura', 'background', 'cartouche', 'case', 'class', 'curse', 'role', 'room', 'rune', 'saga', 'shard', 'shrine',
  // spell types
  'adventure', 'arcane', 'lesson', 'omen', 'trap',
]);

const SUPERTYPES = new Set<string>(['basic', 'legendary', 'snow', 'world', 'ongoing', 'host', 'elite']);

function cardOf(perm: any): any {
  return perm?.card || perm || {};
}

function typeLineOf(perm: any): string {
  const card = cardOf(perm);
  return String(card?.type_line || perm?.type_line || '');
}

function splitTypeLine(typeLine: string): { types: string[]; subtypes: string[]; dash: string } {
  const front = String(typeLine || '').split(' // ')[0];
  const m = front.match(/^(.*?)\s+([\u2014\u2013-])\s+(.*)$/);
  const left = m ? m[1] : front;
  const right = m ? m[3] : '';
  return {
    types: left.split(/\s+/).filter(Boolean),
    subtypes: right.split(/\s+/).filter(Boolean),
    dash: m ? m[2] : '\u2014',
  };
}

function isCreaturePerm(perm: any): boolean {
  return /\bcreature\b/i.test(typeLineOf(perm));
}

function controlledBy(perm: any, controllerId: string): boolean {
  return String(perm?.controller || '').trim() === String(controllerId || '').trim();
}

export function isNonCreatureSubtype(subtype: string): boolean {
  return NON_CREATURE_SUBTYPES.has(String(subtype || '').trim().toLowerCase());
}

export function getCreatureSubtypes(typeLine: string): string[] {
  const { types, subtypes } = splitTypeLine(typeLine);
  if (!types.some(t => /^creature$/i.test(t)) && !types.some(t => /^kindred|tribal$/i.test(t))) return [];
  return subtypes.filter(s => !isNonCreatureSubtype(s));
}

/** Strange new worlds: differently named lands you control, each English name counted once. */
export function countDifferentlyNamedLands(battlefield: readonly BattlefieldPermanent[] | undefined, controllerId: string): number {
  const names = new Set<string>();
  for (const perm of (battlefield || []) as any[]) {
    if (!controlledBy(perm, controllerId)) continue;
    if (!/\bland\b/i.test(typeLineOf(perm))) continue;
    if (perm?.isFaceDown) { names.add(`__facedown_${String(perm?.id || '')}`); continue; }
    const name = String(cardOf(perm)?.name || perm?.name || '').split(' // ')[0].trim().toLowerCase();
    if (name) names.add(name);
  }
  return [...names].filter(n => !n.startsWith('__facedown_')).length;
}

/** Federation: creature types among non-Borg creatures you control. */
export function countFederationCreatureTypes(battlefield: readonly BattlefieldPermanent[] | undefined, controllerId: string): number {
  const types = new Set<string>();
  for (const perm of (battlefield || []) as any[]) {
    if (!controlledBy(perm, controllerId) || !isCreaturePerm(perm)) continue;
    const subs = getCreatureSubtypes(typeLineOf(perm));
    if (subs.some(s => /^borg$/i.test(s))) continue;
    // R32: a changeling ("is every creature type") has all creature types (CR 702.73a).
    if (/\bchangeling\b|\bis every creature type\b/i.test(String(cardOf(perm)?.oracle_text || '')) || /\bchangeling\b/i.test(String((cardOf(perm)?.keywords || []).join(' ')))) {
      for (const t of CREATURE_TYPES) if (!/^borg$/i.test(t)) types.add(String(t).toLowerCase());
      continue;
    }
    for (const s of subs) types.add(s.toLowerCase());
  }
  return types.size;
}

/** Assimilated type line: Borg artifact creature keeping supertypes, other card types and non-creature subtypes. */
export function assimilatedTypeLine(typeLine: string): string {
  const { types, subtypes, dash } = splitTypeLine(typeLine);
  const supers = types.filter(t => SUPERTYPES.has(t.toLowerCase()));
  const others = types.filter(t => !SUPERTYPES.has(t.toLowerCase()) && !/^(artifact|creature)$/i.test(t));
  const keptSubs = subtypes.filter(s => isNonCreatureSubtype(s));
  const left = [...supers, 'Artifact', ...others, 'Creature'].join(' ');
  return `${left} ${dash} ${[...keptSubs, 'Borg'].join(' ')}`;
}

/** Apply the Assimilate characteristic change + counter to a battlefield permanent (after control change). */
export function assimilatePermanentInPlace(perm: any, sourceId?: string): any {
  if (!perm) return perm;
  const card = cardOf(perm);
  const printed = String(perm?.assimilated?.printedTypeLine || card?.type_line || '');
  const newTypeLine = assimilatedTypeLine(printed);
  const counters = { ...(perm.counters || {}) };
  counters['+1/+1'] = Number(counters['+1/+1'] || 0) + 1;
  return {
    ...perm,
    // 400.7: the card remembers its printed type line so it is restored once it leaves the battlefield.
    card: { ...card, type_line: newTypeLine, assimilatedPrintedTypeLine: printed },
    counters,
    isCreature: true,
    assimilated: { printedTypeLine: printed, ...(sourceId ? { sourceId } : {}) },
    ...(sourceId ? { assimilatedBySourceId: sourceId } : {}),
  };
}

/** Record on the source (e.g. a Borg Saga) which permanents were assimilated with it. */
export function recordAssimilatedWithSource(state: GameState, sourceId: string | undefined, ids: readonly string[]): GameState {
  const sid = String(sourceId || '').trim();
  if (!sid || ids.length === 0) return state;
  const battlefield = ((state as any).battlefield || []).map((p: any) => {
    if (String(p?.id || '') !== sid) return p;
    const prev: string[] = Array.isArray(p.assimilatedIds) ? p.assimilatedIds : [];
    return { ...p, assimilatedIds: [...new Set([...prev, ...ids])] };
  });
  return { ...(state as any), battlefield } as GameState;
}

export function assimilateBattlefieldPermanents(state: GameState, ids: readonly string[], sourceId?: string): GameState {
  const want = new Set(ids.map(id => String(id || '').trim()).filter(Boolean));
  if (want.size === 0) return state;
  const battlefield = ((state as any).battlefield || []).map((p: any) =>
    want.has(String(p?.id || '')) ? assimilatePermanentInPlace(p, sourceId) : p
  );
  return recordAssimilatedWithSource({ ...(state as any), battlefield } as GameState, sourceId, [...want]);
}

/**
 * R32: Dilemma count (Captain Benjamin Sisko, The Caretaker). Reads state.dilemmasFacedThisTurn,
 * written by recordDilemmaFaced (server trekPlayerEventTriggers, round 37).
 */
export function countDilemmasFacedThisTurn(state: any, playerId: string): number {
  return Number(state?.dilemmasFacedThisTurn?.[String(playerId || '')]) || 0;
}

/**
 * R32: Battlefront count (Martok, Own the Day, Worf): distinct opponents you attacked this turn.
 * Mirrors getBattlefrontCount (server trekPlayerEventTriggers): players who left still count.
 */
export function countOpponentsAttackedThisTurn(state: any, playerId: string): number {
  const pid = String(playerId || '');
  const list = state?.attackedPlayersThisTurnByPlayer?.[pid];
  return new Set((Array.isArray(list) ? list : []).map((id: any) => String(id || '')).filter((id: string) => id && id !== pid)).size;
}
