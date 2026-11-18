import React, { useEffect, useMemo, useState } from 'react';

import { getCardPreviewHandlers } from './CardPreviewLayer';
import {
  fetchVariantCardCatalog,
  selectedVariantNames,
  toggleVariantCardInDeckText,
  type VariantCardCatalog,
  type VariantCatalogCard,
  type VariantCatalogKind,
} from '../utils/variantCardCatalogApi';

type KindFilter = 'all' | VariantCatalogKind;

const KIND_LABEL: Record<VariantCatalogKind, string> = {
  plane: 'Plane',
  phenomenon: 'Phenomenon',
  scheme: 'Scheme',
  ongoing_scheme: 'Ongoing',
};

const FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'plane', label: 'Planes' },
  { id: 'phenomenon', label: 'Phenomena' },
  { id: 'scheme', label: 'Schemes' },
  { id: 'ongoing_scheme', label: 'Ongoing' },
];

function allCards(catalog: VariantCardCatalog): VariantCatalogCard[] {
  return [...catalog.planes, ...catalog.phenomena, ...catalog.schemes, ...catalog.ongoingSchemes];
}

function countKind(catalog: VariantCardCatalog, kind: VariantCatalogKind): number {
  if (kind === 'plane') return catalog.planes.length;
  if (kind === 'phenomenon') return catalog.phenomena.length;
  if (kind === 'scheme') return catalog.schemes.length;
  return catalog.ongoingSchemes.length;
}

/**
 * Pick planes, phenomena and schemes into the deck list. The pool is a few hundred cards,
 * loaded once from the local catalog.
 */
export function VariantDeckBuilder({
  deckText,
  onChangeDeckText,
  onImport,
}: {
  deckText: string;
  onChangeDeckText: (next: string) => void;
  onImport: () => void;
}) {
  const [catalog, setCatalog] = useState<VariantCardCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  useEffect(() => {
    let cancelled = false;
    fetchVariantCardCatalog()
      .then((next) => {
        if (!cancelled) setCatalog(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the catalog');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => selectedVariantNames(deckText, catalog), [deckText, catalog]);

  const visible = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return allCards(catalog).filter((card) => {
      if (kind !== 'all' && card.kind !== kind) return false;
      if (!needle) return true;
      return (
        card.name.toLowerCase().includes(needle)
        || card.type_line.toLowerCase().includes(needle)
        || card.oracle_text.toLowerCase().includes(needle)
      );
    });
  }, [catalog, kind, query]);

  const selectedCounts = useMemo(() => {
    const counts = { plane: 0, phenomenon: 0, scheme: 0, ongoing_scheme: 0 };
    if (!catalog) return counts;
    for (const card of allCards(catalog)) {
      if (selected.has(card.name.toLowerCase())) counts[card.kind] += 1;
    }
    return counts;
  }, [catalog, selected]);

  if (error) {
    return <div style={{ color: '#fecaca', fontSize: 13 }}>{error}</div>;
  }
  if (!catalog) {
    return <div style={{ color: '#cbd5e1', fontSize: 13 }}>Loading planes and schemes…</div>;
  }

  const total = allCards(catalog).length;

  return (
    <div>
      <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8, lineHeight: 1.45 }}>
        {catalog.planes.length} planes, {catalog.phenomena.length} phenomena, {catalog.schemes.length} schemes,{' '}
        {catalog.ongoingSchemes.length} ongoing schemes. Click a card to add or remove it. These cards are not part of
        the library: Planechase uses one shared planar deck, and Archenemy uses one scheme deck. Turn the matching
        option on when you import.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, world, or rules text"
          style={{ flex: '1 1 180px', minWidth: 160 }}
        />
        {FILTERS.map((filter) => {
          const count = filter.id === 'all' ? total : countKind(catalog, filter.id);
          const active = kind === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => setKind(filter.id)}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 6,
                border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
                background: active ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                color: active ? '#e0f2fe' : '#cbd5e1',
                cursor: 'pointer',
              }}
            >
              {filter.label} ({count})
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
        In this list: {selectedCounts.plane} planes, {selectedCounts.phenomenon} phenomena,{' '}
        {selectedCounts.scheme + selectedCounts.ongoing_scheme} schemes
        <button
          type="button"
          onClick={onImport}
          disabled={!deckText.trim()}
          style={{ marginLeft: 10, fontSize: 11 }}
        >
          Import deck list
        </button>
      </div>
      <div style={{ border: '1px solid #333', borderRadius: 6, background: '#111', maxHeight: 420, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: '#94a3b8' }}>No cards match.</div>
        )}
        {visible.map((card) => {
          const on = selected.has(card.name.toLowerCase());
          const image = card.image_small || card.image_normal;
          return (
            <button
              key={`${card.kind}:${card.name}`}
              type="button"
              onClick={() => onChangeDeckText(toggleVariantCardInDeckText(deckText, card.name))}
              {...getCardPreviewHandlers({
                name: card.name,
                type_line: card.type_line,
                image_uris: card.image_normal || card.image_small
                  ? { normal: card.image_normal || card.image_small, small: card.image_small || card.image_normal }
                  : undefined,
              })}
              style={{
                display: 'flex',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                borderBottom: '1px solid #1f2937',
                background: on ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                color: '#e5e7eb',
                cursor: 'pointer',
              }}
            >
              {image ? (
                <img src={image} alt="" width={36} height={50} style={{ objectFit: 'cover', borderRadius: 3, flex: '0 0 auto' }} />
              ) : (
                <span style={{ width: 36, height: 50, flex: '0 0 auto', background: '#1f2937', borderRadius: 3 }} />
              )}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                  {on ? '✓ ' : ''}{card.name}
                  <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 11, color: '#93c5fd' }}>
                    {KIND_LABEL[card.kind]}
                  </span>
                </span>
                <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>{card.type_line}</span>
                {card.oracle_text && (
                  <span
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      fontSize: 11,
                      color: '#cbd5e1',
                      marginTop: 2,
                    }}
                  >
                    {card.oracle_text}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
