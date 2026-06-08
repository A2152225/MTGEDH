import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

function unknowns(text, cardName) {
  const ir = parseOracleTextToIR(text, cardName);
  const out = [];
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const e of v) walk(e); return; }
    if (v.kind === 'unknown') out.push(v.raw);
    for (const [k, c] of Object.entries(v)) {
      if (k === 'raw' || k === 'text' || k === 'effectText') continue;
      walk(c);
    }
  }
  for (const a of ir.abilities || []) for (const s of a.steps || []) walk(s);
  return { unknowns: out, abilities: ir.abilities };
}

const cases = [
  ['draw a card', 'Kindred Discovery'],
  ['draw a card.', 'Kindred Discovery'],
  ['you may draw a card.', 'Vedalken Heretic'],
  ['Whenever a creature you control of the chosen type enters or attacks, draw a card.', 'Kindred Discovery'],
  ['Whenever this creature deals damage to an opponent, you may draw a card.', 'Vedalken Heretic'],
];

for (const [text, card] of cases) {
  const r = unknowns(text, card);
  console.log(JSON.stringify({ text, card, unknowns: r.unknowns, steps: r.abilities?.[0]?.steps?.map((s) => ({ kind: s.kind, raw: s.raw?.slice?.(0,60) })) }));
}
