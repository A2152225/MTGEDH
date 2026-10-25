/**
 * Batch 14: turn-face-up cost components (morph / megamorph / disguise).
 * Supports mixed costs ("{1}{U}, Pay 2 life") and non-mana costs such as
 * "Return a Bird you control to its owner's hand", "Sacrifice a creature", "Discard a card",
 * "Reveal a white card in your hand", "Pay N life".
 */
export type TurnFaceUpCostComponent =
  | { type: 'mana'; manaCost: string }
  | { type: 'reveal'; color: string; colorWord: string }
  | { type: 'life'; amount: number }
  | { type: 'return'; count: number; filter: string }
  | { type: 'sacrifice'; count: number; filter: string }
  | { type: 'discard'; count: number; filter: string };

export type TurnFaceUpChoiceComponent = 'reveal' | 'return' | 'sacrifice' | 'discard';

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

function countOf(word: string): number {
  const w = String(word || '').toLowerCase();
  return NUMBER_WORDS[w] ?? (Number(w) || 1);
}

/** Parse the cost text after the keyword (already stripped of "Morph—"). Null when any part is unsupported. */
export function parseTurnFaceUpCostComponents(rawCost: string): TurnFaceUpCostComponent[] | null {
  const raw = String(rawCost || '').trim().replace(/\.\s*$/, '').trim();
  if (!raw) return null;
  const parts = raw
    .split(/,\s*(?:and\s+)?|\s+and\s+(?=(?:pay|reveal|return|sacrifice|discard|\{))/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: TurnFaceUpCostComponent[] = [];
  let mana = '';
  for (const p of parts) {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^(?:pay\s+)?((?:\{[^}]+\}\s*)+)$/i))) { mana += m[1].replace(/\s+/g, ''); continue; }
    if ((m = p.match(/^reveal an? (white|blue|black|red|green) card (?:in|from) your hand$/i))) {
      const word = m[1].toLowerCase();
      out.push({ type: 'reveal', color: COLOR_WORDS[word], colorWord: word });
      continue;
    }
    if ((m = p.match(/^pay (\d+) life$/i))) { out.push({ type: 'life', amount: Number(m[1]) }); continue; }
    if ((m = p.match(/^return (a|an|one|two|three|\d+) (.+?) you control to (?:its|their) owner'?s'? hands?$/i))) {
      out.push({ type: 'return', count: countOf(m[1]), filter: m[2].trim() });
      continue;
    }
    if ((m = p.match(/^sacrifice (a|an|one|two|three|\d+) (.+?)$/i))) {
      out.push({ type: 'sacrifice', count: countOf(m[1]), filter: m[2].trim() });
      continue;
    }
    if ((m = p.match(/^discard (a|an|one|two|three|\d+) (?:(.+?) )?cards?$/i))) {
      out.push({ type: 'discard', count: countOf(m[1]), filter: String(m[2] || '').trim() });
      continue;
    }
    return null;
  }
  if (mana) out.unshift({ type: 'mana', manaCost: mana });
  return out.length ? out : null;
}

export function describeTurnFaceUpCostComponents(components: TurnFaceUpCostComponent[] | undefined): string {
  return (components || []).map((c) => {
    switch (c.type) {
      case 'mana': return c.manaCost;
      case 'reveal': return `Reveal a ${c.colorWord} card in your hand`;
      case 'life': return `Pay ${c.amount} life`;
      case 'return': return `Return ${c.count === 1 ? 'a' : c.count} ${c.filter} you control to its owner's hand`;
      case 'sacrifice': return `Sacrifice ${c.count === 1 ? 'a' : c.count} ${c.filter}`;
      case 'discard': return `Discard ${c.count === 1 ? 'a' : c.count} ${c.filter ? c.filter + ' ' : ''}card${c.count === 1 ? '' : 's'}`;
    }
    return '';
  }).filter(Boolean).join(', ');
}

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** "Bird", "creature", "nontoken creature", "artifact or creature", "land" against a card/permanent. */
export function matchesTurnFaceUpFilter(obj: any, filter: string, isPermanent: boolean): boolean {
  const f = String(filter || '').trim().toLowerCase();
  if (!f || f === 'card') return true;
  const typeLine = String((isPermanent ? obj?.card?.type_line : obj?.type_line) || '').toLowerCase();
  const typeWords = typeLine.replace(/[\u2014\u2013-]/g, ' ').split(/\s+/).filter(Boolean);
  const alternatives = f.split(/\s+or\s+/);
  return alternatives.some((alt) => {
    const words = alt.split(/\s+/).filter((w) => w && w !== 'other' && w !== 'another' && w !== 'card' && w !== 'permanent');
    return words.every((raw) => {
      if (raw === 'nontoken') return !(isPermanent && obj?.isToken === true);
      if (raw === 'token') return isPermanent && obj?.isToken === true;
      if (raw === 'untapped') return isPermanent && obj?.tapped !== true;
      if (raw.startsWith('non')) return !typeWords.includes(singular(raw.slice(3)));
      return typeWords.includes(singular(raw));
    });
  });
}

export function candidatesForComponent(state: any, playerId: string, comp: TurnFaceUpCostComponent, excludePermanentId?: string): any[] {
  const hand: any[] = state?.zones?.[playerId]?.hand || [];
  if (comp.type === 'reveal') {
    return hand.filter((c: any) => {
      const colors: string[] = Array.isArray(c?.colors) ? c.colors : [];
      return colors.some((x) => String(x).toUpperCase() === comp.color || COLOR_WORDS[String(x).toLowerCase()] === comp.color);
    });
  }
  if (comp.type === 'discard') return hand.filter((c: any) => matchesTurnFaceUpFilter(c, comp.filter, false));
  if (comp.type === 'return' || comp.type === 'sacrifice') {
    return (state?.battlefield || []).filter((p: any) =>
      p && String(p.controller) === String(playerId) &&
      String(p.id) !== String(excludePermanentId || '') &&
      matchesTurnFaceUpFilter(p, comp.filter, true));
  }
  return [];
}