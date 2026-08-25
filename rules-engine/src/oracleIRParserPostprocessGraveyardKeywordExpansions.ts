/**
 * Graveyard and combat keyword ability expansions for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 21295-21711 of the
 * pre-split file).
 * Cluster moved: the keyword abilities that lower into an explicit activated or triggered
 * ability - scavenge, embalm, eternalize, transmute, typecycling, transfigure, encore,
 * myriad and mobilize.
 * Public entry symbols: the expand*KeywordAbilities passes exported inline below.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { extractLeadingInlineManaCost } from './oracleIRParserPostprocessGraveyardAdditionalCostPermission';
import { normalizeOracleText } from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

export function expandScavengeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'add_counter');
    if (alreadyExpanded || !normalizedText.startsWith('scavenge ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText: "Put X +1/+1 counters on target creature, where X is this card's power. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'target creature' },
          counter: '+1/+1',
          amount: { kind: 'x' },
          raw: "Put X +1/+1 counters on target creature, where X is this card's power.",
        },
      ],
    };
  });
}

export function expandEmbalmKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'create_token');
    if (alreadyExpanded || !normalizedText.startsWith('embalm ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'create_token',
          who: { kind: 'you' },
          token:
            "copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types",
          amount: { kind: 'number', value: 1 },
          raw: "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types.",
        },
      ],
    };
  });
}

export function expandEternalizeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'create_token');
    if (alreadyExpanded || !normalizedText.startsWith('eternalize ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'create_token',
          who: { kind: 'you' },
          token:
            "copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types",
          amount: { kind: 'number', value: 1 },
          raw: "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types.",
        },
      ],
    };
  });
}

export function expandTransmuteKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const matchesCanonicalEffect =
      normalizedEffect.includes('search your library for a card with the same mana value as this card') ||
      normalizedText.includes('search your library for a card with the same mana value as this card') ||
      normalizedEffect.includes('same mana value as this card') ||
      normalizedText.includes('same mana value as this card');
    if (!normalizedText.startsWith('transmute ') && !matchesCanonicalEffect) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Discard this card` } : {}),
      effectText:
        'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.',
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'same_mana_value_as_source' },
          destination: 'hand',
          revealFound: true,
          shuffle: true,
          maxResults: 1,
          raw: 'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle.',
        },
      ],
    };
  });
}

function parseTypecyclingSearchSelector(ability: OracleIRAbility): string | null {
  const normalizedText = normalizeOracleText(String(ability.text || '')).trim();
  if (/^basic landcycling\b/i.test(normalizedText)) return 'basic land';

  const keywordMatch = normalizedText.match(/^([a-z]+)cycling\b/i);
  if (keywordMatch) {
    return String(keywordMatch[1] || '').trim();
  }

  const effectMatch = normalizeOracleText(String(ability.effectText || ''))
    .trim()
    .match(/^search your library for (?:a|an) (.+?) card, reveal it, put it into your hand, then shuffle/i);
  if (!effectMatch) return null;
  return String(effectMatch[1] || '').trim();
}

function formatTypecyclingSelectorForEffect(selector: string): string {
  if (/^basic land$/i.test(selector)) return 'basic land';
  return String(selector || '')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function indefiniteArticleForSelector(selector: string): 'a' | 'an' {
  return /^[aeiou]/i.test(String(selector || '').trim()) ? 'an' : 'a';
}

export function expandTypecyclingKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const alreadyExpanded = ability.steps.some((step) => step.kind === 'search_library');
    const matchesKeywordLine =
      /^basic landcycling\b/i.test(normalizedText) ||
      (/^[a-z]+cycling\b/i.test(normalizedText) && !/^cycling\b/i.test(normalizedText));
    const matchesCanonicalEffect =
      normalizedEffect.startsWith('search your library for a ') ||
      normalizedEffect.startsWith('search your library for an ');
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const selector = parseTypecyclingSearchSelector(ability);
    if (!selector) return ability;

    const formattedSelector = formatTypecyclingSelectorForEffect(selector);
    const article = indefiniteArticleForSelector(formattedSelector);
    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Discard this card` } : {}),
      effectText: `Search your library for ${article} ${formattedSelector} card, reveal it, put it into your hand, then shuffle.`,
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'raw', text: selector },
          destination: 'hand',
          revealFound: true,
          shuffle: true,
          maxResults: 1,
          raw: `Search your library for ${article} ${formattedSelector} card, reveal it, put it into your hand, then shuffle.`,
        },
      ],
    };
  });
}

export function expandTransfigureKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded = ability.steps.some(
      (step) => step.kind === 'search_library' && (step as any).criteria?.kind === 'same_mana_value_as_source'
    );
    const canonicalEffectPrefix = 'search your library for a creature card with the same mana value as this permanent';
    const matchesKeywordLine = normalizedText.startsWith('transfigure ');
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Sacrifice this permanent` } : {}),
      effectText:
        'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'same_mana_value_as_source', requiredCardType: 'creature' },
          destination: 'battlefield',
          shuffle: true,
          maxResults: 1,
          raw: 'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle.',
        },
      ],
    };
  });
}

export function expandEncoreKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'create_token' && (step as any).attacking === 'each_opponent');
    const canonicalEffectPrefix = "for each opponent, create a token that's a copy of it";
    const matchesKeywordLine = normalizedText.startsWith('encore ');
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: "copy of it",
      entersTapped: true,
      attacking: 'each_opponent',
      grantsHaste: 'permanent',
      atNextEndStep: 'sacrifice',
      raw: "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step.",
    };

    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.",
      steps: matchesKeywordLine
        ? [
            {
              kind: 'move_zone',
              what: { kind: 'raw', text: 'this card' },
              to: 'exile',
              toRaw: 'exile',
              raw: 'Exile this card from your graveyard.',
            },
            createTokenStep,
          ]
        : [createTokenStep],
    };
  });
}

export function expandMyriadKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.triggerCondition === 'this creature attacks' &&
      ability.steps.some((step) => step.kind === 'create_token' && (step as any).attacking === 'each_other_opponent');
    const canonicalEffectPrefix =
      "for each opponent other than defending player, create a token that's a copy of it";
    const canonicalTokenCopyEffectPrefix =
      'for each opponent other than defending player, create a token copy';
    const canonicalOptionalTokenCopyEffectPrefix =
      'for each opponent other than defending player, you may create a token copy';
    const normalizedTextWithoutTrigger = normalizedText.replace(/^whenever it attacks,\s*/i, '');
    const matchesKeywordLine = normalizedText === 'myriad';
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix) ||
      normalizedEffect.startsWith(canonicalTokenCopyEffectPrefix) ||
      normalizedEffect.startsWith(canonicalOptionalTokenCopyEffectPrefix) ||
      normalizedTextWithoutTrigger.startsWith(canonicalTokenCopyEffectPrefix) ||
      normalizedTextWithoutTrigger.startsWith(canonicalOptionalTokenCopyEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: "copy of it",
      entersTapped: true,
      attacking: 'each_other_opponent',
      atEndOfCombat: 'exile',
      raw: "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
    };

    return {
      ...ability,
      type: AbilityType.TRIGGERED,
      triggerCondition: 'this creature attacks',
      effectText:
        "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
      steps: [createTokenStep],
    };
  });
}

export function expandMobilizeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    // A create_token step that already carries the whole reminder ("... Sacrifice them at the
    // beginning of the next end step.") is canonical. One that stopped at the first sentence still
    // needs the rewrite below, even though the attacks trigger was attached upstream.
    const alreadyExpanded =
      ability.triggerCondition === 'this creature attacks' &&
      ability.steps.some(
        (step) =>
          step.kind === 'create_token' &&
          (step as any).attacking === 'defending_player' &&
          /next end step/i.test(String((step as any).raw || ''))
      );
    const mobilizeMatch = normalizedText.match(/^mobilize\s+(\d+)(?:\s*\(.*)?$/i);
    const canonicalEffectPrefix = 'create ';
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) &&
      normalizedEffect.includes('red warrior creature token') &&
      normalizedEffect.includes('enter tapped and attacking') &&
      normalizedEffect.includes('next end step');
    if (alreadyExpanded || (!mobilizeMatch && !matchesCanonicalEffect)) {
      return ability;
    }

    const canonicalAmountMatch = normalizedEffect.match(/^create\s+(a|an|\d+)\s+1\/1 red warrior creature token/);
    const inferredAmountText = String(mobilizeMatch?.[1] || canonicalAmountMatch?.[1] || '1').trim().toLowerCase();
    const amount =
      inferredAmountText === 'a' || inferredAmountText === 'an'
        ? 1
        : Number.parseInt(inferredAmountText, 10);
    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: Number.isFinite(amount) && amount > 0 ? amount : 1 },
      token: '1/1 red Warrior creature',
      entersTapped: true,
      attacking: 'defending_player',
      atNextEndStep: 'sacrifice',
      raw: `Create ${Number.isFinite(amount) && amount > 1 ? amount : 'a'} 1/1 red Warrior creature token${Number.isFinite(amount) && amount > 1 ? 's' : ''}. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.`,
    };

    return {
      ...ability,
      type: AbilityType.TRIGGERED,
      triggerCondition: 'this creature attacks',
      effectText: createTokenStep.raw,
      steps: [createTokenStep],
    };
  });
}

