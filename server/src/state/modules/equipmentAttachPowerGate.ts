// server/src/state/modules/equipmentAttachPowerGate.ts
// B79: O-Naginata — "This Equipment can be attached only to a creature with power N or greater."
// Public: equipmentMinAttachPower, creatureMeetsEquipmentAttachPower.

const RE = /(?:this equipment|~|it) can be attached only to a creature with power (\d+|[a-z]+) or greater/i;

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function toNum(raw: string): number | null {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return WORDS[w] ?? null;
}

export function equipmentMinAttachPower(equipment: any): number | null {
  const text = String(equipment?.card?.oracle_text || equipment?.oracle_text || '');
  const m = text.match(RE);
  if (!m) return null;
  return toNum(m[1]);
}

export function creatureMeetsEquipmentAttachPower(creature: any, minPower: number): boolean {
  const raw = creature?.power ?? creature?.basePower ?? creature?.card?.power;
  const base = Number(raw);
  const counters = creature?.counters || {};
  const power = (Number.isFinite(base) ? base : 0)
    + (Number(counters['+1/+1']) || 0)
    - (Number(counters['-1/-1']) || 0);
  return power >= minPower;
}
