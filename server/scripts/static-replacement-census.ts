/*
  Phase 5 static/replacement census: Commander-legal permanent ability lines that read as
  static or replacement abilities, and whether the declarative registries pick them up
  (parseStaticEffectSpecsFromOraclePermanent / collectReplacementEffectSpecsFromState).

  Usage (from server/): npm run census:statics
  Writes docs/static-replacement-census.md and scripts/out/static-replacement-census.json.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { stripReminderParentheticals } from '../../rules-engine/src/oracleReminderText.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { classifyStaticCensusLine, staticFamilyKey } from './static-replacement-census-classify.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';
import { isCreatureNow, getCreatureTypesNow } from '../src/state/creatureTypeNow.js';
import { landAwareTypeLine } from '../src/state/modules/effectiveLandTypeLine.js';

/**
 * R18: behavioural probe for effects applied outside the spec pipeline (layer 4 type setting, land-type
 * modifiers, legacy attached P/T, Mimic-style chosen types). Builds a small board with and without the
 * line and credits it when any observable characteristic (creature-ness, creature types, effective land
 * types, P/T, colours) of any permanent changes. The source gets a neutral name so card-name keyed
 * handling (hard-coded tables such as Blood Moon) is not credited to the line.
 */
const NEUTRAL_NAME = 'Census Source';
function observableBoardDiffers(line: string, face: Face, cardName: string): boolean {
  const snapshot = (oracle: string, name: string): string => {
    const mk = (id: string, name: string, typeLine: string, extra: any = {}) => ({ id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: id + '-card', name, type_line: typeLine, oracle_text: '', colors: [], ...extra } });
    const src: any = mk('census-perm', name, face.type_line || '', { oracle_text: oracle, power: face.power, toughness: face.toughness });
    src.chosenCreatureType = 'Bear'; src.chosenColor = 'green';
    const hostType = /enchanted land/i.test(line) ? 'Basic Land \u2014 Forest' : /enchanted artifact/i.test(line) ? 'Artifact' : 'Creature \u2014 Bear';
    const host: any = mk('census-host', 'Census Host', hostType, /creature/i.test(hostType) ? { power: '2', toughness: '2', colors: ['G'] } : {});
    if (/\b(?:enchanted|equipped|fortified) /i.test(line)) src.attachedTo = host.id;
    const bf: any[] = [src, host,
      mk('census-ally', 'Census Ally', 'Creature \u2014 Elf', { power: '1', toughness: '1', colors: ['G'] }),
      { ...mk('census-foe', 'Census Foe', 'Creature \u2014 Goblin', { power: '1', toughness: '1', colors: ['R'] }), controller: 'p2', owner: 'p2' },
      mk('census-forest', 'Forest', 'Basic Land \u2014 Forest'), mk('census-nonbasic', 'Census Land', 'Land'),
      { ...mk('census-foe-land', 'Island', 'Basic Land \u2014 Island'), controller: 'p2', owner: 'p2' }, mk('census-artifact', 'Census Rock', 'Artifact')];
    const state: any = { battlefield: bf, stack: [], players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, turnPlayer: 'p1', zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } } };
    try { syncDerivedContinuousEffects(state); } catch { /* probe only */ }
    return JSON.stringify(bf.map((x) => {
      const safe = (fn: () => unknown) => { try { return fn(); } catch { return 'err'; } };
      return [safe(() => isCreatureNow(x)), safe(() => [...getCreatureTypesNow(x)].sort()), safe(() => landAwareTypeLine(state, x)),
        safe(() => getCurrentPowerToughness(x, state)), safe(() => getEffectiveColors(x, state))];
    }));
  };
  const base = snapshot('', NEUTRAL_NAME);
  const neutralLine = cardName ? line.split(cardName).join(NEUTRAL_NAME) : line;
  return snapshot(neutralLine, NEUTRAL_NAME) !== base;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) || '--top=40').slice(6)) || 40;
const SAMPLE = process.argv.find((a) => a.startsWith('--grep='))?.slice(7);

type Face = { name?: string; oracle_text?: string; type_line?: string; power?: string; toughness?: string };
type Card = Face & { oracle_id?: string; legalities?: Record<string, string>; card_faces?: Face[] };

function isHandled(line: string, face: Face, cardName: string): { static: boolean; replacement: boolean } {
  const perm: any = {
    id: 'census-perm', controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: 'census-card', name: cardName, type_line: face.type_line || '', oracle_text: line, power: face.power, toughness: face.toughness },
    // R15: placeholder as-enters choices so choice-dependent statics (chosen type/color lords) are probed, not miscounted.
    chosenCreatureType: 'Bear', chosenColor: 'green',
  };
  // Auras/Equipment only project specs onto a host, so give them one.
  const host: any = {
    id: 'census-host', controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: 'census-host-card', name: 'Census Bear', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' },
  };
  if (/\b(?:enchanted|equipped|fortified) /i.test(line)) perm.attachedTo = host.id;
  let st = false;
  let rp = false;
  try { st = parseStaticEffectSpecsFromOraclePermanent(perm).length > 0; } catch { st = false; }
  const battlefield = perm.attachedTo ? [perm, host] : [perm];
  try {
    const state: any = { battlefield, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], turnPlayer: 'p1' };
    rp = collectReplacementEffectSpecsFromState(state).length > 0;
  } catch { rp = false; }
  // R15: characteristic-defining P/T (CR 604.3) is computed by calculateVariablePT, not a spec; probe it directly.
  if (!st && /\b(?:power|toughness)\b[^.]*\bequal to\b/i.test(line) && /\*/.test(String(face.power ?? '') + String(face.toughness ?? ''))) {
    try { st = !!calculateVariablePT({ ...perm.card }, { battlefield, zones: { p1: { hand: [], graveyard: [] } }, players: [{ id: 'p1', life: 40 }], life: { p1: 40 } }); } catch { st = false; }
  }
  if (!st && !rp) st = observableBoardDiffers(line, face, cardName);
  return { static: st, replacement: rp };
}

async function main() {
  let lines = 0;
  let handled = 0;
  let elsewhere = 0;
  const byFamily = new Map<string, { scope: string; lines: number; cards: Set<string>; sample: string }>();
  const bySystem = new Map<string, number>();
  const seen = new Set<string>();
  for await (const raw of iterateOracleCards(resolveOracleCardsPath(repoRoot))) {
    const card = raw as Card;
    if (card.legalities?.commander !== 'legal') continue;
    const oid = String(card.oracle_id || card.name);
    if (seen.has(oid)) continue;
    seen.add(oid);
    const faces: Face[] = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces.map((f) => ({ power: card.power, toughness: card.toughness, ...f })) : [card];
    for (const face of faces) {
      const typeLine = String(face.type_line || card.type_line || '');
      if (/\b(instant|sorcery)\b/i.test(typeLine)) continue;
      const name = String(face.name || card.name || '');
      // Strip reminder text per line; stripping the whole text can merge a keyword line into the next.
      const text = String(face.oracle_text || '');
      for (const rawLine of text.split(/\n+/).map((l) => stripReminderParentheticals(l).trim())) {
        const cls = classifyStaticCensusLine(rawLine, name);
        if (!cls) continue;
        lines += 1;
        if (cls.system) { elsewhere += 1; bySystem.set(cls.system, (bySystem.get(cls.system) || 0) + 1); continue; }
        const h = isHandled(rawLine.trim(), face, name);
        if (h.static || h.replacement) { handled += 1; continue; }
        const key = staticFamilyKey(rawLine, name);
        if (SAMPLE && key.includes(SAMPLE)) console.log(`${name}: ${rawLine.trim()}`);
        const e = byFamily.get(key) || { scope: cls.scope, lines: 0, cards: new Set<string>(), sample: '' };
        e.lines += 1;
        e.cards.add(String(card.name));
        if (!e.sample) e.sample = rawLine.trim().slice(0, 220);
        byFamily.set(key, e);
      }
    }
  }
  const unhandled = lines - handled - elsewhere;
  const ranked = [...byFamily.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size);
  const scopeTotals = { static: 0, replacement: 0 };
  for (const [, v] of ranked) scopeTotals[v.scope as 'static' | 'replacement'] += v.lines;
  const json = {
    generatedAt: new Date().toISOString(),
    candidateLines: lines,
    declarativeHandled: handled,
    otherSystem: elsewhere,
    ownedButUnhandled: unhandled,
    unhandledStatic: scopeTotals.static,
    unhandledReplacement: scopeTotals.replacement,
    otherSystems: Object.fromEntries([...bySystem.entries()].sort((a, b) => b[1] - a[1])),
    families: ranked.slice(0, 300).map(([key, v]) => ({ key, scope: v.scope, lines: v.lines, cards: v.cards.size, examples: [...v.cards].slice(0, 5), sample: v.sample })),
  };
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'static-replacement-census.json'), JSON.stringify(json, null, 2));
  // Run history survives regeneration: keep earlier rows from the existing doc and append this run.
  const docPath = path.join(repoRoot, 'docs', 'static-replacement-census.md');
  const previous = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
  const historySection = previous.split('## Run history')[1] || '';
  const historyRows = historySection.split('\n').filter((row) => /^\| (?:\d{4}-|B\d+ )/.test(row)).slice(0, 200);
  historyRows.push(`| ${json.generatedAt.slice(0, 16).replace('T', ' ')}Z | ${lines} | ${handled} | ${elsewhere} | ${scopeTotals.static} | ${scopeTotals.replacement} |`);
  const md = [
    '# Phase 5 static/replacement census (owned_but_unhandled)',
    '',
    `Generated ${json.generatedAt} by \`npm run census:statics\` (server/scripts/static-replacement-census.ts).`,
    '',
    'Candidate lines: Commander-legal permanent faces, reminder text stripped, lines that end in a period and are',
    'not triggers, activated abilities, or keyword lists. A line is **declarative-handled** when',
    '`parseStaticEffectSpecsFromOraclePermanent` or `collectReplacementEffectSpecsFromState` returns a spec for it alone.',
    'Lines owned by another subsystem (cost modifiers, ETB-tapped/with-counters, cast permissions, etc.) are listed',
    'separately and not counted as gaps. Remaining lines are `owned_but_unhandled` for Phase 5.',
    '',
    '| Metric | Lines |',
    '|---|---|',
    `| Candidate static/replacement lines | ${lines} |`,
    `| Declarative-handled | ${handled} |`,
    `| Owned by another subsystem | ${elsewhere} |`,
    `| owned_but_unhandled (static) | ${scopeTotals.static} |`,
    `| owned_but_unhandled (replacement) | ${scopeTotals.replacement} |`,
    '',
    '## Run history',
    '',
    '| Run (UTC) | Candidates | Handled | Other subsystems | Unhandled static | Unhandled replacement |',
    '|---|---|---|---|---|---|',
    ...historyRows,
    '',
    '## Other subsystems',
    '',
    ...[...bySystem.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `## Top ${TOP} unhandled families (by cards affected)`,
    '',
    '| # | Scope | Family | Cards | Example cards |',
    '|---|---|---|---|---|',
    ...ranked.slice(0, TOP).map(([k, v], i) => `| ${i + 1} | ${v.scope} | ${k.replace(/\|/g, '/')} | ${v.cards.size} | ${[...v.cards].slice(0, 3).join('; ').replace(/\|/g, '/')} |`),
    '',
  ];
  fs.writeFileSync(docPath, md.join('\n'));
  console.log(`lines=${lines} handled=${handled} elsewhere=${elsewhere} unhandled=${unhandled} (static=${scopeTotals.static} replacement=${scopeTotals.replacement})`);
  for (const [k, v] of ranked.slice(0, TOP)) console.log(`${v.cards.size}\t${v.scope}\t${k}\t| ${[...v.cards].slice(0, 2).join('; ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });