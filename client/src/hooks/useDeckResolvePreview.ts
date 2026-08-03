import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import type { DeckResolvePreviewCard } from '../components/DeckResolvePreviewPanel';
import {
  extractCardNamesFromDeckText,
  getLineAtCaret,
  parseCardNameFromDeckLine,
} from '../utils/deckListLine';
import { lookupDeckCardsViaApi, type DeckCardLookupResult } from '../utils/serverDeckApi';

function toPreviewCard(result: DeckCardLookupResult): DeckResolvePreviewCard | null {
  if (!result.found || !result.name) return null;
  return {
    query: result.query,
    found: true,
    name: result.name,
    type_line: result.type_line,
    oracle_text: result.oracle_text,
    mana_cost: result.mana_cost,
    image_uris: result.image_uris,
  };
}

function cardsEqual(a: DeckResolvePreviewCard[], b: DeckResolvePreviewCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name.toLowerCase() !== b[i].name.toLowerCase()) return false;
  }
  return true;
}

/** Build gallery rows in decklist order from known/cached cards only. */
function orderCardsForText(
  text: string,
  known: Iterable<DeckResolvePreviewCard>,
  cache: Map<string, DeckResolvePreviewCard | null>,
): DeckResolvePreviewCard[] {
  const names = extractCardNamesFromDeckText(text);
  if (names.length === 0) return [];

  const byKey = new Map<string, DeckResolvePreviewCard>();
  for (const card of known) {
    byKey.set(card.name.toLowerCase(), card);
    byKey.set(card.query.toLowerCase(), card);
  }

  const next: DeckResolvePreviewCard[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    const card = byKey.get(key) || cache.get(key) || null;
    if (!card) continue;
    const id = card.name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(card);
  }
  return next;
}

export function useDeckResolvePreview() {
  const [cards, setCards] = useState<DeckResolvePreviewCard[]>([]);
  const [focusCardKey, setFocusCardKey] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const cacheRef = useRef(new Map<string, DeckResolvePreviewCard | null>());
  const inflightRef = useRef(new Map<string, Promise<DeckResolvePreviewCard | null>>());
  const generationRef = useRef(0);

  const clearPreview = useCallback(() => {
    generationRef.current += 1;
    setCards([]);
    setFocusCardKey(null);
  }, []);

  const focusResolvedCard = useCallback((name: string) => {
    setFocusCardKey(name.toLowerCase());
    setFocusToken((token) => token + 1);
  }, []);

  /** Keep gallery in decklist order; drop names no longer present. */
  const syncPreviewToText = useCallback((text: string) => {
    if (!text.trim()) {
      clearPreview();
      return;
    }
    setCards((prev) => {
      const next = orderCardsForText(text, prev, cacheRef.current);
      return cardsEqual(prev, next) ? prev : next;
    });
  }, [clearPreview]);

  const fetchOne = useCallback(async (name: string): Promise<DeckResolvePreviewCard | null> => {
    const key = name.toLowerCase();
    if (cacheRef.current.has(key)) {
      return cacheRef.current.get(key) ?? null;
    }
    const existing = inflightRef.current.get(key);
    if (existing) return existing;

    const promise = lookupDeckCardsViaApi([name])
      .then((results) => {
        const preview = toPreviewCard(results[0] || { query: name, found: false });
        cacheRef.current.set(key, preview);
        inflightRef.current.delete(key);
        return preview;
      })
      .catch(() => {
        inflightRef.current.delete(key);
        return null;
      });

    inflightRef.current.set(key, promise);
    return promise;
  }, []);

  const resolveLine = useCallback(
    async (line: string, textAfter?: string) => {
      const name = parseCardNameFromDeckLine(line);
      if (!name) return;
      const gen = generationRef.current;
      const card = await fetchOne(name);
      if (!card || gen !== generationRef.current) return;
      const text = textAfter ?? name;
      setCards((prev) => {
        const next = orderCardsForText(text, [...prev, card], cacheRef.current);
        return cardsEqual(prev, next) ? prev : next;
      });
      focusResolvedCard(card.name);
    },
    [fetchOne, focusResolvedCard],
  );

  const resolveAllFromText = useCallback(
    async (text: string) => {
      const names = extractCardNamesFromDeckText(text);
      if (names.length === 0) {
        clearPreview();
        return;
      }

      const gen = generationRef.current;
      const previouslyKnown = new Set(
        [...cacheRef.current.entries()]
          .filter(([, card]) => !!card)
          .map(([key]) => key),
      );
      const missing: string[] = [];
      for (const name of names) {
        if (!cacheRef.current.has(name.toLowerCase())) {
          missing.push(name);
        }
      }

      if (missing.length > 0) {
        try {
          const results = await lookupDeckCardsViaApi(missing);
          const byQuery = new Map(
            results.map((r) => [r.query.toLowerCase(), toPreviewCard(r)] as const),
          );
          for (const name of missing) {
            const preview = byQuery.get(name.toLowerCase()) ?? null;
            cacheRef.current.set(name.toLowerCase(), preview);
          }
        } catch {
          // leave misses unresolved
        }
      }

      if (gen !== generationRef.current) return;

      const next = orderCardsForText(text, [], cacheRef.current);
      setCards((prev) => (cardsEqual(prev, next) ? prev : next));

      // Prefer the last newly resolved card; otherwise the last card in list order.
      let focusName: string | null = null;
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const card = next[i];
        const wasNew = !previouslyKnown.has(card.name.toLowerCase())
          && !previouslyKnown.has(card.query.toLowerCase());
        if (wasNew || missing.some((m) => m.toLowerCase() === card.query.toLowerCase() || m.toLowerCase() === card.name.toLowerCase())) {
          focusName = card.name;
          break;
        }
      }
      if (!focusName && next.length > 0) {
        focusName = next[next.length - 1].name;
      }
      if (focusName) focusResolvedCard(focusName);
    },
    [clearPreview, focusResolvedCard],
  );

  const onTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, text: string) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const caret = e.currentTarget.selectionStart ?? text.length;
      const line = getLineAtCaret(text, caret);
      // Enter inserts a newline after this handler; include it for ordering/presence.
      const textAfter = `${text.slice(0, caret)}\n${text.slice(caret)}`;
      void resolveLine(line, textAfter);
    },
    [resolveLine],
  );

  const onTextareaPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>, currentText: string) => {
      const pasted = e.clipboardData.getData('text');
      if (!pasted) return;
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? start;
      const next = `${currentText.slice(0, start)}${pasted}${currentText.slice(end)}`;
      window.setTimeout(() => {
        void resolveAllFromText(next);
      }, 0);
    },
    [resolveAllFromText],
  );

  return {
    cards,
    focusCardKey,
    focusToken,
    clearPreview,
    syncPreviewToText,
    resolveAllFromText,
    onTextareaKeyDown,
    onTextareaPaste,
  };
}
