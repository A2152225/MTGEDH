import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  deleteCompiledOracleIROverlaySync,
  lookupCompiledOracleIROverlaySync,
  resetCompiledOracleIROverlayTableForTests,
} from '../src/services/oracleIrCompiledOverlayStore.js';
import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import {
  inferOverlayNameFromFilename,
  isOverlayExampleFile,
  normalizeOverlayImportRecord,
  validateCompilerEnvelope,
} from '../scripts/oracleIrOverlayImportUtils.js';

describe('oracle ir overlay import utils', () => {
  let tempDir = '';

  beforeEach(() => {
    resetLocalCardLookupForTests();
    resetCompiledOracleIROverlayTableForTests();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-import-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes wrapped and bare overlay records', () => {
    const wrapped = normalizeOverlayImportRecord({
      card_id: 'wrapped-id',
      name: 'Wrapped Card',
      envelope: {
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          steps: [{ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw: 'Draw a card.' }],
        }],
      },
    }, 'wrapped.json');

    expect(wrapped.cardId).toBe('wrapped-id');
    expect(wrapped.name).toBe('Wrapped Card');
    expect(wrapped.envelope.abilities?.[0]?.steps?.[0]?.kind).toBe('draw');
  });

  it('skips example overlay filenames during bulk import listing', () => {
    expect(isOverlayExampleFile('gribblestorm.example.json')).toBe(true);
    expect(isOverlayExampleFile('real-card.json')).toBe(false);
  });

  it('imports overlay files from a directory', () => {
    const filePath = path.join(tempDir, 'bulk-test-card.json');
    fs.writeFileSync(filePath, JSON.stringify({
      card_id: 'bulk-test-card-id',
      name: 'Bulk Test Card',
      envelope: {
        card_id: 'bulk-test-card-id',
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          effect_text: 'Draw a card.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          }],
        }],
      },
    }));

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const record = normalizeOverlayImportRecord(raw, path.basename(filePath));
    expect(validateCompilerEnvelope(record.envelope).ok).toBe(true);

    upsertCompiledOracleIROverlaySync({
      cardId: record.cardId,
      name: record.name || inferOverlayNameFromFilename(path.basename(filePath)),
      envelope: record.envelope,
    });

    expect(lookupCompiledOracleIROverlaySync({ cardId: 'bulk-test-card-id' })?.abilities?.[0]?.steps?.[0]?.kind)
      .toBe('draw');
    expect(deleteCompiledOracleIROverlaySync({ cardId: 'bulk-test-card-id' })).toBe(true);
  });
});
