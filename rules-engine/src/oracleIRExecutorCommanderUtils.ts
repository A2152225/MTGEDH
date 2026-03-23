import type { GameState, PlayerID } from '../../shared/src';

type FindObjectById = (idRaw: string) => any | null;

export function isCommanderObject(obj: any): boolean {
  return Boolean(
    (obj as any)?.isCommander === true ||
      (obj as any)?.commander === true ||
      (obj as any)?.card?.isCommander === true
  );
}

export function collectCommandZoneObjects(
  state: GameState,
  controllerId: PlayerID,
  findObjectById: FindObjectById
): readonly any[] {
  const out: any[] = [];
  const pushResolved = (entry: any): void => {
    if (!entry) return;
    if (typeof entry === 'string' || typeof entry === 'number') {
      const resolved = findObjectById(String(entry));
      if (resolved) out.push(resolved);
      return;
    }
    out.push(entry);
  };

  const commandZoneAny = (state as any)?.commandZone ?? (state as any)?.commanderZone;
  if (!commandZoneAny) return out;

  if (Array.isArray(commandZoneAny)) {
    commandZoneAny.forEach(pushResolved);
    return out;
  }

  if (Array.isArray((commandZoneAny as any)?.objects)) {
    (commandZoneAny as any).objects.forEach(pushResolved);
    return out;
  }

  const byController = (commandZoneAny as any)?.[controllerId];
  if (Array.isArray(byController)) {
    byController.forEach(pushResolved);
  }

  return out;
}

export function getHighestCommanderTaxForController(
  state: GameState,
  controllerId: PlayerID
): number | null {
  const commandZoneAny = (state as any)?.commandZone ?? (state as any)?.commanderZone;
  if (!commandZoneAny) return null;

  const infoCandidates: any[] = [];
  const byController = (commandZoneAny as any)?.[controllerId];
  if (byController && typeof byController === 'object') infoCandidates.push(byController);
  if ((commandZoneAny as any)?.commanderIds || (commandZoneAny as any)?.taxById) infoCandidates.push(commandZoneAny as any);

  const maxTaxFromInfo = (info: any): number | null => {
    if (!info || typeof info !== 'object') return null;

    const taxById = info.taxById;
    if (taxById && typeof taxById === 'object' && !Array.isArray(taxById)) {
      let highest = 0;
      let seen = false;
      for (const value of Object.values(taxById as Record<string, unknown>)) {
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        highest = Math.max(highest, Math.max(0, n));
        seen = true;
      }
      return seen ? highest : 0;
    }

    const commanderIds = Array.isArray(info.commanderIds) ? info.commanderIds : [];
    const totalTax = Number(info.tax);
    if (commanderIds.length <= 1 && Number.isFinite(totalTax)) {
      return Math.max(0, totalTax);
    }

    return null;
  };

  for (const info of infoCandidates) {
    const highest = maxTaxFromInfo(info);
    if (highest !== null) return highest;
  }

  return null;
}
