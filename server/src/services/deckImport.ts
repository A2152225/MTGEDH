import { createCardFromScryfall } from '../../../shared/src/cardFactory.js';
import type { KnownCardRef } from '../../../shared/src/types.js';

import { lookupLocalCards } from './localCardLookup.js';
import { fetchCardByExactNameStrict, fetchCardsByExactNamesBatch, normalizeName } from './scryfall.js';
import { debugWarn } from '../utils/debug.js';

type ParsedDeckEntry = { name: string; count: number };
type ResolvedCard = Pick<
  KnownCardRef,
  'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'mana_cost' | 'power' | 'toughness' | 'card_faces' | 'layout' | 'loyalty'
>;

type ResolutionSource = 'scryfall' | 'oracle-cards' | 'AtomicCards' | 'hybrid';

export interface ResolveDeckListStatus {
  phase: 'start' | 'scryfall-progress' | 'scryfall-slow' | 'local-load' | 'local-progress' | 'strict-progress' | 'done';
  source: ResolutionSource;
  completed: number;
  total: number;
  message: string;
}

export interface ResolveDeckListOptions {
  onStatus?: (status: ResolveDeckListStatus) => void;
  uniqueInstanceIds?: boolean;
  scryfallTimeoutMs?: number;
}

const defaultScryfallBatchTimeoutMs = Number(process.env.SCRYFALL_DECK_IMPORT_BATCH_TIMEOUT_MS ?? 15000);

let cardInstanceCounter = 0;

function normalizeLookupName(name: string): string {
  return normalizeName(name).toLowerCase();
}

function createProgressBar(completed: number, total: number, width = 20): string {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.max(0, Math.min(1, completed / safeTotal));
  const filled = Math.round(width * ratio);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}] ${Math.round(ratio * 100)}%`;
}

function emitStatus(options: ResolveDeckListOptions | undefined, status: ResolveDeckListStatus): void {
  options?.onStatus?.(status);
}

function generateUniqueCardInstanceId(baseId: string): string {
  const counter = (++cardInstanceCounter).toString(36);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${baseId}_${timestamp}_${counter}_${random}`;
}

async function resolveResidualViaStrictScryfall(
  entries: ParsedDeckEntry[],
  resolvedCards: ResolvedCard[],
  validationCards: any[],
  uniqueInstanceIds: boolean,
  options?: ResolveDeckListOptions,
): Promise<ParsedDeckEntry[]> {
  const unresolved: ParsedDeckEntry[] = [];
  const total = entries.length;
  let completed = 0;

  for (const entry of entries) {
    try {
      const card = await fetchCardByExactNameStrict(entry.name);
      for (let i = 0; i < (entry.count || 1); i++) {
        validationCards.push(card);
        resolvedCards.push(
          createCardFromScryfall(card, {
            instanceId: uniqueInstanceIds ? generateUniqueCardInstanceId(card.id) : undefined,
          })
        );
      }
    } catch {
      unresolved.push(entry);
    }

    completed += 1;
    emitStatus(options, {
      phase: 'strict-progress',
      source: 'scryfall',
      completed,
      total,
      message: `Scryfall strict lookup ${createProgressBar(completed, total)} (${completed}/${total} unique cards)` ,
    });
  }

  return unresolved;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(timeoutMs > 0)) return promise;

  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function resolveDeckList(parsed: ParsedDeckEntry[], options: ResolveDeckListOptions = {}) {
  const requestedNames = parsed.map((entry) => entry.name);
  const totalUnique = parsed.length;
  const totalCards = parsed.reduce((sum, entry) => sum + Math.max(1, entry.count || 1), 0);
  const uniqueInstanceIds = options.uniqueInstanceIds !== false;
  const sourcesUsed = new Set<ResolutionSource>();
  const resolvedCards: ResolvedCard[] = [];
  const validationCards: any[] = [];

  emitStatus(options, {
    phase: 'start',
    source: 'hybrid',
    completed: 0,
    total: totalUnique,
    message: `Resolving ${totalCards} cards (${totalUnique} unique) via local lookup table first`,
  });

  let localCardsByName = new Map<string, any>();
  try {
    emitStatus(options, {
      phase: 'local-load',
      source: 'hybrid',
      completed: 0,
      total: totalUnique,
      message: 'Preparing local card lookup table',
    });
    localCardsByName = await lookupLocalCards(requestedNames, {
      onStatus: (status) => {
        emitStatus(options, {
          phase: 'local-load',
          source: 'hybrid',
          completed: 0,
          total: totalUnique,
          message: status.message,
        });
      },
    });
  } catch (error) {
    debugWarn(1, '[deck-import] Local card lookup table unavailable, falling back to Scryfall', error);
    emitStatus(options, {
      phase: 'local-load',
      source: 'hybrid',
      completed: 0,
      total: totalUnique,
      message: 'Local card lookup table unavailable; continuing with Scryfall',
    });
  }

  const unresolvedFromLocal: ParsedDeckEntry[] = [];
  let localCompleted = 0;
  for (const entry of parsed) {
    const card = localCardsByName.get(normalizeLookupName(entry.name));
    if (!card) {
      unresolvedFromLocal.push(entry);
    } else {
      sourcesUsed.add(card.source);
      for (let i = 0; i < (entry.count || 1); i++) {
        validationCards.push(card);
        resolvedCards.push(
          createCardFromScryfall(card, {
            instanceId: uniqueInstanceIds ? generateUniqueCardInstanceId(card.id) : undefined,
          })
        );
      }
    }

    localCompleted += 1;
    emitStatus(options, {
      phase: 'local-progress',
      source: 'hybrid',
      completed: localCompleted,
      total: totalUnique,
      message: `Local lookup ${createProgressBar(localCompleted, totalUnique)} (${localCompleted}/${totalUnique} unique cards)` ,
    });
  }

  let byName: Map<string, any> | null = null;
  let scryfallTimedOut = false;

  let unresolved = unresolvedFromLocal;
  if (unresolved.length > 0) {
    try {
      const startedAt = Date.now();
      byName = await withTimeout(
        fetchCardsByExactNamesBatch(unresolved.map((entry) => entry.name), 75, 120),
        options.scryfallTimeoutMs ?? defaultScryfallBatchTimeoutMs,
      );
      const durationMs = Date.now() - startedAt;
      emitStatus(options, {
        phase: 'scryfall-progress',
        source: 'scryfall',
        completed: unresolved.length,
        total: unresolved.length,
        message: `Scryfall batch lookup ${createProgressBar(unresolved.length, unresolved.length)} for ${unresolved.length} unresolved cards in ${durationMs}ms`,
      });
    } catch (error) {
      scryfallTimedOut = error instanceof Error && /timed out/i.test(error.message);
      debugWarn(1, '[deck-import] Scryfall lookup for unresolved cards timed out or failed', error);
      emitStatus(options, {
        phase: 'scryfall-slow',
        source: 'scryfall',
        completed: 0,
        total: unresolved.length,
        message: 'Scryfall is slow to respond for unresolved cards; keeping local-only results',
      });
    }
  }

  if (byName) {
    const unresolvedFromScryfall: ParsedDeckEntry[] = [];
    let scryfallResolvedAny = false;
    for (const entry of unresolved) {
      const card = byName.get(normalizeLookupName(entry.name));
      if (!card) {
        unresolvedFromScryfall.push(entry);
        continue;
      }

      scryfallResolvedAny = true;

      for (let i = 0; i < (entry.count || 1); i++) {
        validationCards.push(card);
        resolvedCards.push(
          createCardFromScryfall(card, {
            instanceId: uniqueInstanceIds ? generateUniqueCardInstanceId(card.id) : undefined,
          })
        );
      }
    }

    if (scryfallResolvedAny) {
      sourcesUsed.add('scryfall');
    }
    unresolved = unresolvedFromScryfall;
  }

  if (unresolved.length > 0 && !scryfallTimedOut) {
    const beforeStrict = unresolved.length;
    unresolved = await resolveResidualViaStrictScryfall(unresolved, resolvedCards, validationCards, uniqueInstanceIds, options);
    if (unresolved.length < beforeStrict) sourcesUsed.add('scryfall');
  }

  const missing = unresolved.map((entry) => entry.name);
  const sourceSummary = sourcesUsed.size <= 1
    ? ([...sourcesUsed][0] || 'scryfall')
    : 'hybrid';

  emitStatus(options, {
    phase: 'done',
    source: sourceSummary,
    completed: totalUnique - missing.length,
    total: totalUnique,
    message: `Resolved ${resolvedCards.length}/${totalCards} cards using ${sourceSummary}${missing.length ? ` with ${missing.length} unresolved name(s)` : ''}`,
  });

  return {
    resolvedCards,
    validationCards,
    missing,
    usedLocalFallback: sourcesUsed.has('oracle-cards') || sourcesUsed.has('AtomicCards'),
    usedLocalIndex: sourcesUsed.has('oracle-cards') || sourcesUsed.has('AtomicCards'),
    sourcesUsed: [...sourcesUsed],
    scryfallTimedOut,
  };
}