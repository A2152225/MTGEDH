/**
 * Production gap telemetry for Oracle IR primary paths (task D2).
 *
 * Records structured events whenever:
 *  - IR attempted an effect and failed the all-or-nothing gate
 *    (`all_or_nothing_failure` — legacy fallback may still run), or
 *  - IR primary *owns* the effect text but did not handle it and the legacy
 *    path was skipped (`owned_but_unhandled` — silent no-op risk), or
 *  - a legacy handler executed an effect while IR primary is enabled
 *    (`legacy_handled` — retirement triage: which effect texts still rely
 *    on the legacy path in production).
 *
 * Unlike `debug()`, telemetry counters are always recorded regardless of
 * DEBUG_STATE so live soaks surface misses without verbose logging. Console
 * emission is deduped per fingerprint and can be disabled with
 * ORACLE_IR_GAP_TELEMETRY_LOG=0.
 *
 * Snapshot is exposed via GET /api/oracle-ir/telemetry (server/src/index.ts).
 *
 * IMPORTANT: this module must not import from other state modules — it is
 * consumed by oracleIrStepWiring.ts and the execution orchestrators, and any
 * state-module import here would create a cycle.
 */

export type OracleIrGapTelemetryKind =
  | 'all_or_nothing_failure'
  | 'owned_but_unhandled'
  | 'legacy_handled';

export type OracleIrGapTelemetryScope =
  | 'spell'
  | 'trigger'
  | 'activated'
  | 'fallback'
  | 'unknown';

export interface OracleIrGapTelemetryEvent {
  readonly kind: OracleIrGapTelemetryKind;
  readonly scope: OracleIrGapTelemetryScope;
  /** Card / source name. */
  readonly label: string;
  readonly reasons: readonly string[];
  /** Effect clause or oracle text snippet (truncated). */
  readonly effectText?: string;
  readonly gameId?: string;
  readonly stats?: { applied?: number; parsed?: number; mandatory?: number };
  readonly at: string;
}

export interface OracleIrGapTelemetrySnapshot {
  readonly totalEvents: number;
  readonly byKind: Record<string, number>;
  readonly byScopeKind: Record<string, number>;
  /** label → occurrence count, most frequent first (top 50). */
  readonly topLabels: Array<{ label: string; kind: string; count: number }>;
  readonly recentEvents: readonly OracleIrGapTelemetryEvent[];
}

const MAX_RECENT_EVENTS = 200;
const MAX_EFFECT_TEXT = 240;

let totalEvents = 0;
const byKind = new Map<string, number>();
const byScopeKind = new Map<string, number>();
const labelCounts = new Map<string, number>();
const recentEvents: OracleIrGapTelemetryEvent[] = [];
const loggedFingerprints = new Set<string>();

function telemetryLoggingEnabled(): boolean {
  const raw = String(process.env.ORACLE_IR_GAP_TELEMETRY_LOG ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

function normalizeReasons(reasons: readonly string[] | string | undefined): readonly string[] {
  if (Array.isArray(reasons)) return reasons.map((reason) => String(reason));
  if (typeof reasons === 'string' && reasons.trim()) return [reasons.trim()];
  return [];
}

export function recordOracleIrGapTelemetry(event: {
  kind: OracleIrGapTelemetryKind;
  scope: OracleIrGapTelemetryScope;
  label: string;
  reasons?: readonly string[] | string;
  effectText?: string;
  gameId?: string;
  stats?: { applied?: number; parsed?: number; mandatory?: number };
}): void {
  try {
    const label = String(event.label || 'unknown');
    const reasons = normalizeReasons(event.reasons);
    const record: OracleIrGapTelemetryEvent = {
      kind: event.kind,
      scope: event.scope,
      label,
      reasons,
      effectText: event.effectText
        ? String(event.effectText).trim().slice(0, MAX_EFFECT_TEXT)
        : undefined,
      gameId: event.gameId ? String(event.gameId) : undefined,
      stats: event.stats,
      at: new Date().toISOString(),
    };

    totalEvents += 1;
    byKind.set(record.kind, (byKind.get(record.kind) || 0) + 1);
    const scopeKindKey = `${record.scope}:${record.kind}`;
    byScopeKind.set(scopeKindKey, (byScopeKind.get(scopeKindKey) || 0) + 1);
    const labelKey = `${record.kind}|${label}`;
    labelCounts.set(labelKey, (labelCounts.get(labelKey) || 0) + 1);

    recentEvents.push(record);
    if (recentEvents.length > MAX_RECENT_EVENTS) {
      recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
    }

    // Console emission: gaps only (legacy_handled is triage data, not an error),
    // once per fingerprint per process, independent of DEBUG_STATE.
    if (record.kind !== 'legacy_handled' && telemetryLoggingEnabled()) {
      const fingerprint = `${record.kind}|${record.scope}|${label}`;
      if (!loggedFingerprints.has(fingerprint)) {
        loggedFingerprints.add(fingerprint);
        console.warn(
          `[oracleIR-telemetry] ${record.kind} (${record.scope}) ${label}` +
            (reasons.length > 0 ? ` — ${reasons.join('; ')}` : ''),
        );
      }
    }
  } catch {
    // Telemetry must never break game logic.
  }
}

export function getOracleIrGapTelemetrySnapshot(): OracleIrGapTelemetrySnapshot {
  const topLabels = [...labelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([key, count]) => {
      const sep = key.indexOf('|');
      return { kind: key.slice(0, sep), label: key.slice(sep + 1), count };
    });

  return {
    totalEvents,
    byKind: Object.fromEntries(byKind.entries()),
    byScopeKind: Object.fromEntries(byScopeKind.entries()),
    topLabels,
    recentEvents: [...recentEvents],
  };
}

export function resetOracleIrGapTelemetry(): void {
  totalEvents = 0;
  byKind.clear();
  byScopeKind.clear();
  labelCounts.clear();
  recentEvents.length = 0;
  loggedFingerprints.clear();
}
