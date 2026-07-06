import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function readModule(relativePath: string): string {
  return readFileSync(join(serverRoot, relativePath), 'utf8');
}

function collectTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function isSpellOracleIrTestPath(testPath: string): boolean {
  const normalized = testPath.replace(/\\/g, '/');
  return /oracle-ir-spell|oracle-ir-modal-spell/.test(normalized);
}

const stackSource = readModule('src/state/modules/stack.ts');
const oracleIrSpellLegacyRoutingSource = readModule('src/state/modules/oracleIrSpellLegacyRouting.ts');
const stackResolveInstantSorceryLegacyBodyUtilsSource = readModule(
  'src/state/modules/stackResolveInstantSorceryLegacyBodyUtils.ts',
);
const stackResolveInstantSorceryLegacyResolutionUtilsSource = readModule(
  'src/state/modules/stackResolveInstantSorceryLegacyResolutionUtils.ts',
);
const stackResolveSpellLegacyRegexDrawUtilsSource = readModule(
  'src/state/modules/stackResolveSpellLegacyRegexDrawUtils.ts',
);
const stackResolveSpellLegacySpecUtilsSource = readModule(
  'src/state/modules/stackResolveSpellLegacySpecUtils.ts',
);
const stackResolveSpellPostCategorizeRidersUtilsSource = readModule(
  'src/state/modules/stackResolveSpellPostCategorizeRidersUtils.ts',
);
const spellLegacyDispatchUtilsSource = readModule('src/state/modules/oracleIrSpellLegacyDispatchUtils.ts');
const stateIndexSource = readModule('src/state/index.ts');

describe('oracleIrSpellLegacyGuardrail', () => {
  it('exports spell legacy routing helpers from stack barrel', () => {
    expect(oracleIrSpellLegacyRoutingSource.includes('export function skipRetiredSpellLegacyHandler')).toBe(true);
    expect(oracleIrSpellLegacyRoutingSource.includes('export function shouldSkipLegacySpellBodyHandlers')).toBe(true);
    expect(stackSource.includes("from './oracleIrSpellLegacyRouting.js'")).toBe(true);
    expect(stackSource.includes('skipRetiredSpellLegacyHandler')).toBe(true);
    expect(stackSource.includes('shouldSkipLegacySpellBodyHandlers')).toBe(true);
    expect(stackSource.includes('isSpellEffectOwnedByOracleIrPrimary')).toBe(true);
  });

  it('routes instant/sorcery legacy resolution through body bypass orchestration', () => {
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('tryApplyInstantSorceryLegacyBodyHandlers')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('shouldSkipLegacySpellBodyHandlers')).toBe(true);
    expect(stackResolveInstantSorceryLegacyResolutionUtilsSource.includes('applyInstantSorceryCopyStackSpellRiders(ctx')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('logLegacySpellRegexPrimaryMiss')).toBe(true);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('applyLegacySpellRegexDrawHandlers(ctx')).toBe(false);
    expect(stackResolveInstantSorceryLegacyBodyUtilsSource.includes('resolveSkipLegacySpellRegexHandlers')).toBe(false);
  });

  it('keeps defense-in-depth skip guards on spell legacy handler modules', () => {
    expect(stackResolveSpellLegacyRegexDrawUtilsSource.includes('shouldSkipLegacySpellRegexHandlers')).toBe(true);
    expect(stackResolveSpellLegacySpecUtilsSource.includes('skipRetiredSpellLegacyHandler')).toBe(true);
    expect(stackResolveSpellPostCategorizeRidersUtilsSource.includes('skipRetiredSpellLegacyHandler')).toBe(true);
    expect(spellLegacyDispatchUtilsSource.includes('skipRetiredSpellLegacyHandler')).toBe(true);
  });

  it('keeps production game state wired through stack orchestrators instead of stack barrel', () => {
    expect(stateIndexSource.includes('from "./modules/stack.js"')).toBe(false);
    expect(stateIndexSource.includes('from "./modules/stackResolveTopOfStackUtils.js"')).toBe(true);
    expect(stateIndexSource.includes('from "./modules/stackPushUtils.js"')).toBe(true);
    expect(stateIndexSource.includes('from "./modules/stackPlayLandUtils.js"')).toBe(true);
  });

  it('keeps spell oracle-ir tests decoupled from stack barrel imports', () => {
    const stackBarrelImportPattern = /from\s+(['"])([^'"]*\/stack(?:\.js)?)\1\s*;/;
    for (const testPath of collectTestFiles(join(serverRoot, 'tests'))) {
      if (testPath.endsWith('oracle-ir-spell-legacy-guardrail.test.ts')) continue;
      if (!isSpellOracleIrTestPath(testPath)) continue;
      const testSource = readFileSync(testPath, 'utf8');
      expect(stackBarrelImportPattern.test(testSource)).toBe(false);
    }
  });
});
