// server/src/state/modules/copyEntryExceptions.ts
// Layer 1 copy-effect exceptions for "enter as a copy of ..., except ..." (CR 707.9): the exception is part of the
// copy effect, so it becomes a copiable value of the copy. Handles Phyrexian Metamorph ("it's an artifact in addition
// to its other types"), Phantasmal Image ("it's an Illusion in addition ... and it has \"...\""), Spark Double
// ("it isn't legendary"), Quicksilver Gargantuan ("it's 7/7"), Gigantoplasm / Evil Twin (quoted abilities) and
// unquoted keyword grants ("it has flying").
// Public entry symbols: parseCopyEntryExceptions, applyCopyEntryExceptions, CopyEntryExceptions.

export interface CopyEntryExceptions {
  addCardTypes: string[];
  addSubtypes: string[];
  notLegendary: boolean;
  basePT?: { power: number; toughness: number };
  abilities: string[];
  /** Spark Double: "enters with an additional +1/+1 counter on it if it's a creature". */
  extraCounters: Array<{ counter: string; ifType: string }>;
  /** Flesh Duplicate: "it has vanishing 3 if that creature doesn't have vanishing". */
  conditionalKeywords?: Array<{ ability: string; unlessHas: string }>;
  /** Sakashima: "except it has Sakashima's other abilities". */
  keepOwnOtherAbilities?: boolean;
}

const CARD_TYPES = new Set(['artifact', 'enchantment', 'creature', 'land', 'planeswalker']);

export function parseCopyEntryExceptions(sourceOracle: string): CopyEntryExceptions | null {
  const text = String(sourceOracle || '').replace(/[\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const m = text.match(/enters?(?: tapped)?(?: as a copy of| as a copy of)[^\n]*?, except ((?:[^"\n]|"[^"]*")+?)(?:\.\s*$|\.\s*\n|\.\s+(?=[A-Z])|$)/m);
  if (!m) return null;
  const out: CopyEntryExceptions = { addCardTypes: [], addSubtypes: [], notLegendary: false, abilities: [], extraCounters: [] };
  let rest = m[1];
  rest = rest.replace(/"([^"]+)"/g, (_all, q) => { out.abilities.push(String(q).trim()); return 'QUOTED'; });
  for (const raw of rest.split(/,\s*(?:and\s+)?|\s+and\s+/)) {
    const part = raw.trim().replace(/^(?:it|this creature)\s+/i, '').replace(/^(?:'s|is)\s+/i, "it's ").trim();
    let p: RegExpMatchArray | null;
    if ((p = part.match(/^it's (?:an? )?([A-Za-z]+(?: [A-Za-z]+)*?) in addition to its other (?:creature )?types$/i))) {
      for (const w of p[1].split(/\s+/)) {
        const lw = w.toLowerCase();
        if (CARD_TYPES.has(lw)) out.addCardTypes.push(lw[0].toUpperCase() + lw.slice(1));
        else out.addSubtypes.push(w[0].toUpperCase() + w.slice(1));
      }
    } else if ((p = part.match(/^(?:it )?enters with an additional (\S+) counter on it(?: if it's an? ([a-z]+))?$/i))) {
      out.extraCounters.push({ counter: p[1].toLowerCase(), ifType: (p[2] || '').toLowerCase() });
    } else if ((p = part.match(/^(?:it )?has (([a-z]+)(?: \d+)?) if that (?:creature|permanent) doesn't have \2$/i))) {
      (out.conditionalKeywords ||= []).push({ ability: p[1][0].toUpperCase() + p[1].slice(1), unlessHas: p[2].toLowerCase() });
    } else if (/^(?:it )?has .+?'s other abilities$/i.test(part)) {
      out.keepOwnOtherAbilities = true;
    } else if (/^(?:it )?(?:isn't|is not) legendary$/i.test(part)) {
      out.notLegendary = true;
    } else if ((p = part.match(/^it's (\d+)\/(\d+)$/i))) {
      out.basePT = { power: Number(p[1]), toughness: Number(p[2]) };
    } else if ((p = part.match(/^(?:it )?(?:has|gains) ([a-z ,]+)$/i)) && !/QUOTED/.test(part)) {
      for (const kw of p[1].split(/\s*,\s*|\s+and\s+/)) if (kw.trim()) out.abilities.push(kw.trim()[0].toUpperCase() + kw.trim().slice(1));
    }
  }
  const any = out.addCardTypes.length || out.addSubtypes.length || out.notLegendary || out.basePT || out.abilities.length || out.extraCounters.length
    || out.conditionalKeywords?.length || out.keepOwnOtherAbilities;
  return any ? out : null;
}

function rewriteTypeLine(typeLine: string, ex: CopyEntryExceptions): string {
  const [leftRaw, rightRaw = ''] = String(typeLine || '').split(/\s+\u2014\s+|\s+-\s+/);
  let left = leftRaw.split(/\s+/).filter(Boolean);
  if (ex.notLegendary) left = left.filter((w) => w.toLowerCase() !== 'legendary');
  for (const t of ex.addCardTypes) {
    if (left.some((w) => w.toLowerCase() === t.toLowerCase())) continue;
    const firstType = left.findIndex((w) => CARD_TYPES.has(w.toLowerCase()) || /^(?:kindred|tribal|battle)$/i.test(w));
    if (firstType < 0) left.push(t); else left.splice(firstType, 0, t);
  }
  const right = rightRaw.split(/\s+/).filter(Boolean);
  for (const s of ex.addSubtypes) if (!right.some((w) => w.toLowerCase() === s.toLowerCase())) right.push(s);
  return right.length ? left.join(' ') + ' \u2014 ' + right.join(' ') : left.join(' ');
}

/** Applies the exceptions on top of an already-copied permanent; returns true when anything changed. */
export function applyCopyEntryExceptions(permanent: any, sourceOracle: string): boolean {
  const ex = parseCopyEntryExceptions(sourceOracle);
  if (!ex || !permanent?.card) return false;
  const typeLine = rewriteTypeLine(String(permanent.card.type_line || permanent.type_line || ''), ex);
  const oracleParts = [String(permanent.card.oracle_text || '').trim()];
  for (const a of ex.abilities) if (!oracleParts.join('\n').includes(a)) oracleParts.push(a);
  for (const { ability, unlessHas } of ex.conditionalKeywords || []) {
    if (!new RegExp('(?:^|\\n)\\s*' + unlessHas + '\\b', 'i').test(oracleParts.join('\n'))) oracleParts.push(ability);
  }
  if (ex.keepOwnOtherAbilities) {
    for (const line of String(sourceOracle || '').split(/\n+/)) {
      const l = line.trim();
      if (l && !/\bas a copy of\b/i.test(l) && !oracleParts.join('\n').includes(l)) oracleParts.push(l);
    }
  }
  const oracle = oracleParts.filter(Boolean).join('\n');
  permanent.card = { ...permanent.card, type_line: typeLine, oracle_text: oracle,
    ...(ex.basePT ? { power: String(ex.basePT.power), toughness: String(ex.basePT.toughness) } : {}) };
  Object.assign(permanent, { type_line: typeLine, cardType: typeLine, oracle_text: oracle,
    ...(ex.basePT ? { power: ex.basePT.power, basePower: ex.basePT.power, toughness: ex.basePT.toughness, baseToughness: ex.basePT.toughness, effectivePower: undefined, effectiveToughness: undefined } : {}) });
  if (!permanent.copyEntryCountersApplied) {
    const tl = typeLine.toLowerCase();
    // A copied planeswalker enters with the copied card's printed loyalty (CR 306.5b / 707.2).
    const printedLoy = Number((permanent.card as any)?.loyalty);
    if (/\bplaneswalker\b/.test(tl) && Number.isFinite(printedLoy) && !Number(permanent.counters?.loyalty || 0)) {
      permanent.counters = { ...(permanent.counters || {}), loyalty: printedLoy };
      permanent.loyalty = printedLoy;
    }
    for (const { counter, ifType } of ex.extraCounters) {
      if (ifType && !new RegExp('\\b' + ifType + '\\b').test(tl)) continue;
      permanent.counters = { ...(permanent.counters || {}), [counter]: Number(permanent.counters?.[counter] || 0) + 1 };
      if (counter === 'loyalty') permanent.loyalty = Number(permanent.loyalty || 0) + 1;
    }
    if (ex.extraCounters.length) permanent.copyEntryCountersApplied = true;
  }
  permanent.copyEntryExceptions = ex;
  return true;
}
