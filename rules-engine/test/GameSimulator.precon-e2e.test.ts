import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AIStrategy } from '../src/AIEngine';
import { GameSimulator, type CardData, PlayerType, type SimulationPlayer } from '../src/GameSimulator';

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
let atomicIndexCache: Map<string, CardData> | null = null;
const oracleLoadedNames = new Set<string>();
const atomicLoadedNames = new Set<string>();

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

function toAtomicCardData(name: string, raw: any): CardData {
  return {
    name,
    mana_cost: typeof raw?.manaCost === 'string' ? raw.manaCost : undefined,
    cmc: typeof raw?.manaValue === 'number' ? raw.manaValue : undefined,
    type_line: typeof raw?.type === 'string' ? raw.type : undefined,
    oracle_text: typeof raw?.text === 'string' ? raw.text : undefined,
    power: typeof raw?.power === 'string' ? raw.power : undefined,
    toughness: typeof raw?.toughness === 'string' ? raw.toughness : undefined,
    loyalty: typeof raw?.loyalty === 'string' ? raw.loyalty : undefined,
    id: typeof raw?.uuid === 'string' ? raw.uuid : undefined,
  };
}

function loadOracleIndex(requiredNames: Set<string>): Map<string, CardData> {
  if (!oracleIndexCache) {
    oracleIndexCache = new Map();
  }

  const missingNames = [...requiredNames].filter((name) => !oracleLoadedNames.has(name));
  if (missingNames.length > 0) {
    const missingSet = new Set(missingNames);
    const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');
    const oracleCards = JSON.parse(fs.readFileSync(oracleCardsPath, 'utf8')) as any[];

    for (const rawCard of oracleCards) {
      const cardData = toOracleCardData(rawCard);
      if (!cardData) continue;

      const candidateNames = [rawCard?.name, ...(Array.isArray(rawCard?.card_faces) ? rawCard.card_faces.map((face: any) => face?.name) : [])]
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

      for (const candidateName of candidateNames) {
        const normalizedName = normalizeCardName(candidateName);
        if (!normalizedName || !missingSet.has(normalizedName)) continue;

        const existing = oracleIndexCache.get(normalizedName);
        if (!existing || cardScore(cardData, rawCard?.layout) > cardScore(existing)) {
          oracleIndexCache.set(normalizedName, cardData);
        }
      }
    }

    for (const normalizedName of missingNames) {
      oracleLoadedNames.add(normalizedName);
    }
  }

  return new Map([...oracleIndexCache].filter(([key]) => requiredNames.has(key)));
}

function loadAtomicIndex(requiredNames: Set<string>): Map<string, CardData> {
  if (!atomicIndexCache) {
    atomicIndexCache = new Map();
  }

  const missingNames = [...requiredNames].filter((name) => !atomicLoadedNames.has(name));
  if (missingNames.length > 0) {
    const missingSet = new Set(missingNames);
    const atomicCardsPath = path.join(repoRoot, 'AtomicCards.json');
    const atomicCards = JSON.parse(fs.readFileSync(atomicCardsPath, 'utf8')) as {
      data?: Record<string, any[]>;
    };

    for (const [name, printings] of Object.entries(atomicCards.data || {})) {
      const normalizedName = normalizeCardName(name);
      if (!missingSet.has(normalizedName)) continue;

      const bestPrinting = Array.isArray(printings)
        ? printings.find((printing) => printing?.text || printing?.type || printing?.manaCost) ?? printings[0]
        : undefined;
      if (!bestPrinting) continue;

      const cardData = toAtomicCardData(name, bestPrinting);
      const existing = atomicIndexCache.get(normalizedName);
      if (!existing || cardScore(cardData) > cardScore(existing)) {
        atomicIndexCache.set(normalizedName, cardData);
      }
    }

    for (const normalizedName of missingNames) {
      atomicLoadedNames.add(normalizedName);
    }
  }

  return new Map([...atomicIndexCache].filter(([key]) => requiredNames.has(key)));
}

function readDeckFile(relativePath: string): string[] {
  const deckPath = path.join(repoRoot, relativePath);
  return fs
    .readFileSync(deckPath, 'utf8')
    .split(/\r?\n/)
    .flatMap(expandDeckLine)
    .filter(Boolean);
}

function resolveDeckCards(deckCards: string[]): { resolved: CardData[]; unresolved: string[] } {
  const requiredNames = new Set(
    deckCards.map((cardName) => CARD_ALIASES[normalizeCardName(cardName)] ?? normalizeCardName(cardName)),
  );
  const oracleIndex = loadOracleIndex(requiredNames);
  const unresolvedKeys = [...requiredNames].filter((name) => !oracleIndex.has(name));
  const atomicIndex = unresolvedKeys.length > 0 ? loadAtomicIndex(new Set(unresolvedKeys)) : new Map<string, CardData>();

  const resolved: CardData[] = [];
  const unresolved = new Set<string>();

  for (const deckCard of deckCards) {
    const normalizedName = CARD_ALIASES[normalizeCardName(deckCard)] ?? normalizeCardName(deckCard);
    const cardData = oracleIndex.get(normalizedName) ?? atomicIndex.get(normalizedName);
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
    const loadedDecks = DECK_FILES.map((relativePath) => {
      const rawCards = readDeckFile(relativePath);
      const { resolved, unresolved } = resolveDeckCards(rawCards);

      expect(unresolved, `${relativePath} contains unresolved cards`).toEqual([]);
      expect(resolved.length, `${relativePath} should produce a meaningful deck`).toBeGreaterThan(60);

      return {
        relativePath,
        commander: resolved[0].name,
        cards: resolved.map((card) => card.name),
        cardData: resolved,
      };
    });

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