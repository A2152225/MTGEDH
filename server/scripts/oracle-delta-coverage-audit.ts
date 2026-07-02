/*
  Oracle snapshot delta coverage audit (task D1).

  Diffs the current oracle-cards.json against a committed baseline of per-card
  identity hashes, runs the executor dry-run + trigger detection audits on the
  NEW/CHANGED cards only, and fails (non-zero exit) when the delta introduces
  gaps. Emits an overlay-first work queue so failures map directly onto the
  new-card workflow (probe → overlay → parser batch).

  Run (from server/):
    npm run oracle-ir:delta                       # audit delta vs baseline
    npm run oracle-ir:delta -- --update-baseline  # accept current corpus as baseline
    npm run oracle-ir:delta -- --no-fail          # report only, always exit 0

  First-time bootstrap (no baseline yet): --update-baseline writes the baseline
  from the current corpus without auditing (Layer 1–2 corpus audits already
  cover it).

  Optional env:
    ORACLE_DELTA_BASELINE=path                    (default: scripts/oracle-delta-baseline.json)
    ORACLE_DELTA_MAX_CARDS=2000                   safety cap on audited delta cards
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  collectUnknownIrGapsFromSteps,
  getCombinedOracleText,
  hasUnknownIRSteps,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
  serverDetectsTrigger,
} from './trigger-coverage-audit.ts';
import {
  collectStepsFromIrText,
  dryRunOracleSteps,
  isBenignFullCardAbilityMetadata,
  isBenignFullCardReplacementMetadata,
  type ExecutorCoverageStatus,
} from './executor-coverage-audit.ts';
import {
  buildOracleDeltaBaseline,
  computeOracleDelta,
  hashOracleIdentity,
  oracleIdForCard,
  suggestDeltaGapAction,
  type DeltaGapReasonCode,
  type OracleDeltaBaseline,
  type OracleDeltaCardIdentity,
} from './oracleDeltaAuditUtils.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'out');
const reportPath = path.join(outDir, 'oracle-delta-coverage-audit.json');
const defaultBaselinePath = path.join(__dirname, 'oracle-delta-baseline.json');

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  games?: string[];
  digital?: boolean;
  oversized?: boolean;
  set_type?: string;
  border_color?: string;
  set?: string;
  legalities?: Record<string, string>;
};

type DeltaCardResult = {
  oracleId: string;
  name: string;
  changeType: 'new' | 'changed';
  fullCardStatuses: ExecutorCoverageStatus[];
  gapReasons: DeltaGapReasonCode[];
  gapDetails: string[];
  ok: boolean;
};

type DeltaArgs = {
  baselinePath: string;
  updateBaseline: boolean;
  failOnGaps: boolean;
  maxCards: number;
};

function parseArgs(): DeltaArgs {
  const argv = process.argv.slice(2);
  const baselineFlagIndex = argv.indexOf('--baseline');
  const baselinePath =
    baselineFlagIndex >= 0 && argv[baselineFlagIndex + 1]
      ? path.resolve(argv[baselineFlagIndex + 1])
      : process.env.ORACLE_DELTA_BASELINE
        ? path.resolve(process.env.ORACLE_DELTA_BASELINE)
        : defaultBaselinePath;
  return {
    baselinePath,
    updateBaseline: argv.includes('--update-baseline') || process.env.ORACLE_DELTA_UPDATE_BASELINE === '1',
    failOnGaps: !(argv.includes('--no-fail') || process.env.ORACLE_DELTA_NO_FAIL === '1'),
    maxCards: Math.max(1, Number.parseInt(process.env.ORACLE_DELTA_MAX_CARDS || '2000', 10) || 2000),
  };
}

function loadEligibleCards(): { cards: OracleCard[]; identities: OracleDeltaCardIdentity[] } {
  const oraclePath = path.join(repoRoot, 'oracle-cards.json');
  if (!fs.existsSync(oraclePath)) {
    console.error(`oracle-cards.json not found at ${oraclePath} — run npm run card-lookup:refresh first`);
    process.exit(1);
  }
  const all = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];
  const seen = new Set<string>();
  const cards: OracleCard[] = [];
  const identities: OracleDeltaCardIdentity[] = [];
  const byOracleId = new Map<string, OracleCard>();

  for (const card of all) {
    if (!isEligible(card)) continue;
    const oracleId = oracleIdForCard(card);
    if (!oracleId || seen.has(oracleId)) continue;
    seen.add(oracleId);
    cards.push(card);
    byOracleId.set(oracleId, card);
    identities.push({
      oracleId,
      name: card.name,
      hash: hashOracleIdentity(card.name, getCombinedOracleText(card)),
    });
  }

  return { cards, identities };
}

function assessDeltaCard(card: OracleCard, changeType: 'new' | 'changed'): DeltaCardResult {
  const oracle = getCombinedOracleText(card);
  const fullCardStatuses: ExecutorCoverageStatus[] = [];
  const gapReasons: DeltaGapReasonCode[] = [];
  const gapDetails: string[] = [];
  const ignorableForIrGap = isIgnorableCardForIrGap(card);

  // Full-card scope: parse → dry-run, mirroring executor-coverage-audit full_card.
  if (!ignorableForIrGap) {
    const parsed = parseOracleTextToIR(oracle, card.name);
    for (const ability of parsed.abilities || []) {
      const text = String((ability as any).effectText || (ability as any).text || '').trim();
      if (!text) continue;
      const abilitySteps = Array.isArray((ability as any).steps) ? (ability as any).steps : [];
      if ((ability as any).type === 'replacement' && abilitySteps.length === 0 && isBenignFullCardReplacementMetadata(text)) {
        continue;
      }
      if (isBenignFullCardAbilityMetadata(text)) continue;

      const irGaps = abilitySteps.length > 0
        ? collectUnknownIrGapsFromSteps(abilitySteps)
        : hasUnknownIRSteps(text, card.name);
      const steps = abilitySteps.length > 0 ? abilitySteps : collectStepsFromIrText(text, card.name);
      const record = dryRunOracleSteps(steps, card as any, irGaps, { typeLine: card.type_line });
      fullCardStatuses.push(record.status);

      if (record.status === 'ir_gap') {
        gapReasons.push('full_card_ir_gap');
        gapDetails.push(`ir_gap: ${irGaps.slice(0, 3).join(' | ').slice(0, 160)}`);
      } else if (record.status !== 'fully_applied' && record.status !== 'choice_required') {
        gapReasons.push('full_card_parse_to_execute');
        const reasonCodes = Object.keys(record.reasonCodes || {}).slice(0, 4).join(', ');
        gapDetails.push(`${record.status}${reasonCodes ? ` (${reasonCodes})` : ''}: ${text.slice(0, 120)}`);
      }
    }
  }

  // Trigger scope: detection + effect IR gaps, mirroring trigger-coverage-audit.
  const triggers = parseTriggeredAbilitiesFromText(oracle, 'AUDIT_SRC', 'P1', card.name);
  for (const trigger of triggers) {
    const effect = String((trigger as any).effect || '').trim();
    const event = String((trigger as any).event || '').trim();

    if (!event || event === 'unknown') {
      gapReasons.push('trigger_event_unknown');
      gapDetails.push(`trigger_event_unknown: ${String((trigger as any).condition || '').slice(0, 120)}`);
      continue;
    }
    if (!serverDetectsTrigger(card as any, trigger as any)) {
      gapReasons.push('trigger_not_detected');
      gapDetails.push(`trigger_not_detected (${event}): ${String((trigger as any).condition || '').slice(0, 120)}`);
    }
    if (!ignorableForIrGap && effect && hasUnknownIRSteps(effect, card.name).length > 0) {
      gapReasons.push('trigger_effect_ir_gap');
      gapDetails.push(`trigger_effect_ir_gap: ${effect.slice(0, 120)}`);
    }
  }

  return {
    oracleId: oracleIdForCard(card),
    name: card.name,
    changeType,
    fullCardStatuses,
    gapReasons: [...new Set(gapReasons)],
    gapDetails,
    ok: gapReasons.length === 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  await loadEffectIrParser();

  const { cards, identities } = loadEligibleCards();
  const cardsByOracleId = new Map(cards.map((card) => [oracleIdForCard(card), card]));

  const baselineExists = fs.existsSync(args.baselinePath);

  if (!baselineExists) {
    if (!args.updateBaseline) {
      console.error(
        `No baseline at ${args.baselinePath}.\n` +
          'Bootstrap one from the current (audited-green) corpus with:\n' +
          '  npm run oracle-ir:delta -- --update-baseline',
      );
      process.exit(1);
    }
    const baseline = buildOracleDeltaBaseline(identities);
    fs.writeFileSync(args.baselinePath, JSON.stringify(baseline));
    console.log(`Bootstrapped oracle delta baseline: ${identities.length} cards → ${args.baselinePath}`);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(args.baselinePath, 'utf8')) as OracleDeltaBaseline;
  const delta = computeOracleDelta(identities, baseline);
  const deltaIdentities = [...delta.newCards, ...delta.changedCards];

  console.log('Oracle Snapshot Delta Coverage Audit');
  console.log('====================================');
  console.log(`Baseline: ${args.baselinePath} (${baseline.meta?.cardCount ?? Object.keys(baseline.cards).length} cards, ${baseline.meta?.generatedAt ?? 'unknown date'})`);
  console.log(`Corpus: ${identities.length} eligible cards; delta: ${delta.newCards.length} new, ${delta.changedCards.length} changed, ${delta.unchangedCount} unchanged`);

  if (deltaIdentities.length > args.maxCards) {
    console.error(
      `Delta of ${deltaIdentities.length} cards exceeds ORACLE_DELTA_MAX_CARDS=${args.maxCards}. ` +
        'If this is a full-corpus refresh, run the full audits (executor:coverage, trigger:coverage) and re-bootstrap the baseline.',
    );
    process.exit(1);
  }

  const results: DeltaCardResult[] = [];
  const changedSet = new Set(delta.changedCards.map((entry) => entry.oracleId));
  for (const identity of deltaIdentities) {
    const card = cardsByOracleId.get(identity.oracleId);
    if (!card) continue;
    results.push(assessDeltaCard(card, changedSet.has(identity.oracleId) ? 'changed' : 'new'));
  }

  const gapResults = results.filter((result) => !result.ok);
  const overlayWorkQueue = gapResults.map((result) => ({
    name: result.name,
    oracleId: result.oracleId,
    changeType: result.changeType,
    reasons: result.gapReasons,
    details: result.gapDetails,
    suggestedAction: suggestDeltaGapAction(result.gapReasons),
    probeCommand: `npm run oracle-ir:overlay:probe -- --name "${result.name.replace(/"/g, '\\"')}"`,
  }));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      baselinePath: args.baselinePath,
      baselineGeneratedAt: baseline.meta?.generatedAt ?? null,
      corpusEligibleCards: identities.length,
    },
    delta: {
      newCards: delta.newCards.length,
      changedCards: delta.changedCards.length,
      unchangedCards: delta.unchangedCount,
      auditedCards: results.length,
      gapCards: gapResults.length,
    },
    results,
    overlayWorkQueue,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Audited ${results.length} delta cards: ${results.length - gapResults.length} ok, ${gapResults.length} with gaps`);
  for (const entry of overlayWorkQueue.slice(0, 20)) {
    console.log(`  [${entry.changeType}] ${entry.name} — ${entry.reasons.join(', ')}`);
    console.log(`      → ${entry.suggestedAction}`);
  }
  if (overlayWorkQueue.length > 20) {
    console.log(`  … and ${overlayWorkQueue.length - 20} more (see report)`);
  }
  console.log(`Wrote report: ${reportPath}`);

  if (args.updateBaseline) {
    const nextBaseline = buildOracleDeltaBaseline(identities);
    fs.writeFileSync(args.baselinePath, JSON.stringify(nextBaseline));
    console.log(`Updated baseline: ${identities.length} cards → ${args.baselinePath}`);
  } else if (gapResults.length === 0 && deltaIdentities.length > 0) {
    console.log('Delta is green. Accept it into the baseline with: npm run oracle-ir:delta -- --update-baseline');
  }

  if (gapResults.length > 0 && args.failOnGaps) {
    console.error(`FAIL: ${gapResults.length} delta card(s) with automation gaps (see overlayWorkQueue in report).`);
    process.exit(1);
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
