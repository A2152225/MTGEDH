/**
 * Audit: persisted event types vs applyEvent handlers, Oracle IR replay mutations,
 * and replay projection blind spots.
 *
 * Run: npx tsx scripts/mutation-replay-audit.ts
 * Output: scripts/out/mutation-replay-audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const OUT_DIR = path.join(SCRIPT_DIR, 'out');
const OUT_PATH = path.join(OUT_DIR, 'mutation-replay-audit.json');

const SERVER_SRC = path.join(SERVER_DIR, 'src');
const RULES_ENGINE_SRC = path.join(REPO_ROOT, 'rules-engine', 'src');

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkTsFiles(full, acc);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      acc.push(full);
    }
  }
  return acc;
}

function extractPersistedEventTypes(files: string[]): Map<string, string[]> {
  const types = new Map<string, string[]>();
  const patterns = [
    /appendEvent\s*\(\s*[^,]+,\s*[^,]+,\s*['"]([A-Za-z0-9_]+)['"]/g,
    /appendGameEvent\s*\(\s*[^,]+,\s*['"]([A-Za-z0-9_]+)['"]/g,
  ];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const type = m[1];
        const list = types.get(type) || [];
        if (!list.includes(rel)) list.push(rel);
        types.set(type, list);
      }
    }
  }
  return types;
}

function extractApplyEventHandlers(applyEventPath: string): Set<string> {
  const text = fs.readFileSync(applyEventPath, 'utf8');
  const handlers = new Set<string>();
  const re = /case\s+["']([A-Za-z0-9_]+)["']\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) handlers.add(m[1]);
  return handlers;
}

function extractOracleIrStepKinds(oracleIrPath: string): string[] {
  const text = fs.readFileSync(oracleIrPath, 'utf8');
  const kinds = new Set<string>();
  const re = /readonly kind:\s*['"]([a-z0-9_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) kinds.add(m[1]);
  return [...kinds].sort();
}

function extractReplayMutationKinds(replayMutationsPath: string): Set<string> {
  const text = fs.readFileSync(replayMutationsPath, 'utf8');
  const kinds = new Set<string>();
  const re = /kind:\s*['"]([a-z0-9_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) kinds.add(m[1]);
  return kinds;
}

function extractCollectReplaySwitchKinds(replayMutationsPath: string): Set<string> {
  const text = fs.readFileSync(replayMutationsPath, 'utf8');
  const block = text.match(/function collectReplayMutationsFromAppliedStep[\s\S]*?^}/m)?.[0] || '';
  const kinds = new Set<string>();
  const re = /case\s+['"]([a-z0-9_]+)['"]\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) kinds.add(m[1]);
  return kinds;
}

function extractResolutionStepTypes(typesPath: string): string[] {
  const text = fs.readFileSync(typesPath, 'utf8');
  const types: string[] = [];
  const enumBlock = text.match(/export enum ResolutionStepType\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const re = /^\s*([A-Z0-9_]+)\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(enumBlock))) types.push(m[1]);
  return types;
}

function findReplayTests(testDir: string): string[] {
  return walkTsFiles(testDir).filter((f) => /\.replay/i.test(path.basename(f)));
}

function main(): void {
  const serverFiles = walkTsFiles(SERVER_SRC);
  const persisted = extractPersistedEventTypes(serverFiles);
  const handlers = extractApplyEventHandlers(path.join(SERVER_SRC, 'state', 'modules', 'applyEvent.ts'));

  const persistedTypes = [...persisted.keys()].sort();
  const missingHandlers = persistedTypes.filter((t) => !handlers.has(t));
  const handlerOnly = [...handlers].filter((t) => !persisted.has(t)).sort();

  const oracleIrPath = path.join(RULES_ENGINE_SRC, 'oracleIR.ts');
  const replayMutationsPath = path.join(RULES_ENGINE_SRC, 'oracleIRReplayMutations.ts');
  const irStepKinds = extractOracleIrStepKinds(oracleIrPath);
  const replayMutationKinds = extractReplayMutationKinds(replayMutationsPath);
  const collectSwitchKinds = extractCollectReplaySwitchKinds(replayMutationsPath);

  const battlefieldMutationGaps = irStepKinds.filter((kind) => {
    const battlefieldLike = [
      'goad', 'detain', 'cant_attack', 'cant_block', 'force_block', 'cant_activate_abilities',
      'exert', 'tap', 'untap', 'modify_pt', 'modify_pt_where', 'add_ability', 'remove_ability',
      'phase_out', 'suspect', 'cloak', 'manifest', 'transform', 'counter', 'proliferate',
    ];
    return battlefieldLike.includes(kind) && !replayMutationKinds.has(kind) && !collectSwitchKinds.has(kind);
  });

  const resolutionStepTypes = extractResolutionStepTypes(
    path.join(SERVER_SRC, 'state', 'resolution', 'types.ts'),
  );
  const replayTests = findReplayTests(path.join(SERVER_DIR, 'tests'));

  const skipPersistenceHits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of serverFiles) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes('skipEventPersistence')) {
        skipPersistenceHits.push({ file: rel, line: idx + 1, text: line.trim() });
      }
    });
  }

  const projectionPath = path.join(SERVER_DIR, 'tests', 'helpers', 'replayDivergence.ts');
  const projectionText = fs.readFileSync(projectionPath, 'utf8');
  const projectionFields = {
    includesGoadedBy: projectionText.includes('goadedBy'),
    includesCounters: projectionText.includes('counters'),
    includesGrantedAbilities: projectionText.includes('grantedAbilities'),
    includesTemporaryPTMods: projectionText.includes('tempPowerBonus'),
    includesPhasedOut: projectionText.includes('phasedOut'),
    includesTemporaryEffects: projectionText.includes('temporaryEffects'),
    includesManaPool: projectionText.includes('manaPool'),
    includesResolutionQueue: projectionText.includes('resolution'),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      persistedEventTypeCount: persistedTypes.length,
      applyEventHandlerCount: handlers.size,
      persistedWithoutHandler: missingHandlers.length,
      handlerWithoutPersistCall: handlerOnly.length,
      oracleIrStepKindCount: irStepKinds.length,
      replayMutationKindCount: replayMutationKinds.size,
      battlefieldMutationGapCount: battlefieldMutationGaps.length,
      resolutionStepTypeCount: resolutionStepTypes.length,
      replayNamedTestFileCount: replayTests.length,
      skipEventPersistenceSiteCount: skipPersistenceHits.length,
    },
    persistedWithoutApplyEventHandler: missingHandlers.map((type) => ({
      type,
      persistedFrom: persisted.get(type),
    })),
    applyEventHandlerWithoutPersistedCalls: handlerOnly,
    oracleIrReplayMutationKinds: [...replayMutationKinds].sort(),
    oracleIrBattlefieldMutationGaps: battlefieldMutationGaps,
    skipEventPersistenceSites: skipPersistenceHits,
    skipEventPersistenceAudit: [
      {
        site: 'server/src/state/modules/applyEvent.ts (updateCounters/updateCountersBulk replay)',
        status: 'expected',
        note: 'Replay applies persisted counter events directly; live double-append avoided.',
      },
      {
        site: 'server/src/state/modules/oracleIrServerZoneSync.ts (counter replacement bonus)',
        status: 'compensated',
        note: 'Bonus counters skip inline persistence; persistCounterDiffsFromOracleIR captures net counter state after IR.',
      },
      {
        site: 'server/src/state/modules/stackResolveAbilityMidHandlersUtils.ts',
        status: 'compensated',
        note: 'Live +1 uses skipEventPersistence; counterTargetChosen event restores on replay.',
      },
      {
        site: 'server/src/state/modules/replay.ts',
        status: 'expected',
        note: 'Replay-only counter application must not re-append while rebuilding from log.',
      },
    ],
    replayProjectionBlindSpots: projectionFields,
    resolvedHighImpactGaps: [
      {
        id: 'generic-target-selection-not-persisted',
        fixedIn: [
          'server/src/socket/resolution.ts assignTriggeredAbilityTargets (generic + targetedTriggeredAbility)',
          'server/tests/vengeful-ancestor-goad.replay.integration.test.ts',
        ],
      },
      {
        id: 'oracle-ir-goad-no-replay-mutation',
        fixedIn: [
          'rules-engine/src/oracleIRReplayMutations.ts (goad kind)',
          'server/src/state/effects/effectProgramReplayMutationPersistence.ts (goadPermanent)',
          'server/src/state/modules/applyEvent.ts (goadPermanent handler)',
        ],
      },
      {
        id: 'replay-projection-omits-battlefield-metadata',
        fixedIn: [
          'server/tests/helpers/replayDivergence.ts (goadedBy, counters, temp P/T, isSuspected)',
          'server/src/state/effects/battlefieldPermanentReplayPersistence.ts',
        ],
      },
      {
        id: 'life-redistribution-resolve-handler',
        fixedIn: [
          'server/src/state/modules/applyEvent.ts (lifeRedistributionResolve)',
          'server/tests/life-redistribution.replay.test.ts',
          'server/tests/life-redistribution.socket.replay.integration.test.ts',
        ],
      },
      {
        id: 'undo-counts-are-event-rows',
        mitigatedIn: [
          'server/src/socket/undo.ts semanticStepCount/semanticPhaseCount (display-only collapse)',
          'server/tests/undo-semantic-counts.unit.test.ts',
        ],
      },
      {
        id: 'life-redistribution-prompt-not-persisted',
        fixedIn: [
          'server/src/state/modules/oracleIrServerZoneSync.ts (appendQueuedResolutionPromptEvent)',
          'server/tests/life-redistribution.socket.replay.integration.test.ts',
        ],
      },
      {
        id: 'keyword-prompt-resolve-clears-only',
        fixedIn: [
          'server/src/state/modules/keywordPromptReplayOutcomes.ts',
          'server/tests/keyword-prompt-resolve.replay.test.ts',
          'server/tests/keyword-riot-haste.socket.replay.integration.test.ts',
        ],
        note: 'Restores haste/tribute/devour/soulshift/extort life+mana/fabricate tokens/exploit sacrifice+reward triggers on replay; counter choices use updateCounters.',
      },
      {
        id: 'keyword-prompt-not-persisted',
        fixedIn: [
          'server/src/state/modules/triggerKeywordChoiceUtils.ts (appendQueuedResolutionPromptEvent)',
          'server/src/state/modules/triggerTributeChoiceUtils.ts (appendQueuedResolutionPromptEvent)',
          'server/tests/keyword-riot-haste.socket.replay.integration.test.ts',
        ],
      },
      {
        id: 'exploit-keyword-prompt-stack-scrub',
        fixedIn: [
          'server/src/state/modules/replay-prompt-cleanup.ts (preserve stack after exploit keywordPromptResolve)',
          'server/tests/exploit-keyword.socket.replay.integration.test.ts',
        ],
      },
      {
        id: 'proliferate-resolve-player-counters',
        fixedIn: [
          'server/src/state/modules/applyEvent.ts (proliferateResolve player counter replay)',
          'server/tests/proliferate-fateseal-clash.replay.test.ts',
        ],
      },
      {
        id: 'battlefield-ir-mutations-partial',
        mitigatedIn: [
          'server/src/state/effects/battlefieldPermanentReplayPersistence.ts (generic diff patch)',
          'server/tests/battlefield-ir-mutations.socket.replay.integration.test.ts (suspect, detain, phase_out)',
          'server/tests/battlefield-permanent-patch.replay.test.ts',
        ],
        note: 'Permanent counter deltas use updateCounters; proliferateResolve now mirrors live player-counter increments (tests/proliferate-fateseal-clash.replay.test.ts). Static goad recompute is runtime-derived from battlefield.',
      },
    ],
    knownHighImpactGaps: [
      {
        id: 'resolve-top-of-stack-replay-pop-only',
        severity: 'high',
        description:
          'During replay, resolveTopOfStack only pops the stack; IR/trigger outcomes must be in separate mutation/resolve events.',
        evidence: ['server/src/state/modules/applyEvent.ts case resolveTopOfStack isReplaying branch'],
      },
    ],
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote report: ${OUT_PATH}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
