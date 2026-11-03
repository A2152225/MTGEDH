/**
 * Probe: run every trigger line's intervening-if clause from real oracle texts through
 * isInterveningIfSatisfied on a minimal board and report what lands in
 * state.unknownInterveningIfClauses (skipped unknowns) plus recognised-but-undecided (null) clauses.
 * Usage: node --import tsx/esm scripts/intervening-if-unknown-probe.ts [--top N]
 */
import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { extractInterveningIfClause, isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if.js';

const topIdx = process.argv.indexOf('--top');
const TOP = topIdx > 0 ? Number(process.argv[topIdx + 1]) || 40 : 40;
const nrIdx = process.argv.indexOf('--nulls');
const NULL_RE = nrIdx > 0 ? new RegExp(process.argv[nrIdx + 1], 'i') : null;
const nullClauses: Record<string, number> = {};
const shape = (c: string) => c.toLowerCase().split(/\s+/).slice(0, 3).join(' ');

async function main() {
  const state: any = { battlefield: [], players: [{ id: 'p1' }, { id: 'p2' }], zones: { p1: { hand: [], graveyard: [], exile: [], library: [] }, p2: { hand: [], graveyard: [], exile: [], library: [] } }, turnPlayer: 'p1', unknownInterveningIfClauses: {} };
  const ctx: any = { state, gameId: 'probe' };
  let lines = 0, withIf = 0, nulls = 0, bools = 0;
  const nullShapes: Record<string, number> = {};
  for await (const raw of iterateOracleCards(resolveOracleCardsPath())) {
    const card: any = raw;
    const faces = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces : [card];
    for (const face of faces) {
      for (const line of String(face.oracle_text || '').split('\n')) {
        if (!/^(?:when|whenever|at)\b/i.test(line)) continue;
        lines++;
        const clause = extractInterveningIfClause(line);
        if (!clause) continue;
        withIf++;
        const src = { id: 'src', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { name: face.name || card.name, type_line: face.type_line || card.type_line || '', oracle_text: face.oracle_text || '' } };
        state.battlefield = [src];
        let v: boolean | null = null;
        try { v = isInterveningIfSatisfied(ctx, 'p1', line, src); } catch { v = null; }
        if (v === null && NULL_RE && NULL_RE.test(clause)) nullClauses[clause] = (nullClauses[clause] || 0) + 1;
        if (v === null) { nulls++; const k = shape(clause); nullShapes[k] = (nullShapes[k] || 0) + 1; } else bools++;
      }
    }
  }
  const unk: Record<string, number> = state.unknownInterveningIfClauses || {};
  const unkShapes: Record<string, number> = {};
  for (const [c, n] of Object.entries(unk)) unkShapes[shape(c)] = (unkShapes[shape(c)] || 0) + n;
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, TOP);
  const unkTotal = Object.values(unk).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ triggerLines: lines, withIf, decided: bools, recognisedNull: nulls, unknownSkipped: unkTotal, distinctUnknown: Object.keys(unk).length }));
  console.log('-- unknown (skipped) by leading words --');
  for (const [k, n] of top(unkShapes)) console.log(String(n).padStart(5), k);
  console.log('-- unknown sample clauses --');
  for (const [k, n] of top(unk).slice(0, TOP)) console.log(String(n).padStart(5), k);
  console.log('-- recognised-null by leading words --');
  for (const [k, n] of top(nullShapes)) console.log(String(n).padStart(5), k);
}
main().then(() => { if (NULL_RE) { console.log('-- null clauses matching --nulls --'); for (const [k, n] of Object.entries(nullClauses).sort((x, y) => y[1] - x[1])) console.log(String(n).padStart(5), k); } });
