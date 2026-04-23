function normalizeTokenColor(abilityId: 'embalm' | 'eternalize'): string[] {
  return abilityId === 'eternalize' ? ['B'] : ['W'];
}

function addZombieSubtype(typeLineRaw: any): string {
  const typeLine = String(typeLineRaw || '').trim();
  if (!typeLine) {
    return 'Creature - Zombie';
  }

  const separator = typeLine.includes('—') ? ' — ' : ' - ';
  const parts = typeLine.split(/\s+[—-]\s+/);
  const typePart = String(parts[0] || '').trim() || 'Creature';
  const subtypePart = String(parts.slice(1).join(' ') || '').trim();
  const subtypes = subtypePart ? subtypePart.split(/\s+/).filter(Boolean) : [];

  if (!subtypes.some((subtype) => String(subtype || '').toLowerCase() === 'zombie')) {
    subtypes.unshift('Zombie');
  }

  return `${typePart}${separator}${subtypes.join(' ')}`.trim();
}

function cardHasHaste(card: any): boolean {
  const keywords = Array.isArray(card?.keywords) ? card.keywords : [];
  const oracleText = String(card?.oracle_text || '');
  return keywords.some((value: any) => /\bhaste\b/i.test(String(value || ''))) || /\bhaste\b/i.test(oracleText);
}

function parseNumericPT(value: any): number | undefined {
  const text = String(value ?? '').trim();
  if (!/^-?\d+$/.test(text)) {
    return undefined;
  }
  return Number(text);
}

export function buildEmbalmOrEternalizeTokenCard(
  sourceCard: any,
  abilityId: 'embalm' | 'eternalize',
  tokenCardId?: string,
): any {
  const tokenColors = normalizeTokenColor(abilityId);
  const tokenPower = abilityId === 'eternalize' ? '4' : sourceCard?.power;
  const tokenToughness = abilityId === 'eternalize' ? '4' : sourceCard?.toughness;

  return {
    ...(sourceCard || {}),
    id: String(tokenCardId || `${String(sourceCard?.id || abilityId)}_token_card`),
    copiedFromCardId: String(sourceCard?.id || ''),
    zone: 'battlefield',
    name: String(sourceCard?.name || 'Unknown'),
    type_line: addZombieSubtype(sourceCard?.type_line),
    colors: tokenColors,
    color_identity: tokenColors,
    mana_cost: undefined,
    manaCost: undefined,
    mana_value: 0,
    cmc: 0,
    power: tokenPower,
    toughness: tokenToughness,
  };
}

export function buildEmbalmOrEternalizeTokenPermanent(
  sourceCard: any,
  abilityId: 'embalm' | 'eternalize',
  controller: string,
  permanentId: string,
): any {
  const tokenCard = buildEmbalmOrEternalizeTokenCard(sourceCard, abilityId, `${String(permanentId)}_card`);
  const isCreature = /\bcreature\b/i.test(String(tokenCard?.type_line || ''));
  const basePower = abilityId === 'eternalize' ? 4 : parseNumericPT(tokenCard?.power);
  const baseToughness = abilityId === 'eternalize' ? 4 : parseNumericPT(tokenCard?.toughness);

  return {
    id: String(permanentId),
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    isToken: true,
    summoningSickness: isCreature && !cardHasHaste(tokenCard),
    ...(typeof basePower === 'number' ? { basePower } : null),
    ...(typeof baseToughness === 'number' ? { baseToughness } : null),
    card: tokenCard,
  };
}