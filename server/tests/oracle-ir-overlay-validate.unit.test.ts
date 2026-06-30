import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  normalizeOverlayImportRecord,
  validateCompilerEnvelope,
} from '../scripts/oracleIrOverlayImportUtils.js';

describe('oracle ir overlay validate utils', () => {
  it('accepts valid draw overlay envelopes', () => {
    const record = normalizeOverlayImportRecord({
      card_id: 'test-id',
      name: 'Test Card',
      envelope: {
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          }],
        }],
      },
    }, 'test.json');

    expect(validateCompilerEnvelope(record.envelope).ok).toBe(true);
  });

  it('rejects unknown step kinds', () => {
    const record = normalizeOverlayImportRecord({
      envelope: {
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          steps: [{ kind: 'unknown', raw: 'Novel effect.' }],
        }],
      },
    }, 'bad.json');

    const validation = validateCompilerEnvelope(record.envelope);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.join(' ')).toMatch(/unknown/);
    }
  });

  it('example overlay file normalizes for import', () => {
    const examplePath = path.join(
      process.cwd(),
      'data',
      'compiled-oracle-ir-overlays',
      'gribblestorm.example.json',
    );
    expect(fs.existsSync(examplePath)).toBe(true);
    const record = normalizeOverlayImportRecord(
      JSON.parse(fs.readFileSync(examplePath, 'utf8')),
      'gribblestorm.example.json',
    );
    expect(validateCompilerEnvelope(record.envelope).ok).toBe(true);
    expect(record.name).toBe('Gribblestorm');
  });
});
