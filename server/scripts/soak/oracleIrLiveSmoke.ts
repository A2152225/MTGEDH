/*
  HTTP client for the live-table Oracle IR soak.

  Talks to the running server:
    POST /api/oracle-ir/live-soak/session
    POST /api/oracle-ir/live-soak/cast
    POST /api/oracle-ir/live-soak/end
*/

import {
  check,
  finishCard,
  finishSoak,
  liveCastRequestForCard,
  liveSoakBaseUrl,
  type LiveSoakConfig,
  type LiveSoakExpect,
  type SmokeCardResult,
  type SmokeCheck,
  type SmokeSoakResult,
} from './oracleIrSmokeHelpers.js';
import type { SoakSuite } from './oracleIrSmokeCore.js';

export type LiveCastResponse = {
  gameId: string;
  cardName: string;
  cardId?: string;
  found: boolean;
  errors: Array<{ code?: string; message?: string }>;
  queuedSteps: Array<{
    type: string;
    playerId?: string;
    cardName?: string;
    pBudget?: number;
    canRepeatModes?: boolean;
    status?: string;
  }>;
  seenQueueTypes?: string[];
  stack: Array<{ name?: string; id?: string }>;
  handNames: string[];
  phase?: string;
  combatCleared?: boolean;
  telemetryEvents: Array<{ kind: string; label: string }>;
  action?: string;
  injected?: string[];
  board?: {
    millApplied?: number;
    millOpponent?: number;
    millOther?: number;
    lifeUnchanged?: boolean;
    attackerPlusOne?: number;
    search?: {
      canSearch?: boolean;
      limitToTop?: number;
      paymentAmount?: string;
      controlledBySeat?: 'human' | 'ai';
      triggerCount?: number;
    };
  };
};

export type LiveTableRun = {
  ok: boolean;
  error?: string;
  baseUrl: string;
  soaks: SmokeSoakResult[];
};

const DEFAULT_LIVE: LiveSoakConfig = { playerCount: 2, setup: 'main' };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = { error: text };
  }
  if (!response.ok) {
    throw new Error(parsed?.error || `${response.status} ${response.statusText} from ${url}`);
  }
  return parsed as T;
}

function liveConfigFor(suite: SoakSuite, soakId: string): LiveSoakConfig {
  return suite.live?.[soakId] || DEFAULT_LIVE;
}

function assertLiveExpect(expect: LiveSoakExpect | undefined, cast: LiveCastResponse, result: SmokeCardResult): void {
  if (!expect) return;
  const board = cast.board || {};
  if (expect.millOpponentExact != null) {
    const actual = board.millOpponent ?? board.millApplied;
    result.checks.push(
      check('live_mill_opponent', expect.millOpponentExact, actual, actual === expect.millOpponentExact),
    );
  }
  if (expect.millOpponentAtLeast != null) {
    const actual = Number(board.millOpponent ?? board.millApplied ?? 0);
    result.checks.push(
      check(
        'live_mill_opponent_at_least',
        expect.millOpponentAtLeast,
        actual,
        actual >= expect.millOpponentAtLeast,
      ),
    );
  }
  if (expect.millOtherUnchanged) {
    result.checks.push(
      check('live_mill_other_unchanged', 0, board.millOther, Number(board.millOther || 0) === 0),
    );
  }
  if (expect.millOtherAtLeast != null) {
    result.checks.push(
      check(
        'live_mill_other_at_least',
        expect.millOtherAtLeast,
        board.millOther,
        Number(board.millOther || 0) >= expect.millOtherAtLeast,
      ),
    );
  }
  if (expect.lifeUnchanged) {
    result.checks.push(
      check('live_life_unchanged', true, board.lifeUnchanged, board.lifeUnchanged === true),
    );
  }
  if (expect.plusOneOnAttacker != null) {
    result.checks.push(
      check(
        'live_plus_one',
        expect.plusOneOnAttacker,
        board.attackerPlusOne,
        Number(board.attackerPlusOne) === expect.plusOneOnAttacker,
      ),
    );
  }
  if (expect.plusOneAtLeast != null) {
    result.checks.push(
      check(
        'live_plus_one_at_least',
        expect.plusOneAtLeast,
        board.attackerPlusOne,
        Number(board.attackerPlusOne || 0) >= expect.plusOneAtLeast,
      ),
    );
  }
  if (expect.canSearch != null) {
    result.checks.push(
      check('live_can_search', expect.canSearch, board.search?.canSearch, board.search?.canSearch === expect.canSearch),
    );
  }
  if (expect.limitToTop != null) {
    result.checks.push(
      check('live_limit_to_top', expect.limitToTop, board.search?.limitToTop, board.search?.limitToTop === expect.limitToTop),
    );
  }
  if (expect.paymentAmount) {
    result.checks.push(
      check(
        'live_search_payment',
        expect.paymentAmount,
        board.search?.paymentAmount,
        board.search?.paymentAmount === expect.paymentAmount,
      ),
    );
  }
  if (expect.controlledBySeat) {
    result.checks.push(
      check(
        'live_search_control',
        expect.controlledBySeat,
        board.search?.controlledBySeat,
        board.search?.controlledBySeat === expect.controlledBySeat,
      ),
    );
  }
  if (expect.triggerCountAtLeast != null) {
    const actual = Number(board.search?.triggerCount || 0);
    result.checks.push(
      check(
        'live_search_trigger',
        expect.triggerCountAtLeast,
        actual,
        actual >= expect.triggerCountAtLeast,
      ),
    );
  }
}

function assertLiveCast(
  soakId: string,
  config: LiveSoakConfig,
  name: string,
  cast: LiveCastResponse,
): SmokeCardResult {
  const result: SmokeCardResult = {
    name,
    found: cast.found,
    abilityTypes: [],
    spellStepKinds: [],
    allStepKinds: [],
    checks: [],
    telemetryEvents: cast.telemetryEvents || [],
    pass: false,
  };
  if (!cast.found) {
    result.checks.push(check('lookup', 'local oracle on live server', 'not found', false));
    return finishCard(result);
  }

  const request = liveCastRequestForCard(config, name);
  const queueTypes = [
    ...new Set([
      ...(cast.queuedSteps || []).map((step) => String(step.type || '')),
      ...(cast.seenQueueTypes || []),
    ]),
  ].filter(Boolean);
  const onStack = (cast.stack || []).some((item) => String(item.name || '') === name);
  const stillInHand = (cast.handNames || []).includes(name);
  const errorText = (cast.errors || []).map((entry) => entry.code || entry.message).filter(Boolean).join('; ');
  if (request.action !== 'cast') {
    result.checks.push(
      check(
        'live_action',
        request.action,
        { action: cast.action, injected: cast.injected, errors: cast.errors },
        cast.action === request.action && !errorText,
      ),
    );
  } else {
    const started = queueTypes.length > 0 || onStack || !stillInHand;
    result.checks.push(
      check(
        'live_cast',
        'queued, on stack, or left hand',
        { queueTypes, onStack, stillInHand, errors: cast.errors },
        started && !errorText.includes('CARD_NOT_FOUND'),
      ),
    );
  }

  const cardExpect = config.perCard?.[name];
  const expectQueue = cardExpect?.expectAnyQueue || config.expectAnyQueue;
  if (expectQueue && expectQueue.length > 0) {
    result.checks.push(
      check(
        'live_queue',
        expectQueue,
        queueTypes,
        expectQueue.some((type) => queueTypes.includes(type)) || onStack,
      ),
    );
  }

  const expectPBudget = cardExpect?.expectPBudget ?? config.expectPBudget;
  if (expectPBudget != null) {
    const modeStep = (cast.queuedSteps || []).find((step) => step.type === 'mode_selection');
    result.checks.push(
      check(
        'live_pBudget',
        expectPBudget,
        modeStep?.pBudget,
        modeStep != null && Number(modeStep.pBudget) === expectPBudget,
      ),
    );
    if (modeStep) {
      result.checks.push(
        check('live_canRepeat', true, Boolean(modeStep.canRepeatModes), Boolean(modeStep.canRepeatModes)),
      );
    }
  }

  if (soakId === 'end_combat_phase' && name === 'Mandate of Peace' && !onStack && queueTypes.length === 0) {
    result.checks.push(
      check(
        'live_end_combat',
        'postcombatMain or combat cleared',
        { phase: cast.phase, combatCleared: cast.combatCleared },
        cast.phase === 'postcombatMain' || cast.combatCleared === true,
      ),
    );
  }

  assertLiveExpect(request.expect, cast, result);

  result.checks.push(
    check(
      'live_telemetry_clean',
      '0 gap/legacy events for this card',
      result.telemetryEvents.map((event) => `${event.kind}:${event.label}`),
      result.telemetryEvents.length === 0,
    ),
  );
  return finishCard(result);
}

export async function runLiveTableSoaks(
  suite: SoakSuite,
  inProcessSoaks: readonly SmokeSoakResult[],
  options: { url?: string } = {},
): Promise<LiveTableRun> {
  const telemetryUrl = options.url || `http://127.0.0.1:${process.env.PORT || 3001}/api/oracle-ir/telemetry`;
  const baseUrl = liveSoakBaseUrl(telemetryUrl);

  try {
    const health = await fetch(`${baseUrl}/api/oracle-ir/telemetry`, { headers: { accept: 'application/json' } });
    if (!health.ok) {
      return { ok: false, error: `Live server telemetry HTTP ${health.status}`, baseUrl, soaks: [] };
    }
  } catch (error) {
    return {
      ok: false,
      error: `Live server unreachable at ${baseUrl} (${error instanceof Error ? error.message : String(error)}). Start the server, then re-run with --live.`,
      baseUrl,
      soaks: [],
    };
  }

  const soaks: SmokeSoakResult[] = [];
  for (const soak of inProcessSoaks) {
    const config = liveConfigFor(suite, soak.id);
    const names = soak.cards.map((card) => card.name);
    let session: { gameId: string } | undefined;
    const cards: SmokeCardResult[] = [];
    try {
      session = await postJson(`${baseUrl}/api/oracle-ir/live-soak/session`, {
        playerCount: config.playerCount,
        soakId: soak.id,
        cardNames: names,
      });
      for (const name of names) {
        try {
          const request = liveCastRequestForCard(config, name);
          const cast = await postJson<LiveCastResponse>(`${baseUrl}/api/oracle-ir/live-soak/cast`, {
            gameId: session.gameId,
            cardName: name,
            setup: request.setup,
            ...(request.inject.length > 0 ? { inject: request.inject } : {}),
            action: request.action,
            ...(request.millCount != null ? { millCount: request.millCount } : {}),
          });
          cards.push(assertLiveCast(soak.id, config, name, cast));
        } catch (error) {
          cards.push(finishCard({
            name,
            found: false,
            abilityTypes: [],
            spellStepKinds: [],
            allStepKinds: [],
            checks: [check('live_cast', 'cast on live table', String(error instanceof Error ? error.message : error), false)],
            telemetryEvents: [],
            pass: false,
          }));
        }
      }
    } catch (error) {
      for (const name of names) {
        cards.push(finishCard({
          name,
          found: false,
          abilityTypes: [],
          spellStepKinds: [],
          allStepKinds: [],
          checks: [check('live_session', 'create game + AI + decks', String(error instanceof Error ? error.message : error), false)],
          telemetryEvents: [],
          pass: false,
        }));
      }
    } finally {
      if (session?.gameId) {
        try {
          await postJson(`${baseUrl}/api/oracle-ir/live-soak/end`, { gameId: session.gameId });
        } catch {
          // best-effort cleanup
        }
      }
    }
    soaks.push(finishSoak(`live_${soak.id}`, soak.session, `Live table — ${soak.title}`, cards));
  }

  return { ok: soaks.every((soak) => soak.pass), baseUrl, soaks };
}

export function printLiveTableSummary(run: LiveTableRun): void {
  console.log(`\n=== Live table @ ${run.baseUrl} ===`);
  if (run.error) {
    console.log(`  ${run.error}`);
    return;
  }
  for (const soak of run.soaks) {
    const mark = soak.pass ? 'PASS' : 'FAIL';
    console.log(`\n[${mark}] ${soak.title}  (${soak.cards.filter((card) => card.pass).length}/${soak.cards.length} cards)`);
    for (const card of soak.cards) {
      const cardMark = card.pass ? '  ok' : '  !!';
      const failed = card.checks.filter((entry: SmokeCheck) => !entry.pass).map((entry) => entry.id);
      console.log(`${cardMark} ${card.name}${failed.length ? `  ${failed.join(',')}` : ''}`);
    }
  }
}
