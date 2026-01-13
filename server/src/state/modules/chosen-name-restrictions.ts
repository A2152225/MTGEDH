import type { PlayerID } from '../../../../shared/src/index.js';

function normalizeApostrophes(input: string): string {
  return input
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"');
}

export function normalizeCardName(name: string): string {
  return normalizeApostrophes(String(name || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function oracleLower(oracleText: string): string {
  return normalizeApostrophes(String(oracleText || '')).toLowerCase();
}

function restrictionAffectsPlayer(params: {
  restrictionController: string | undefined;
  playerId: PlayerID;
  oracle: string;
}): boolean {
  const { restrictionController, playerId, oracle } = params;

  // Opponents-only restrictions (relative to the permanent's controller)
  if (/\byour opponents\b/.test(oracle) || /\beach opponent\b/.test(oracle) || /\bopponents can't\b/.test(oracle) || /\bopponents cannot\b/.test(oracle)) {
    return !!restrictionController && restrictionController !== playerId;
  }

  // You-only restrictions (rare, but possible)
  if (/\byou can't\b/.test(oracle) || /\byou cannot\b/.test(oracle)) {
    return !!restrictionController && restrictionController === playerId;
  }

  // Default: applies to all players
  return true;
}

function getBattlefield(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

export function isSpellCastingProhibitedByChosenName(state: any, playerId: PlayerID, spellName: string): {
  prohibited: boolean;
  by?: { sourceId?: string; sourceName?: string; chosenName?: string };
} {
  const targetName = normalizeCardName(spellName);
  if (!targetName) return { prohibited: false };

  for (const perm of getBattlefield(state)) {
    const chosen = (perm as any)?.chosenCardName;
    if (!chosen) continue;

    const chosenName = normalizeCardName(String(chosen));
    if (!chosenName || chosenName !== targetName) continue;

    const oracle = oracleLower((perm as any)?.card?.oracle_text || '');

    // Must actually contain the cast-prohibition text.
    const isCastProhibition =
      /spells?\s+with\s+the\s+chosen\s+name\s+(?:can't|cannot)\s+be\s+cast/.test(oracle) ||
      /(?:can't|cannot)\s+cast\s+spells?\s+with\s+the\s+chosen\s+name/.test(oracle);

    if (!isCastProhibition) continue;

    const controller = (perm as any)?.controller as string | undefined;
    if (!restrictionAffectsPlayer({ restrictionController: controller, playerId, oracle })) continue;

    return {
      prohibited: true,
      by: {
        sourceId: (perm as any)?.id,
        sourceName: (perm as any)?.card?.name,
        chosenName: String(chosen),
      },
    };
  }

  return { prohibited: false };
}

export function isAbilityActivationProhibitedByChosenName(
  state: any,
  playerId: PlayerID,
  sourceName: string,
  isManaAbility: boolean
): {
  prohibited: boolean;
  by?: { sourceId?: string; sourceName?: string; chosenName?: string; allowsManaAbilities?: boolean };
} {
  const targetName = normalizeCardName(sourceName);
  if (!targetName) return { prohibited: false };

  for (const perm of getBattlefield(state)) {
    const chosen = (perm as any)?.chosenCardName;
    if (!chosen) continue;

    const chosenName = normalizeCardName(String(chosen));
    if (!chosenName || chosenName !== targetName) continue;

    const oracle = oracleLower((perm as any)?.card?.oracle_text || '');

    const isActivationProhibition =
      /activated abilities of sources with the chosen name\s+(?:can't|cannot)\s+be\s+activated/.test(oracle) ||
      /activated abilities of sources with the chosen name\s+(?:can't|cannot)\s+be\s+activated/.test(oracle);

    if (!isActivationProhibition) continue;

    const controller = (perm as any)?.controller as string | undefined;
    if (!restrictionAffectsPlayer({ restrictionController: controller, playerId, oracle })) continue;

    const allowsManaAbilities =
      /unless\s+they'?re\s+mana\s+abilities/.test(oracle) ||
      /unless\s+they\s+are\s+mana\s+abilities/.test(oracle) ||
      /except\s+for\s+mana\s+abilities/.test(oracle);

    if (isManaAbility && allowsManaAbilities) {
      continue;
    }

    return {
      prohibited: true,
      by: {
        sourceId: (perm as any)?.id,
        sourceName: (perm as any)?.card?.name,
        chosenName: String(chosen),
        allowsManaAbilities,
      },
    };
  }

  return { prohibited: false };
}
