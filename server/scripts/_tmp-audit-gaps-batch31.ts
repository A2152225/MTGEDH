import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

async function main() {
  const auditMod = await import('./trigger-coverage-audit.ts');
  const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
  const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

  const assess = (auditMod as { assessTriggerCoverage?: (card: unknown, trigger: unknown) => { statuses: string[]; effectGaps?: string[] } }).assessTriggerCoverage;
  if (!assess) {
    console.log('no assessTriggerCoverage export');
    return;
  }

  function isSilverBorder(card: { border_color?: string; set_type?: string; set?: string }): boolean {
    if (card.border_color === 'silver') return true;
    if (card.set_type === 'funny') return true;
    const funnySets = new Set(['ugl', 'unh', 'ust', 'und', 'unf', 'unk', 'ugm', 'uhd']);
    return funnySets.has(String(card.set || '').toLowerCase());
  }

  const patternCounts = new Map<string, number>();
  let gapTriggers = 0;

  for (const card of cards) {
    if (isSilverBorder(card)) continue;
    const o = card.card_faces
      ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
      : String(card.oracle_text || '');
    if (!o) continue;
    const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
    for (const t of parsed) {
      const result = assess(card, t);
      if (!result.statuses.includes('effect_ir_gap')) continue;
      gapTriggers++;
      const gaps = result.effectGaps || [];
      for (const g of gaps) {
        patternCounts.set(g, (patternCounts.get(g) || 0) + 1);
      }
    }
  }

  const sorted = [...patternCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`audit effect_ir_gap triggers (non-silver): ${gapTriggers}`);
  console.log('top gap strings:');
  for (const [g, c] of sorted.slice(0, 45)) {
    console.log(`${c}\t${g.slice(0, 100)}`);
  }
}

main().catch(console.error);
