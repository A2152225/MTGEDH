// server/src/state/modules/replacementBatch91LoseGameReplacements.ts
// B91: "If you would lose the game, instead exile this creature/~ and your life
// total becomes equal to your starting life total" (Exquisite Archangel).
// Public: parseBatch91LoseGameExileResetSentence, collectBatch91LoseGameReplacementSpecs,
// collectBatch91LoseGameReplacementSpecsFromState, tryApplyLoseGameExileAndResetLife.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const LOSE_EXILE_RESET_RE =
  /if you would lose the game, instead exile (this (?:creature|artifact|permanent|enchantment)|~|.+?) and your life total becomes (equal to your starting life total|\d+)/i;

function namedLoseGameText(oracle: string, sourceName?: string): string {
  let text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const name = String(sourceName || '').trim().toLowerCase();
  if (name) {
    const first = name.split(/\s*\/\/\s*/)[0];
    for (const n of [name, first, first.split(',')[0].trim()]) {
      if (n) text = text.split(n).join('~');
    }
  }
  return text;
}

export function parseBatch91LoseGameLife(oracle: string, sourceName?: string): { life: 'starting' | number } | null {
  const m = namedLoseGameText(oracle, sourceName).match(LOSE_EXILE_RESET_RE);
  if (!m) return null;
  if (/starting life total/i.test(String(m[2] || ''))) return { life: 'starting' };
  const n = parseInt(String(m[2] || ''), 10);
  return Number.isFinite(n) ? { life: n } : null;
}

export function parseBatch91LoseGameExileResetSentence(oracle: string, sourceName?: string): boolean {
  return parseBatch91LoseGameLife(oracle, sourceName) != null;
}

export function collectBatch91LoseGameReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseBatch91LoseGameLife(oracle, source.sourceName);
  if (!parsed) return [];
  const starting = parsed.life === 'starting';
  return [{
    id: `${source.sourcePermanentId}:lose-game-exile-reset-life`,
    event: 'lose-game',
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { affectedPlayerIsSourceController: true },
    instead: { loseGame: starting ? { exileSourceAndResetLifeToStarting: true } : { exileSourceAndSetLifeTo: parsed.life } as any },
    effectId: starting ? 'lose-game-exile-source-reset-starting-life' : 'lose-game-exile-source-set-life',
    reason: starting ? 'lose_game_exile_source_reset_starting_life' : 'lose_game_exile_source_set_life',
    metadata: { exileSourceAndResetLifeToStarting: starting, lifeTotal: parsed.life },
  } as ReplacementEffectSpec];
}

export function collectBatch91LoseGameReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch91LoseGameReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function startingLifeOf(state: any, playerId: string): number {
  const fromState = Number(state?.startingLife);
  if (Number.isFinite(fromState) && fromState > 0) return Math.floor(fromState);
  const player = Array.isArray(state?.players) ? state.players.find((p: any) => String(p?.id || '') === playerId) : undefined;
  const fromPlayer = Number(player?.startingLife ?? player?.initialLife);
  if (Number.isFinite(fromPlayer) && fromPlayer > 0) return Math.floor(fromPlayer);
  return 40;
}

/**
 * If the player would lose the game, apply the first matching exile-and-reset-life
 * replacement and return true (the loss does not happen). Persistent loss conditions
 * such as poison still held after this will be re-checked on a later SBA.
 */
export function tryApplyLoseGameExileAndResetLife(state: any, playerId: string): boolean {
  const pid = String(playerId || '').trim();
  if (!pid || !state) return false;
  const specs = collectBatch91LoseGameReplacementSpecsFromState(state).filter((spec) => String(spec.sourceController || '') === pid);
  if (!specs.length) return false;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const spec = specs[0];
  const sourceId = String(spec.sourcePermanentId || '').trim();
  const idx = battlefield.findIndex((p: any) => String(p?.id || '') === sourceId);
  if (idx < 0) return false;
  const perm = battlefield[idx];
  const card = perm?.card ? { ...perm.card } : { name: spec.sourceName };
  const owner = String(perm?.owner || perm?.controller || pid);
  battlefield.splice(idx, 1);
  state.battlefield = battlefield;
  state.zones = state.zones || {};
  state.zones[owner] = state.zones[owner] || {};
  const exile = Array.isArray(state.zones[owner].exile) ? state.zones[owner].exile : [];
  exile.push({ ...card, zone: 'exile', owner });
  state.zones[owner].exile = exile;
  const lifeTotal = (spec.metadata as any)?.lifeTotal;
  const start = lifeTotal === 'starting' || (spec.metadata as any)?.exileSourceAndResetLifeToStarting && lifeTotal == null
    ? startingLifeOf(state, pid)
    : (Number.isFinite(Number(lifeTotal)) ? Math.floor(Number(lifeTotal)) : startingLifeOf(state, pid));
  state.life = state.life || {};
  state.life[pid] = start;
  const player = Array.isArray(state.players) ? state.players.find((p: any) => String(p?.id || '') === pid) : undefined;
  if (player) {
    player.life = start;
    player.hasLost = false;
  }
  return true;
}
