import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import type { TokenCharacteristics } from './tokenCreationTypes';

function generateTokenId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const TOKEN_KEYWORD_NAMES: Record<string, string> = {
  deathtouch: 'Deathtouch',
  defender: 'Defender',
  double_strike: 'Double strike',
  first_strike: 'First strike',
  flying: 'Flying',
  haste: 'Haste',
  hexproof: 'Hexproof',
  indestructible: 'Indestructible',
  lifelink: 'Lifelink',
  menace: 'Menace',
  reach: 'Reach',
  trample: 'Trample',
  vigilance: 'Vigilance',
};

function canonicalizeTokenAbility(ability: string): string {
  const normalized = String(ability || '').trim();
  const keywordKey = normalized
    .replace(/[.!]+$/, '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  return TOKEN_KEYWORD_NAMES[keywordKey] || normalized;
}

export function createTokenPermanent(
  characteristics: TokenCharacteristics,
  controllerId: PlayerID,
  sourceId?: string,
  sourceNameOrWithCounters?: string | Record<string, number>,
  withCountersArg?: Record<string, number>
): BattlefieldPermanent {
  const tokenId = `token-${generateTokenId()}`;
  const sourceName = typeof sourceNameOrWithCounters === 'string' ? sourceNameOrWithCounters : undefined;
  const withCounters =
    typeof sourceNameOrWithCounters === 'string'
      ? withCountersArg
      : sourceNameOrWithCounters;

  const typeLineParts: string[] = ['Token'];
  if (characteristics.isLegendary) typeLineParts.push('Legendary');
  typeLineParts.push(...characteristics.types);
  if (characteristics.subtypes.length > 0) {
    typeLineParts.push('—');
    typeLineParts.push(...characteristics.subtypes);
  }
  const abilities = characteristics.abilities.map(canonicalizeTokenAbility);
  const startingLoyalty =
    typeof characteristics.loyalty === 'number' && Number.isFinite(characteristics.loyalty)
      ? Math.max(0, Math.floor(characteristics.loyalty))
      : undefined;
  const counters: Record<string, number> = { ...(withCounters || {}) };
  if (startingLoyalty !== undefined && counters.loyalty === undefined) {
    counters.loyalty = startingLoyalty;
  }

  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: characteristics.entersTapped || false,
    summoningSickness: characteristics.types.includes('Creature'),
    counters,
    attachedTo: undefined,
    attachments: [],
    modifiers: [],
    card: {
      id: tokenId,
      name: characteristics.name,
      type_line: typeLineParts.join(' '),
      oracle_text: abilities.join('\n'),
      keywords: abilities,
      power: characteristics.power?.toString(),
      toughness: characteristics.toughness?.toString(),
      colors: [...characteristics.colors],
      mana_cost: '',
      cmc: 0,
      image_uris: {},
    } as KnownCardRef,
    basePower: characteristics.power,
    baseToughness: characteristics.toughness,
    ...(startingLoyalty !== undefined ? { loyalty: startingLoyalty } : {}),
    isToken: true,
    createdBySourceId: sourceId ? String(sourceId).trim() || undefined : undefined,
    createdBySourceName: sourceName ? String(sourceName).trim() || undefined : undefined,
  } as BattlefieldPermanent;
}
