/**
 * server/src/state/modules/gameStall/gameStallConfig.ts
 *
 * Single tuning spot for the game-stall (non-progress) detector and its
 * automatic recovery. Every threshold used by gameStallDetector.ts,
 * gameStallRecovery.ts and gameStallReportWriter.ts lives here.
 *
 * Runtime overrides:
 *   MTGEDH_STALL_DETECTOR=0          disable detection + recovery entirely
 *   MTGEDH_STALL_REPORT_DIR=<path>   write stall reports somewhere else
 * Tests call setGameStallConfigOverrides() / resetGameStallConfigOverrides().
 */

export interface GameStallConfig {
  /** Master switch. */
  enabled: boolean;
  /** N: successful priority passes with an unchanged board fingerprint (ping-pong). */
  noProgressPriorityPassThreshold: number;
  /** K: the same AI action signature repeated with an unchanged board fingerprint. */
  repeatedAiActionThreshold: number;
  /** K (failures): the same failed AI action signature repeated with no board change. */
  repeatedAiFailureThreshold: number;
  /** nextStep() calls that did not change the fingerprint (blocked advance loop). */
  stepAdvanceNoopThreshold: number;
  /** Repeating action-sequence cycle: longest period checked. */
  cycleMaxPeriod: number;
  /** Repeating action-sequence cycle: minimum number of full repetitions. */
  cycleMinRepeats: number;
  /** Repeating action-sequence cycle: minimum observations covered by the cycle. */
  cycleMinObservations: number;
  /** A rule only fires once the board has been frozen for at least this long. */
  minStallDurationMs: number;
  /** AI seat holds priority / owns a prompt with zero progress for this long (idle watchdog). */
  aiIdleTimeoutMs: number;
  /** How often the socket layer runs the idle watchdog sweep. */
  idleWatchdogIntervalMs: number;
  /** Rolling action/event window kept per game (also the report's action window). */
  actionWindowSize: number;
  /** Signatures retained for cycle detection within one no-progress run. */
  runSignatureCap: number;
  /** Wait after stage 1 before deciding whether stage 2 is needed. */
  stage2DelayMs: number;
  /** Minimum time between two automatic recoveries of the same game. */
  recoveryCooldownMs: number;
  /** Rate limit: max automatic recoveries per game inside recoveryRateWindowMs. */
  maxRecoveriesPerWindow: number;
  recoveryRateWindowMs: number;
  /** Server log lines attached to a report. */
  reportLogLines: number;
  /** Max in-memory trackers (oldest evicted). */
  maxTrackedGames: number;
}

const DEFAULT_GAME_STALL_CONFIG: GameStallConfig = {
  enabled: true,
  noProgressPriorityPassThreshold: 30,
  repeatedAiActionThreshold: 12,
  repeatedAiFailureThreshold: 5,
  stepAdvanceNoopThreshold: 6,
  cycleMaxPeriod: 8,
  cycleMinRepeats: 4,
  cycleMinObservations: 16,
  minStallDurationMs: 3_000,
  aiIdleTimeoutMs: 45_000,
  idleWatchdogIntervalMs: 5_000,
  actionWindowSize: 50,
  runSignatureCap: 96,
  stage2DelayMs: 4_000,
  recoveryCooldownMs: 15_000,
  maxRecoveriesPerWindow: 6,
  recoveryRateWindowMs: 10 * 60_000,
  reportLogLines: 100,
  maxTrackedGames: 200,
};

let overrides: Partial<GameStallConfig> = {};

function envDisabled(): boolean {
  const raw = String(process.env.MTGEDH_STALL_DETECTOR ?? '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no';
}

export function getGameStallConfig(): GameStallConfig {
  const merged = { ...DEFAULT_GAME_STALL_CONFIG, ...overrides };
  if (envDisabled()) merged.enabled = false;
  return merged;
}

export function getDefaultGameStallConfig(): GameStallConfig {
  return { ...DEFAULT_GAME_STALL_CONFIG };
}

/** Test / tuning hook. Values merge over the defaults until reset. */
export function setGameStallConfigOverrides(next: Partial<GameStallConfig>): void {
  overrides = { ...overrides, ...next };
}

export function resetGameStallConfigOverrides(): void {
  overrides = {};
}
