import { describe, expect, it } from 'vitest';

import {
  describeTelemetryGameLabel,
  escapeTelemetryHtml,
  renderOracleIrTelemetryHtml,
  wantsOracleIrTelemetryHtml,
} from '../src/oracleIrGapTelemetryPage.js';
import type { OracleIrGapTelemetrySnapshot } from '../src/state/modules/oracleIrGapTelemetry.js';

function snapshot(overrides: Partial<OracleIrGapTelemetrySnapshot> = {}): OracleIrGapTelemetrySnapshot {
  return {
    totalEvents: 0,
    byKind: {},
    byScopeKind: {},
    topLabels: [],
    recentEvents: [],
    processStartedAt: '2026-08-13T07:00:00.000Z',
    ...overrides,
  };
}

describe('oracle IR telemetry HTML log', () => {
  it('serves HTML for browser Accept and format=html, JSON when asked', () => {
    expect(wantsOracleIrTelemetryHtml({
      query: {},
      accepts: (types) => types[0] === 'html' ? 'html' : false,
    })).toBe(true);
    expect(wantsOracleIrTelemetryHtml({ query: { format: 'html' } })).toBe(true);
    expect(wantsOracleIrTelemetryHtml({
      query: { format: 'json' },
      accepts: () => 'html',
    })).toBe(false);
    expect(wantsOracleIrTelemetryHtml({
      query: {},
      accepts: () => 'json',
    })).toBe(false);
  });

  it('prefers player names, then recorded gameName, then game id', () => {
    expect(describeTelemetryGameLabel({
      gameId: 'g1',
      gameName: 'Table Night',
    })).toBe('Table Night');
    expect(describeTelemetryGameLabel({
      gameId: 'g1',
      players: [{ name: 'Alice' }, { name: 'Bob' }],
    })).toBe('Alice, Bob');
    expect(describeTelemetryGameLabel({ gameId: 'live-soak-1' })).toBe('live-soak-1');
    expect(describeTelemetryGameLabel({})).toBe('—');
  });

  it('renders an empty-state explanation when nothing has broken', () => {
    const html = renderOracleIrTelemetryHtml(snapshot());
    expect(html).toContain('No IR gaps since this server process started');
    expect(html).toContain('rolling history of up to 200 events');
    expect(html).toContain('0 events');
  });

  it('logs game, timestamp, card, and what broke for each event', () => {
    const html = renderOracleIrTelemetryHtml(
      snapshot({
        totalEvents: 1,
        byKind: { owned_but_unhandled: 1 },
        recentEvents: [{
          kind: 'owned_but_unhandled',
          scope: 'trigger',
          label: 'Tivit, Seller of Secrets',
          reasons: ['ir_primary_owns_effect_but_did_not_apply; legacy regex tail skipped'],
          effectText: 'each player votes for evidence or bribery',
          gameId: 'game-42',
          gameName: 'Ken, Sam, AI-West',
          at: '2026-08-13T07:15:00.000Z',
        }],
      }),
    );
    expect(html).toContain('Ken, Sam, AI-West');
    expect(html).toContain('game-42');
    expect(html).toContain('Tivit, Seller of Secrets');
    expect(html).toContain('IR owns this text but did nothing');
    expect(html).toContain('each player votes for evidence or bribery');
    expect(html).toContain('datetime="2026-08-13T07:15:00.000Z"');
    expect(html).not.toContain('<script');
  });

  it('escapes HTML in card names and reasons', () => {
    expect(escapeTelemetryHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    const html = renderOracleIrTelemetryHtml(
      snapshot({
        totalEvents: 1,
        recentEvents: [{
          kind: 'all_or_nothing_failure',
          scope: 'spell',
          label: '<img>',
          reasons: ['foo <bar>'],
          gameId: 'g',
          at: '2026-08-13T07:15:00.000Z',
        }],
      }),
    );
    expect(html).toContain('&lt;img&gt;');
    expect(html).toContain('foo &lt;bar&gt;');
    expect(html).not.toContain('<img>');
  });
});
