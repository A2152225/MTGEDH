// Batch 16: "This creature saddles Mounts and crews Vehicles as though its power were N greater."
// (Deathless Pilot, Dynamite Diver, Cloudspire Captain). Added to the crewer's power only for crew/saddle sums.
// Public entry symbols: crewSaddlePowerBonus.

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const RE = /(?:this creature|it|~) (?:saddles mounts and crews vehicles|crews vehicles and saddles mounts|crews vehicles|saddles mounts) as though its power were (\d+|one|two|three|four|five) greater/gi;

export function crewSaddlePowerBonus(perm: any, kind: 'crew' | 'saddle' = 'crew'): number {
  const name = String(perm?.card?.name || '').toLowerCase();
  let text = String(perm?.card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
  if (name) text = text.split(name).join('~');
  let total = 0;
  for (const m of text.matchAll(RE)) {
    const verb = m[0];
    if (kind === 'crew' && !verb.includes('crews vehicles')) continue;
    if (kind === 'saddle' && !verb.includes('saddles mounts')) continue;
    total += WORDS[m[1]] ?? (parseInt(m[1], 10) || 0);
  }
  return total;
}