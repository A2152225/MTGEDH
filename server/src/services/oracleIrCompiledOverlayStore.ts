import type { OracleIRCompilerEnvelope } from '../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { validateCompiledOverlayEnvelope } from '../../../rules-engine/src/oracleIRCompilerEnvelope.js';

import {
  ensureLocalCardLookupIndexSync,
  getLocalCardLookupDatabase,
} from './localCardLookup.js';
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
  ensureLocalCardLookupIndexSync();
  const database = getLocalCardLookupDatabase();
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
  ensureLocalCardLookupIndexSync();
  const database = getLocalCardLookupDatabase();
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
  ensureLocalCardLookupIndexSync();
  const database = getLocalCardLookupDatabase();
  const cardId = normalizeCardId(input.cardId);
  const normalizedName = normalizeOverlayName(input.name);

  if (cardId) {
    const byId = database.prepare(`
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE card_id = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(cardId, normalizeOverlayKey(cardId)) as { payload: string } | undefined;
    if (byId?.payload) {
      const envelope = parseStoredEnvelope(byId.payload);
      if (envelope) return envelope;
    }
  }

  if (normalizedName) {
    const byName = database.prepare(`
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE normalized_name = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(normalizedName, normalizeOverlayKey(normalizedName)) as { payload: string } | undefined;
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
  ensureLocalCardLookupIndexSync();
  const database = getLocalCardLookupDatabase();
  const cardId = normalizeCardId(input.cardId);
  const normalizedName = normalizeOverlayName(input.name);

  if (cardId) {
    const byId = database.prepare(`
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE card_id = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(cardId, normalizeOverlayKey(cardId)) as { payload: string } | undefined;
    if (byId?.payload) return byId.payload;
  }

  if (normalizedName) {
    const byName = database.prepare(`
      SELECT payload FROM oracle_ir_compiled_overlay
      WHERE normalized_name = ? OR overlay_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(normalizedName, normalizeOverlayKey(normalizedName)) as { payload: string } | undefined;
    if (byName?.payload) return byName.payload;
  }

  return null;
}

export function resetCompiledOracleIROverlayTableForTests(): void {
  ensureLocalCardLookupIndexSync();
  const database = getLocalCardLookupDatabase();
  database.exec('DELETE FROM oracle_ir_compiled_overlay');
}
