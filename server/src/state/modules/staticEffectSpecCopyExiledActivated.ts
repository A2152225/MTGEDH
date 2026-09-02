// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: expand "have all activated abilities of cards exiled with"
//   (Steward of the Harvest / Hazel's Brewmaster).
// Public: collectActivatedAbilitiesExiledWithSource.

import { isGrantedActivatedAbilityText } from '../../../../shared/src/attachmentAbilityGrants.js';

function cardMatchesExiledType(card: { type_line?: string; type?: string } | null | undefined, cardType: string): boolean {
  const wanted = String(cardType || '').trim().toLowerCase();
  if (!wanted) return true;
  const typeLine = String(card?.type_line || (card as any)?.type || '').toLowerCase();
  return new RegExp(`\\b${wanted.replace(/[^a-z]/g, '')}\\b`).test(typeLine);
}

function extractActivatedAbilityTexts(oracle: string): string[] {
  return String(oracle || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((part) => String(part || '').trim().replace(/\.$/, ''))
    .filter((part) => isGrantedActivatedAbilityText(part));
}

function exileCardsFromState(state: unknown, sourcePermanentId: string): any[] {
  const record = state as {
    zones?: Record<string, { exile?: readonly unknown[] }>;
    exile?: readonly unknown[];
    players?: readonly { exile?: readonly unknown[] }[];
    battlefield?: readonly { id?: string; exiledCards?: readonly unknown[] }[];
  };
  const out: any[] = [];
  if (Array.isArray(record.exile)) out.push(...record.exile);
  const zones = record.zones && typeof record.zones === 'object' ? record.zones : {};
  for (const zone of Object.values(zones)) {
    if (Array.isArray(zone?.exile)) out.push(...zone.exile);
  }
  for (const player of record.players || []) {
    if (Array.isArray(player?.exile)) out.push(...player.exile);
  }
  const sourceId = String(sourcePermanentId || '').trim();
  for (const perm of record.battlefield || []) {
    if (String(perm?.id || '').trim() !== sourceId) continue;
    if (Array.isArray(perm?.exiledCards)) out.push(...perm.exiledCards);
  }
  return out;
}

export function collectActivatedAbilitiesExiledWithSource(
  state: unknown,
  sourcePermanentId: string,
  cardType: string,
): string[] {
  const sourceId = String(sourcePermanentId || '').trim();
  if (!sourceId) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of exileCardsFromState(state, sourceId)) {
    const linked = String(
      card?.exiledWithSourceId
      || card?.card?.exiledWithSourceId
      || card?.exiledWith
      || '',
    ).trim();
    if (linked !== sourceId) continue;
    const face = card?.card && typeof card.card === 'object' ? card.card : card;
    if (!cardMatchesExiledType(face, cardType)) continue;
    for (const ability of extractActivatedAbilityTexts(String(face?.oracle_text || card?.oracle_text || ''))) {
      const key = ability.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ability);
    }
  }
  return out;
}
