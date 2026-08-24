#!/usr/bin/env node
/**
 * Helpers for running a large vitest suite as several short shards instead of one long run.
 *
 * A single full-suite run can take long enough that the agent shell connection drops before it
 * finishes, losing the whole result. Sharding keeps each command short and restartable: run
 * `vitest run --shard=i/N --reporter=json --outputFile=...` once per shard, then merge the shard
 * reports here and diff or summarise the merged file.
 *
 *   node tools/vitest-report.mjs merge <out.json> <shard.json...>
 *   node tools/vitest-report.mjs summary <report.json>
 *   node tools/vitest-report.mjs diff <baseline.json> <current.json>
 *
 * Shard reports may be produced in different working directories (for example a baseline git
 * worktree); test keys are normalised to a repo-relative path so those still diff cleanly.
 */
import fs from 'node:fs';

function readReport(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/** Repo-relative test file path, so reports from different checkouts compare equal. */
function normalizeSuiteName(name) {
  const unix = String(name || '').replace(/\\/g, '/');
  const match = unix.match(/\/((?:rules-engine|server|client|shared)\/(?:test|tests)\/.*)$/);
  if (match) return match[1];
  return unix.split('/').slice(-2).join('/');
}

function collectTests(report) {
  const tests = new Map();
  // `it.each` cases can share an identical fullName, so disambiguate repeats by occurrence index -
  // otherwise duplicates collapse and a regression in one of them is invisible to the diff.
  const occurrences = new Map();
  for (const suite of report.testResults || []) {
    const file = normalizeSuiteName(suite.name);
    for (const test of suite.assertionResults || []) {
      const base = `${file} :: ${test.fullName}`;
      const seen = occurrences.get(base) || 0;
      occurrences.set(base, seen + 1);
      tests.set(seen === 0 ? base : `${base} #${seen + 1}`, { file, test });
    }
  }
  return tests;
}

function merge(outPath, shardPaths) {
  const testResults = [];
  const seen = new Set();
  let duplicates = 0;

  for (const shardPath of shardPaths) {
    if (!fs.existsSync(shardPath)) {
      console.error(`missing shard report: ${shardPath}`);
      process.exitCode = 1;
      return;
    }
    for (const suite of readReport(shardPath).testResults || []) {
      const key = normalizeSuiteName(suite.name);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      testResults.push(suite);
    }
  }

  let passed = 0;
  let failed = 0;
  for (const suite of testResults) {
    for (const test of suite.assertionResults || []) {
      if (test.status === 'failed') failed += 1;
      else if (test.status === 'passed') passed += 1;
    }
  }

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        numTotalTestSuites: testResults.length,
        numPassedTests: passed,
        numFailedTests: failed,
        testResults,
      },
      null,
      0,
    ),
  );

  console.log(`merged ${shardPaths.length} shard(s) -> ${outPath}`);
  console.log(`files ${testResults.length}, passed ${passed}, failed ${failed}`);
  if (duplicates > 0) console.log(`skipped ${duplicates} duplicate file result(s)`);
}

function summary(reportPath) {
  const byFile = new Map();
  for (const [key, { file, test }] of collectTests(readReport(reportPath))) {
    if (test.status !== 'failed') continue;
    if (!byFile.has(file)) byFile.set(file, []);
    const message = String(test.failureMessages?.[0] || '').split('\n')[0].slice(0, 150);
    byFile.get(file).push(`${key.split(' :: ')[1].slice(0, 110)}  ||  ${message}`);
  }

  let total = 0;
  for (const [file, tests] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    total += tests.length;
    console.log(`\n=== ${file}  (${tests.length}) ===`);
    for (const entry of tests) console.log('  - ' + entry);
  }
  console.log(`\nTOTAL ${total}`);
}

function diff(baselinePath, currentPath) {
  const base = collectTests(readReport(baselinePath));
  const cur = collectTests(readReport(currentPath));

  const failedKeys = (tests) =>
    new Set([...tests].filter(([, { test }]) => test.status === 'failed').map(([key]) => key));

  const baseFailed = failedKeys(base);
  const curFailed = failedKeys(cur);
  const fixed = [...baseFailed].filter((key) => !curFailed.has(key));
  const regressed = [...curFailed].filter((key) => !baseFailed.has(key));
  const missing = [...base.keys()].filter((key) => !cur.has(key));

  console.log(`baseline failures: ${baseFailed.size} (of ${base.size})`);
  console.log(`current  failures: ${curFailed.size} (of ${cur.size})`);
  if (missing.length > 0) console.log(`NOT RUN in current: ${missing.length} (incomplete shard set?)`);

  console.log(`\nFIXED (${fixed.length}):`);
  for (const key of fixed) console.log('  + ' + key.slice(0, 150));
  console.log(`\nREGRESSED (${regressed.length}):`);
  for (const key of regressed) console.log('  - ' + key.slice(0, 150));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'merge' && args.length >= 2) merge(args[0], args.slice(1));
else if (command === 'summary' && args.length === 1) summary(args[0]);
else if (command === 'diff' && args.length === 2) diff(args[0], args[1]);
else {
  console.error('usage:');
  console.error('  node tools/vitest-report.mjs merge <out.json> <shard.json...>');
  console.error('  node tools/vitest-report.mjs summary <report.json>');
  console.error('  node tools/vitest-report.mjs diff <baseline.json> <current.json>');
  process.exitCode = 1;
}
