import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

type FindObjectById = (idRaw: string) => any | null;

export function getContextSourceId(ctx?: OracleIRExecutionContext): string {
  return String(ctx?.sourceId || '').trim();
}

export function getContextExcludedId(
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext
): string {
  return String(targetCreatureId || ctx?.sourceId || '').trim();
}

export function getContextSourceObject(
  ctx: OracleIRExecutionContext | undefined,
  findObjectById: FindObjectById
): any | null {
  const sourceId = getContextSourceId(ctx);
  return sourceId ? findObjectById(sourceId) : null;
}

export function getContextTargetObject(
  targetCreatureId: string | undefined,
  findObjectById: FindObjectById
): any | null {
  const targetId = String(targetCreatureId || '').trim();
  return targetId ? findObjectById(targetId) : null;
}

export function getCardsFromPlayerZone(player: any, zone: string): readonly any[] | null {
  const normalizedZone = String(zone || '').toLowerCase();
  if (normalizedZone === 'graveyard') return Array.isArray(player?.graveyard) ? player.graveyard : [];
  if (normalizedZone === 'hand') return Array.isArray(player?.hand) ? player.hand : [];
  if (normalizedZone === 'library') return Array.isArray(player?.library) ? player.library : [];
  if (normalizedZone === 'exile') return Array.isArray(player?.exile) ? player.exile : [];
  return null;
}
