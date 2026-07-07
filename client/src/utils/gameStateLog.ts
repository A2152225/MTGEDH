import {
  formatCastSpellMessage,
  formatLifeChangeMessage,
} from '../../../shared/src/gameLogFormat';

export type GameLogEntry = {
  id: string;
  ts: number;
  kind: 'state' | 'chat';
  message: string;
};

type NameResolver = (playerId: string) => string;

function cardLabel(card: any): string {
  return String(card?.name || card?.card?.name || 'Permanent').trim() || 'Permanent';
}

function permLabel(perm: any): string {
  return cardLabel(perm?.card || perm);
}

function isLandPermanent(perm: any): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function counterDeltaSummary(before: Record<string, number>, after: Record<string, number>): string | null {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const prev = Number(before?.[key] ?? 0);
    const next = Number(after?.[key] ?? 0);
    const delta = next - prev;
    if (delta === 0) continue;
    parts.push(`${delta > 0 ? '+' : ''}${delta} ${key}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function lifeChangeKey(message: string): string | null {
  const match = message.match(/(.+?)\s+(?:gains|loses|gained|lost)\s+(\d+)\s+life/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|${match[2]}`;
}

function castMessageKey(message: string): string | null {
  const match = message.match(/^(.+?)\s+casts\s+(.+?)(?:\s+targeting|\s+from|$)/i);
  if (!match) return null;
  return `${match[1].trim().toLowerCase()}|${match[2].trim().toLowerCase()}`;
}

export function dedupeGameLogEntries(entries: readonly GameLogEntry[]): GameLogEntry[] {
  const result: GameLogEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'state') {
      const lifeKey = lifeChangeKey(entry.message);
      if (lifeKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && lifeChangeKey(existing.message) === lifeKey,
        );
        if (duplicate) continue;
      }

      const castKey = castMessageKey(entry.message);
      if (castKey) {
        const duplicate = result.some((existing) =>
          Math.abs(existing.ts - entry.ts) < 5000
          && existing.kind === 'chat'
          && castMessageKey(existing.message) === castKey,
        );
        if (duplicate) continue;
      }
    }
    result.push(entry);
  }
  return result;
}

export function buildGameStateLogEntries(
  prev: any | null | undefined,
  next: any | null | undefined,
  resolveName: NameResolver,
): GameLogEntry[] {
  if (!next || !prev) return [];

  const ts = Date.now();
  const entries: GameLogEntry[] = [];
  let seq = 0;
  const push = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    entries.push({
      id: `log_${ts}_${seq++}`,
      ts,
      kind: 'state',
      message: trimmed,
    });
  };

  const prevLife = (prev.life || {}) as Record<string, number>;
  const nextLife = (next.life || {}) as Record<string, number>;
  const lifeIds = new Set([...Object.keys(prevLife), ...Object.keys(nextLife)]);
  for (const playerId of lifeIds) {
    const before = Number(prevLife[playerId] ?? NaN);
    const after = Number(nextLife[playerId] ?? NaN);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) continue;
    push(formatLifeChangeMessage(resolveName(playerId), before, after));
  }

  for (const counterKey of ['poisonCounters', 'energyCounters', 'experienceCounters'] as const) {
    const prevMap = (prev as any)[counterKey] as Record<string, number> | undefined;
    const nextMap = (next as any)[counterKey] as Record<string, number> | undefined;
    if (!prevMap && !nextMap) continue;
    const ids = new Set([...Object.keys(prevMap || {}), ...Object.keys(nextMap || {})]);
    const label = counterKey === 'poisonCounters' ? 'poison' : counterKey === 'energyCounters' ? 'energy' : 'experience';
    for (const playerId of ids) {
      const before = Number(prevMap?.[playerId] ?? 0);
      const after = Number(nextMap?.[playerId] ?? 0);
      if (before === after) continue;
      const delta = after - before;
      const verb = delta > 0 ? 'gains' : 'loses';
      push(`${resolveName(playerId)} ${verb} ${Math.abs(delta)} ${label} counter${Math.abs(delta) === 1 ? '' : 's'} (${before} → ${after})`);
    }
  }

  if (String(prev.turnPlayer || '') !== String(next.turnPlayer || '')) {
    push(`${resolveName(String(next.turnPlayer || ''))}'s turn`);
  }

  const prevBattlefield = Array.isArray(prev.battlefield) ? prev.battlefield : [];
  const nextBattlefield = Array.isArray(next.battlefield) ? next.battlefield : [];
  const prevById = new Map(prevBattlefield.map((perm: any) => [String(perm?.id || ''), perm]));
  const nextById = new Map(nextBattlefield.map((perm: any) => [String(perm?.id || ''), perm]));

  for (const [id, perm] of nextById) {
    if (!id || prevById.has(id)) continue;
    const controller = resolveName(String(perm?.controller || ''));
    const name = permLabel(perm);
    if (isLandPermanent(perm)) {
      push(`${controller} played ${name}`);
    } else {
      push(`${name} entered the battlefield (${controller})`);
    }
  }

  for (const [id, perm] of prevById) {
    if (!id || nextById.has(id)) continue;
    push(`${permLabel(perm)} left the battlefield`);
  }

  for (const [id, afterPerm] of nextById) {
    const beforePerm = prevById.get(id);
    if (!beforePerm) continue;

    const name = permLabel(afterPerm);

    const counterSummary = counterDeltaSummary(
      (beforePerm?.counters || {}) as Record<string, number>,
      (afterPerm?.counters || {}) as Record<string, number>,
    );
    if (counterSummary) {
      push(`${name}: ${counterSummary}`);
    }

    const beforeCtrl = String(beforePerm?.controller || '');
    const afterCtrl = String(afterPerm?.controller || '');
    if (beforeCtrl && afterCtrl && beforeCtrl !== afterCtrl) {
      push(`${name} now controlled by ${resolveName(afterCtrl)}`);
    }
  }

  const prevStack = Array.isArray(prev.stack) ? prev.stack : [];
  const nextStack = Array.isArray(next.stack) ? next.stack : [];
  const prevStackById = new Map(prevStack.map((item: any) => [String(item?.id || ''), item]));
  const nextStackById = new Map(nextStack.map((item: any) => [String(item?.id || ''), item]));

  for (const [stackId, item] of nextStackById) {
    if (!stackId || prevStackById.has(stackId)) continue;
    const caster = resolveName(String(item?.controller || ''));
    push(formatCastSpellMessage(caster, cardLabel(item?.card || item), item?.targetDetails, resolveName));
  }

  for (const [stackId, item] of prevStackById) {
    if (!stackId || nextStackById.has(stackId)) continue;
    push(`${cardLabel(item?.card || item)} resolves`);
  }

  const prevMonarch = prev.monarch ?? null;
  const nextMonarch = next.monarch ?? null;
  if (prevMonarch !== nextMonarch) {
    push(nextMonarch ? `${resolveName(String(nextMonarch))} becomes the Monarch` : 'The Monarch is vacant');
  }

  const prevInitiative = prev.initiative ?? null;
  const nextInitiative = next.initiative ?? null;
  if (prevInitiative !== nextInitiative) {
    push(nextInitiative ? `${resolveName(String(nextInitiative))} takes the Initiative` : 'The Initiative is unclaimed');
  }

  return entries;
}

export function mergeGameLogEntries(
  existing: readonly GameLogEntry[],
  incoming: readonly GameLogEntry[],
  maxEntries = 400,
): GameLogEntry[] {
  if (incoming.length === 0) return [...existing];
  const merged = dedupeGameLogEntries([...existing, ...incoming]);
  return merged.slice(-maxEntries);
}
