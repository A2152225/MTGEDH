// Stamp GY→exile provenance so copy-exiled-activated collectors
// (Steward of the Harvest / Hazel's Brewmaster) can match cards against
// spec.sourcePermanentId. Do not stamp stack-item / effect ids.
// Public: stampCardExiledWithSource, resolveGraveyardExileSourcePermanentId,
//   stampLiveExileCardWithSource.

export function stampCardExiledWithSource(card: any, sourceId: string | undefined | null): any {
  const id = String(sourceId || '').trim();
  if (!card || typeof card !== 'object') return card;
  if (!id) return { ...card, zone: 'exile' };
  return { ...card, zone: 'exile', exiledWith: id, exiledWithSourceId: id };
}

export function stampLiveExileCardWithSource(card: any, sourceId: string | undefined | null): void {
  const id = String(sourceId || '').trim();
  if (!id || !card || typeof card !== 'object') return;
  card.zone = 'exile';
  card.exiledWith = id;
  card.exiledWithSourceId = id;
}

export function resolveGraveyardExileSourcePermanentId(stepOrEvent: any): string {
  return String(
    stepOrEvent?.triggeredAbilitySourcePermanentId
    || stepOrEvent?.triggerSourcePermanentId
    || stepOrEvent?.exiledWithSourceId
    || stepOrEvent?.sourcePermanentId
    || '',
  ).trim();
}
