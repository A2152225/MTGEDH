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

function normalizeModeLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/\s+/g, ' ');
}

function getPermanentSelectedModeLabel(permanent: any): string {
  const selectedMode = (permanent as any)?.selectedMode ?? (permanent as any)?.card?.selectedMode;
  if (selectedMode && typeof selectedMode === 'object') {
    const label = String((selectedMode as any).label || (selectedMode as any).description || '').trim();
    if (label) return label;
  }

  if (typeof selectedMode === 'string') {
    return String(selectedMode).trim();
  }

  return '';
}

function scopeOracleTextToSelectedMode(oracleText: string, selectedModeLabel: string): string {
  const chosenLabel = normalizeModeLabel(selectedModeLabel);
  if (!oracleText || !chosenLabel) {
    return oracleText;
  }

  const lines = String(oracleText || '').split(/\r?\n/);
  let sawModalBullet = false;
  let keptChosenBullet = false;

  const scopedLines = lines.filter((line) => {
    const bulletMatch = line.match(/^\s*(?:\u2022|\*)\s*(.+?)\s*(?:\u2014|-)\s*(.+?)\s*$/);
    if (!bulletMatch) {
      return true;
    }

    sawModalBullet = true;
    const bulletLabel = normalizeModeLabel(bulletMatch[1]);
    if (bulletLabel === chosenLabel) {
      keptChosenBullet = true;
      return true;
    }

    return false;
  });

  if (!sawModalBullet || !keptChosenBullet) {
    return oracleText;
  }

  return scopedLines.join('\n');
}

function getBattlefieldStaticOracleText(permanent: any): string {
  const oracleText = String(permanent?.card?.oracle_text || permanent?.card?.oracleText || '');
  const selectedModeLabel = getPermanentSelectedModeLabel(permanent);
  return scopeOracleTextToSelectedMode(oracleText, selectedModeLabel);
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
        oracleText: getBattlefieldStaticOracleText(permanent),
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