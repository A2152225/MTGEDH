/*
  Oracle IR smoke / soak core.

  In-process card soaks: local oracle lookup → parse/collect IR → optional Layer 3
  apply / Effect Program → expected vs actual checks → gap telemetry correlation.

  Suites live in scripts/soak/suites/. Register them in scripts/soak/suites/index.ts.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlayerID } from '../../../shared/src/index.js';
import { GamePhase } from '../../../shared/src/index.js';
import {
  collectOracleEffectStepsWithOverlay,
  collectSpellResolutionEffectStepsWithOverlay,
} from '../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { parseOracleTextToIR } from '../../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../../rules-engine/src/oracleIRExecutor.js';
import { lookupLocalCardByNameSync } from '../../src/services/localCardLookup.js';
import { createInitialGameState } from '../../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../../src/state/modules/oracleIrServerZoneSync.js';
import { startOracleEffectProgramOnServer } from '../../src/state/modules/oracleIrEffectProgramServer.js';
import {
  getOracleIrGapTelemetrySnapshot,
  resetOracleIrGapTelemetry,
  type OracleIrGapTelemetryEvent,
  type OracleIrGapTelemetrySnapshot,
} from '../../src/state/modules/oracleIrGapTelemetry.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import {
  check,
  finishCard,
  finishSoak,
  kindsOf,
  slug,
  summarizeSoaks,
  type LiveSoakConfig,
  type SmokeCardResult,
  type SmokeCheck,
  type SmokeSoakResult,
} from './oracleIrSmokeHelpers.js';

export {
  check,
  findStep,
  finishCard,
  finishSoak,
  hasKind,
  hasVoteTail,
  kindsOf,
  liveSoakBaseUrl,
  parseSmokeArgs,
  scopedOmitsOtherEffects,
  slug,
  summarizeSoaks,
  unknownRaws,
  walkSteps,
  type LiveSoakConfig,
  type SmokeCardResult,
  type SmokeCheck,
  type SmokeCliArgs,
  type SmokeSoakResult,
} from './oracleIrSmokeHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SMOKE_OUT_DIR = path.join(__dirname, '..', 'out');

export type SoakCardRecord = {
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  colors?: string[];
};

export type CollectedIr = {
  ir: ReturnType<typeof parseOracleTextToIR>;
  spellSteps: ReturnType<typeof collectSpellResolutionEffectStepsWithOverlay>;
  allSteps: ReturnType<typeof collectOracleEffectStepsWithOverlay>;
  abilityTypes: string[];
};

export type SoakSuite = {
  id: string;
  title: string;
  description?: string;
  live?: Record<string, LiveSoakConfig>;
  run: () => SmokeSoakResult[] | Promise<SmokeSoakResult[]>;
};

export type SmokeRunOptions = {
  url?: string;
  outDir?: string;
  reportName?: string;
  snapshotName?: string;
  requireLiveTelemetry?: boolean;
  live?: boolean;
};

export type LiveTelemetryFetch = {
  ok: boolean;
  url: string;
  snapshot?: OracleIrGapTelemetrySnapshot;
  error?: string;
};

export type SmokeReport = {
  generatedAt: string;
  suite: { id: string; title: string; description?: string };
  liveServer: {
    url: string;
    reachable: boolean;
    error?: string;
    before: { totalEvents: number; byKind: Record<string, number>; topLabels: OracleIrGapTelemetrySnapshot['topLabels'] } | null;
    after: { totalEvents: number; byKind: Record<string, number>; topLabels: OracleIrGapTelemetrySnapshot['topLabels'] } | null;
    note: string;
  };
  soakTelemetry: {
    totalEvents: number;
    byKind: Record<string, number>;
    byScopeKind: Record<string, number>;
    topLabels: OracleIrGapTelemetrySnapshot['topLabels'];
    snapshotPath: string;
  };
  correlation: ReturnType<typeof correlateTelemetry>;
  soaks: SmokeSoakResult[];
  liveTable?: {
    ok: boolean;
    error?: string;
    baseUrl: string;
    soaks: SmokeSoakResult[];
  };
  summary: ReturnType<typeof summarizeSoaks>;
  reportPath: string;
};

export function lookupCard(name: string): SoakCardRecord | undefined {
  const direct = lookupLocalCardByNameSync(name);
  if (direct?.oracle_text) {
    return {
      name: String(direct.name || name),
      type_line: direct.type_line,
      oracle_text: direct.oracle_text,
      mana_cost: (direct as any).mana_cost,
      colors: (direct as any).colors,
    };
  }
  const folded = name.normalize('NFD').replace(/\p{M}/gu, '');
  if (folded !== name) {
    const fallback = lookupLocalCardByNameSync(folded);
    if (fallback?.oracle_text) {
      return {
        name: String(fallback.name || name),
        type_line: fallback.type_line,
        oracle_text: fallback.oracle_text,
        mana_cost: (fallback as any).mana_cost,
        colors: (fallback as any).colors,
      };
    }
  }
  return undefined;
}

export function collectFor(name: string, oracleText: string): CollectedIr {
  const ir = parseOracleTextToIR(oracleText, name);
  const spellSteps = collectSpellResolutionEffectStepsWithOverlay(oracleText, name);
  const allSteps = collectOracleEffectStepsWithOverlay(oracleText, name);
  return {
    ir,
    spellSteps,
    allSteps,
    abilityTypes: (ir.abilities || []).map((ability) => String(ability.type || '')),
  };
}

export function makeGame(gameId: string, playerCount = 2) {
  ResolutionQueueManager.removeQueue(gameId);
  const game = createInitialGameState(gameId);
  (game as any).gameId = gameId;
  const players: PlayerID[] = [];
  for (let i = 1; i <= playerCount; i += 1) {
    const id = `p${i}` as PlayerID;
    game.applyEvent!({ type: 'join', playerId: id, name: `P${i}` } as any);
    players.push(id);
  }
  const p1 = players[0];
  Object.assign(game.state as any, {
    activePlayer: p1,
    turnPlayer: p1,
    priority: p1,
    phase: GamePhase.PRECOMBAT_MAIN,
  });
  (game.state as any).zones = (game.state as any).zones || {};
  const libraries = new Map<PlayerID, any[]>();
  for (const pid of players) {
    const lib = Array.from({ length: 8 }, (_, index) => ({
      id: `${pid}-lib-${index}`,
      name: `Library ${index}`,
      type_line: 'Instant',
      zone: 'library',
    }));
    const player = (game.state as any).players.find((entry: any) => entry.id === pid);
    player.library = lib.map((card) => ({ ...card }));
    player.hand = [];
    player.graveyard = player.graveyard || [];
    player.exile = player.exile || [];
    (game.state as any).zones[pid] = {
      hand: [],
      handCount: 0,
      library: lib.map((card) => ({ ...card })),
      libraryCount: lib.length,
      graveyard: [],
      graveyardCount: 0,
    };
    libraries.set(pid, lib.map((card) => ({ ...card })));
  }
  (game as any).libraries = libraries;
  return { game, p1, players };
}

export function applySteps(game: any, name: string, steps: readonly any[], extra?: Record<string, unknown>) {
  const irCtx = buildOracleIRExecutionContext({
    controllerId: 'p1' as PlayerID,
    sourceId: `${slug(name)}-src`,
    sourceName: name,
    sourceObjectType: 'spell',
  });
  return applyOracleIRStepsOnServer(
    game,
    game.state,
    steps as any,
    irCtx,
    { allowOptional: true, haltOnPlayerChoiceRequired: true, ...(extra || {}) },
    { controller: 'p1' as PlayerID, sourceName: name, sourceId: `${slug(name)}-src` },
  );
}

export function startEp(game: any, name: string, steps: readonly any[]) {
  const irCtx = buildOracleIRExecutionContext({
    controllerId: 'p1' as PlayerID,
    sourceId: `${slug(name)}-src`,
    sourceName: name,
    sourceObjectType: 'spell',
  });
  return startOracleEffectProgramOnServer(game, {
    controller: 'p1' as PlayerID,
    sourceName: name,
    sourceId: `${slug(name)}-src`,
    steps: steps as any,
    irCtx,
    executionOptions: { allowOptional: true },
    programIdPrefix: `spell:${slug(name)}`,
    metadata: { family: 'spell_resolution' },
  });
}

export function queueTypes(gameId: string): string[] {
  return ResolutionQueueManager.getQueue(gameId).steps.map((step) => String(step.type));
}

export function telemetryDelta(beforeCount: number): OracleIrGapTelemetryEvent[] {
  const snap = getOracleIrGapTelemetrySnapshot();
  const added = Math.max(0, snap.totalEvents - beforeCount);
  if (added === 0) return [];
  return snap.recentEvents.slice(-added);
}

function baseCardResult(name: string, card: SoakCardRecord | undefined, collected?: CollectedIr): SmokeCardResult {
  return {
    name,
    found: Boolean(card),
    typeLine: card?.type_line,
    oraclePreview: String(card?.oracle_text || '').slice(0, 180),
    abilityTypes: collected?.abilityTypes || [],
    spellStepKinds: kindsOf(collected?.spellSteps),
    allStepKinds: kindsOf(collected?.allSteps),
    checks: [],
    telemetryEvents: [],
    pass: false,
  };
}

export function soakCard(
  name: string,
  run: (card: SoakCardRecord, collected: CollectedIr, result: SmokeCardResult) => void,
): SmokeCardResult {
  const before = getOracleIrGapTelemetrySnapshot().totalEvents;
  const card = lookupCard(name);
  if (!card?.oracle_text) {
    const result = baseCardResult(name, card);
    result.checks.push(check('lookup', 'local oracle record', card ? 'missing oracle_text' : 'not found', false));
    result.telemetryEvents = telemetryDelta(before);
    return finishCard(result);
  }
  const collected = collectFor(card.name || name, card.oracle_text);
  const result = baseCardResult(name, card, collected);
  try {
    run(card, collected, result);
  } catch (error) {
    result.checks.push(check('run', 'no throw', String(error instanceof Error ? error.message : error), false));
  }
  result.telemetryEvents = telemetryDelta(before);
  result.checks.push(
    check(
      'telemetry_clean',
      '0 gap/legacy events for this card',
      result.telemetryEvents.map((event) => `${event.kind}:${event.label}`),
      result.telemetryEvents.length === 0,
      'IR-primary soak should not emit all_or_nothing_failure, owned_but_unhandled, or legacy_handled',
    ),
  );
  return finishCard(result);
}

export async function fetchLiveTelemetry(url: string): Promise<LiveTelemetryFetch> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return { ok: false, url, error: `${response.status} ${response.statusText}` };
    }
    const snapshot = (await response.json()) as OracleIrGapTelemetrySnapshot;
    return { ok: true, url, snapshot };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

export function correlateTelemetry(
  soaks: readonly SmokeSoakResult[],
  soakTelemetry: OracleIrGapTelemetrySnapshot,
  live?: OracleIrGapTelemetrySnapshot,
) {
  const soakNames = new Set(soaks.flatMap((soak) => soak.cards.map((card) => card.name.toLowerCase())));
  const matchEvents = (events: readonly OracleIrGapTelemetryEvent[] | undefined) =>
    (events || []).filter((event) => {
      const label = String(event.label || '').toLowerCase();
      return [...soakNames].some((name) => label.includes(name) || name.includes(label));
    });

  return {
    soakProcess: {
      totalEvents: soakTelemetry.totalEvents,
      byKind: soakTelemetry.byKind,
      byScopeKind: soakTelemetry.byScopeKind,
      topLabels: soakTelemetry.topLabels,
      matchingListedCards: matchEvents(soakTelemetry.recentEvents),
    },
    liveServer: live
      ? {
          totalEvents: live.totalEvents,
          byKind: live.byKind,
          topLabels: live.topLabels,
          matchingListedCards: matchEvents(live.recentEvents),
        }
      : null,
  };
}

export function printSmokeSummary(
  title: string,
  soaks: readonly SmokeSoakResult[],
  liveBefore: LiveTelemetryFetch,
  liveAfter: LiveTelemetryFetch,
  reportPath: string,
  skipFooter = false,
): void {
  const summary = summarizeSoaks(soaks);
  console.log(`\n=== ${title} ===`);
  console.log(`Cards ${summary.cardsPassed}/${summary.cardsTotal}  checks ${summary.checksPassed}/${summary.checksPassed + summary.checksFailed}`);
  console.log(`Live telemetry ${liveBefore.ok ? 'reachable' : 'UNREACHABLE'} @ ${liveBefore.url}`);
  if (liveBefore.ok) {
    console.log(`  before: ${liveBefore.snapshot?.totalEvents ?? 0} events  after: ${liveAfter.snapshot?.totalEvents ?? 0} events`);
  } else {
    console.log(`  ${liveBefore.error}`);
  }

  for (const soak of soaks) {
    const mark = soak.pass ? 'PASS' : 'FAIL';
    console.log(`\n[${mark}] ${soak.session} / ${soak.title}  (${soak.cards.filter((card) => card.pass).length}/${soak.cards.length} cards, ${soak.failedChecks} failed checks)`);
    for (const card of soak.cards) {
      const cardMark = card.pass ? '  ok' : '  !!';
      const failed = card.checks.filter((entry) => !entry.pass).map((entry) => entry.id);
      const tel = card.telemetryEvents.length > 0 ? ` telemetry=${card.telemetryEvents.map((event) => event.kind).join(',')}` : '';
      console.log(`${cardMark} ${card.name}${card.found ? '' : ' (MISSING)'}${failed.length ? `  failed: ${failed.join(', ')}` : ''}${tel}`);
      if (!card.pass) {
        for (const entry of card.checks.filter((checkEntry: SmokeCheck) => !checkEntry.pass)) {
          console.log(`      ${entry.id}: expected ${JSON.stringify(entry.expected)} actual ${JSON.stringify(entry.actual)}`);
        }
      }
    }
  }

  if (!skipFooter) {
    if (summary.cardsPassed < summary.cardsTotal) {
      console.log(`\n${summary.cardsTotal - summary.cardsPassed} card(s) failed. Report: ${reportPath}`);
    } else {
      console.log(`\nAll listed cards passed. Report: ${reportPath}`);
    }
  }
}

function enableIrPrimary(): void {
  process.env.ORACLE_IR_SPELL_PRIMARY = '1';
  process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  process.env.ORACLE_IR_ACTIVATED_PRIMARY = '1';
  process.env.ORACLE_IR_GAP_TELEMETRY_LOG = process.env.ORACLE_IR_GAP_TELEMETRY_LOG || '0';
}

export async function runSmokeSuite(suite: SoakSuite, options: SmokeRunOptions = {}): Promise<SmokeReport> {
  enableIrPrimary();
  const outDir = options.outDir || DEFAULT_SMOKE_OUT_DIR;
  const reportPath = path.join(outDir, options.reportName || `${suite.id}-soak-report.json`);
  const snapshotPath = path.join(outDir, options.snapshotName || `${suite.id}-soak-telemetry.json`);
  const url = options.url || `http://127.0.0.1:${process.env.PORT || 3001}/api/oracle-ir/telemetry`;

  process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT = snapshotPath;
  fs.mkdirSync(outDir, { recursive: true });
  try {
    fs.rmSync(`${snapshotPath}.jsonl`, { force: true });
  } catch {
    // ignore
  }

  resetOracleIrGapTelemetry();
  const liveBefore = await fetchLiveTelemetry(url);
  const soaks = await suite.run();
  const soakTelemetry = getOracleIrGapTelemetrySnapshot();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(soakTelemetry, null, 2)}\n`, 'utf8');
  const summary = summarizeSoaks(soaks);
  printSmokeSummary(suite.title, soaks, liveBefore, liveBefore, reportPath, true);

  let liveTable: SmokeReport['liveTable'];
  if (options.live) {
    const { runLiveTableSoaks, printLiveTableSummary } = await import('./oracleIrLiveSmoke.js');
    liveTable = await runLiveTableSoaks(suite, soaks, { url });
    printLiveTableSummary(liveTable);
  }

  const liveAfter = await fetchLiveTelemetry(url);
  const correlation = correlateTelemetry(soaks, soakTelemetry, liveAfter.snapshot);
  if (options.live && liveAfter.ok) {
    console.log(`Live telemetry after table: ${liveAfter.snapshot?.totalEvents ?? 0} events (before ${liveBefore.snapshot?.totalEvents ?? 0})`);
  }

  const report: SmokeReport = {
    generatedAt: new Date().toISOString(),
    suite: { id: suite.id, title: suite.title, description: suite.description },
    liveServer: {
      url,
      reachable: liveBefore.ok,
      error: liveBefore.error,
      before: liveBefore.snapshot
        ? { totalEvents: liveBefore.snapshot.totalEvents, byKind: liveBefore.snapshot.byKind, topLabels: liveBefore.snapshot.topLabels }
        : null,
      after: liveAfter.snapshot
        ? { totalEvents: liveAfter.snapshot.totalEvents, byKind: liveAfter.snapshot.byKind, topLabels: liveAfter.snapshot.topLabels }
        : null,
      note: options.live
        ? 'Live table soak created a real game on this server (AI seats + imported decks + free-cast). Telemetry after should include any gaps from those casts.'
        : 'In-process soak uses the same IR modules as the live server but does not inject into the live process. Live totals stay unchanged unless a table is played on that process.',
    },
    soakTelemetry: {
      totalEvents: soakTelemetry.totalEvents,
      byKind: soakTelemetry.byKind,
      byScopeKind: soakTelemetry.byScopeKind,
      topLabels: soakTelemetry.topLabels,
      snapshotPath,
    },
    correlation,
    soaks,
    liveTable,
    summary,
    reportPath,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const liveFailed = Boolean(liveTable && (!liveTable.ok || liveTable.soaks.some((soak) => !soak.pass)));
  if (summary.checksFailed > 0 || liveFailed) process.exitCode = 1;
  else if (options.live && !liveBefore.ok) process.exitCode = 1;
  else if (options.requireLiveTelemetry && !liveBefore.ok) process.exitCode = 1;
  if (summary.cardsPassed < summary.cardsTotal || liveFailed) {
    console.log(`\nFailed. Report: ${reportPath}`);
  } else {
    console.log(`\nAll listed cards passed. Report: ${reportPath}`);
  }
  return report;
}
