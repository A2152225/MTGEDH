export type ActivatedAbilityConditionKey =
  | 'metalcraft'
  | 'threshold'
  | 'delirium'
  | 'spellMastery'
  | 'ferocious'
  | 'formidable'
  | 'coven';

export interface ActivatedAbilityConditionRequirement {
  key: ActivatedAbilityConditionKey;
  label: string;
  errorCode: string;
  getFailureMessage: (cardName: string) => string;
  matches: (text: string) => boolean;
}

function normalizeAbilityText(text: string): string {
  return String(text || '').toLowerCase();
}

function textIncludesAny(text: string, fragments: string[]): boolean {
  const normalized = normalizeAbilityText(text);
  return fragments.some(fragment => normalized.includes(fragment));
}

const ACTIVATED_ABILITY_CONDITION_REQUIREMENTS: ActivatedAbilityConditionRequirement[] = [
  {
    key: 'metalcraft',
    label: 'Metalcraft',
    errorCode: 'METALCRAFT_NOT_ACTIVE',
    getFailureMessage: () => 'Metalcraft is not active.',
    matches: text => textIncludesAny(text, ['metalcraft', 'three or more artifacts', '3 or more artifacts']),
  },
  {
    key: 'threshold',
    label: 'Threshold',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s threshold ability requires seven or more cards in your graveyard.`,
    matches: text => textIncludesAny(text, ['threshold', 'seven or more cards in your graveyard']),
  },
  {
    key: 'delirium',
    label: 'Delirium',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s delirium ability requires four or more card types among cards in your graveyard.`,
    matches: text => textIncludesAny(text, ['delirium', 'four or more card types among cards in your graveyard']),
  },
  {
    key: 'spellMastery',
    label: 'Spell mastery',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s spell mastery ability requires two or more instant and/or sorcery cards in your graveyard.`,
    matches: text => {
      const normalized = normalizeAbilityText(text);
      return normalized.includes('spell mastery') ||
        /two or more instant and\/?or sorcery cards in your graveyard/.test(normalized);
    },
  },
  {
    key: 'ferocious',
    label: 'Ferocious',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s ferocious ability requires you to control a creature with power 4 or greater.`,
    matches: text => textIncludesAny(text, ['ferocious', 'creature with power 4 or greater']),
  },
  {
    key: 'formidable',
    label: 'Formidable',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s formidable ability requires creatures you control to have total power 8 or greater.`,
    matches: text => textIncludesAny(text, ['formidable', 'creatures you control have total power 8 or greater']),
  },
  {
    key: 'coven',
    label: 'Coven',
    errorCode: 'ACTIVATION_CONDITION_NOT_MET',
    getFailureMessage: cardName => `${cardName}'s coven ability requires you to control three or more creatures with different powers.`,
    matches: text => textIncludesAny(text, ['coven', 'three or more creatures with different powers']),
  },
];

export function detectActivatedAbilityConditionRequirement(
  fullAbilityText: string,
  oracleText?: string,
  matchIndex?: number,
): ActivatedAbilityConditionRequirement | null {
  const directRequirement = ACTIVATED_ABILITY_CONDITION_REQUIREMENTS.find(requirement =>
    requirement.matches(fullAbilityText),
  );
  if (directRequirement) {
    return directRequirement;
  }

  if (typeof matchIndex !== 'number' || !Number.isFinite(matchIndex)) {
    return null;
  }

  const normalizedOracleText = String(oracleText || '');
  if (!normalizedOracleText) {
    return null;
  }

  const prefix = normalizedOracleText.slice(Math.max(0, matchIndex - 160), matchIndex);
  const lastLinePrefix = prefix.split(/\r?\n/).pop() || prefix;
  return ACTIVATED_ABILITY_CONDITION_REQUIREMENTS.find(requirement =>
    requirement.matches(lastLinePrefix),
  ) || null;
}