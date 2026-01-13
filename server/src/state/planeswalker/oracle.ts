import fs from "fs";
import path from "path";

export type OracleCard = {
  oracle_id?: string;
  name?: string;
  type_line?: string;
  oracle_text?: string;
};

export type OracleRuling = {
  oracle_id?: string;
  published_at?: string;
  source?: string;
  comment?: string;
};

let oracleIndex:
  | {
      cardsByOracleId: Map<string, OracleCard>;
      rulingsByOracleId: Map<string, OracleRuling[]>;
    }
  | undefined;

function resolveRepoFile(...parts: string[]): string | null {
  const candidates = [
    path.resolve(process.cwd(), ...parts),
    path.resolve(process.cwd(), "..", ...parts),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function loadJsonFile<T>(absolutePath: string): T {
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

function normalizeMinus(s: string): string {
  return s.replace(/\u2212/g, "-").replace(/[−–—]/g, "-");
}

export type ParsedLoyaltyLine = {
  costDisplay: string;
  cost: number | "X";
  effect: string;
  rawLine: string;
};

export function parseLoyaltyLinesFromOracleText(oracleText: string): ParsedLoyaltyLine[] {
  const text = normalizeMinus(oracleText);
  const lines = text.split("\n");
  const out: ParsedLoyaltyLine[] = [];

  const re = /^([+\-]?\d+|[+\-]?X|0):\s*(.+)$/i;

  for (const rawLine of lines) {
    const m = rawLine.match(re);
    if (!m) continue;

    const costDisplay = m[1];
    const effect = m[2].trim();

    let cost: number | "X";
    if (costDisplay.toUpperCase().includes("X")) {
      cost = "X";
    } else {
      cost = parseInt(costDisplay, 10);
    }

    out.push({ costDisplay, cost, effect, rawLine });
  }

  return out;
}

export function getOracleIndex(): {
  cardsByOracleId: Map<string, OracleCard>;
  rulingsByOracleId: Map<string, OracleRuling[]>;
} {
  if (oracleIndex) return oracleIndex;

  const oracleCardsPath = resolveRepoFile("oracle-cards.json");
  const rulingsPath = resolveRepoFile("rulings.json");

  const cardsByOracleId = new Map<string, OracleCard>();
  const rulingsByOracleId = new Map<string, OracleRuling[]>();

  if (oracleCardsPath) {
    const cardsJson = loadJsonFile<any>(oracleCardsPath);
    const cardsArr: OracleCard[] = Array.isArray(cardsJson) ? cardsJson : cardsJson?.data || [];

    for (const card of cardsArr) {
      if (card?.oracle_id) {
        cardsByOracleId.set(card.oracle_id, card);
      }
    }
  }

  if (rulingsPath) {
    const rulingsJson = loadJsonFile<any>(rulingsPath);
    const rulingsArr: OracleRuling[] = Array.isArray(rulingsJson) ? rulingsJson : rulingsJson?.data || [];

    for (const r of rulingsArr) {
      const oid = r?.oracle_id;
      if (!oid) continue;
      const list = rulingsByOracleId.get(oid) || [];
      list.push(r);
      rulingsByOracleId.set(oid, list);
    }
  }

  oracleIndex = { cardsByOracleId, rulingsByOracleId };
  return oracleIndex;
}

export function getPlaneswalkerLoyaltyLineByIndex(
  oracleId: string,
  abilityIndex: number
): ParsedLoyaltyLine | null {
  const { cardsByOracleId } = getOracleIndex();
  const card = cardsByOracleId.get(oracleId);
  const oracleText = card?.oracle_text;
  if (!oracleText) return null;

  const lines = parseLoyaltyLinesFromOracleText(oracleText);
  return lines[abilityIndex] || null;
}

export function getRulingsForOracleId(oracleId: string): OracleRuling[] {
  const { rulingsByOracleId } = getOracleIndex();
  return rulingsByOracleId.get(oracleId) || [];
}
