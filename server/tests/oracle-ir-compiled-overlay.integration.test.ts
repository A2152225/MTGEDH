import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  collectOracleEffectSteps,
} from '../src/state/modules/trigger-runtime-wiring.js';
import {
  deleteCompiledOracleIROverlaySync,
  lookupCompiledOracleIROverlaySync,
  upsertCompiledOracleIROverlaySync,
} from '../src/services/oracleIrCompiledOverlayStore.js';
import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { resetCompiledOracleIROverlayTableForTests } from '../src/services/oracleIrCompiledOverlayStore.js';
import { extractOracleCardLookupKeys } from '../src/state/modules/oracleIrCompiledOverlayLookup.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import {
  normalizeOverlayImportRecord,
  validateCompilerEnvelope,
} from '../scripts/oracleIrOverlayImportUtils.js';

const TEST_CARD_NAME = 'Overlay Test Gribble';
const TEST_CARD_ID = 'overlay-test-gribble';

describe('oracle ir compiled overlay integration', () => {
  beforeEach(() => {
    resetLocalCardLookupForTests();
    resetCompiledOracleIROverlayTableForTests();
  });

  it('stores and loads overlay envelopes by card name and id', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: TEST_CARD_ID,
      name: TEST_CARD_NAME,
      envelope: {
        card_id: TEST_CARD_ID,
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          effect_text: 'Draw two cards.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 2 },
            raw: 'Draw two cards.',
          }],
        }],
      },
    });

    expect(lookupCompiledOracleIROverlaySync({ name: TEST_CARD_NAME })?.abilities?.[0]?.steps?.[0]?.kind)
      .toBe('draw');
    expect(lookupCompiledOracleIROverlaySync({ cardId: TEST_CARD_ID })?.abilities?.[0]?.steps?.[0]?.kind)
      .toBe('draw');
    expect(deleteCompiledOracleIROverlaySync({ cardId: TEST_CARD_ID })).toBe(true);
    expect(lookupCompiledOracleIROverlaySync({ cardId: TEST_CARD_ID })).toBeNull();
  });

  it('collectOracleEffectSteps uses stored overlay when parser yields unknown', () => {
    const oracleText = 'Zorplexify the gibberwump.';
    const parsed = parseOracleTextToIR(oracleText, TEST_CARD_NAME);
    expect(parsed.abilities.some((ability) => ability.steps.some((step) => step.kind === 'unknown'))).toBe(true);

    upsertCompiledOracleIROverlaySync({
      cardId: TEST_CARD_ID,
      name: TEST_CARD_NAME,
      envelope: {
        card_id: TEST_CARD_ID,
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          effect_text: 'Draw three cards.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 3 },
            raw: 'Draw three cards.',
          }],
        }],
      },
    });

    const steps = collectOracleEffectSteps(oracleText, TEST_CARD_NAME, {
      cardId: TEST_CARD_ID,
      cardName: TEST_CARD_NAME,
    });
    expect(steps.map((step) => step.kind)).toEqual(['draw']);
  });

  it('extracts oracle card ids from stack spell card objects', () => {
    const keys = extractOracleCardLookupKeys({
      sourceName: 'Lightning Bolt',
      card: { oracle_id: 'abc-oracle-id', name: 'Lightning Bolt' },
      effectiveCard: { oracle_id: 'abc-oracle-id', name: 'Lightning Bolt' },
      sourceItem: {
        id: 'stack-item-1',
        card: { oracle_id: 'abc-oracle-id', name: 'Lightning Bolt' },
      },
    });

    expect(keys).toEqual({
      cardId: 'abc-oracle-id',
      cardName: 'Lightning Bolt',
    });
  });

  it('does not treat stack item ids as oracle card ids', () => {
    const keys = extractOracleCardLookupKeys({
      sourceName: 'Mystery Spell',
      sourceItem: { id: 'stack-item-1', card: { name: 'Mystery Spell' } },
    });

    expect(keys.cardId).toBeUndefined();
    expect(keys.cardName).toBe('Mystery Spell');
  });

  it('imports declarative STATIC and REPLACEMENT example overlays end-to-end', () => {
    const overlayDir = path.join(process.cwd(), 'data', 'compiled-oracle-ir-overlays');
    const anthemRecord = normalizeOverlayImportRecord(
      JSON.parse(fs.readFileSync(path.join(overlayDir, 'anthem-static.example.json'), 'utf8')),
      'anthem-static.example.json',
    );
    const millRecord = normalizeOverlayImportRecord(
      JSON.parse(fs.readFileSync(path.join(overlayDir, 'mill-replacement.example.json'), 'utf8')),
      'mill-replacement.example.json',
    );

    expect(validateCompilerEnvelope(anthemRecord.envelope).ok).toBe(true);
    expect(validateCompilerEnvelope(millRecord.envelope).ok).toBe(true);

    upsertCompiledOracleIROverlaySync({
      cardId: anthemRecord.cardId!,
      name: anthemRecord.name!,
      envelope: anthemRecord.envelope,
    });
    upsertCompiledOracleIROverlaySync({
      cardId: millRecord.cardId!,
      name: millRecord.name!,
      envelope: millRecord.envelope,
    });

    const staticSpecs = collectStaticEffectSpecsFromState({
      battlefield: [{
        id: 'custom_anthem_perm',
        controller: 'p1',
        card: { id: anthemRecord.cardId, name: anthemRecord.name, oracle_text: '' },
      }],
    });
    expect(staticSpecs).toHaveLength(1);
    expect(staticSpecs[0]).toMatchObject({
      scope: { kind: 'creatures_you_control' },
      grant: { power: 1, toughness: 1 },
    });

    const replacementSpecs = collectReplacementEffectSpecsFromState({
      battlefield: [{
        id: 'custom_mill_perm',
        controller: 'p1',
        card: { id: millRecord.cardId, name: millRecord.name, oracle_text: '' },
      }],
    });
    expect(replacementSpecs).toHaveLength(1);
    expect(replacementSpecs[0]).toMatchObject({
      event: 'mill',
      instead: { modify: 'double' },
    });
  });
});
