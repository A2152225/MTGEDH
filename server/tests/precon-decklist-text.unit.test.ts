import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { registerPreconDecklistHttpRoutes } from '../src/preconDecklistHttp.js';
import {
  formatPreconDecklistText,
  loadPreconDecklistText,
} from '../src/services/preconDecklistText.js';

describe('precon decklist text', () => {
  it('formats counted lines and skips blank names', () => {
    expect(formatPreconDecklistText([
      { count: 1, name: 'Sol Ring' },
      { count: 11, name: '  Plains  ' },
      { name: '' },
      { count: 0, name: 'Swamp' },
    ])).toBe('1 Sol Ring\n11 Plains\n1 Swamp');
  });

  it('loads Witherbloom Pestilence as editable deck text', () => {
    const loaded = loadPreconDecklistText('soc', '  Witherbloom Pestilence  ');
    expect(loaded).toBeTruthy();
    expect(loaded?.setCode).toBe('SOC');
    expect(loaded?.deckName).toBe('Witherbloom Pestilence');
    expect(loaded?.cardCount).toBe(100);
    expect(loaded?.text).toContain('1 Dina, Essence Brewer');
    expect(loaded?.text).toContain('1 Sol Ring');
    expect(loaded?.text.split('\n').every((line) => /^\d+ .+/.test(line))).toBe(true);
  });

  it('returns null when the precon is not baked', () => {
    expect(loadPreconDecklistText('', 'Nope')).toBeNull();
    expect(loadPreconDecklistText('ZZZ', 'Nope')).toBeNull();
  });
});

describe('GET /api/precons/decklist', () => {
  let server: Server;
  let base = '';

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function listen(): Promise<void> {
    if (server) return;
    const app = express();
    registerPreconDecklistHttpRoutes(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  }

  it('requires setCode and deckName', async () => {
    await listen();
    const res = await fetch(`${base}/api/precons/decklist`);
    expect(res.status).toBe(400);
  });

  it('404s an unknown precon and returns a known list', async () => {
    await listen();
    const missing = await fetch(`${base}/api/precons/decklist?setCode=ZZZ&deckName=Nope`);
    expect(missing.status).toBe(404);

    const params = new URLSearchParams({ setCode: 'SOC', deckName: 'Witherbloom Pestilence' });
    const ok = await fetch(`${base}/api/precons/decklist?${params}`);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.cardCount).toBe(100);
    expect(body.text).toContain('1 Dina, Essence Brewer');
    expect(body.setCode).toBe('SOC');
  });
});
