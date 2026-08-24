import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AIStrategy } from '../src/AIEngine';
import { GameSimulator, type CardData, PlayerType, type SimulationPlayer } from '../src/GameSimulator';
import { lookupCorpusCards } from './helpers/cardCorpus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DECK_FILES = [
  'precon_json/StopHittingYourself.txt',
  'precon_json/Myrel, Shield of Argive token deck.txt',
  'precon_json/Iroas-Boros.txt',
] as const;

const CARD_ALIASES: Record<string, string> = {
  vindicator: 'phyrexian vindicator',
};

let oracleIndexCache: Map<string, CardData> | null = null;
const oracleLoadedNames = new Set<string>();

function normalizeCardName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

function expandDeckLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const countMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!countMatch) return [trimmed];

  return Array.from({ length: Number(countMatch[1]) }, () => countMatch[2].trim());
}

function cardScore(card: CardData, layout?: string): number {
  let score = 0;

  if (layout && !['art_series', 'token', 'double_faced_token', 'emblem'].includes(layout)) {
    score += 4;
  }
  if (card.oracle_text) score += 4;
  if (card.type_line && card.type_line !== 'Card' && !card.type_line.endsWith('// Card')) score += 3;
  if (card.mana_cost !== undefined) score += 1;
  if (card.power || card.toughness || card.loyalty) score += 1;

  return score;
}

function toOracleCardData(raw: any): CardData | null {
  if (!raw || !raw.name) return null;

  const firstFace = Array.isArray(raw.card_faces) && raw.card_faces.length > 0 ? raw.card_faces[0] : undefined;
  return {
    name: raw.name,
    id: raw.id,
    mana_cost: raw.mana_cost ?? firstFace?.mana_cost,
    cmc: typeof raw.cmc === 'number' ? raw.cmc : undefined,
    type_line: raw.type_line ?? firstFace?.type_line,
    oracle_text: raw.oracle_text ?? firstFace?.oracle_text,
    power: raw.power ?? firstFace?.power,
    toughness: raw.toughness ?? firstFace?.toughness,
    loyalty: raw.loyalty ?? firstFace?.loyalty,
  };
}

/**
 * The lookup database is built from both the Scryfall oracle dump and AtomicCards, so one query
 * covers what used to be two separate index loaders over the raw JSON files.
 */
async function loadCardIndex(requiredNames: Set<string>): Promise<Map<string, CardData>> {
  if (!oracleIndexCache) {
    oracleIndexCache = new Map();
  }

  const missingNames = [...requiredNames].filter((name) => !oracleLoadedNames.has(name));
  if (missingNames.length > 0) {
    const { cards } = await lookupCorpusCards(missingNames);

    for (const [normalizedName, rawCard] of cards) {
      const cardData = toOracleCardData(rawCard);
      if (!cardData) continue;

      const existing = oracleIndexCache.get(normalizedName);
      if (!existing || cardScore(cardData, (rawCard as any)?.layout) > cardScore(existing)) {
        oracleIndexCache.set(normalizedName, cardData);
      }
    }

    for (const normalizedName of missingNames) {
      oracleLoadedNames.add(normalizedName);
    }
  }

  return new Map([...oracleIndexCache].filter(([key]) => requiredNames.has(key)));
}

function readDeckFile(relativePath: string): string[] {
  const deckPath = path.join(repoRoot, relativePath);
  return fs
    .readFileSync(deckPath, 'utf8')
    .split(/\r?\n/)
    .flatMap(expandDeckLine)
    .filter(Boolean);
}

async function resolveDeckCards(deckCards: string[]): Promise<{ resolved: CardData[]; unresolved: string[] }> {
  const requiredNames = new Set(
    deckCards.map((cardName) => CARD_ALIASES[normalizeCardName(cardName)] ?? normalizeCardName(cardName)),
  );
  const cardIndex = await loadCardIndex(requiredNames);

  const resolved: CardData[] = [];
  const unresolved = new Set<string>();

  for (const deckCard of deckCards) {
    const normalizedName = CARD_ALIASES[normalizeCardName(deckCard)] ?? normalizeCardName(deckCard);
    const cardData = cardIndex.get(normalizedName);
    if (!cardData) {
      unresolved.add(deckCard);
      continue;
    }
    resolved.push(cardData);
  }

  return {
    resolved,
    unresolved: [...unresolved].sort((left, right) => left.localeCompare(right)),
  };
}

describe('GameSimulator - precon text deck end-to-end', () => {
  it('runs a full 3-player commander simulation from the txt decklists', async () => {
    const loadedDecks: Array<{
      relativePath: string;
      commander: string;
      cards: string[];
      cardData: CardData[];
    }> = [];
    for (const relativePath of DECK_FILES) {
      const rawCards = readDeckFile(relativePath);
      const { resolved, unresolved } = await resolveDeckCards(rawCards);

      expect(unresolved, `${relativePath} contains unresolved cards`).toEqual([]);
      expect(resolved.length, `${relativePath} should produce a meaningful deck`).toBeGreaterThan(60);

      loadedDecks.push({
        relativePath,
        commander: resolved[0].name,
        cards: resolved.map((card) => card.name),
        cardData: resolved,
      });
    }

    const cardDatabase = new Map<string, CardData>();
    for (const deck of loadedDecks) {
      for (const card of deck.cardData) {
        cardDatabase.set(card.name, card);
      }
    }

    const players: SimulationPlayer[] = loadedDecks.map((deck, index) => ({
      id: `player-${index + 1}`,
      name: path.basename(deck.relativePath, '.txt'),
      type: PlayerType.AI,
      aiStrategy: AIStrategy.AGGRESSIVE,
      deckList: deck.cards,
      commander: deck.commander,
    }));

    const simulator = new GameSimulator();
    const result = await simulator.runSimulation({
      gameId: 'precon-e2e-seed-20260330',
      players,
      format: 'commander',
      startingLife: 40,
      maxTurns: 80,
      rngSeed: 20260330,
      verbose: false,
      headless: true,
      cardDatabase,
    });

    expect(result.totalTurns).toBeGreaterThan(0);
    expect(result.totalTurns).toBeLessThanOrEqual(80);
    expect(result.totalActions).toBeGreaterThan(0);
    expect(result.reason).toMatch(/Last player standing|Highest life total|All players eliminated/);
    expect(result.winner).toBeTruthy();
    expect(result.eliminations.length).toBeGreaterThan(0);
  }, 180000);
});