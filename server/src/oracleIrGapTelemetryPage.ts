/**
 * Browser log for GET /api/oracle-ir/telemetry.
 * JSON remains the default for scripts (`Accept: application/json` or `?format=json`).
 */

import type {
  OracleIrGapTelemetryEvent,
  OracleIrGapTelemetrySnapshot,
} from './state/modules/oracleIrGapTelemetry.js';

const KIND_LABELS: Record<string, string> = {
  all_or_nothing_failure: 'IR started, then failed a mandatory step',
  owned_but_unhandled: 'IR owns this text but did nothing (silent no-op risk)',
  legacy_handled: 'Legacy path ran while IR primary is on',
};

export function wantsOracleIrTelemetryHtml(req: {
  query?: Record<string, unknown>;
  accepts?: (types: string[]) => string | false;
}): boolean {
  const format = String(req.query?.format || '').trim().toLowerCase();
  if (format === 'json') return false;
  if (format === 'html') return true;
  return req.accepts?.(['html', 'json']) === 'html';
}

export function describeTelemetryGameLabel(input: {
  gameId?: string;
  gameName?: string;
  players?: Array<{ name?: string } | null | undefined> | null;
}): string {
  const named = String(input.gameName || '').trim();
  if (named) return named;
  const players = (input.players || [])
    .map((player) => String(player?.name || '').trim())
    .filter(Boolean);
  if (players.length) return players.join(', ');
  const id = String(input.gameId || '').trim();
  return id || '—';
}

export function escapeTelemetryHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString();
}

function brokenSummary(event: OracleIrGapTelemetryEvent): string {
  const kind = KIND_LABELS[event.kind] || event.kind;
  const reasons = (event.reasons || []).map((reason) => String(reason).trim()).filter(Boolean);
  const effect = String(event.effectText || '').trim();
  const parts = [`${kind} · ${event.scope}`];
  if (reasons.length) parts.push(reasons.join('; '));
  if (effect) parts.push(effect);
  return parts.join(' — ');
}

export function renderOracleIrTelemetryHtml(
  snapshot: OracleIrGapTelemetrySnapshot,
  options?: {
    gameNameFor?: (gameId: string) => string | undefined;
  },
): string {
  const events = [...snapshot.recentEvents].reverse();
  const rows = events.map((event) => {
    const gameId = String(event.gameId || '').trim();
    const game = describeTelemetryGameLabel({
      gameId,
      gameName: event.gameName || (gameId ? options?.gameNameFor?.(gameId) : undefined),
    });
    const gameSub = gameId && game !== gameId ? gameId : '';
    return `<article class="row ${escapeTelemetryHtml(event.kind)}">
  <time datetime="${escapeTelemetryHtml(event.at)}">${escapeTelemetryHtml(formatWhen(event.at))}</time>
  <div class="game"><strong>${escapeTelemetryHtml(game)}</strong>${gameSub ? `<span class="id">${escapeTelemetryHtml(gameSub)}</span>` : ''}</div>
  <div class="card">${escapeTelemetryHtml(event.label || 'unknown')}</div>
  <p>${escapeTelemetryHtml(brokenSummary(event))}</p>
</article>`;
  }).join('\n');

  const empty = `<p class="empty">No IR gaps since this server process started (${escapeTelemetryHtml(formatWhen(snapshot.processStartedAt))}). A clean game looks like this — rows appear only when something fails the all-or-nothing gate, IR owns text but does nothing, or a legacy handler still runs. Restarting the server clears the log. This is a rolling history of up to 200 events, not just the last one.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oracle IR gap log</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: #111; color: #eee; }
    header { padding: 1.25rem 1.5rem 0.75rem; border-bottom: 1px solid #333; }
    h1 { margin: 0 0 0.35rem; font-size: 1.25rem; }
    .meta { color: #aaa; font-size: 0.9rem; }
    main { padding: 1rem 1.5rem 2rem; display: grid; gap: 0.75rem; }
    .empty { color: #bbb; max-width: 52rem; }
    .row { background: #1b1b1b; border: 1px solid #333; border-left: 4px solid #666; border-radius: 6px; padding: 0.75rem 1rem; }
    .row.owned_but_unhandled { border-left-color: #e5534b; }
    .row.all_or_nothing_failure { border-left-color: #d89b2a; }
    .row.legacy_handled { border-left-color: #6b8cae; }
    time, .id { color: #9aa; font-size: 0.82rem; }
    .game { margin: 0.15rem 0; }
    .id { display: block; }
    .card { font-weight: 650; margin: 0.15rem 0 0.35rem; }
    p { margin: 0; color: #ddd; }
  </style>
</head>
<body>
  <header>
    <h1>Oracle IR gap log</h1>
    <p class="meta">${snapshot.totalEvents} event${snapshot.totalEvents === 1 ? '' : 's'}
      · process started ${escapeTelemetryHtml(formatWhen(snapshot.processStartedAt))}
      · refreshes every 8s
      · <a href="?format=json">JSON</a></p>
  </header>
  <main>
    ${events.length ? rows : empty}
  </main>
</body>
</html>`;
}
