import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  parseSacrificeWhat,
} from '../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  isBenignFullCardReplacementMetadata,
} from './executor-coverage-audit.ts';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const auditJsonPath = path.join(__dirname, 'out', 'executor-coverage-audit.json');
const outPath = path.join(__dirname, 'out', 'executor-fullcard-object-selector-gap-analysis.json');

type FixKind = 'parser' | 'executor' | 'audit_enrich';

type GapRow = {
  key: string;
  stepKind: string;
  objectText: string;
  raw: string;
  count: number;
  exampleCards: string[];
  handlerFile: string;
  fixKind: FixKind;
  fixNotes: string;
};

function extractObjectText(step: OracleEffectStep): string {
  const anyStep = step as any;
  if (anyStep.object) {
    const obj = anyStep.object;
    return String(obj.text || obj.raw || '').trim();
  }
  if (anyStep.what) {
    const what = anyStep.what;
    return String(what.text || what.raw || '').trim();
  }
  return '';
}

function handlerFileForStepKind(stepKind: string): string {
  switch (stepKind) {
    case 'sacrifice':
    case 'schedule_delayed_battlefield_action':
      return 'rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts';
    case 'put_on_bottom':
      return 'rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts';
    default:
      return 'rules-engine/src/oracleIRExecutorMainLoop.ts';
  }
}

function inferFixKind(stepKind: string, objectText: string): { fixKind: FixKind; fixNotes: string } {
  const lower = objectText.toLowerCase().trim();
  const sacrificeParsed = parseSacrificeWhat({ kind: 'raw', text: objectText });

  if (stepKind === 'put_on_bottom') {
    if (/^the rest\b/.test(lower)) {
      return {
        fixKind: 'audit_enrich',
        fixNotes: 'Seed ctx.lastMovedCards from prior reveal/look step in executor-coverage-audit.ts',
      };
    }
    return {
      fixKind: 'executor',
      fixNotes: 'Extend applyPutOnBottomStep what patterns in oracleIRExecutorPlayerStepHandlers.ts',
    };
  }

  if (stepKind === 'sacrifice' || stepKind === 'schedule_delayed_battlefield_action') {
    if (sacrificeParsed?.mode === 'choice_required') {
      return {
        fixKind: 'audit_enrich',
        fixNotes: 'Choice-shaped sacrifice; audit may need fixture or should route to player_choice_required',
      };
    }
    if (/^(?:a|an|one|two|three|\d+)\s+/i.test(objectText) && !sacrificeParsed) {
      return {
        fixKind: 'executor',
        fixNotes: 'Extend parseSacrificeWhat count/subtype patterns in oracleIRExecutorBattlefieldStepHandlers.ts',
      };
    }
    if (/\battached to\b|\bcreated with\b|\bexiled with\b/i.test(objectText) && !sacrificeParsed) {
      return {
        fixKind: 'executor',
        fixNotes: 'Extend parseSacrificeWhat attachment/contextual reference patterns',
      };
    }
    if (/\bopponent/i.test(objectText) && !sacrificeParsed) {
      return {
        fixKind: 'executor',
        fixNotes: 'Extend parseSacrificeWhat opponent-controlled permanent patterns',
      };
    }
    if (!objectText || objectText.length < 3) {
      return {
        fixKind: 'parser',
        fixNotes: 'Object text missing/truncated; check oracleIRParserSacrificeHelpers.ts / parseObjectSelector wiring',
      };
    }
    if (/[,;]|\band\/or\b|\bor pay\b/i.test(objectText)) {
      return {
        fixKind: 'parser',
        fixNotes: 'Compound sacrifice clause; split object in oracleIRParserSacrificeHelpers.ts',
      };
    }
    return {
      fixKind: 'executor',
      fixNotes: 'Extend parseSacrificeWhat in oracleIRExecutorBattlefieldStepHandlers.ts',
    };
  }

  return {
    fixKind: 'executor',
    fixNotes: `Unhandled step kind ${stepKind}; inspect handler dispatch`,
  };
}

function clusterFromLiveScan(): {
  clusters: Map<string, GapRow>;
  scanned: number;
  gapItems: number;
  gapEvents: number;
} {
  const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
  const clusters = new Map<string, GapRow>();
  const seen = new Set<string>();
  let scanned = 0;
  let gapItems = 0;
  let gapEvents = 0;

  for (const card of cards) {
    if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
    const oracleId = String(card.oracle_id || card.id || card.name);
    if (seen.has(oracleId)) continue;
    seen.add(oracleId);
    scanned += 1;

    const oracle = getCombinedOracleText(card);
    if (!oracle) continue;
    if (isIgnorableCardForIrGap(card)) continue;

    const parsed = parseOracleTextToIR(oracle, card.name);
    for (const ability of parsed.abilities || []) {
      const text = String(ability.effectText || ability.text || '').trim();
      if (!text) continue;
      const abilitySteps = Array.isArray(ability.steps) ? ability.steps : [];
      if (
        ability.type === 'replacement' &&
        abilitySteps.length === 0 &&
        isBenignFullCardReplacementMetadata(text)
      ) {
        continue;
      }
      const steps = abilitySteps.length > 0 ? abilitySteps : [];
      if (steps.length === 0) continue;
      if (collectUnknownIrGapsFromSteps(steps).length > 0) continue;

      let state = buildAuditFixtureState(card.name, card.type_line);
      let ctx = buildAuditExecutionContext(card.name);
      const enriched = enrichAuditStateAndContextForCopySteps(
        { name: card.name, type_line: card.type_line, oracle_text: oracle },
        steps,
        state,
        ctx
      );
      const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
        oracleText: oracle,
      });
      state = targetEnriched.state;
      ctx = targetEnriched.ctx;
      const selectedModeIds = collectAutoSelectedModeIds(steps);
      const result = applyOracleIRStepsToGameState(state, steps, ctx, {
        allowOptional: true,
        ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
      });

      const objectGaps = (result.automationGaps || []).filter(
        (gap) => gap.reasonCode === 'unsupported_object_selector'
      );
      if (objectGaps.length === 0) continue;

      gapItems += 1;
      for (const gap of objectGaps) {
        gapEvents += 1;
        const stepKind = String(gap.stepKind || 'unknown');
        const objectText =
          String((gap.metadata as any)?.objectText || (gap.metadata as any)?.selectorText || '').trim() ||
          extractObjectTextFromGap(gap, steps);
        const key = `${stepKind}|${objectText.toLowerCase() || String(gap.raw || text).toLowerCase().slice(0, 120)}`;
        const { fixKind, fixNotes } = inferFixKind(stepKind, objectText || String(gap.raw || ''));
        const existing = clusters.get(key);
        if (!existing) {
          clusters.set(key, {
            key,
            stepKind,
            objectText: objectText || String(gap.raw || text).slice(0, 160),
            raw: String(gap.raw || text).slice(0, 200),
            count: 1,
            exampleCards: [card.name],
            handlerFile: handlerFileForStepKind(stepKind),
            fixKind,
            fixNotes,
          });
          continue;
        }
        existing.count += 1;
        if (!existing.exampleCards.includes(card.name) && existing.exampleCards.length < 8) {
          existing.exampleCards.push(card.name);
        }
      }
    }
  }

  return { clusters, scanned, gapItems, gapEvents };
}

function extractObjectTextFromGap(gap: { stepKind?: string; raw?: string }, steps: OracleEffectStep[]): string {
  const raw = String(gap.raw || '').trim();
  for (const step of steps) {
    if (String(step.raw || '').trim() !== raw) continue;
    return extractObjectText(step);
  }
  return '';
}

function clusterFromAuditJson(): { clusters: Map<string, GapRow>; gapItems: number; gapEvents: number } | null {
  if (!fs.existsSync(auditJsonPath)) return null;
  const audit = JSON.parse(fs.readFileSync(auditJsonPath, 'utf8')) as any;
  const items = Array.isArray(audit?.gapItems) ? audit.gapItems : [];
  const clusters = new Map<string, GapRow>();
  const cardsWithGap = new Set<string>();
  let gapEvents = 0;

  for (const item of items) {
    const gaps = Array.isArray(item?.automationGaps) ? item.automationGaps : [];
    const objectGaps = gaps.filter((g: any) => g.reasonCode === 'unsupported_object_selector');
    if (objectGaps.length === 0) continue;
    cardsWithGap.add(String(item.cardName || item.name || ''));
    for (const gap of objectGaps) {
      gapEvents += 1;
      const stepKind = String(gap.stepKind || 'unknown');
      const objectText = String(
        (gap.metadata as any)?.objectText ||
          (gap.metadata as any)?.selectorText ||
          (gap.metadata as any)?.selector ||
          ''
      ).trim();
      const cardName = String(item.cardName || item.name || 'unknown');
      const key = `${stepKind}|${objectText.toLowerCase() || String(gap.raw || '').toLowerCase().slice(0, 120)}`;
      const { fixKind, fixNotes } = inferFixKind(stepKind, objectText || String(gap.raw || ''));
      const existing = clusters.get(key);
      if (!existing) {
        clusters.set(key, {
          key,
          stepKind,
          objectText: objectText || String(gap.raw || '').slice(0, 160),
          raw: String(gap.raw || '').slice(0, 200),
          count: 1,
          exampleCards: cardName !== 'unknown' ? [cardName] : [],
          handlerFile: handlerFileForStepKind(stepKind),
          fixKind,
          fixNotes,
        });
        continue;
      }
      existing.count += 1;
      if (cardName !== 'unknown' && !existing.exampleCards.includes(cardName) && existing.exampleCards.length < 8) {
        existing.exampleCards.push(cardName);
      }
    }
  }

  return { clusters, gapItems: cardsWithGap.size, gapEvents };
}

await loadEffectIrParser();

const auditResult = clusterFromAuditJson();
const useAudit = auditResult && auditResult.gapEvents > 0;
const liveResult = useAudit ? null : clusterFromLiveScan();

const clusters = useAudit ? auditResult!.clusters : liveResult!.clusters;
const scanned = useAudit ? null : liveResult!.scanned;
const gapItems = useAudit ? auditResult!.gapItems : liveResult!.gapItems;
const gapEvents = useAudit ? auditResult!.gapEvents : liveResult!.gapEvents;

const top = [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 40);
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'full_card',
  source: useAudit ? 'executor-coverage-audit.json' : 'oracle-cards.json live scan',
  cardsScanned: scanned,
  gapItems,
  gapEvents,
  uniqueClusters: clusters.size,
  topClusters: top,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Source: ${report.source}`);
if (scanned != null) console.log(`Cards scanned: ${scanned}`);
console.log(`Items with unsupported_object_selector: ${gapItems}`);
console.log(`Gap events: ${gapEvents}`);
console.log(`Unique clusters: ${clusters.size}`);
for (const row of top.slice(0, 20)) {
  console.log(`[${row.count}] ${row.stepKind} — ${row.objectText}`);
  console.log(`     ${row.fixKind} → ${row.handlerFile}`);
  console.log(`     e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
}
console.log(`\nWrote ${outPath}`);
process.exit(0);
