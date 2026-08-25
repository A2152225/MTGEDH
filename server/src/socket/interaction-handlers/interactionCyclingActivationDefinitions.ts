/**
 * socket/interaction-handlers/interactionCyclingActivationDefinitions.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: parsing cycling / typecycling keyword lines off oracle text
 *   into activation definitions (cost, stack description, search filter) and
 *   picking the definition matching an activated ability id.
 * Public entry symbols: CyclingActivationDefinition,
 *   getCyclingDefinitionForActivation.
 */

export type CyclingActivationDefinition = {
  kind: 'cycling' | 'typecycling';
  keywordLabel: string;
  cost: string;
  stackDescription: string;
  searchCriteria?: string;
  searchFilter?: any;
};

function titleCaseCyclingText(value: string): string {
  return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildTypecyclingDefinition(rawSelector: string, cost: string): CyclingActivationDefinition {
  const normalizedSelector = String(rawSelector || '').trim().toLowerCase();
  const prettySelector = titleCaseCyclingText(rawSelector);
  const article = /^[aeiou]/i.test(prettySelector) ? 'an' : 'a';
  const landSelectors = new Set([
    'basic land',
    'artifact land',
    'land',
    'plains',
    'island',
    'swamp',
    'mountain',
    'forest',
    'desert',
    'gate',
    'cave',
    'locus',
    'lair',
    'sphere',
    'mine',
    'tower',
    'power-plant',
  ]);

  if (normalizedSelector === 'basic land') {
    return {
      kind: 'typecycling',
      keywordLabel: `${prettySelector}cycling`,
      cost,
      stackDescription: 'Search your library for a basic land card',
      searchCriteria: 'a basic land card',
      searchFilter: { types: ['land'], supertypes: ['basic'] },
    };
  }

  if (normalizedSelector === 'artifact land') {
    return {
      kind: 'typecycling',
      keywordLabel: `${prettySelector}cycling`,
      cost,
      stackDescription: 'Search your library for an artifact land card',
      searchCriteria: 'an artifact land card',
      searchFilter: { allTypes: ['artifact', 'land'] },
    };
  }

  if (landSelectors.has(normalizedSelector) || normalizedSelector.endsWith(' land')) {
    return {
      kind: 'typecycling',
      keywordLabel: `${prettySelector}cycling`,
      cost,
      stackDescription: `Search your library for ${article} ${prettySelector} card`,
      searchCriteria: `${article} ${prettySelector} card`,
      searchFilter: normalizedSelector === 'land'
        ? { types: ['land'] }
        : { types: ['land'], subtypes: [normalizedSelector] },
    };
  }

  return {
    kind: 'typecycling',
    keywordLabel: `${prettySelector}cycling`,
    cost,
    stackDescription: `Search your library for ${article} ${prettySelector} creature card`,
    searchCriteria: `${article} ${prettySelector} creature card`,
    searchFilter: { types: ['creature'], subtypes: [normalizedSelector] },
  };
}

function getCyclingDefinitions(oracleTextRaw: string): CyclingActivationDefinition[] {
  const definitions: CyclingActivationDefinition[] = [];
  const lines = String(oracleTextRaw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const plainCyclingMatch = line.match(/^cycling\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (plainCyclingMatch) {
      definitions.push({
        kind: 'cycling',
        keywordLabel: 'Cycling',
        cost: plainCyclingMatch[1],
        stackDescription: 'Draw a card',
      });
      continue;
    }

    const typeCyclingMatch = line.match(/^(.+?)cycling\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (!typeCyclingMatch) {
      continue;
    }

    const rawSelector = String(typeCyclingMatch[1] || '').trim();
    const cost = String(typeCyclingMatch[2] || '').trim();
    if (!rawSelector || !cost) {
      continue;
    }

    definitions.push(buildTypecyclingDefinition(rawSelector, cost));
  }

  return definitions;
}

export function getCyclingDefinitionForActivation(oracleTextRaw: string, normalizedAbilityId: string, cardId: string): CyclingActivationDefinition | undefined {
  const definitions = getCyclingDefinitions(oracleTextRaw);
  const escapedCardId = String(cardId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parserAbilityMatch = normalizedAbilityId.match(new RegExp(`^${escapedCardId}-cycling-(\\d+)$`, 'i'));
  if (parserAbilityMatch) {
    const abilityIndex = Number.parseInt(parserAbilityMatch[1] || '', 10);
    return Number.isFinite(abilityIndex) ? definitions[abilityIndex] : undefined;
  }

  if (normalizedAbilityId === 'cycling') {
    return definitions.find((definition) => definition.kind === 'cycling');
  }

  return undefined;
}
