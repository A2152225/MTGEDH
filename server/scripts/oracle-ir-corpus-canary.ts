/*
  Bounded Oracle IR corpus canary.

  Full-corpus audits (trigger:coverage, executor:coverage, oracle-ir:live-seam)
  score parse/detect/dry-run. They do not ask: "does IR *own* this text, then
  skip it?" — the Reins of Power class (wired steps, incomplete apply).

  This canary classifies each trigger effect (and instant/sorcery oracle) as:
    covered              — dry-run fully_applied / choice_required / impossible
    parse_unknown        — unknown IR steps (parser hole)
    owned_unexecuted     — fully wired, then partial/unsupported/no_steps
    wiring_step_mismatch — ownership parser and dry-run step lists disagree
    unwired              — not fully wired; remaining work, not a silent skip

  Run (from server/):
    npm run oracle-ir:corpus-canary
    $env:CORPUS_CANARY_MAX_CARDS='2000'; npm run oracle-ir:corpus-canary
    $env:CORPUS_CANARY_FAIL_ON_OWNED_UNEXECUTED='1'; npm run oracle-ir:corpus-canary

  Env:
    CORPUS_CANARY_MAX_CARDS=500          (0 = all commander-legal)
    CORPUS_CANARY_STRIDE=1               take every Nth commander card
    CORPUS_CANARY_COMMANDER_ONLY=1
    CORPUS_CANARY_FAIL_ON_OWNED_UNEXECUTED=0
    CORPUS_CANARY_TOP=40
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { isSpellEffectFullyIrWired } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';
import {
  collectStepsFromIrText,
  dryRunOracleSteps,
  type ExecutorCoverageStatus,
} from './executor-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'out');
const outPath = path.join(outDir, 'oracle-ir-corpus-canary.json');

export type CanaryHoleKind =
  | 'covered'
  | 'parse_unknown'
  | 'owned_unexecuted'
  | 'wiring_step_mismatch'
  | 'unwired';

export type CanaryScope = 'trigger_effect' | 'spell';

export type CanaryItem = {
  name: string;
  scope: CanaryScope;
  effect: string;
  hole: CanaryHoleKind;
  status: ExecutorCoverageStatus;
  wired: boolean;
  dryRunSteps: number;
  ownershipSteps: number;
};

export type CanaryCard = {
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ name?: string; type_line?: string; oracle_text?: string }>;
  legalities?: Record<string, string>;
  set?: string;
  set_type?: string;
  border_color?: string;
};

/** Cards this session treats as "IR must actually apply", not merely own. */
export const MUST_COVER_CARD_NAMES = [
  'Reins of Power',
  'Hydra Trainer',
  'Glory-Bound Initiate',
  'Themberchaud',
  'Trueheart Twins',
  'Tah-Crop Elite',
  "Oketra's Avenger",
  'Disposal Mummy',
  "Green Sun's Twilight",
  'Glimpse of Tomorrow',
  'Dead Drop',
  'Slip Through Space',
  'Political Triumph',
  "Teferi's Protection",
  'The Eagles Are Coming!',
  'Nemesis Trap',
  'Entrapment Maneuver',
  'Hex Magic',
  "Siren's Call",
] as const;

const OK_STATUSES = new Set<ExecutorCoverageStatus>([
  'fully_applied',
  'choice_required',
  'impossible',
]);

export function isInstantOrSorcery(typeLine: string | undefined): boolean {
  const line = String(typeLine || '');
  if (line.includes('//')) {
    return line.split('//').every((face) => /\b(?:instant|sorcery)\b/i.test(face.trim()));
  }
  return /\b(?:instant|sorcery)\b/i.test(line);
}

function clip(text: string, n = 160): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function ownershipStepCount(text: string, name: string, scope: CanaryScope): number {
  if (scope === 'spell') {
    return isSpellEffectFullyIrWired(text, name) ? 1 : 0;
  }
  return isTriggerEffectFullyIrWired(text, name) ? 1 : 0;
}

export function classifyCanaryItem(
  name: string,
  scope: CanaryScope,
  effect: string,
  typeLine?: string,
): CanaryItem {
  const text = String(effect || '').trim();
  const wired =
    scope === 'spell'
      ? isSpellEffectFullyIrWired(text, name)
      : isTriggerEffectFullyIrWired(text, name);
  const steps = collectStepsFromIrText(text, name);
  const irGaps = collectUnknownIrGapsFromSteps(steps);
  const record = dryRunOracleSteps(steps, name, irGaps, { typeLine });
  const dryRunSteps = steps.length;
  const ownershipSteps = ownershipStepCount(text, name, scope);

  let hole: CanaryHoleKind;
  if (irGaps.length > 0) {
    hole = 'parse_unknown';
  } else if (wired && dryRunSteps === 0) {
    hole = 'wiring_step_mismatch';
  } else if (wired && !OK_STATUSES.has(record.status)) {
    hole = 'owned_unexecuted';
  } else if (OK_STATUSES.has(record.status)) {
    hole = 'covered';
  } else {
    hole = 'unwired';
  }

  return {
    name,
    scope,
    effect: clip(text),
    hole,
    status: record.status,
    wired,
    dryRunSteps,
    ownershipSteps,
  };
}

function splitFirstSentenceOutsideParens(text: string): { head: string; rest: string } {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    else if (ch === '.' && depth === 0) {
      const next = text[i + 1] ?? '';
      if (next === '' || /\s/.test(next)) {
        return { head: text.slice(0, i + 1).trim(), rest: text.slice(i + 1).trim() };
      }
    }
  }
  return { head: text.trim(), rest: '' };
}

function splitWheneverAbilitiesFromSpellText(text: string): {
  spellText: string;
  wheneverEffects: string[];
} {
  const source = String(text || '');
  const spellParts: string[] = [];
  const wheneverEffects: string[] = [];
  let current = '';
  let parenDepth = 0;

  const flush = (chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    if (/^When you (?:cast|play) this spell\b/i.test(trimmed)) {
      const { head, rest } = splitFirstSentenceOutsideParens(trimmed);
      wheneverEffects.push(head);
      if (rest) spellParts.push(rest);
      return;
    }
    if (/^(?:Whenever|When you discard this card)\b/i.test(trimmed)) {
      wheneverEffects.push(trimmed);
      return;
    }
    spellParts.push(trimmed);
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;

    if (parenDepth === 0) {
      const rest = source.slice(i);
      const triggerStart = rest.match(/^(?:Whenever|When you cast this spell|When you play this spell|When you discard this card)\b/i);
      if (triggerStart && current.trim()) {
        const prev = source[i - 1] ?? '';
        if (!prev || /[\s\n]/.test(prev)) {
          flush(current);
          current = '';
        }
      }
    }
    current += ch;
  }
  flush(current);
  return { spellText: spellParts.join(' ').trim(), wheneverEffects };
}

function assessOracleFace(name: string, typeLine: string | undefined, oracle: string): CanaryItem[] {
  const text = String(oracle || '').trim();
  if (!name || !text) return [];
  if (isInstantOrSorcery(typeLine)) {
    const { spellText, wheneverEffects } = splitWheneverAbilitiesFromSpellText(text);
    const items: CanaryItem[] = [];
    if (spellText) items.push(classifyCanaryItem(name, 'spell', spellText, typeLine));
    for (const effect of wheneverEffects) {
      items.push(classifyCanaryItem(name, 'trigger_effect', effect, typeLine));
    }
    return items.length > 0 ? items : [classifyCanaryItem(name, 'spell', text, typeLine)];
  }
  const triggers = parseTriggeredAbilitiesFromText(text, name);
  const items: CanaryItem[] = [];
  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    items.push(classifyCanaryItem(name, 'trigger_effect', effect, typeLine));
  }
  return items;
}

export function assessCard(card: CanaryCard): CanaryItem[] {
  const name = String(card.name || '').trim();
  const faces = Array.isArray(card.card_faces) ? card.card_faces.filter((face) => String(face?.oracle_text || '').trim()) : [];
  if (faces.length > 1) {
    const nameFaces = name.split('//').map((part) => part.trim()).filter(Boolean);
    const typeFaces = String(card.type_line || '').split('//').map((part) => part.trim()).filter(Boolean);
    const items: CanaryItem[] = [];
    faces.forEach((face, index) => {
      const faceName = String(face.name || nameFaces[index] || name).trim();
      const faceType = String(face.type_line || typeFaces[index] || '').trim();
      items.push(...assessOracleFace(faceName, faceType, String(face.oracle_text || '')));
    });
    return items;
  }

  const oracle = getCombinedOracleText(card as Parameters<typeof getCombinedOracleText>[0]);
  if (!name || !oracle) return [];
  return assessOracleFace(name, card.type_line, oracle);
}

function missingCanaryItem(name: string, effect: string): CanaryItem {
  return {
    name,
    scope: 'spell',
    effect,
    hole: 'unwired',
    status: 'no_steps',
    wired: false,
    dryRunSteps: 0,
    ownershipSteps: 0,
  };
}

export function assessNamedCards(names: readonly string[]): CanaryItem[] {
  const items: CanaryItem[] = [];
  for (const name of names) {
    const card = lookupLocalCardByNameSync(name);
    if (!card) {
      items.push(missingCanaryItem(name, '(missing from local card lookup)'));
      continue;
    }
    const assessed = assessCard(card);
    if (assessed.length === 0) {
      items.push(missingCanaryItem(name, '(no parsed trigger/spell effects)'));
      continue;
    }
    items.push(...assessed);
  }
  return items;
}

export function holeItems(items: readonly CanaryItem[]): CanaryItem[] {
  return items.filter((item) => item.hole !== 'covered');
}

export function ownedUnexecutedItems(items: readonly CanaryItem[]): CanaryItem[] {
  return items.filter((item) => item.hole === 'owned_unexecuted' || item.hole === 'wiring_step_mismatch');
}

function parseEnv(): {
  maxCards: number;
  stride: number;
  commanderOnly: boolean;
  failOnOwnedUnexecuted: boolean;
  top: number;
} {
  return {
    maxCards: Math.max(0, Number(process.env.CORPUS_CANARY_MAX_CARDS ?? '500') || 0),
    stride: Math.max(1, Number(process.env.CORPUS_CANARY_STRIDE || '1') || 1),
    commanderOnly: String(process.env.CORPUS_CANARY_COMMANDER_ONLY ?? '1') !== '0',
    failOnOwnedUnexecuted: String(process.env.CORPUS_CANARY_FAIL_ON_OWNED_UNEXECUTED || '') === '1',
    top: Math.max(1, Number(process.env.CORPUS_CANARY_TOP || '40') || 40),
  };
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

async function main(): Promise<void> {
  const args = parseEnv();
  await loadEffectIrParser();

  const oraclePath = resolveOracleCardsPath(repoRoot);
  if (!fs.existsSync(oraclePath)) {
    console.error(`Oracle cards file not found at ${oraclePath}`);
    process.exit(1);
  }

  const byHole: Record<CanaryHoleKind, number> = {
    covered: 0,
    parse_unknown: 0,
    owned_unexecuted: 0,
    wiring_step_mismatch: 0,
    unwired: 0,
  };
  const examples: Record<CanaryHoleKind, CanaryItem[]> = {
    covered: [],
    parse_unknown: [],
    owned_unexecuted: [],
    wiring_step_mismatch: [],
    unwired: [],
  };
  const statusCounts: Record<string, number> = {};

  let cardsScanned = 0;
  let commanderIndex = 0;
  const allItems: CanaryItem[] = [];

  for await (const raw of iterateOracleCards(oraclePath)) {
    const card = raw as CanaryCard;
    if (!isEligible(card as Parameters<typeof isEligible>[0])) continue;
    if (args.commanderOnly && !isCommanderLegalCard(card as Parameters<typeof isCommanderLegalCard>[0])) continue;
    if (isIgnorableCardForIrGap(card as Parameters<typeof isIgnorableCardForIrGap>[0])) continue;

    commanderIndex += 1;
    if ((commanderIndex - 1) % args.stride !== 0) continue;
    if (args.maxCards > 0 && cardsScanned >= args.maxCards) break;

    cardsScanned += 1;
    const items = assessCard(card);
    for (const item of items) {
      allItems.push(item);
      bump(byHole, item.hole);
      bump(statusCounts, item.status);
      const bucket = examples[item.hole];
      if (item.hole !== 'covered' && bucket.length < args.top) bucket.push(item);
    }
  }

  const mustCover = assessNamedCards(MUST_COVER_CARD_NAMES);
  const mustCoverHoles = ownedUnexecutedItems(mustCover);

  const report = {
    generatedAt: new Date().toISOString(),
    oraclePath: path.relative(repoRoot, oraclePath),
    maxCards: args.maxCards,
    stride: args.stride,
    commanderOnly: args.commanderOnly,
    cardsScanned,
    itemsScanned: allItems.length,
    byHole,
    byStatus: statusCounts,
    mustCover: mustCover.map((item) => ({
      name: item.name,
      scope: item.scope,
      hole: item.hole,
      status: item.status,
      wired: item.wired,
      effect: item.effect,
    })),
    examples: {
      owned_unexecuted: examples.owned_unexecuted,
      wiring_step_mismatch: examples.wiring_step_mismatch,
      parse_unknown: examples.parse_unknown,
      unwired: examples.unwired.slice(0, 15),
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Oracle IR corpus canary');
  console.log('=======================');
  console.log(`Cards scanned: ${cardsScanned}`);
  console.log(`Items classified: ${allItems.length}`);
  console.log('By hole:');
  for (const kind of Object.keys(byHole) as CanaryHoleKind[]) {
    console.log(`  ${kind}: ${byHole[kind]}`);
  }
  console.log('');
  console.log('Must-cover:');
  for (const item of mustCover) {
    console.log(`  ${item.hole.padEnd(22)} ${item.name} (${item.status}) ${item.effect.slice(0, 70)}`);
  }
  console.log('');
  if (examples.owned_unexecuted.length > 0) {
    console.log('Owned but unexecuted (IR skip after wiring):');
    for (const item of examples.owned_unexecuted.slice(0, 12)) {
      console.log(`  ${item.name}: ${item.effect}`);
    }
    console.log('');
  }
  if (examples.parse_unknown.length > 0) {
    console.log('Parse unknown (parser hole):');
    for (const item of examples.parse_unknown.slice(0, 8)) {
      console.log(`  ${item.name}: ${item.effect}`);
    }
    console.log('');
  }
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);

  if (mustCoverHoles.length > 0) {
    console.error(`Must-cover owned-unexecuted: ${mustCoverHoles.map((item) => item.name).join(', ')}`);
    process.exit(1);
  }
  if (args.failOnOwnedUnexecuted && byHole.owned_unexecuted + byHole.wiring_step_mismatch > 0) {
    console.error('CORPUS_CANARY_FAIL_ON_OWNED_UNEXECUTED=1 and sample has owned-unexecuted items');
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
