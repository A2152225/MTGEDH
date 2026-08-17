import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';import type { DeckResolvePreviewCard } from '../components/DeckResolvePreviewPanel';import {
  aggregateDeckCardQuantities,
  enumerateDeckTextLines,
  extractCardNamesFromDeckText,
  getLineAtCaret,
  parseCardNameFromDeckLine,
} from '../utils/deckListLine';import { lookupDeckCardsViaApi, type DeckCardLookupResult } from '../utils/serverDeckApi';
export type UnresolvedDeckLine = {
  lineNumber: number;
  name: string;
};
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
    quantity: 1,
  };
}
function cardsEqual(a: DeckResolvePreviewCard[], b: DeckResolvePreviewCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name.toLowerCase() !== b[i].name.toLowerCase()) return false;
    if ((a[i].quantity || 1) !== (b[i].quantity || 1)) return false;
  }
  return true;
}


function unresolvedEqual(a: UnresolvedDeckLine[], b: UnresolvedDeckLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].lineNumber !== b[i].lineNumber) return false;
    if (a[i].name.toLowerCase() !== b[i].name.toLowerCase()) return false;
  }
  return true;
}
type PreviewSnapshot = {
  cards: DeckResolvePreviewCard[];
  unresolvedLines: UnresolvedDeckLine[];
  resolvedCopies: number;
  totalCopies: number;
};
/** Build gallery + totals from current text and lookup cache (includes duplicate quantities). */function buildPreviewSnapshot(
  text: string,

  cache: Map<string, DeckResolvePreviewCard | null>,
): PreviewSnapshot {
  const quantities = aggregateDeckCardQuantities(text);
  const cards: DeckResolvePreviewCard[] = [];
  let resolvedCopies = 0;
  let totalCopies = 0;

  for (const row of quantities) {
    // Ignore lines or category names starting with [
    if (row.name.trim().startsWith('[')) continue;

    totalCopies += row.count;
    const cached = cache.get(row.name.toLowerCase());
    if (!cached) continue;
    resolvedCopies += row.count;
    cards.push({ ...cached, quantity: row.count });
  }

  const unresolvedLines: UnresolvedDeckLine[] = [];

  for (const line of enumerateDeckTextLines(text)) {
    if (!line.name) continue;

    // Ignore lines or category names starting with [ so they aren't marked as unresolved
    if (line.name.trim().startsWith('[')) continue;

    const cached = cache.get(line.name.toLowerCase());
    // Only alert after we've attempted a lookup and it missed.
    if (cached === null) {
      unresolvedLines.push({ lineNumber: line.lineNumber, name: line.name });
    }
  }

  return { cards, unresolvedLines, resolvedCopies, totalCopies };
}
export function useDeckResolvePreview() {
  const [cards, setCards] = useState<DeckResolvePreviewCard[]>([]);
  const [unresolvedLines, setUnresolvedLines] = useState<UnresolvedDeckLine[]>([]);

  const [resolvedCopies, setResolvedCopies] = useState(0);
  const [totalCopies, setTotalCopies] = useState(0);
  const [focusCardKey, setFocusCardKey] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  const cacheRef = useRef(new Map<string, DeckResolvePreviewCard | null>());
  const inflightRef = useRef(new Map<string, Promise<DeckResolvePreviewCard | null>>());
  const generationRef = useRef(0);

  const applySnapshot = useCallback((snapshot: PreviewSnapshot) => {
    setCards((prev) => (cardsEqual(prev, snapshot.cards) ? prev : snapshot.cards));
    setUnresolvedLines((prev) => (
      unresolvedEqual(prev, snapshot.unresolvedLines) ? prev : snapshot.unresolvedLines
    ));
    setResolvedCopies(snapshot.resolvedCopies);
    setTotalCopies(snapshot.totalCopies);
  }, []);

  const clearPreview = useCallback(() => {

    generationRef.current += 1;
    setCards([]);
    setUnresolvedLines([]);
    setResolvedCopies(0);
    setTotalCopies(0);
    setFocusCardKey(null);
  }, []);

  const focusResolvedCard = useCallback((name: string) => {
    setFocusCardKey(name.toLowerCase());
    setFocusToken((token) => token + 1);
  }, []);

  /** Keep gallery/totals in decklist order; drop names no longer present. */
  const syncPreviewToText = useCallback((text: string) => {
    if (!text.trim()) {
      clearPreview();
      return;
    }

    applySnapshot(buildPreviewSnapshot(text, cacheRef.current));
  }, [applySnapshot, clearPreview]);

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

        // Treat hard failures as unresolved misses for this session.
        cacheRef.current.set(key, null);
        inflightRef.current.delete(key);
        return null;
      });

    inflightRef.current.set(key, promise);
    return promise;
  }, []);

  const resolveLine = useCallback(
    async (line: string, textAfter?: string) => {
      // Abort early if the current line being executed starts with [
      if (line.trim().startsWith('[')) return;

      const name = parseCardNameFromDeckLine(line);
      if (!name) return;

      const gen = generationRef.current;

      const card = await fetchOne(name);
      if (gen !== generationRef.current) return;

      const text = textAfter ?? name;
      applySnapshot(buildPreviewSnapshot(text, cacheRef.current));
      if (card) focusResolvedCard(card.name);
    },
    [applySnapshot, fetchOne, focusResolvedCard],
  );

  const resolveAllFromText = useCallback(
    async (text: string) => {
      // Filter out names extracted from lines starting with [
      const names = extractCardNamesFromDeckText(text).filter(name => !name.trim().startsWith('['));
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
          for (const name of missing) {
            if (!cacheRef.current.has(name.toLowerCase())) {
              cacheRef.current.set(name.toLowerCase(), null);
            }
          }
        }
      }

      if (gen !== generationRef.current) return;

      const snapshot = buildPreviewSnapshot(text, cacheRef.current);
      applySnapshot(snapshot);


      let focusName: string | null = null;
      for (let i = snapshot.cards.length - 1; i >= 0; i -= 1) {
        const card = snapshot.cards[i];
        const wasNew =
          !previouslyKnown.has(card.name.toLowerCase()) &&
          !previouslyKnown.has(card.query.toLowerCase());
        if (
          wasNew ||
          missing.some(
            (m) =>
              m.toLowerCase() === card.query.toLowerCase() ||
              m.toLowerCase() === card.name.toLowerCase(),
          )
        ) {
          focusName = card.name;
          break;
        }
      }


      if (!focusName && snapshot.cards.length > 0) {
        focusName = snapshot.cards[snapshot.cards.length - 1].name;
      }
      if (focusName) focusResolvedCard(focusName);
    },
    [applySnapshot, clearPreview, focusResolvedCard],
  );

  const onTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, text: string) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const caret = e.currentTarget.selectionStart ?? text.length;
      const line = getLineAtCaret(text, caret);
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

  const unresolvedLineNumbers = unresolvedLines.reduce<Set<number>>((set, line) => {
    set.add(line.lineNumber);
    return set;
  }, new Set());


  return {
    cards,
    unresolvedLines,
    unresolvedLineNumbers,
    resolvedCopies,
    totalCopies,
    focusCardKey,
    focusToken,
    clearPreview,
    syncPreviewToText,
    resolveAllFromText,
    onTextareaKeyDown,
    onTextareaPaste,
  };
}