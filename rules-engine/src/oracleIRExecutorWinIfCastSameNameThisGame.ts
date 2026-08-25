// Origin: oracleIRExecutorConditionalStepSupport.ts
// Cluster: evaluateConditionalWrapperCondition “this spell was cast from your
//   hand and you've cast another spell with the same name this game”
//   (Approach of the Second Sun spell-win family). Generic — matches this
//   spell’s current name, not a printed card-name string.
// Public: tryEvaluateWinIfCastSameNameThisGame

import type { EvaluateConditionalWrapperConditionParams } from './oracleIRExecutorConditionalStepSupportHelpers.js';

const CAST_SAME_NAME_THIS_GAME =
  /^this spell was cast from your hand and you've cast another spell (?:named .+|with the same name) this game$/i;

const NON_HAND_ZONES = new Set([
  'graveyard',
  'exile',
  'battlefield',
  'command',
  'stack',
  'library',
]);

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveCastFromZone(ctx: EvaluateConditionalWrapperConditionParams['ctx']): string {
  const direct = String(ctx.castFromZone || (ctx.selectorContext as { castFromZone?: string } | undefined)?.castFromZone || '')
    .trim()
    .toLowerCase();
  if (direct) return direct;
  if (ctx.castFromExile === true || (ctx.selectorContext as { castFromExile?: boolean } | undefined)?.castFromExile === true) {
    return 'exile';
  }
  const sourceItem = (ctx as { sourceItem?: { castFromHand?: boolean; source?: string; castFromZone?: string } }).sourceItem;
  const itemZone = String(sourceItem?.castFromZone || '').trim().toLowerCase();
  if (itemZone) return itemZone;
  if (sourceItem?.castFromHand === true || String(sourceItem?.source || '').trim().toLowerCase() === 'hand') {
    return 'hand';
  }
  if (String(ctx.sourceObjectType || '').trim().toLowerCase() === 'spell') {
    return 'hand';
  }
  return '';
}

type NamedCastEntry = {
  readonly name: string;
  readonly id?: string;
};

function pushNamedCast(out: NamedCastEntry[], name: unknown, id?: unknown): void {
  const normalized = normalizeName(name);
  if (!normalized) return;
  const sourceId = String(id || '').trim();
  out.push(sourceId ? { name: normalized, id: sourceId } : { name: normalized });
}

function collectNamedCastsFromList(raw: unknown, out: NamedCastEntry[]): void {
  if (!Array.isArray(raw)) return;
  for (const entry of raw) {
    if (typeof entry === 'string') {
      pushNamedCast(out, entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { name?: string; id?: string; card?: { name?: string; id?: string }; count?: number };
    const name = record.name || record.card?.name;
    const id = record.id || record.card?.id;
    const count = Number(record.count);
    if (Number.isFinite(count) && count > 1 && name) {
      for (let index = 0; index < count; index += 1) {
        pushNamedCast(out, name, index === 0 ? id : undefined);
      }
      continue;
    }
    pushNamedCast(out, name, id);
  }
}

function collectNamedCastsThisGame(
  state: EvaluateConditionalWrapperConditionParams['nextState'],
  controllerId: string,
): NamedCastEntry[] {
  const out: NamedCastEntry[] = [];
  const named = (state as { namedSpellsCastThisGame?: unknown } | undefined)?.namedSpellsCastThisGame;
  if (named && typeof named === 'object' && !Array.isArray(named)) {
    const byPlayer = (named as Record<string, unknown>)[controllerId];
    if (Array.isArray(byPlayer)) {
      collectNamedCastsFromList(byPlayer, out);
    } else if (byPlayer && typeof byPlayer === 'object') {
      for (const [name, value] of Object.entries(byPlayer as Record<string, unknown>)) {
        const count = typeof value === 'number' ? value : 1;
        for (let index = 0; index < Math.max(1, count); index += 1) {
          pushNamedCast(out, name);
        }
      }
    }
    return out;
  }
  if (Array.isArray(named)) {
    collectNamedCastsFromList(named, out);
    return out;
  }

  const turn = (state as { spellsCastThisTurn?: unknown } | undefined)?.spellsCastThisTurn;
  if (Array.isArray(turn)) {
    for (const entry of turn) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as {
        casterId?: string;
        controller?: string;
        playerId?: string;
        name?: string;
        id?: string;
        card?: { name?: string; id?: string };
      };
      const caster = String(record.casterId || record.controller || record.playerId || '').trim();
      if (caster && caster !== controllerId) continue;
      pushNamedCast(out, record.name || record.card?.name, record.id || record.card?.id);
    }
  }
  return out;
}

function resolveSourceName(params: EvaluateConditionalWrapperConditionParams): string {
  const ctx = params.ctx;
  const fromCtx = normalizeName(ctx.sourceName);
  if (fromCtx) return fromCtx;
  const selector = ctx.selectorContext as { sourceName?: string } | undefined;
  const fromSelector = normalizeName(selector?.sourceName);
  if (fromSelector) return fromSelector;
  return '';
}

function hasAnotherSameNameCastThisGame(params: EvaluateConditionalWrapperConditionParams): boolean {
  const controllerId = String(params.controllerId || params.ctx.controllerId || '').trim();
  const sourceName = resolveSourceName(params);
  if (!controllerId || !sourceName) return false;
  const sourceId = String(params.ctx.sourceId || '').trim();
  const casts = collectNamedCastsThisGame(params.nextState, controllerId);
  return casts.some((entry) => {
    if (entry.name !== sourceName) return false;
    if (sourceId && entry.id && entry.id === sourceId) return false;
    return true;
  });
}

export function tryEvaluateWinIfCastSameNameThisGame(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  if (params.condition.kind !== 'if' && params.condition.kind !== 'as_long_as') {
    return undefined;
  }

  const raw = String(params.condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }
  if (!CAST_SAME_NAME_THIS_GAME.test(normalizedRaw)) return undefined;

  const zone = resolveCastFromZone(params.ctx);
  if (NON_HAND_ZONES.has(zone)) return false;
  if (zone !== 'hand') return false;

  return hasAnotherSameNameCastThisGame(params);
}
