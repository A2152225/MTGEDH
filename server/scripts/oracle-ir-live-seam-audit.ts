/*
  Live-seam corpus audit.

  Executor/trigger coverage score isolated IR clauses on a synthetic fixture.
  This audit asks the questions those numbers miss:

    - Does a continuous lord/anthem parse to StaticEffectSpec on the battlefield?
    - Does that same spec leak from the graveyard?
    - Do compound timings (enters or attacks / attacks or blocks / attacks or dies)
      hit BOTH detectors, not one-or-the-other?
    - Do watchers on other permanents (goaded creature attacks, another creature
      enters, a creature you control dies) actually detect?
    - Do exile-source payoffs (time counter removed while exiled) detect, and does
      the suspend upkeep path emit them?

  Run:
    npm run oracle-ir:live-seam

  Env:
    LIVE_SEAM_TOP=40
    LIVE_SEAM_COMMANDER_ONLY=1
    LIVE_SEAM_FAIL_ON_GAPS=0
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { iterateOracleCards, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';
import {
  detectAttackTriggers,
  detectBlockTriggers,
  detectDeathTriggers,
  detectETBTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { isAttackWatcherTriggerType } from '../src/state/modules/triggers/attack-watcher-queue.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'out');
const outPath = path.join(outDir, 'oracle-ir-live-seam-audit.json');
const upkeepPath = path.resolve(__dirname, '../src/state/modules/turn-handlers/turnStepUpkeep.ts');

export type LiveSeamId =
  | 'static_other_type_lord'
  | 'static_creatures_you_control'
  | 'static_gy_leak'
  | 'gy_static_missing'
  | 'compound_enters_or_attacks'
  | 'compound_attacks_or_blocks'
  | 'compound_attacks_or_dies'
  | 'attack_watcher'
  | 'etb_watcher'
  | 'death_watcher'
  | 'exile_time_counter'
  | 'exile_time_counter_emission';

export type LiveSeamCard = {
  name: string;
  type_line?: string;
  oracle_text?: string;
  legalities?: Record<string, string>;
};

export type LiveSeamGap = {
  seam: LiveSeamId;
  detail: string;
};

const UNTIL_EOT = /\buntil (?:end of turn|your next turn)\b/i;
const TRIGGER_LEAD = /^(?:when|whenever|at the )\b/i;
const ACTIVATED_LEAD = /^\{/;

const OTHER_TYPE_LORD =
  /\bother\s+[a-z]+s?(?:\s+creatures?)?\s+(?:you\s+control\s+)?(?:get\s+\+\d+\s*\/\s*\+\d+|have\b)/i;
const CREATURES_YOU_CONTROL_STATIC =
  /(?:^|[.\n;])\s*(?:other\s+)?(?:[a-z]+\s+)?creatures you control (?:get\s+\+\d+\s*\/\s*\+\d+|have\b)/i;
/** Continuous GY-source statics only. Trigger intervening-ifs ("if this card is in
 *  your graveyard") and battlefield-looking-at-GY clauses ("as long as a Warrior
 *  card is in your graveyard") are not this seam. */
const GY_STATIC =
  /\bas long as this (?:card|permanent|creature) is in (?:your |a )?graveyard\b/i;
const EXILE_TIME_COUNTER =
  /whenever a time counter is removed from this card while it's exiled/i;

function stripQuoted(text: string): string {
  return String(text || '').replace(/"[^"]*"/g, ' ');
}

function stripParentheticals(text: string): string {
  return String(text || '').replace(/\([^)]*\)/g, ' ');
}

function watcherScanText(oracle: string): string {
  return stripParentheticals(stripQuoted(oracle));
}

function splitClauses(oracle: string): string[] {
  return String(oracle || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function isTriggeredOrActivated(clause: string): boolean {
  return TRIGGER_LEAD.test(clause) || ACTIVATED_LEAD.test(clause);
}

function isContinuousClause(clause: string): boolean {
  if (!clause) return false;
  if (isTriggeredOrActivated(clause)) return false;
  if (UNTIL_EOT.test(clause)) return false;
  if (/^suspend\b/i.test(clause)) return false;
  return true;
}

export function suspendTickEmitsExileTimeCounter(source = fs.readFileSync(upkeepPath, 'utf8')): boolean {
  return /time_counter_removed_from_exiled_self|detectCounterRemovedTriggers|queueCounterRemovedTriggers|queueExiledTimeCounterRemovedTriggers/.test(
    source,
  );
}

function battlefieldProbe(card: LiveSeamCard) {
  return {
    id: 'seam_bf_1',
    controller: 'p1',
    card: {
      id: 'seam_bf_1_card',
      name: card.name,
      type_line: card.type_line || 'Creature',
      oracle_text: String(card.oracle_text || ''),
    },
  };
}

function cardObj(card: LiveSeamCard) {
  return {
    name: card.name,
    type_line: card.type_line,
    oracle_text: String(card.oracle_text || ''),
  };
}

function triggerTypes(triggers: readonly { triggerType?: string }[]): string[] {
  return triggers.map((trigger) => String(trigger.triggerType || '')).filter(Boolean);
}

function evaluateStaticSpecs(card: LiveSeamCard, oracle: string, gaps: LiveSeamGap[]): void {
  const perm = battlefieldProbe(card);
  const specs = parseStaticEffectSpecsFromOraclePermanent(perm as any);
  const specIds = specs.map((spec) => String(spec.id || spec.condition?.kind || spec.scope?.kind || 'spec'));

  const continuous = splitClauses(watcherScanText(oracle)).filter(isContinuousClause);
  for (const clause of continuous) {
    if (OTHER_TYPE_LORD.test(clause) && specs.length === 0) {
      gaps.push({ seam: 'static_other_type_lord', detail: clause });
    } else if (CREATURES_YOU_CONTROL_STATIC.test(clause) && specs.length === 0) {
      gaps.push({ seam: 'static_creatures_you_control', detail: clause });
    }
  }

  const gyStaticClause = continuous.find((clause) => (
    GY_STATIC.test(clause)
    && !/\bif you would\b/i.test(clause)
    && !/\benters with\b/i.test(clause)
  ));
  if (gyStaticClause) {
    const gyState = {
      battlefield: [],
      zones: {
        p1: {
          graveyard: [{
            id: 'seam_gy_1',
            name: card.name,
            type_line: card.type_line,
            oracle_text: oracle,
            controller: 'p1',
            owner: 'p1',
          }],
        },
      },
    };
    const gySpecs = collectStaticEffectSpecsFromState(gyState);
    if (gySpecs.length === 0) {
      gaps.push({ seam: 'gy_static_missing', detail: gyStaticClause });
    }
  } else if (specs.length > 0 && (OTHER_TYPE_LORD.test(oracle) || CREATURES_YOU_CONTROL_STATIC.test(oracle))) {
    const gyState = {
      battlefield: [{
        id: 'unrelated_1',
        controller: 'p1',
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      }],
      zones: {
        p1: {
          graveyard: [{
            id: 'seam_gy_lord',
            name: card.name,
            type_line: card.type_line,
            oracle_text: oracle,
            owner: 'p1',
          }],
        },
      },
    };
    const leaked = collectStaticEffectSpecsFromState(gyState).filter(
      (spec) => String(spec.sourcePermanentId || '') === 'seam_gy_lord',
    );
    if (leaked.length > 0) {
      gaps.push({
        seam: 'static_gy_leak',
        detail: `battlefield static leaked from GY (${specIds.join(', ')})`,
      });
    }
  }
}

function evaluateCompounds(card: LiveSeamCard, oracle: string, gaps: LiveSeamGap[]): void {
  const probe = battlefieldProbe(card);
  const obj = cardObj(card);
  const etb = detectETBTriggers(obj, probe);
  const attack = detectAttackTriggers(obj, probe);
  const block = detectBlockTriggers(obj, probe);
  const death = detectDeathTriggers(obj, probe);
  const body = watcherScanText(oracle);

  if (/\benters or attacks\b/i.test(oracle)) {
    if (etb.length === 0 || attack.length === 0) {
      gaps.push({
        seam: 'compound_enters_or_attacks',
        detail: `etb=${triggerTypes(etb).join('|') || 'none'} attack=${triggerTypes(attack).join('|') || 'none'}`,
      });
    }
  }

  if (
    /\battacks or blocks\b/i.test(body)
    && !/\bcan't attack or block\b/i.test(body)
    && !/\battacks or blocks each combat if able\b/i.test(body)
    && /when(?:ever)?\b/i.test(body)
  ) {
    const attackOrBlock = [...attack, ...block].some((trigger) =>
      /attacks_or_blocks|any_creature_attacks_or_blocks|equipped_creature_attacks_or_blocks/.test(
        String(trigger.triggerType || ''),
      ),
    );
    if (!attackOrBlock && (attack.length === 0 || block.length === 0)) {
      gaps.push({
        seam: 'compound_attacks_or_blocks',
        detail: `attack=${triggerTypes(attack).join('|') || 'none'} block=${triggerTypes(block).join('|') || 'none'}`,
      });
    }
  }

  if (/\battacks or dies\b/i.test(oracle)) {
    if (attack.length === 0 || death.length === 0) {
      gaps.push({
        seam: 'compound_attacks_or_dies',
        detail: `attack=${triggerTypes(attack).join('|') || 'none'} death=${triggerTypes(death).join('|') || 'none'}`,
      });
    }
  }
}

function evaluateWatchers(card: LiveSeamCard, oracle: string, gaps: LiveSeamGap[]): void {
  const probe = battlefieldProbe(card);
  const obj = cardObj(card);
  const clauses = splitClauses(watcherScanText(oracle));

  const attackWatcherLine = clauses.find((clause) =>
    /^whenever\s+(?:a |another )/i.test(clause)
    && /\battacks\b/i.test(clause)
    && !/\benters or attacks\b/i.test(clause)
    && !/whenever this (?:creature|permanent) attacks/i.test(clause),
  );
  if (attackWatcherLine) {
    const attack = detectAttackTriggers(obj, probe);
    const kinds = triggerTypes(attack);
    const watcher = kinds.some((kind) => isAttackWatcherTriggerType(kind) || /attacks_this_turn/.test(kind))
      || (kinds.length > 0 && kinds.some((kind) => kind !== 'attacks'));
    if (!watcher) {
      gaps.push({
        seam: 'attack_watcher',
        detail: `${attackWatcherLine} types=${triggerTypes(attack).join('|') || 'none'}`,
      });
    }
  }

  const etbWatcherLine = clauses.find((clause) =>
    /^whenever\b/i.test(clause)
    && /\benters\b/i.test(clause)
    && !/\benters with\b/i.test(clause)
    && (/\banother\b/i.test(clause) || /\ba (?!this )/.test(clause)),
  );
  if (etbWatcherLine) {
    const etb = detectETBTriggers(obj, probe);
    const landfall = /\bland\b|\bplains\b|\bisland\b|\bswamp\b|\bmountain\b|\bforest\b|\bgate\b|\bdesert\b/i.test(etbWatcherLine)
      ? detectLandfallTriggers(obj, probe)
      : [];
    if (etb.length === 0 && landfall.length === 0) {
      gaps.push({ seam: 'etb_watcher', detail: etbWatcherLine });
    }
  }

  const deathWatcherLine = clauses.find((clause) =>
    /whenever (?:a |another )/i.test(clause)
    && /\bdies\b/i.test(clause)
    && !/whenever this (?:creature|permanent) dies/i.test(clause),
  );
  if (deathWatcherLine) {
    const death = detectDeathTriggers(obj, probe);
    if (death.length === 0) {
      gaps.push({ seam: 'death_watcher', detail: deathWatcherLine });
    }
  }
}

function evaluateExile(card: LiveSeamCard, oracle: string, gaps: LiveSeamGap[], exileEmission: boolean): void {
  if (!EXILE_TIME_COUNTER.test(oracle)) return;
  const probe = { id: 'seam_exile_1', controller: 'p1', zone: 'exile', isSuspended: true };
  const detected = detectCounterRemovedTriggers(cardObj(card), probe);
  const hit = detected.some((trigger) => trigger.triggerType === 'time_counter_removed_from_exiled_self');
  if (!hit) {
    gaps.push({
      seam: 'exile_time_counter',
      detail: `types=${detected.map((trigger) => trigger.triggerType).join('|') || 'none'}`,
    });
  }
  if (!exileEmission) {
    gaps.push({
      seam: 'exile_time_counter_emission',
      detail: 'suspend upkeep decrements time counters without emitting the exile trigger',
    });
  }
}

export function evaluateLiveSeams(card: LiveSeamCard, options?: { exileEmission?: boolean }): LiveSeamGap[] {
  const oracle = String(card.oracle_text || '').trim();
  if (!oracle) return [];
  const gaps: LiveSeamGap[] = [];
  const exileEmission = options?.exileEmission ?? suspendTickEmitsExileTimeCounter();
  evaluateStaticSpecs(card, oracle, gaps);
  evaluateCompounds(card, oracle, gaps);
  evaluateWatchers(card, oracle, gaps);
  evaluateExile(card, oracle, gaps, exileEmission);
  return gaps;
}

export function isCommanderLegalCard(card: LiveSeamCard & { legalities?: Record<string, string> }): boolean {
  return String(card.legalities?.commander || '').toLowerCase() === 'legal';
}

function parseEnv(): { top: number; commanderOnly: boolean; failOnGaps: boolean } {
  return {
    top: Math.max(1, Number(process.env.LIVE_SEAM_TOP || 40) || 40),
    commanderOnly: String(process.env.LIVE_SEAM_COMMANDER_ONLY ?? '1') !== '0',
    failOnGaps: String(process.env.LIVE_SEAM_FAIL_ON_GAPS || '') === '1',
  };
}

async function main(): Promise<void> {
  const args = parseEnv();
  const exileEmission = suspendTickEmitsExileTimeCounter();
  const bySeam = new Map<LiveSeamId, { count: number; examples: string[] }>();
  const bump = (gap: LiveSeamGap, name: string) => {
    const cur = bySeam.get(gap.seam) ?? { count: 0, examples: [] };
    cur.count += 1;
    if (cur.examples.length < args.top) cur.examples.push(`${name}: ${gap.detail}`.slice(0, 220));
    bySeam.set(gap.seam, cur);
  };

  let scanned = 0;
  let cardsWithGaps = 0;
  const oraclePath = resolveOracleCardsPath(repoRoot);

  for await (const raw of iterateOracleCards(oraclePath)) {
    const card = raw as LiveSeamCard & { legalities?: Record<string, string> };
    if (args.commanderOnly && !isCommanderLegalCard(card)) continue;
    scanned += 1;
    const gaps = evaluateLiveSeams(card, { exileEmission });
    if (gaps.length === 0) continue;
    cardsWithGaps += 1;
    for (const gap of gaps) bump(gap, card.name);
  }

  const seams = [...bySeam.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([seam, info]) => ({ seam, count: info.count, examples: info.examples }));

  const report = {
    generatedAt: new Date().toISOString(),
    scanned,
    cardsWithGaps,
    exileEmissionWired: exileEmission,
    seams,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log('Oracle IR live-seam audit');
  console.log('=========================');
  console.log(`Cards scanned: ${scanned}`);
  console.log(`Cards with gaps: ${cardsWithGaps}`);
  console.log(`Suspend exile-time-counter emission: ${exileEmission ? 'wired' : 'MISSING'}`);
  for (const row of seams) {
    console.log(`\n${row.seam}: ${row.count}`);
    for (const example of row.examples.slice(0, 8)) {
      console.log(`  - ${example}`);
    }
  }
  console.log(`\nWrote ${path.relative(repoRoot, outPath)}`);

  if (args.failOnGaps && cardsWithGaps > 0) process.exit(1);
}

const invokedDirectly = process.argv[1] && /oracle-ir-live-seam-audit/.test(String(process.argv[1]));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
