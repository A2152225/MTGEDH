export type StaticEffectSourceType = 'battlefield' | 'emblem' | 'plane' | 'scheme';

export interface StaticEffectSource {
  sourceType: StaticEffectSourceType;
  controller: string;
  sourceId: string;
  sourceName: string;
  oracleText: string;
  typeLine: string;
  affectsAllPlayers?: boolean;
  phasedOut?: boolean;
  counters?: any;
}

export function collectStaticEffectSources(
  state: any,
  options?: { sourceTypes?: StaticEffectSourceType[] },
): StaticEffectSource[] {
  const sourceTypeFilter = Array.isArray(options?.sourceTypes) && options.sourceTypes.length > 0
    ? new Set(options.sourceTypes)
    : null;
  const include = (sourceType: StaticEffectSourceType) => !sourceTypeFilter || sourceTypeFilter.has(sourceType);

  const sources: StaticEffectSource[] = [];

  if (include('battlefield')) {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent?.card) continue;

      sources.push({
        sourceType: 'battlefield',
        controller: String(permanent.controller || ''),
        sourceId: String(permanent.id || permanent.card?.id || ''),
        sourceName: String(permanent.card?.name || permanent.name || 'Unknown'),
        oracleText: String(permanent.card?.oracle_text || permanent.card?.oracleText || ''),
        typeLine: String(permanent.card?.type_line || permanent.card?.typeLine || ''),
        phasedOut: Boolean(permanent.phasedOut),
        counters: (permanent as any)?.counters,
      });
    }
  }

  if (include('emblem')) {
    const emblems = Array.isArray((state as any)?.emblems) ? (state as any).emblems : [];
    for (const emblem of emblems) {
      if (!emblem) continue;

      sources.push({
        sourceType: 'emblem',
        controller: String(emblem.controller || ''),
        sourceId: String(emblem.id || 'emblem'),
        sourceName: String(emblem.sourceName || emblem.name || 'Emblem'),
        oracleText: String(emblem.effect || emblem.text || emblem.oracle_text || ''),
        typeLine: '',
      });
    }
  }

  if (include('plane')) {
    const activePlane = (state as any)?.activePlane || (state as any)?.currentPlane;
    if (activePlane) {
      sources.push({
        sourceType: 'plane',
        controller: String(activePlane.controller || ''),
        sourceId: String(activePlane.id || 'active_plane'),
        sourceName: String(activePlane.name || 'Active plane'),
        oracleText: String(activePlane.text || activePlane.oracle_text || activePlane.effect || ''),
        typeLine: '',
        affectsAllPlayers: true,
      });
    }
  }

  if (include('scheme')) {
    const activeSchemes = Array.isArray((state as any)?.activeSchemes)
      ? (state as any).activeSchemes
      : Array.isArray((state as any)?.ongoingSchemes)
        ? (state as any).ongoingSchemes
        : [];
    for (const scheme of activeSchemes) {
      if (!scheme) continue;

      sources.push({
        sourceType: 'scheme',
        controller: String(scheme.controller || ''),
        sourceId: String(scheme.id || 'scheme'),
        sourceName: String(scheme.name || 'Ongoing scheme'),
        oracleText: String(scheme.text || scheme.oracle_text || scheme.effect || ''),
        typeLine: '',
        affectsAllPlayers: true,
      });
    }
  }

  return sources;
}