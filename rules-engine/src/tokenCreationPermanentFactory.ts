import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import type { TokenCharacteristics } from './tokenCreationTypes';

function generateTokenId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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

  const typeLineParts: string[] = [];
  if (characteristics.isLegendary) typeLineParts.push('Legendary');
  typeLineParts.push(...characteristics.types);
  if (characteristics.subtypes.length > 0) {
    typeLineParts.push('â€”');
    typeLineParts.push(...characteristics.subtypes);
  }

  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: characteristics.entersTapped || false,
    summoningSickness: characteristics.types.includes('Creature'),
    counters: withCounters || {},
    attachedTo: undefined,
    attachments: [],
    modifiers: [],
    card: {
      id: tokenId,
      name: characteristics.name,
      type_line: typeLineParts.join(' '),
      oracle_text: characteristics.abilities.join('\n'),
      power: characteristics.power?.toString(),
      toughness: characteristics.toughness?.toString(),
      colors: [...characteristics.colors],
      mana_cost: '',
      cmc: 0,
      image_uris: {},
    } as KnownCardRef,
    basePower: characteristics.power,
    baseToughness: characteristics.toughness,
    isToken: true,
    createdBySourceId: sourceId ? String(sourceId).trim() || undefined : undefined,
    createdBySourceName: sourceName ? String(sourceName).trim() || undefined : undefined,
  } as BattlefieldPermanent;
}
