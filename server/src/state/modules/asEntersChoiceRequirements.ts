/**
 * Shared as-enters choice derivation.
 *
 * Oracle IR choose_* steps are the sole source of truth (land play + permanent spell ETB).
 */

import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';

export type MagicColorName = 'white' | 'blue' | 'black' | 'red' | 'green';

export type AsEntersChoiceKind =
  | 'color'
  | 'creature_type'
  | 'basic_land_type'
  | 'card_name'
  | 'player'
  | 'opponent'
  | 'copy_permanent';

export interface AsEntersChoiceRequirement {
  kind: AsEntersChoiceKind;
  mandatory: boolean;
  reason: string;
  colors?: MagicColorName[];
  excludedColors?: MagicColorName[];
  excludedCreatureTypes?: string[];
  copyType?: 'land' | 'creature' | 'permanent';
  enterTappedIfCopied?: boolean;
  /** Permanent enters under the chosen opponent's control (Xantcha-style replacement). */
  appliesControlChange?: boolean;
}

const ALL_COLORS: readonly MagicColorName[] = ['white', 'blue', 'black', 'red', 'green'];

const MANA_TO_COLOR: Record<string, MagicColorName> = {
  '{W}': 'white',
  W: 'white',
  '{U}': 'blue',
  U: 'blue',
  '{B}': 'black',
  B: 'black',
  '{R}': 'red',
  R: 'red',
  '{G}': 'green',
  G: 'green',
};

function manaOptionsToColors(manaOptions: readonly string[] | undefined): MagicColorName[] {
  if (!Array.isArray(manaOptions) || manaOptions.length === 0) return [...ALL_COLORS];
  const colors: MagicColorName[] = [];
  for (const option of manaOptions) {
    const key = String(option || '').trim().toUpperCase();
    const normalized = key.startsWith('{') ? key : `{${key}}`;
    const color = MANA_TO_COLOR[normalized] || MANA_TO_COLOR[key];
    if (color && !colors.includes(color)) colors.push(color);
  }
  return colors.length > 0 ? colors : [...ALL_COLORS];
}

function collectIrAsEntersChoices(oracleText: string, cardName: string): AsEntersChoiceRequirement[] {
  let ir: ReturnType<typeof parseOracleTextToIR>;
  try {
    ir = parseOracleTextToIR(oracleText, cardName || 'Card');
  } catch {
    return [];
  }

  const requirements: AsEntersChoiceRequirement[] = [];
  for (const ability of ir.abilities || []) {
    for (const step of ability.steps || []) {
      const kind = String((step as any).kind || '');
      const raw = String((step as any).raw || '');
      const optional = Boolean((step as any).optional);
      const looksAsEnters = /\bas\s+.+\s+enters\b/i.test(raw)
        || /enter(?:s)?(?:\s+tapped)?\s+as\s+a\s+copy\b/i.test(raw)
        || requirements.length > 0;

      if (kind === 'grant_static_ability') {
        const effectText = Array.isArray((step as any).effectText)
          ? (step as any).effectText.map((entry: unknown) => String(entry || '')).join(' ')
          : '';
        const copySource = `${effectText} ${raw}`;
        const copyMatch = copySource.match(
          /may enter(?:\s+tapped)? as a copy of any (land|creature|permanent) on the battlefield/i,
        );
        if (copyMatch) {
          const copyType = String(copyMatch[1] || 'permanent').toLowerCase() as 'land' | 'creature' | 'permanent';
          const enterTappedIfCopied = /enter(?:s)?\s+tapped\s+as\s+a\s+copy/i.test(copySource);
          requirements.push({
            kind: 'copy_permanent',
            mandatory: false,
            reason: enterTappedIfCopied
              ? `You may have this ${copyType} enter tapped as a copy of any ${copyType} on the battlefield`
              : `You may have this ${copyType} enter as a copy of any ${copyType} on the battlefield`,
            copyType,
            enterTappedIfCopied,
          });
        }
        continue;
      }

      // Accept standalone choose_* from as-enters abilities and compound follow-ups.
      if (kind === 'choose_color') {
        if (!looksAsEnters && !/\bchoose\s+a\s+colou?r\b/i.test(raw)) continue;
        // Skip activated-ability color choices (cost: Choose a color...)
        if (/^\s*\{/.test(String(ability.text || ability.effectText || ''))) continue;
        const colors = manaOptionsToColors((step as any).manaOptions);
        const excludedColors = ALL_COLORS.filter((c) => !colors.includes(c));
        const isColorWord = /\bcolou?r\s+word\b/i.test(raw);
        requirements.push({
          kind: 'color',
          mandatory: !optional,
          reason: isColorWord
            ? 'Choose a color word'
            : excludedColors.length === 1
              ? `Choose a color other than ${excludedColors[0]}`
              : 'Choose a color',
          colors,
          ...(excludedColors.length > 0 ? { excludedColors } : {}),
        });
        continue;
      }

      if (kind === 'choose_creature_type') {
        const excluded = Array.isArray((step as any).excludedTypes)
          ? ((step as any).excludedTypes as string[]).map((t) => String(t).trim()).filter(Boolean)
          : undefined;
        requirements.push({
          kind: 'creature_type',
          mandatory: !optional,
          reason: excluded?.length
            ? `Choose a creature type other than ${excluded.join(', ')}`
            : 'Choose a creature type',
          ...(excluded?.length ? { excludedCreatureTypes: excluded } : {}),
        });
        continue;
      }

      if (kind === 'choose_basic_land_type') {
        requirements.push({
          kind: 'basic_land_type',
          mandatory: !optional,
          reason: 'Choose a basic land type',
        });
        continue;
      }

      if (kind === 'choose_card_name') {
        if (!looksAsEnters && !/\bas\s+.+\s+enters\b/i.test(String(ability.text || ''))) continue;
        requirements.push({
          kind: 'card_name',
          mandatory: !optional,
          reason: 'Choose a card name',
        });
        continue;
      }

      if (kind === 'choose_opponent') {
        requirements.push({
          kind: 'opponent',
          mandatory: !optional,
          reason: 'Choose an opponent',
        });
        continue;
      }

      if (
        kind === 'gain_control'
        && (
          /enters(?: the battlefield)? under the control of an opponent/i.test(raw)
          || /under the control of an opponent of your choice/i.test(raw)
        )
      ) {
        requirements.push({
          kind: 'opponent',
          mandatory: !optional,
          reason: 'Choose an opponent to control this permanent',
          appliesControlChange: true,
        });
        continue;
      }

      if (kind === 'player_choice' && /choose\s+a\s+player/i.test(raw)) {
        requirements.push({
          kind: 'player',
          mandatory: !optional,
          reason: 'Choose a player',
        });
      }
    }
  }

  return requirements;
}

/**
 * Derive all as-enters choice requirements for a card.
 */
export function getAsEntersChoiceRequirements(card: any): AsEntersChoiceRequirement[] {
  if (!card) return [];
  const oracleText = String(card.oracle_text || '');
  if (!oracleText.trim()) return [];
  const cardName = String(card.name || 'Card');

  // IR is the sole source of truth for as-enters choice derivation (Phase 8).
  return collectIrAsEntersChoices(oracleText, cardName);
}

/**
 * Color-choice convenience wrapper (land/spell ETB).
 */
export function requiresColorChoice(card: any): {
  required: boolean;
  reason: string;
  colors?: MagicColorName[];
  excludedColors?: MagicColorName[];
  mandatory?: boolean;
} {
  const colorReq = getAsEntersChoiceRequirements(card).find((req) => req.kind === 'color');
  if (!colorReq) return { required: false, reason: '' };
  return {
    required: true,
    reason: colorReq.reason,
    colors: colorReq.colors || [...ALL_COLORS],
    ...(colorReq.excludedColors ? { excludedColors: colorReq.excludedColors } : {}),
    mandatory: colorReq.mandatory,
  };
}
