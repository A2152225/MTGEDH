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

function isTriggerOracleIrTestPath(testPath: string): boolean {
  const normalized = testPath.replace(/\\/g, '/');
  return /oracle-ir-trigger/.test(normalized);
}

const stackSource = readModule('src/state/modules/stack.ts');
const oracleIrTriggerLegacyRoutingSource = readModule('src/state/modules/oracleIrTriggerLegacyRouting.ts');
const stackExecuteTriggerEffectLegacyBodyUtilsSource = readModule(
  'src/state/modules/stackExecuteTriggerEffectLegacyBodyUtils.ts',
);
const stackExecuteTriggerEffectUtilsSource = readModule(
  'src/state/modules/stackExecuteTriggerEffectUtils.ts',
);
const oracleIrTriggerLegacyRegexHandlersSource = readModule(
  'src/state/modules/oracleIrTriggerLegacyRegexHandlers.ts',
);

describe('oracleIrTriggerScopedGuardrail', () => {
  it('exports trigger legacy routing helpers from stack barrel', () => {
    expect(oracleIrTriggerLegacyRoutingSource.includes('export function skipRetiredTriggerLegacyHandler')).toBe(true);
    expect(oracleIrTriggerLegacyRoutingSource.includes('export function shouldSkipLegacyTriggerBodyHandlers')).toBe(true);
    expect(stackSource.includes("from './oracleIrTriggerLegacyRouting.js'")).toBe(true);
    expect(stackSource.includes('skipRetiredTriggerLegacyHandler')).toBe(true);
    expect(stackSource.includes('shouldSkipLegacyTriggerBodyHandlers')).toBe(true);
    expect(stackSource.includes('isTriggerEffectOwnedByOracleIrPrimary')).toBe(true);
  });

  it('routes trigger execution through keyword-first orchestration', () => {
    expect(stackExecuteTriggerEffectUtilsSource.includes('tryApplyTriggerEffectLegacyBodyHandlers')).toBe(true);
    expect(stackExecuteTriggerEffectUtilsSource.includes('applyKeywordTriggerFallbackFromOracle')).toBe(true);
  });

  it('keeps skipRetiredTriggerLegacyHandler exported for handler modules', () => {
    expect(oracleIrTriggerLegacyRegexHandlersSource.includes('skipRetiredTriggerLegacyHandler')).toBe(true);
  });

  it('keeps trigger oracle-ir tests decoupled from stack barrel imports', () => {
    const stackBarrelImportPattern = /from\s+(['"])([^'"]*\/stack(?:\.js)?)\1\s*;/;
    for (const testPath of collectTestFiles(join(serverRoot, 'tests'))) {
      if (testPath.endsWith('oracle-ir-trigger-scoped-guardrail.test.ts')) continue;
      if (!isTriggerOracleIrTestPath(testPath)) continue;
      const testSource = readFileSync(testPath, 'utf8');
      expect(stackBarrelImportPattern.test(testSource)).toBe(false);
    }
  });
});
