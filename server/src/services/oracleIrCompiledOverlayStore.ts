import type Database from 'better-sqlite3';

import type { OracleIRCompilerEnvelope } from '../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { validateCompiledOverlayEnvelope } from '../../../rules-engine/src/oracleIRCompilerEnvelope.js';

import { getCompiledOracleIROverlayDatabase } from './oracleIrCompiledOverlayDatabase.js';
import { debugWarn } from '../utils/debug.js';

export interface CompiledOracleIROverlayLookupInput {
  readonly cardId?: string;
  readonly name?: string;
}

function normalizeOverlayKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeCardId(value: string | undefined): string {
  return String(value || '').trim();
}

function normalizeOverlayName(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

type OverlayDb = ReturnType<typeof getCompiledOracleIROverlayDatabase>;
type OverlayStatement = Database.Statement<[string, string]>;

const OVERLAY_BY_ID_SQL = `
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE card_id = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `;
const OVERLAY_BY_NAME_SQL = `
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE normalized_name = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `;

// Lookups run once per permanent per continuous-effect recompute; re-preparing the
// statement each call showed up as seconds of sqlite `prepare` self time in profiles.
const overlayReadStatements = new WeakMap<OverlayDb, { byId: OverlayStatement; byName: OverlayStatement }>();

function getOverlayReadStatements(database: OverlayDb): { byId: OverlayStatement; byName: OverlayStatement } {
  let statements = overlayReadStatements.get(database);
  if (!statements) {
    statements = {
      byId: database.prepare<[string, string]>(OVERLAY_BY_ID_SQL),
      byName: database.prepare<[string, string]>(OVERLAY_BY_NAME_SQL),
    };
    overlayReadStatements.set(database, statements);
  }
  return statements;
}

function parseStoredEnvelope(payload: string): OracleIRCompilerEnvelope | null {
  try {
    const parsed = JSON.parse(payload) as OracleIRCompilerEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.fallback_to_bespoke) return null;
    const validation = validateCompiledOverlayEnvelope(parsed);
    if (!validation.ok) {
      debugWarn(1, '[oracle-ir-overlay] Stored overlay failed validation', validation.errors);
      return null;
    }
    return parsed;
  } catch (error) {
    debugWarn(1, '[oracle-ir-overlay] Failed to parse stored overlay payload', error);
    return null;
  }
}

export function upsertCompiledOracleIROverlaySync(input: {
  readonly cardId?: string;
  readonly name?: string;
  readonly envelope: OracleIRCompilerEnvelope;
}): void {
  const database = getCompiledOracleIROverlayDatabase();
  const cardId = normalizeCardId(input.cardId || input.envelope.card_id);
  const normalizedName = normalizeOverlayName(input.name);
  const overlayKey = normalizeOverlayKey(cardId || normalizedName);
  if (!overlayKey) {
    throw new Error('upsertCompiledOracleIROverlaySync requires cardId or name');
  }

  const payload = JSON.stringify(input.envelope);
  database.prepare(`
    INSERT INTO oracle_ir_compiled_overlay (overlay_key, card_id, normalized_name, payload, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(overlay_key) DO UPDATE SET
      card_id = excluded.card_id,
      normalized_name = excluded.normalized_name,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(
    overlayKey,
    cardId || null,
    normalizedName || null,
    payload,
    Date.now(),
  );
}

export function deleteCompiledOracleIROverlaySync(input: CompiledOracleIROverlayLookupInput): boolean {
  const database = getCompiledOracleIROverlayDatabase();
  const cardId = normalizeCardId(input.cardId);
  const normalizedName = normalizeOverlayName(input.name);
  const overlayKey = normalizeOverlayKey(cardId || normalizedName);
  if (!overlayKey) return false;
  const result = database.prepare('DELETE FROM oracle_ir_compiled_overlay WHERE overlay_key = ?').run(overlayKey);
  return result.changes > 0;
}

export function lookupCompiledOracleIROverlaySync(
  input: CompiledOracleIROverlayLookupInput,
): OracleIRCompilerEnvelope | null {
  const database = getCompiledOracleIROverlayDatabase();
  const statements = getOverlayReadStatements(database);
  const cardId = normalizeCardId(input.cardId);
  const normalizedName = normalizeOverlayName(input.name);

  if (cardId) {
    const byId = statements.byId.get(cardId, normalizeOverlayKey(cardId)) as { payload: string } | undefined;
    if (byId?.payload) {
      const envelope = parseStoredEnvelope(byId.payload);
      if (envelope) return envelope;
    }
  }

  if (normalizedName) {
    const byName = statements.byName.get(normalizedName, normalizeOverlayKey(normalizedName)) as { payload: string } | undefined;
    if (byName?.payload) {
      return parseStoredEnvelope(byName.payload);
    }
  }

  return null;
}

/** Raw stored payload for telemetry (includes fallback_to_bespoke / invalid envelopes). */
export function peekCompiledOracleIROverlayPayloadSync(
  input: CompiledOracleIROverlayLookupInput,
): string | null {
  const database = getCompiledOracleIROverlayDatabase();
  const statements = getOverlayReadStatements(database);
  const cardId = normalizeCardId(input.cardId);
  const normalizedName = normalizeOverlayName(input.name);

  if (cardId) {
    const byId = statements.byId.get(cardId, normalizeOverlayKey(cardId)) as { payload: string } | undefined;
    if (byId?.payload) return byId.payload;
  }

  if (normalizedName) {
    const byName = statements.byName.get(normalizedName, normalizeOverlayKey(normalizedName)) as { payload: string } | undefined;
    if (byName?.payload) return byName.payload;
  }

  return null;
}

export function resetCompiledOracleIROverlayTableForTests(): void {
  const database = getCompiledOracleIROverlayDatabase();
  database.exec('DELETE FROM oracle_ir_compiled_overlay');
}
