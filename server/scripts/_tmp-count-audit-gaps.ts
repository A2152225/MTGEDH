import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

// Re-import isIgnorable from audit by duplicating the tail of patterns - load module exports
async function main() {
  const auditMod = await import('./trigger-coverage-audit.ts');
  const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
  const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

  function effectTextForIrAudit(effectText: string): string {
    const raw = String(effectText || '').trim();
    const stripped = raw
      .replace(/\([^()]*\)/g, ' ')
      .replace(/\s+\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.length >= 4 ? stripped : raw;
  }

  function isSilverBorder(card: { border_color?: string; set_type?: string; set?: string }): boolean {
    if (card.border_color === 'silver') return true;
    if (card.set_type === 'funny') return true;
    const funnySets = new Set(['ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd']);
    return funnySets.has(String(card.set || '').toLowerCase());
  }

  // Use same gap collection as audit - import internal via re-running assess logic
  const patternCounts = new Map<string, number>();
  let triggerGaps = 0;

  for (const card of cards) {
    if (isSilverBorder(card)) continue;
    const o = card.card_faces
      ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
      : String(card.oracle_text || '');
    if (!o) continue;
    const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
    for (const t of parsed) {
      if (!serverDetectsTrigger(card, t)) continue;
      const gaps = (auditMod as { assessTriggerCoverage?: Function }).assessTriggerCoverage
        ? undefined
        : undefined;
      // fallback: manual with exported helper if available
    }
  }

  // Simpler: read gaps from audit output entries if present
  const entries = audit.triggerGaps || audit.gapEntries || audit.topEffectIrGaps;
  if (entries) {
    console.log('from audit json', entries.length);
    return;
  }

  // Parse audit card results if stored
  const results = audit.results || audit.triggers || [];
  console.log('audit keys', Object.keys(audit).slice(0, 20));
}

main().catch(console.error);
