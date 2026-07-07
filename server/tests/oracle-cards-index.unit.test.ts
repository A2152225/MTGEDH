import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseOracleCardsContent,
  readOracleCardsSync,
  resolveOracleCardsPath,
} from '../src/services/oracleCardsIndex.js';

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.CARD_LOOKUP_ORACLE_FILE;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('oracleCardsIndex', () => {
  it('prefers oracle-cards.jsonl over legacy json when both exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-index-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'oracle-cards.json'), JSON.stringify([{ name: 'Legacy Bolt' }]));
    fs.writeFileSync(
      path.join(dir, 'oracle-cards.jsonl'),
      '{"name":"JSONL Bolt"}\n',
      'utf8',
    );

    expect(resolveOracleCardsPath(dir)).toBe(path.join(dir, 'oracle-cards.jsonl'));
    const cards = readOracleCardsSync(dir) as Array<{ name?: string }>;
    expect(cards).toHaveLength(1);
    expect(cards[0]?.name).toBe('JSONL Bolt');
  });

  it('parses legacy JSON array dumps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-index-'));
    tempDirs.push(dir);
    const jsonPath = path.join(dir, 'oracle-cards.json');
    fs.writeFileSync(jsonPath, JSON.stringify([{ name: 'Sol Ring' }, { name: 'Command Tower' }]));

    const cards = parseOracleCardsContent(fs.readFileSync(jsonPath, 'utf8'), jsonPath) as Array<{ name?: string }>;
    expect(cards.map((card) => card.name)).toEqual(['Sol Ring', 'Command Tower']);
  });
});
