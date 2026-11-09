// server/src/state/modules/offBattlefieldCda.ts
// Grist, the Hunger Tide: "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature
// in addition to its other types." Characteristic-defining ability for non-battlefield zones.
// Public entry symbols: oracleHasOffBattlefieldCreatureCda, applyOffBattlefieldCdaOverlay.

const CDA_RE =
  /as long as (?:~|[a-z' ,-]+?) isn'?t on the battlefield, it'?s an? (\d+)\/(\d+) ([a-z]+) creature in addition to its other types/i;

export type OffBattlefieldCda = {
  power: number;
  toughness: number;
  creatureType: string;
};

export function oracleHasOffBattlefieldCreatureCda(oracle: string): OffBattlefieldCda | null {
  const m = String(oracle || '').replace(/\u2019/g, "'").match(CDA_RE);
  if (!m) return null;
  return {
    power: Number(m[1]),
    toughness: Number(m[2]),
    creatureType: m[3].charAt(0).toUpperCase() + m[3].slice(1).toLowerCase(),
  };
}

/**
 * Returns a shallow card overlay with Insect creature types + printed P/T when the CDA applies.
 * Callers pass zone !== 'battlefield'. Does not mutate the original card.
 */
export function applyOffBattlefieldCdaOverlay(card: any, zone?: string): any {
  if (!card) return card;
  if (String(zone || '').toLowerCase() === 'battlefield') return card;
  const cda = oracleHasOffBattlefieldCreatureCda(String(card.oracle_text || card.oracleText || ''));
  if (!cda) return card;
  const typeLine = String(card.type_line || '');
  let nextType = typeLine;
  if (!/\bcreature\b/i.test(typeLine)) {
    // "Legendary Planeswalker — Grist" -> "Legendary Creature Planeswalker — Insect Grist"
    if (/\s[—–-]\s/.test(typeLine)) {
      nextType = typeLine.replace(/^([^—–-]+)\s*([—–-])\s*(.*)$/, (_s, left, dash, right) => {
        const leftParts = String(left).trim().split(/\s+/);
        if (!leftParts.some((p: string) => /^creature$/i.test(p))) {
          // Insert Creature before Planeswalker/artifact/etc when possible.
          const idx = leftParts.findIndex((p: string) => /^(planeswalker|artifact|enchantment|land|battle)$/i.test(p));
          if (idx >= 0) leftParts.splice(idx, 0, 'Creature');
          else leftParts.push('Creature');
        }
        const rights = String(right).trim().split(/\s+/).filter(Boolean);
        if (!rights.some((p: string) => new RegExp(`^${cda.creatureType}$`, 'i').test(p))) {
          rights.unshift(cda.creatureType);
        }
        return `${leftParts.join(' ')} ${dash} ${rights.join(' ')}`;
      });
    } else {
      nextType = `${typeLine} Creature — ${cda.creatureType}`.replace(/\s+/g, ' ').trim();
    }
  } else if (!new RegExp(`\\b${cda.creatureType}\\b`, 'i').test(typeLine)) {
    nextType = typeLine.replace(/([—–-]\s*)/, `$1${cda.creatureType} `);
  }
  return {
    ...card,
    type_line: nextType,
    power: String(cda.power),
    toughness: String(cda.toughness),
    _offBattlefieldCda: true,
  };
}
