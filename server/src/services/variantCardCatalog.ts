/**
 * Full Planechase / Archenemy card catalog for the deck builder.
 *
 * Planes, phenomena and schemes are a few hundred cards. This reads them once from the local
 * oracle dump (no Scryfall), keeps name, type line, oracle text and image URIs, and caches the
 * result in memory and under server/data (gitignored).
 *
 * Public: variantCatalogKind, buildVariantCatalogFromCards, getVariantCardCatalog.
 */
import fs from 'node:fs';
import path from 'node:path';

import { getDefaultRepoRoot, iterateOracleCards, resolveOracleCardsPath } from './oracleCardsIndex.js';

export type VariantCatalogKind = 'plane' | 'phenomenon' | 'scheme' | 'ongoing_scheme';

export type VariantCatalogCard = {
  name: string;
  kind: VariantCatalogKind;
  type_line: string;
  oracle_text: string;
  image_small?: string;
  image_normal?: string;
};

export type VariantCardCatalog = {
  planes: VariantCatalogCard[];
  phenomena: VariantCatalogCard[];
  schemes: VariantCatalogCard[];
  ongoingSchemes: VariantCatalogCard[];
};

const ORACLE_TEXT_CAP = 2000;

type CacheFile = {
  sourceMtimeMs: number;
  sourceSize: number;
  catalog: VariantCardCatalog;
};

let memory: { key: string; catalog: VariantCardCatalog } | null = null;

function emptyCatalog(): VariantCardCatalog {
  return { planes: [], phenomena: [], schemes: [], ongoingSchemes: [] };
}

/** Plane / phenomenon / scheme, or null for an ordinary card. */
export function variantCatalogKind(layout: unknown, typeLine: unknown): VariantCatalogKind | null {
  const type = String(typeLine || '').trim().toLowerCase();
  const face = String(layout || '').trim().toLowerCase();
  if (face === 'scheme' || type === 'scheme' || type === 'ongoing scheme') {
    return type.includes('ongoing') ? 'ongoing_scheme' : 'scheme';
  }
  if (face === 'planar' || type.startsWith('plane') || type.startsWith('phenom')) {
    return type.startsWith('phenom') ? 'phenomenon' : 'plane';
  }
  return null;
}

function imageOf(card: any): { small?: string; normal?: string } {
  const direct = card?.image_uris;
  const face = Array.isArray(card?.card_faces) ? card.card_faces[0]?.image_uris : undefined;
  const source = direct?.normal || direct?.small ? direct : face;
  if (!source) return {};
  return {
    small: typeof source.small === 'string' ? source.small : undefined,
    normal: typeof source.normal === 'string' ? source.normal : (typeof source.small === 'string' ? source.small : undefined),
  };
}

function toCatalogCard(card: any, kind: VariantCatalogKind): VariantCatalogCard | null {
  const name = String(card?.name || '').trim();
  if (!name) return null;
  const typeLine = String(card?.type_line || card?.type || '').trim();
  const oracle = String(card?.oracle_text || card?.text || '').trim().slice(0, ORACLE_TEXT_CAP);
  const images = imageOf(card);
  const entry: VariantCatalogCard = { name, kind, type_line: typeLine, oracle_text: oracle };
  if (images.small) entry.image_small = images.small;
  if (images.normal) entry.image_normal = images.normal;
  return entry;
}

function prefer(existing: VariantCatalogCard, next: VariantCatalogCard): VariantCatalogCard {
  if (!existing.image_normal && next.image_normal) return next;
  if (!existing.oracle_text && next.oracle_text) return next;
  return existing;
}

/** Dedupe by English name and bucket into the four lists, each sorted by name. */
export function buildVariantCatalogFromCards(cards: readonly any[]): VariantCardCatalog {
  const byName = new Map<string, VariantCatalogCard>();
  for (const card of cards) {
    if (card?.lang && String(card.lang) !== 'en') continue;
    const kind = variantCatalogKind(card?.layout, card?.type_line || card?.type);
    if (!kind) continue;
    const entry = toCatalogCard(card, kind);
    if (!entry) continue;
    const key = entry.name.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, existing ? prefer(existing, entry) : entry);
  }

  const bucket = (kind: VariantCatalogKind) =>
    [...byName.values()]
      .filter((card) => card.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    planes: bucket('plane'),
    phenomena: bucket('phenomenon'),
    schemes: bucket('scheme'),
    ongoingSchemes: bucket('ongoing_scheme'),
  };
}

function catalogCachePath(): string {
  return path.join(getDefaultRepoRoot(), 'server', 'data', 'variant-card-catalog.json');
}

function readDiskCache(filePath: string, mtimeMs: number, size: number): VariantCardCatalog | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CacheFile;
    if (parsed.sourceMtimeMs !== mtimeMs || parsed.sourceSize !== size) return null;
    if (!parsed.catalog || !Array.isArray(parsed.catalog.planes)) return null;
    return parsed.catalog;
  } catch {
    return null;
  }
}

async function scanOracleFile(sourcePath: string): Promise<VariantCardCatalog> {
  const matched: any[] = [];
  for await (const card of iterateOracleCards(sourcePath)) {
    if (variantCatalogKind(card.layout, card.type_line)) matched.push(card);
  }
  return buildVariantCatalogFromCards(matched);
}

/** Cached catalog. Empty lists when the oracle dump is missing. */
export async function getVariantCardCatalog(): Promise<VariantCardCatalog> {
  const sourcePath = resolveOracleCardsPath();
  if (!fs.existsSync(sourcePath)) return emptyCatalog();
  const stat = fs.statSync(sourcePath);
  const key = `${sourcePath}:${stat.mtimeMs}:${stat.size}`;
  if (memory?.key === key) return memory.catalog;

  const cacheFile = catalogCachePath();
  const cached = readDiskCache(cacheFile, stat.mtimeMs, stat.size);
  if (cached) {
    memory = { key, catalog: cached };
    return cached;
  }

  const catalog = await scanOracleFile(sourcePath);
  memory = { key, catalog };
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const body: CacheFile = { sourceMtimeMs: stat.mtimeMs, sourceSize: stat.size, catalog };
    fs.writeFileSync(cacheFile, JSON.stringify(body));
  } catch {
    /* the in-memory copy still serves this process */
  }
  return catalog;
}
