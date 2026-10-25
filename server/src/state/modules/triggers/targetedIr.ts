/**
 * Oracle IR "becomes the target of a spell or ability" (event becomes_target).
 * Merged into the targeted.ts emitters, which every targeting site reaches (cast,
 * activation, triggered-ability targets, copies via stack-put / spell-copied hooks).
 * A printed becomes_target line owns its source: the legacy 'targeted' item that
 * duplicates it is dropped, and the IR line fires instead. Each stack object reports
 * each of its targets once, however many hook sites see it.
 * Public: claimTargetingTargets, mergeParsedBecomesTargetTriggers.
 */
import { collectMatchingParsedEventLines, parsedEffectDuplicates, parsedEventLinesFor } from './triggerConditionFamilyMatch.js';

const MAX_TARGETING_CLAIMS = 256;

function stackItemTargetIds(item: any): string[] {
  const raw = Array.isArray(item?.targets) ? item.targets : [];
  return raw.map((target: any) => (typeof target === 'string' ? target : String(target?.id || ''))).filter(Boolean);
}

/** The stack object doing the targeting: explicit id, else the newest object of that controller holding all the targets. */
export function resolveTargetingStackItemId(state: any, actorId: string, targetIds: readonly string[], stackItemId?: string): string {
  const explicit = String(stackItemId || '').trim();
  if (explicit) return explicit;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];
    if (String(item?.controller || '') !== String(actorId || '')) continue;
    const ids = stackItemTargetIds(item);
    if (ids.length > 0 && targetIds.every((id) => ids.includes(id))) return String(item?.id || '');
  }
  return '';
}

/** Targets this stack object has not yet reported. Later hook sites for the same object get []. */
export function claimTargetingTargets(state: any, actorId: string, targetIds: readonly string[], stackItemId?: string): string[] {
  if (!state || targetIds.length === 0) return [...targetIds];
  const itemId = resolveTargetingStackItemId(state, actorId, targetIds, stackItemId);
  if (!itemId) return [...targetIds];
  const claims: string[] = Array.isArray(state.becomesTargetEmissionClaims)
    ? state.becomesTargetEmissionClaims
    : (state.becomesTargetEmissionClaims = []);
  const fresh = targetIds.filter((targetId) => !claims.includes(`${itemId}|${targetId}`));
  claims.push(...fresh.map((targetId) => `${itemId}|${targetId}`));
  if (claims.length > MAX_TARGETING_CLAIMS) claims.splice(0, claims.length - MAX_TARGETING_CLAIMS);
  return fresh;
}

function claimOnceEachTurn(state: any, key: string): boolean {
  const turn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const record = state.becomesTargetOnceEachTurn && state.becomesTargetOnceEachTurn.turn === turn
    ? state.becomesTargetOnceEachTurn
    : (state.becomesTargetOnceEachTurn = { turn, keys: [] as string[] });
  if (record.keys.includes(key)) return false;
  record.keys.push(key);
  return true;
}

type TargetedItemLike = { source?: string; effect?: string; description?: string; effectData?: Record<string, unknown> };

/**
 * Drop legacy items whose source prints a matching becomes_target line, then add the
 * IR matches (self and observer) for each targeted battlefield permanent.
 */
export function mergeParsedBecomesTargetTriggers<T extends TargetedItemLike>(
  ctx: any,
  actorId: string,
  kind: 'spell' | 'ability',
  targetIds: readonly string[],
  legacy: readonly T[],
  build: (source: any, effect: string, subjectId: string) => T | undefined,
): T[] {
  const state = ctx?.state;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const byId = (id: unknown) => battlefield.find((perm: any) => String(perm?.id || '') === String(id || ''));
  const out: T[] = legacy.filter((item) => {
    const source = byId(item.source);
    if (!source?.card) return true;
    const lines = parsedEventLinesFor(String(source.card.oracle_text || ''), ['becomes_target'], String(source.card.name || '') || undefined);
    return !lines.some((line) => parsedEffectDuplicates([item.effect, item.description], line));
  });
  const actor = String(actorId || '').trim();
  if (!actor) return out;
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  for (const targetId of targetIds) {
    // A targeted player is a pseudo-subject ("whenever you become the target ...").
    const playerTarget = players.some((player: any) => String(player?.id || '') === String(targetId));
    const subject = byId(targetId)
      ?? (playerTarget ? { id: String(targetId), controller: String(targetId), card: { name: '', type_line: '' } } : undefined);
    if (!subject) continue;
    for (const source of battlefield) {
      if (!source?.card) continue;
      const lines = collectMatchingParsedEventLines({
        ctx,
        oracleText: String(source.card.oracle_text || ''),
        event: 'becomes_target',
        subjectPermanent: subject,
        subjectControllerId: String(subject.controller || ''),
        sourcePermanent: source,
        matchContext: { targetingControllerId: actor, targetingKind: kind, ...(playerTarget && !byId(targetId) ? { subjectIsPlayer: true } : {}) },
      });
      for (const line of lines) {
        const sourceId = String(source.id || '');
        const subjectId = String(subject.id || '');
        const duplicate = out.some((item) => (
          String(item.source || '') === sourceId
          && String(item.effectData?.targetedPermanentId || item.source || '') === subjectId
          && parsedEffectDuplicates([item.effect, item.description], line)
        ));
        if (duplicate) continue;
        if ((line.condition as any)?.onceEachTurn && !claimOnceEachTurn(state, `${sourceId}|${subjectId}|${line.effect}`)) continue;
        const item = build(source, line.effect, subjectId);
        if (item) out.push(item);
      }
    }
  }
  return out;
}
