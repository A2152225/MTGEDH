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

function presentNameKeys(text: string): Set<string> {
  return new Set(extractCardNamesFromDeckText(text).map((name) => name.toLowerCase()));
}

function cardStillPresent(card: DeckResolvePreviewCard, present: Set<string>): boolean {
  return present.has(card.name.toLowerCase()) || present.has(card.query.toLowerCase());
}

export function useDeckResolvePreview() {
  const [cards, setCards] = useState<DeckResolvePreviewCard[]>([]);
  const cacheRef = useRef(new Map<string, DeckResolvePreviewCard | null>());
  const inflightRef = useRef(new Map<string, Promise<DeckResolvePreviewCard | null>>());
  const generationRef = useRef(0);

  const clearPreview = useCallback(() => {
    generationRef.current += 1;
    setCards([]);
  }, []);

  /** Drop gallery entries whose names no longer appear in the deck text. */
  const syncPreviewToText = useCallback((text: string) => {
    if (!text.trim()) {
      clearPreview();
      return;
    }
    const present = presentNameKeys(text);
    setCards((prev) => {
      const next = prev.filter((card) => cardStillPresent(card, present));
      return next.length === prev.length ? prev : next;
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

  const appendCard = useCallback((card: DeckResolvePreviewCard, text?: string) => {
    setCards((prev) => {
      if (text !== undefined) {
        const present = presentNameKeys(text);
        if (!cardStillPresent(card, present)) {
          return prev.filter((c) => cardStillPresent(c, present));
        }
        const key = card.name.toLowerCase();
        const without = prev
          .filter((c) => c.name.toLowerCase() !== key)
          .filter((c) => cardStillPresent(c, present));
        return [...without, card];
      }
      const key = card.name.toLowerCase();
      const without = prev.filter((c) => c.name.toLowerCase() !== key);
      return [...without, card];
    });
  }, []);

  const resolveLine = useCallback(
    async (line: string, textAfter?: string) => {
      const name = parseCardNameFromDeckLine(line);
      if (!name) return;
      const gen = generationRef.current;
      const card = await fetchOne(name);
      if (!card || gen !== generationRef.current) return;
      appendCard(card, textAfter);
    },
    [appendCard, fetchOne],
  );

  const resolveAllFromText = useCallback(
    async (text: string) => {
      const names = extractCardNamesFromDeckText(text);
      if (names.length === 0) {
        clearPreview();
        return;
      }

      const gen = generationRef.current;
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

      const next: DeckResolvePreviewCard[] = [];
      for (const name of names) {
        const card = cacheRef.current.get(name.toLowerCase());
        if (card) next.push(card);
      }
      setCards(next);
    },
    [clearPreview],
  );

  const onTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, text: string) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const caret = e.currentTarget.selectionStart ?? text.length;
      const line = getLineAtCaret(text, caret);
      // Enter inserts a newline after this handler; include it for presence checks.
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
      // Defer so controlled value can update; resolve against the post-paste text.
      window.setTimeout(() => {
        void resolveAllFromText(next);
      }, 0);
    },
    [resolveAllFromText],
  );

  return {
    cards,
    clearPreview,
    syncPreviewToText,
    resolveAllFromText,
    onTextareaKeyDown,
    onTextareaPaste,
  };
}
