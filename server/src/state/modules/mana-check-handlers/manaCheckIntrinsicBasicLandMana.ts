// Origin parent: server/src/state/modules/mana-check-handlers/manaCheckExactSources.ts
// Cluster moved: intrinsic basic-land mana for exact payment sources.
// Public entry symbols: buildIntrinsicBasicLandExactOptions.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.
//
// Urborg / Yavimaya are nonbasic lands with no printed "{T}: Add". Their only
// mana ability is the intrinsic one from the basic land type they grant to
// every land, including themselves (CR 305.6). Basic-name shortcuts must also
// offer colors added by those grants, not only the printed name.

import { getEffectiveBasicLandTypes } from "../mana-abilities.js";
import {
  type ExactManaSourceOption,
  type SimpleManaKey,
  createSingleColorProduction,
} from "./manaCheckSimplePool.js";

const BASIC_LAND_TYPE_TO_POOL_KEY: Record<string, SimpleManaKey> = {
  plains: 'white',
  island: 'blue',
  swamp: 'black',
  mountain: 'red',
  forest: 'green',
};

const PRINTED_BASIC_LAND_NAME = /^(?:snow-covered\s+)?(plains|island|swamp|mountain|forest)$/i;

function poolKeysForEffectiveBasicLandTypes(state: any, permanent: any): SimpleManaKey[] {
  const keys: SimpleManaKey[] = [];
  for (const landType of getEffectiveBasicLandTypes(state, permanent)) {
    const key = BASIC_LAND_TYPE_TO_POOL_KEY[String(landType || '').toLowerCase()];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function optionsForKeys(keys: SimpleManaKey[]): ExactManaSourceOption[] {
  return keys.map((key) => ({ produced: createSingleColorProduction(key) }));
}

/**
 * Exact-source options when a permanent's mana is only its basic land types.
 * Returns null when printed "{T}: Add" / other ": Add" text should be parsed
 * instead. An empty array means "this permanent produces no intrinsic mana"
 * and the caller should not fall through to oracle text (printed basic names).
 */
export function buildIntrinsicBasicLandExactOptions(
  state: any,
  permanent: any,
  oracleText: string,
): ExactManaSourceOption[] | null {
  const card = permanent?.card;
  if (!card) return null;

  const cardName = String(card.name || '').trim().toLowerCase();
  const typeLine = String(card.type_line || '').toLowerCase();
  const basicName = cardName.match(PRINTED_BASIC_LAND_NAME);
  const hasPrintedAdd = /:\s*add\s+/i.test(String(oracleText || ''));
  const keys = poolKeysForEffectiveBasicLandTypes(state, permanent);
  const isLand = typeLine.includes('land') || keys.length > 0;

  if (basicName) {
    if (keys.length === 0) {
      const fallback = BASIC_LAND_TYPE_TO_POOL_KEY[String(basicName[1] || '').toLowerCase()];
      if (fallback) keys.push(fallback);
    }
    return optionsForKeys(keys);
  }

  // Nonbasic lands (and Ashaya creature-lands) with no printed mana text.
  // Includes the source of "Each land is a Swamp/Forest in addition…".
  if (!isLand || hasPrintedAdd || keys.length === 0) return null;
  return optionsForKeys(keys);
}
