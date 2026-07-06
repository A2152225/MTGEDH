import type { OracleIRCompilerEnvelope } from '../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { validateCompiledOverlayEnvelope } from '../../rules-engine/src/oracleIRCompilerEnvelope.js';

export interface OverlayImportRecord {
  readonly cardId?: string;
  readonly name?: string;
  readonly envelope: OracleIRCompilerEnvelope;
}

export function validateCompilerEnvelope(
  envelope: OracleIRCompilerEnvelope,
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] } {
  const validation = validateCompiledOverlayEnvelope(envelope);
  if (validation.ok) {
    return { ok: true };
  }
  return { ok: false, errors: validation.errors };
}

export function normalizeOverlayImportRecord(raw: unknown, sourceLabel: string): OverlayImportRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${sourceLabel}: expected JSON object`);
  }

  const record = raw as Record<string, unknown>;
  if (record.envelope && typeof record.envelope === 'object') {
    const envelope = record.envelope as OracleIRCompilerEnvelope;
    return {
      cardId: String(record.card_id || record.cardId || envelope.card_id || '').trim() || undefined,
      name: String(record.name || '').trim() || undefined,
      envelope,
    };
  }

  const envelope = record as OracleIRCompilerEnvelope;
  return {
    cardId: String(envelope.card_id || '').trim() || undefined,
    name: undefined,
    envelope,
  };
}

export function inferOverlayNameFromFilename(fileName: string): string | undefined {
  const stem = String(fileName || '').replace(/\.json$/i, '').trim();
  if (!stem) return undefined;
  return stem.replace(/[-_]+/g, ' ').trim() || undefined;
}

/** Skip template/example overlays from bulk import (`*.example.json`). */
export function isOverlayExampleFile(fileName: string): boolean {
  return /\.example\.json$/i.test(String(fileName || '').trim());
}
