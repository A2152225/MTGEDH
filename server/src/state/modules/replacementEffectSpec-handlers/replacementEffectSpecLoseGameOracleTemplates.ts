// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: oracle-pattern can't-lose / can't-win / empty-library-win
//   ReplacementEffectSpec families (Platinum Angel / Abyssal Persecutor /
//   Laboratory Maniac). No card-name routing.
// Public entry symbols: collectOraclePatternLoseGameReplacementSpecsFromState,
//   loseGameSpecPreventsLoss, loseGameSpecPreventsWin,
//   loseGameSpecExemptsZeroOrLessLife, loseGameSpecExemptsEmptyLibraryDraw,
//   loseGameSpecWinsOnEmptyLibraryDraw.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

type LoseGameSpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

function stripGrantedAndEmblemCreationClauses(oracle: string): string {
  return oracle
    .replace(/you get an emblem with\s+"[^"]*"/g, ' ')
    .replace(/equipped creature has(?: [a-z][a-z0-9\s/-]*)?\s+"[^"]*"/g, ' ')
    .replace(/\bit gains\s+"[^"]*"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isComplexConditionalCantLose(oracle: string): boolean {
  return (
    oracle.includes('if you control an artifact')
    || oracle.includes('twelve or more')
    || oracle.includes('state-based actions don\'t apply')
  );
}

function parseAsLongAsControlledType(oracle: string): string | undefined {
  const match = oracle.match(
    /as long as you control (?:an? )?([a-z0-9][a-z0-9\s/-]*?)(?:,| you (?:can|'t|cannot))/,
  );
  if (!match) return undefined;
  const firstToken = String(match[1] || '').trim().split(/\s+/)[0] || '';
  return firstToken || undefined;
}

function parseLoseGameSpecBodies(oracle: string): LoseGameSpecBody[] {
  const bodies: LoseGameSpecBody[] = [];
  if (!oracle) return bodies;

  const asLongAsType = parseAsLongAsControlledType(oracle);
  const requiresAttachedToCreature = /as long as this equipment is attached/.test(oracle);
  const matchExtras = {
    ...(asLongAsType ? { requiresControlledTypeIncludes: asLongAsType } : {}),
    ...(requiresAttachedToCreature ? { requiresAttachedToCreature: true } : {}),
  };

  if (
    oracle.includes('if you would draw a card while your library has no cards in it')
    && oracle.includes('you win the game instead')
  ) {
    bodies.push({
      event: 'card-draw',
      match: { drawingPlayerIsSourceController: true, ...matchExtras },
      instead: { winInsteadOfLose: true },
      effectId: 'empty-library-draw-win',
      reason: 'empty_library_draw_win',
    });
  }

  if (isComplexConditionalCantLose(oracle)) {
    return bodies;
  }

  if (
    oracle.includes("don't lose the game for having 0 or less life")
    || oracle.includes('do not lose the game for having 0 or less life')
    || oracle.includes("don't lose the game due to having 0 or less life")
  ) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsSourceController: true, ...matchExtras },
      instead: { loseGame: { onlyZeroOrLessLife: true } },
      effectId: 'dont-lose-for-zero-life',
      reason: 'dont_lose_for_zero_or_less_life',
    });
  }

  if (
    oracle.includes("don't lose the game for drawing from an empty library")
    || (
      oracle.includes("don't lose the game due to")
      && oracle.includes('drawing from an empty library')
    )
  ) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsAny: true, ...matchExtras },
      instead: { loseGame: { onlyEmptyLibrary: true } },
      effectId: 'dont-lose-for-empty-library',
      reason: 'dont_lose_for_empty_library_draw',
    });
  }

  if (oracle.includes("players can't lose the game or win the game")) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsAny: true, ...matchExtras },
      instead: { loseGame: { allPlayersCantLose: true, allPlayersCantWin: true } },
      effectId: 'players-cant-lose-or-win',
      reason: 'players_cant_lose_or_win',
    });
    return bodies;
  }

  if (
    /you can't win the game(?: this turn)? and your opponents can't lose the game/.test(oracle)
  ) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsOpponentOfSource: true, ...matchExtras },
      instead: { loseGame: { controllerCantWin: true, opponentsCantLose: true } },
      effectId: 'opponents-cant-lose-controller-cant-win',
      reason: 'opponents_cant_lose_controller_cant_win',
    });
    return bodies;
  }

  if (
    /you can't lose the game(?: this turn)? and your opponents can't win the game/.test(oracle)
  ) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsSourceController: true, ...matchExtras },
      instead: { loseGame: { controllerCantLose: true, opponentsCantWin: true } },
      effectId: 'controller-cant-lose-opponents-cant-win',
      reason: 'controller_cant_lose_opponents_cant_win',
    });
    return bodies;
  }

  if (oracle.includes("you can't lose the game")) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsSourceController: true, ...matchExtras },
      instead: { loseGame: { controllerCantLose: true } },
      effectId: 'controller-cant-lose',
      reason: 'controller_cant_lose',
    });
  }

  if (oracle.includes("your opponents can't lose the game") && !oracle.includes("you can't win the game")) {
    bodies.push({
      event: 'lose-game',
      match: { affectedPlayerIsOpponentOfSource: true, ...matchExtras },
      instead: { loseGame: { opponentsCantLose: true } },
      effectId: 'opponents-cant-lose',
      reason: 'opponents_cant_lose',
    });
  }

  return bodies;
}

function sourceConditionsMet(spec: ReplacementEffectSpec, state: unknown): boolean {
  const match = spec.match || {};
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  const sourceController = String(spec.sourceController || '');

  if (match.requiresControlledTypeIncludes) {
    const wanted = String(match.requiresControlledTypeIncludes || '').trim().toLowerCase();
    if (!wanted || !sourceController) return false;
    const found = battlefield.some((perm) => {
      if (!perm || typeof perm !== 'object') return false;
      const record = perm as { controller?: string; phasedOut?: boolean; type_line?: string; card?: { type_line?: string } };
      if (record.phasedOut === true) return false;
      if (String(record.controller || '') !== sourceController) return false;
      const typeLine = String(record.card?.type_line || record.type_line || '').toLowerCase();
      return typeLine.includes(wanted);
    });
    if (!found) return false;
  }

  if (match.requiresAttachedToCreature === true) {
    const sourceId = String(spec.sourcePermanentId || '').trim();
    if (!sourceId) return false;
    const source = battlefield.find((perm) => {
      if (!perm || typeof perm !== 'object') return false;
      return String((perm as { id?: string }).id || '').trim() === sourceId;
    }) as { attachedTo?: string; phasedOut?: boolean } | undefined;
    if (!source || source.phasedOut === true) return false;
    const attachedId = String(source.attachedTo || '').trim();
    if (!attachedId) return false;
    const attached = battlefield.find((perm) => {
      if (!perm || typeof perm !== 'object') return false;
      return String((perm as { id?: string }).id || '').trim() === attachedId;
    }) as { phasedOut?: boolean; type_line?: string; card?: { type_line?: string } } | undefined;
    if (!attached || attached.phasedOut === true) return false;
    const typeLine = String(attached.card?.type_line || attached.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
  }

  return true;
}

function playerMatchesLoseGameSpec(spec: ReplacementEffectSpec, playerId: string): boolean {
  const match = spec.match || {};
  const pid = String(playerId || '');
  const sourceController = String(spec.sourceController || '');
  if (match.affectedPlayerIsAny === true) return true;
  if (match.affectedPlayerIsSourceController === true) return pid === sourceController;
  if (match.affectedPlayerIsOpponentOfSource === true) {
    return Boolean(pid) && Boolean(sourceController) && pid !== sourceController;
  }
  const polarity = spec.instead.loseGame;
  if (polarity?.allPlayersCantLose || polarity?.allPlayersCantWin || polarity?.onlyEmptyLibrary) {
    return true;
  }
  if (polarity?.opponentsCantLose || polarity?.opponentsCantWin) {
    return Boolean(pid) && Boolean(sourceController) && pid !== sourceController;
  }
  if (polarity?.controllerCantLose || polarity?.controllerCantWin || polarity?.onlyZeroOrLessLife) {
    return pid === sourceController;
  }
  return pid === sourceController;
}

export function loseGameSpecPreventsLoss(
  spec: ReplacementEffectSpec,
  playerId: string,
  state: unknown,
): boolean {
  if (spec.event !== 'lose-game') return false;
  const polarity = spec.instead.loseGame;
  if (!polarity) return false;
  if (polarity.onlyZeroOrLessLife || polarity.onlyEmptyLibrary) return false;
  if (!sourceConditionsMet(spec, state)) return false;
  if (!playerMatchesLoseGameSpec(spec, playerId)) return false;
  const pid = String(playerId || '');
  const sourceController = String(spec.sourceController || '');
  if (polarity.allPlayersCantLose) return true;
  if (polarity.controllerCantLose && pid === sourceController) return true;
  if (polarity.opponentsCantLose && pid !== sourceController) return true;
  return false;
}

export function loseGameSpecPreventsWin(
  spec: ReplacementEffectSpec,
  playerId: string,
  state: unknown,
): boolean {
  if (spec.event !== 'lose-game') return false;
  const polarity = spec.instead.loseGame;
  if (!polarity) return false;
  if (!sourceConditionsMet(spec, state)) return false;
  const pid = String(playerId || '');
  const sourceController = String(spec.sourceController || '');
  if (polarity.allPlayersCantWin) return true;
  if (polarity.controllerCantWin && pid === sourceController) return true;
  if (polarity.opponentsCantWin && pid !== sourceController) return true;
  return false;
}

export function loseGameSpecExemptsZeroOrLessLife(
  spec: ReplacementEffectSpec,
  playerId: string,
  state: unknown,
): boolean {
  if (spec.event !== 'lose-game') return false;
  if (!sourceConditionsMet(spec, state)) return false;
  if (!playerMatchesLoseGameSpec(spec, playerId)) return false;
  if (loseGameSpecPreventsLoss(spec, playerId, state)) return true;
  return spec.instead.loseGame?.onlyZeroOrLessLife === true;
}

export function loseGameSpecExemptsEmptyLibraryDraw(
  spec: ReplacementEffectSpec,
  playerId: string,
  state: unknown,
): boolean {
  if (spec.event !== 'lose-game') return false;
  if (spec.instead.loseGame?.onlyEmptyLibrary !== true) return false;
  if (!sourceConditionsMet(spec, state)) return false;
  if (spec.match?.affectedPlayerIsAny === true) return true;
  return String(playerId || '') === String(spec.sourceController || '');
}

export function loseGameSpecWinsOnEmptyLibraryDraw(
  spec: ReplacementEffectSpec,
  playerId: string,
): boolean {
  if (spec.instead.winInsteadOfLose !== true) return false;
  const pid = String(playerId || '');
  const sourceController = String(spec.sourceController || '');
  return pid === sourceController;
}

function collectEmblemLoseGameSources(state: unknown): Array<{
  id: string;
  controller: string;
  name: string;
  oracle: string;
}> {
  const seen = new Set<string>();
  const sources: Array<{ id: string; controller: string; name: string; oracle: string }> = [];
  const push = (emblem: unknown) => {
    if (!emblem || typeof emblem !== 'object') return;
    const record = emblem as {
      id?: string;
      controller?: string;
      owner?: string;
      sourceName?: string;
      name?: string;
      effect?: string;
      oracle_text?: string;
      oracleText?: string;
      abilities?: unknown;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const id = String(record.id || '').trim();
    if (!id || seen.has(id)) return;
    const abilityText = Array.isArray(record.abilities)
      ? record.abilities.map((entry) => String(entry || '').trim()).filter(Boolean).join(' ')
      : '';
    const oracle = normalizeOraclePatternText(
      record.effect || record.oracle_text || record.oracleText || abilityText || readCardOracleText(record.card),
    );
    if (!oracle) return;
    seen.add(id);
    sources.push({
      id,
      controller: String(record.controller || record.owner || '').trim(),
      name: String(record.sourceName || record.name || record.card?.name || 'Emblem').trim() || 'Emblem',
      oracle,
    });
  };

  const rootEmblems = Array.isArray((state as { emblems?: unknown })?.emblems)
    ? (state as { emblems: unknown[] }).emblems
    : [];
  for (const emblem of rootEmblems) push(emblem);

  const players = Array.isArray((state as { players?: unknown })?.players)
    ? (state as { players: unknown[] }).players
    : [];
  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const playerEmblems = Array.isArray((player as { emblems?: unknown }).emblems)
      ? (player as { emblems: unknown[] }).emblems
      : [];
    for (const emblem of playerEmblems) push(emblem);
  }

  return sources;
}

function pushParsedSpecs(
  specs: ReplacementEffectSpec[],
  oracle: string,
  source: { id: string; controller: string; name: string },
): void {
  for (const body of parseLoseGameSpecBodies(oracle)) {
    specs.push({
      ...body,
      id: `${source.id}:${body.effectId}`,
      sourcePermanentId: source.id,
      sourceController: source.controller,
      sourceName: source.name,
    });
  }
}

export function collectOraclePatternLoseGameReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || !(perm as { card?: unknown }).card) continue;
    const permRecord = perm as {
      id?: string;
      controller?: string;
      phasedOut?: boolean;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    if (permRecord.phasedOut === true) continue;
    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;
    const oracle = stripGrantedAndEmblemCreationClauses(
      normalizeOraclePatternText(readCardOracleText(permRecord.card)),
    );
    if (!oracle) continue;
    pushParsedSpecs(specs, oracle, {
      id: sourcePermanentId,
      controller: sourceController,
      name: sourceName,
    });
  }

  for (const emblem of collectEmblemLoseGameSources(state)) {
    pushParsedSpecs(specs, emblem.oracle, {
      id: emblem.id,
      controller: emblem.controller,
      name: emblem.name,
    });
  }

  const angelsGrace = (state as { angelsGraceEffect?: Record<string, { active?: boolean; sourceName?: string }> })
    ?.angelsGraceEffect;
  if (angelsGrace && typeof angelsGrace === 'object') {
    for (const [playerId, effect] of Object.entries(angelsGrace)) {
      if (!effect?.active) continue;
      const pid = String(playerId || '').trim();
      if (!pid) continue;
      pushParsedSpecs(
        specs,
        "you can't lose the game this turn and your opponents can't win the game this turn",
        {
          id: `angels-grace-effect:${pid}`,
          controller: pid,
          name: String(effect.sourceName || "Angel's Grace").trim() || "Angel's Grace",
        },
      );
    }
  }

  return specs;
}
