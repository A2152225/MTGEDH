#!/usr/bin/env node
/**
 * Rebuild precon_json/Tokens.json from the current Scryfall token printings.
 *
 * The game matches token art locally before it calls Scryfall. A stale dump
 * misses new printings and double-faced token faces (images live on card_faces).
 *
 * Usage: node tools/refresh-scryfall-tokens.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'precon_json', 'Tokens.json');
const userAgent = 'MTGEDH/1.0 (+https://github.com/MTGEDH)';
const pageDelayMs = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickImage(source) {
  const uris = source?.image_uris;
  if (!uris?.normal && !uris?.small) return undefined;
  return {
    small: uris.small,
    normal: uris.normal,
    large: uris.large,
    art_crop: uris.art_crop,
  };
}

function pickColors(source, parent) {
  if (Array.isArray(source?.colors) && source.colors.length) return source.colors;
  if (Array.isArray(source?.color_indicator) && source.color_indicator.length) return source.color_indicator;
  if (Array.isArray(parent?.colors) && parent.colors.length) return parent.colors;
  if (Array.isArray(parent?.color_indicator) && parent.color_indicator.length) return parent.color_indicator;
  return [];
}

function pickKeywords(source, parent) {
  if (Array.isArray(source?.keywords) && source.keywords.length) return source.keywords;
  if (Array.isArray(parent?.keywords)) return parent.keywords;
  return [];
}

function slim(card, face, faceIndex) {
  const source = face || card;
  const image = pickImage(source) || (!face ? pickImage(card) : undefined);
  const name = String(source?.name || card?.name || '').trim();
  if (!image || !name || name.includes('//')) return undefined;
  return {
    id: face ? `${card.id}#${faceIndex}` : card.id,
    name,
    type_line: String(source.type_line || card.type_line || ''),
    oracle_text: String(source.oracle_text || ''),
    power: source.power ?? card.power,
    toughness: source.toughness ?? card.toughness,
    colors: pickColors(source, card),
    keywords: pickKeywords(source, card),
    image_uris: image,
    released_at: String(card.released_at || ''),
    set: String(card.set || ''),
    layout: String(card.layout || ''),
  };
}

function recordsFromCard(card) {
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  const combined = String(card.name || '').includes('//');
  const top = pickImage(card);
  if (faces.length > 0 && (!top || combined)) {
    return faces.map((face, index) => slim(card, face, index)).filter(Boolean);
  }
  const one = slim(card);
  return one ? [one] : [];
}

async function fetchJson(url) {
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
    });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after')) || 500 * 2 ** attempt;
      await sleep(retryAfter);
      attempt += 1;
      continue;
    }
    throw new Error(`Scryfall error ${response.status} (${url})`);
  }
}

const records = [];
const seen = new Set();
let url = 'https://api.scryfall.com/cards/search?q=is%3Atoken&unique=prints';
let pages = 0;
while (url) {
  const page = await fetchJson(url);
  pages += 1;
  const cards = Array.isArray(page.data) ? page.data : [];
  for (const card of cards) {
    for (const record of recordsFromCard(card)) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
  }
  url = page.has_more && page.next_page ? String(page.next_page) : '';
  if (url) await sleep(pageDelayMs);
  process.stdout.write(`\rpages ${pages} tokens ${records.length}`);
}
process.stdout.write('\n');

records.sort((a, b) => a.name.localeCompare(b.name) || String(a.released_at).localeCompare(String(b.released_at)) || a.id.localeCompare(b.id));

const latest = records.reduce((max, record) => (record.released_at > max ? record.released_at : max), '');
const payload = {
  object: 'list',
  total_cards: records.length,
  has_more: false,
  updated_at: new Date().toISOString(),
  data: records,
};

fs.writeFileSync(outPath, JSON.stringify(payload));
const bytes = fs.statSync(outPath).size;
console.log(JSON.stringify({
  pages,
  tokens: records.length,
  latest,
  bytes,
  outPath,
}, null, 2));
