/**
 * Phase 4 legacy-retirement ratchet (see docs/oracle-ir-track-e-remaining-work.md §D3).
 *
 * The dual execution path (IR primary + legacy regex handlers) is the main
 * correctness risk for the all-or-nothing and undo/replay invariants: a routing
 * bug can double-apply or silently skip an effect. This test makes the legacy
 * surface area mechanically shrink-only:
 *
 *  - FAILS if the count of legacy handler exports RISES (no new legacy handlers —
 *    extend the IR parser/executor/queue wiring instead).
 *  - FAILS if the count drops more than RATCHET_SLACK below the ceiling without
 *    the ceiling being lowered (keeps the ceiling honest after deletions).
 *
 * When you delete legacy handlers, lower the ceilings below to the new counts.
 * Retirement triage data: GET /api/oracle-ir/telemetry → `legacy_handled` events
 * show which effect texts still execute via legacy in production.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulesDir = path.join(__dirname, '..', 'src', 'state', 'modules');

// Lower these when legacy handlers are deleted. NEVER raise them.
const TRIGGER_LEGACY_EXPORT_CEILING = 43; // 2026-07-03 — batch 506: TypedCountTokenFallbacks, AgentOfShadowThieves; rebound/paradigm moved to stackSpecialTriggerHandlers
const SPELL_LEGACY_EXPORT_CEILING = 1; // applyLegacySpellRegexDrawHandlers
const RATCHET_SLACK = 5;

function countExports(pattern: RegExp): { count: number; names: string[] } {
  const names: string[] = [];
  const files = fs.readdirSync(modulesDir).filter((file) => file.endsWith('.ts'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(modulesDir, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      names.push(match[1]);
    }
  }
  return { count: names.length, names };
}

describe('oracle IR legacy handler ratchet', () => {
  it('trigger legacy handler exports never increase', () => {
    const { count, names } = countExports(/export function (applyRetiredTriggerLegacy\w+)/g);

    expect(
      count,
      `Legacy trigger handler exports rose above the ratchet ceiling (${count} > ${TRIGGER_LEGACY_EXPORT_CEILING}). ` +
        'Do not add new applyRetiredTriggerLegacy* handlers — extend Oracle IR parser/executor/queue wiring instead ' +
        '(.cursor/rules/oracle-ir-no-bespoke-handlers.mdc). ' +
        `Current exports:\n${names.sort().join('\n')}`,
    ).toBeLessThanOrEqual(TRIGGER_LEGACY_EXPORT_CEILING);

    expect(
      TRIGGER_LEGACY_EXPORT_CEILING - count,
      `Legacy trigger handler count (${count}) is more than ${RATCHET_SLACK} below the ceiling ` +
        `(${TRIGGER_LEGACY_EXPORT_CEILING}). Lower TRIGGER_LEGACY_EXPORT_CEILING to ${count} in this test ` +
        'so the ratchet stays tight.',
    ).toBeLessThanOrEqual(RATCHET_SLACK);
  });

  it('spell legacy regex handler exports never increase', () => {
    const { count, names } = countExports(
      /export function ((?:applyRetiredSpellLegacy|applyLegacySpellRegex)\w+)/g,
    );

    expect(
      count,
      `Legacy spell handler exports rose above the ratchet ceiling (${count} > ${SPELL_LEGACY_EXPORT_CEILING}). ` +
        `Current exports:\n${names.sort().join('\n')}`,
    ).toBeLessThanOrEqual(SPELL_LEGACY_EXPORT_CEILING);
  });
});
