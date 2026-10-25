// server/src/socket/util-handlers/manaAbilityLineResolvers.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: activated-ability line lookup, client-style mana ability ids,
//   and legacy mana-ability id resolution used by calculateManaProduction.
// Public entry symbols: resolveActivatedAbilityLineById,
//   resolveClientStyleManaAbilityById, resolveLegacyManaAbilityById.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { getManaAbilitiesForPermanent } from "../../state/modules/mana-abilities.js";

type ResolvedActivatedAbilityLine = {
  lineText: string;
  costText: string;
  effectText: string;
};

function normalizeActivatedAbilityOracleLine(line: string): string {
  const trimmed = String(line || '').trim();
  const wrappedMatch = trimmed.match(/^\((.*)\)\.?$/);
  return String(wrappedMatch?.[1] || trimmed).trim();
}

export function resolveActivatedAbilityLineById(permanent: any, abilityId?: string | null): ResolvedActivatedAbilityLine | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedAbilityId) return undefined;

  const genericAbilityMatch = normalizedAbilityId.match(/-ability-(\d+)$/i);
  if (!genericAbilityMatch) return undefined;

  const targetIndex = Number(genericAbilityMatch[1]);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return undefined;

  const oracleText = String(permanent?.card?.oracle_text || '').trim();
  if (!oracleText) return undefined;

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;
  const lines = oracleText
    .split(/\r?\n/)
    .map(normalizeActivatedAbilityOracleLine)
    .filter(Boolean);

  let genericAbilityIndex = 0;
  for (const line of lines) {
    const powerUpMatch = line.match(/^Power-up\s*[—-]\s*((?:\{[^}]+\})+)\s*:\s*(.+)$/i);
    if (powerUpMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(powerUpMatch[1] || '').trim(),
          effectText: String(powerUpMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
      continue;
    }

    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(activatedMatch[1] || '').trim(),
          effectText: String(activatedMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
      continue;
    }

    const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
    if (textOnlyMatch) {
      if (genericAbilityIndex === targetIndex) {
        return {
          lineText: line,
          costText: String(textOnlyMatch[1] || '').trim(),
          effectText: String(textOnlyMatch[2] || '').trim(),
        };
      }
      genericAbilityIndex += 1;
    }
  }

  return undefined;
}

/**
 * Client battlefield UI uses ids like "{cardId}-mana-g-1" for intrinsic basic-land mana.
 * Server legacy mana abilities use ids like "native_g" / "native_choice_2".
 */
export function resolveClientStyleManaAbilityById(
  abilityId?: string | null,
): { id: string; cost: string; produces: string[]; amount: number; producesAllAtOnce: boolean } | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  const match = normalizedAbilityId.match(/-mana-([wubrgc])-(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const color = String(match[1] || '').toUpperCase();
  if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) {
    return undefined;
  }

  return {
    id: normalizedAbilityId,
    cost: '{T}',
    produces: [color],
    amount: 1,
    producesAllAtOnce: false,
  };
}

function resolveManaAbilityForClientAbilityId(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId: string,
): any | undefined {
  const scopedLine = resolveActivatedAbilityLineById(permanent, abilityId);
  if (!scopedLine) return undefined;

  let abilities: any[] = [];
  try {
    abilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
  } catch {
    return undefined;
  }
  if (abilities.length === 0) return undefined;

  const effectText = String(scopedLine.effectText || '').toLowerCase();
  const producesColorlessOnly = /\badd\s*\{c\}/i.test(effectText) && !/any color/i.test(effectText);
  if (producesColorlessOnly) {
    return abilities.find((entry) => {
      const produces = Array.isArray(entry?.produces) ? entry.produces : [];
      return produces.length === 1 && String(produces[0] || '').toUpperCase() === 'C';
    });
  }

  if (/one mana of any color|mana of any color|any one color/i.test(effectText)) {
    return abilities.find((entry) => entry?.spendRestriction)
      || abilities.find((entry) => {
        const produces = Array.isArray(entry?.produces) ? entry.produces : [];
        return produces.length >= 2 && String(entry?.id || '') !== 'native_c';
      })
      || abilities.find((entry) => ['native_any', 'native_commander_any', 'native_pay_life_any'].includes(String(entry?.id || '')));
  }

  if (/mana\s+of\s+the\s+chosen\s+colou?r/i.test(effectText)) {
    return abilities.find((entry) => String(entry?.id || '') === 'native_chosen_color')
      || abilities.find((entry) => {
        const produces = Array.isArray(entry?.produces) ? entry.produces : [];
        return produces.length === 1 && ['W', 'U', 'B', 'R', 'G'].includes(String(produces[0] || '').toUpperCase());
      });
  }

  const abilityIndex = Number(abilityId.match(/-ability-(\d+)$/i)?.[1] ?? -1);
  if (Number.isInteger(abilityIndex) && abilityIndex >= 0) {
    const manaProducingAbilities = abilities.filter((entry) => {
      const produces = Array.isArray(entry?.produces) ? entry.produces : [];
      return produces.length > 0;
    });
    if (abilityIndex < manaProducingAbilities.length) {
      return manaProducingAbilities[abilityIndex];
    }
  }

  return abilities[0];
}

export function resolveLegacyManaAbilityById(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId?: string | null,
): any | undefined {
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedAbilityId) {
    return undefined;
  }

  if (/-ability-\d+$/i.test(normalizedAbilityId)) {
    return resolveManaAbilityForClientAbilityId(gameState, permanent, playerId, normalizedAbilityId);
  }

  const clientStyleAbility = resolveClientStyleManaAbilityById(normalizedAbilityId);
  if (clientStyleAbility) {
    return clientStyleAbility;
  }

  try {
    const abilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
    const exact = abilities.find((ability: any) => String(ability?.id || '').trim() === normalizedAbilityId);
    if (exact) return exact;
    // Client payment rows use native_any. Printed lines are native_any_0; continuous
    // grants are continuous_any_<permanentId>. Either one is the selected ability.
    if (normalizedAbilityId === 'native_any' || normalizedAbilityId === 'native_commander_any') {
      const indexedPrefix = normalizedAbilityId === 'native_any' ? 'native_any_' : 'native_commander_any_';
      return abilities.find((ability: any) => {
        const id = String(ability?.id || '');
        if (id.startsWith(indexedPrefix)) return true;
        return normalizedAbilityId === 'native_any' && id.startsWith('continuous_any_');
      });
    }
    return undefined;
  } catch {
    return undefined;
  }
}
