/** Plane and phenomenon scans are portrait files of a landscape card. Schemes are already upright. */
export function isSidewaysVariantTypeLine(typeLine: unknown): boolean {
  const type = String(typeLine || '').trim();
  // `Phenomenon` must not use a `phenome` word-boundary: the next letter is still `n`.
  return /^(plane\b|phenomen)/i.test(type);
}

export function isSidewaysVariantKind(kind: unknown): boolean {
  return kind === 'plane' || kind === 'phenomenon';
}

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

let cached: Promise<VariantCardCatalog> | null = null;

/** One request per page load. The server caches the oracle scan. */
export function fetchVariantCardCatalog(): Promise<VariantCardCatalog> {
  if (!cached) {
    cached = fetch('/api/cards/variant-catalog')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
        return res.json() as Promise<VariantCardCatalog>;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}

/** Name written by a deck-list line, ignoring a leading count and a trailing set code. */
export function deckLineCardName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null;
  const withoutCount = trimmed.replace(/^\d+\s*[xX]?\s+/, '');
  const withoutSet = withoutCount.replace(/\s+\([A-Za-z0-9]{2,6}\)\s*\d*\s*$/, '').trim();
  return withoutSet || null;
}

export function selectedVariantNames(deckText: string, catalog: VariantCardCatalog | null): Set<string> {
  const known = new Set<string>();
  if (catalog) {
    for (const card of [...catalog.planes, ...catalog.phenomena, ...catalog.schemes, ...catalog.ongoingSchemes]) {
      known.add(card.name.toLowerCase());
    }
  }
  const selected = new Set<string>();
  for (const line of deckText.split(/\r?\n/)) {
    const name = deckLineCardName(line);
    if (!name) continue;
    const key = name.toLowerCase();
    if (known.has(key)) selected.add(key);
  }
  return selected;
}

/** Add `1 Name` or remove the existing line. Names stay unique. */
export function toggleVariantCardInDeckText(deckText: string, name: string): string {
  const needle = name.toLowerCase();
  const lines = deckText.split(/\r?\n/);
  const index = lines.findIndex((line) => deckLineCardName(line)?.toLowerCase() === needle);
  if (index >= 0) {
    lines.splice(index, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const trimmed = deckText.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n1 ${name}` : `1 ${name}`;
}
