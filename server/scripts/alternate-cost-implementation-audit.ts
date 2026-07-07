/*
  Alternate-cost / keyword-cast implementation audit.

  Compares keyword alternate costs (warp-style) across:
  - rules-engine keyword module
  - client CastSpellModal parsing
  - server payment resolution (game-actions)
  - delayed end-step riders (exile / sacrifice / return to hand)
  - graveyard activation (interaction.ts)
  - cast-from-exile permissions
  - server payment extras with cost reductions (extraAlternateCosts)
  - integration/unit tests

  Run:
    cd server
    npx tsx scripts/alternate-cost-implementation-audit.ts

  Output:
    server/scripts/out/alternate-cost-implementation-audit.json
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOracleCardsSync, resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outPath = path.join(__dirname, 'out', 'alternate-cost-implementation-audit.json');

type DelayedEffect = 'exile_end_step' | 'sacrifice_end_step' | 'return_hand_end_step' | 'exile_on_resolve' | null;
type CastZone = 'hand' | 'graveyard' | 'exile' | 'declare_blockers' | 'varies';

interface KeywordSpec {
  id: string;
  label: string;
  oraclePattern: RegExp;
  primaryCastZone: CastZone;
  expectedDelayedEffect: DelayedEffect;
  rulesEngineFile?: string;
  notes?: string;
}

const KEYWORDS: KeywordSpec[] = [
  { id: 'warp', label: 'Warp', oraclePattern: /\bwarp\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: 'exile_end_step', rulesEngineFile: 'warp.ts', notes: 'Exile at next end step; owner may cast from exile later.' },
  { id: 'dash', label: 'Dash', oraclePattern: /\bdash\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: 'return_hand_end_step', rulesEngineFile: 'dash.ts', notes: 'Return to hand at next end step; haste while dashed.' },
  { id: 'blitz', label: 'Blitz', oraclePattern: /\bblitz\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: 'sacrifice_end_step', rulesEngineFile: 'blitz.ts', notes: 'Sacrifice at next end step; haste; draw on death.' },
  { id: 'mutate', label: 'Mutate', oraclePattern: /\bmutate\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'mutate.ts' },
  { id: 'madness', label: 'Madness', oraclePattern: /\bmadness\b/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'exile_on_resolve', rulesEngineFile: 'madness.ts', notes: 'Cast from graveyard; exile on resolve.' },
  { id: 'flashback', label: 'Flashback', oraclePattern: /\bflashback\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'exile_on_resolve', rulesEngineFile: 'flashback.ts' },
  { id: 'disturb', label: 'Disturb', oraclePattern: /\bdisturb\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'disturb.ts' },
  { id: 'escape', label: 'Escape', oraclePattern: /\bescape\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'exile_on_resolve', rulesEngineFile: 'escape.ts' },
  { id: 'unearth', label: 'Unearth', oraclePattern: /\bunearth\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'exile_end_step', rulesEngineFile: 'unearth.ts', notes: 'Activated ability from graveyard (NOT alternate cast); uses adjustActivationManaCostForPayment, not buildAlternateCastSpellManaCost.' },
  { id: 'embalm', label: 'Embalm', oraclePattern: /\bembalm\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'embalm.ts' },
  { id: 'eternalize', label: 'Eternalize', oraclePattern: /\beternalize\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'eternalize.ts' },
  { id: 'encore', label: 'Encore', oraclePattern: /\bencore\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'sacrifice_end_step', rulesEngineFile: 'encore.ts' },
  { id: 'scavenge', label: 'Scavenge', oraclePattern: /\bscavenge\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'scavenge.ts' },
  { id: 'miracle', label: 'Miracle', oraclePattern: /\bmiracle\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'miracle.ts' },
  { id: 'overload', label: 'Overload', oraclePattern: /\boverload\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null },
  { id: 'surge', label: 'Surge', oraclePattern: /\bsurge\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'surge.ts' },
  { id: 'spectacle', label: 'Spectacle', oraclePattern: /\bspectacle\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'spectacle.ts' },
  { id: 'prowl', label: 'Prowl', oraclePattern: /\bprowl\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'prowl.ts' },
  { id: 'bestow', label: 'Bestow', oraclePattern: /\bbestow\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'bestow.ts' },
  { id: 'emerge', label: 'Emerge', oraclePattern: /\bemerge\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'emerge.ts' },
  { id: 'evoke', label: 'Evoke', oraclePattern: /\bevoke\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'evoke.ts' },
  { id: 'suspend', label: 'Suspend', oraclePattern: /\bsuspend\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'suspend.ts' },
  { id: 'foretell', label: 'Foretell', oraclePattern: /\bforetell\s+\{/i, primaryCastZone: 'exile', expectedDelayedEffect: null, rulesEngineFile: 'foretell.ts' },
  { id: 'plot', label: 'Plot', oraclePattern: /\bplot\s+\{/i, primaryCastZone: 'exile', expectedDelayedEffect: null, rulesEngineFile: 'plot.ts' },
  { id: 'harmonize', label: 'Harmonize', oraclePattern: /\bharmonize\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'harmonize.ts' },
  { id: 'retrace', label: 'Retrace', oraclePattern: /\bretrace\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'retrace.ts' },
  { id: 'jump-start', label: 'Jump-start', oraclePattern: /\bjump-?start\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: 'exile_on_resolve' },
  { id: 'sneak', label: 'Sneak', oraclePattern: /\bsneak\s+\{/i, primaryCastZone: 'declare_blockers', expectedDelayedEffect: null, rulesEngineFile: 'sneak.ts', notes: 'Declare blockers step only; return unblocked attacker.' },
  { id: 'craft', label: 'Craft', oraclePattern: /\bcraft\s+\{/i, primaryCastZone: 'graveyard', expectedDelayedEffect: null, rulesEngineFile: 'craft.ts' },
  { id: 'ninjutsu', label: 'Ninjutsu', oraclePattern: /\bninjutsu\s+\{/i, primaryCastZone: 'hand', expectedDelayedEffect: null, rulesEngineFile: 'ninjutsu.ts', notes: 'Combat trick from hand.' },
];

function read(relPath: string): string {
  const full = path.join(repoRoot, relPath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

const sources = {
  castSpellModal: read('client/src/components/CastSpellModal.tsx'),
  gameActions: read('server/src/socket/game-actions.ts'),
  alternateCosts: read('server/src/state/modules/alternate-costs.ts'),
  stackResolve: read('server/src/state/modules/stackResolvePermanentEntryUtils.ts'),
  interaction: read('server/src/socket/interaction.ts'),
  playableFromExile: read('server/src/state/modules/playable-from-exile.ts'),
  warpDelayed: read('server/src/state/modules/warpDelayedEffects.ts'),
  keywordCastDelayed: read('server/src/state/modules/keywordCastDelayedEffects.ts'),
  sneakCast: read('server/src/state/modules/sneakCastUtils.ts'),
  applyEvent: read('server/src/state/modules/applyEvent.ts'),
  turn: read('server/src/state/modules/turn.ts'),
  abilityCostAdjustments: read('server/src/state/modules/ability-cost-adjustments.ts'),
  activatedAbilityCostReduction: read('rules-engine/src/activatedAbilityCostReduction.ts'),
};

function listTestFiles(): string[] {
  const dir = path.join(repoRoot, 'server/tests');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.(ts|js)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const testFiles = listTestFiles();

function hasClientParse(id: string): boolean {
  return new RegExp(`id:\\s*['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(sources.castSpellModal);
}

function hasServerExplicitBranch(id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`alternateCostId\\s*===\\s*['"]${escaped}['"]`).test(sources.gameActions)
    || new RegExp(`forcedAlternateCostId\\s*===\\s*['"]${escaped}['"]`).test(sources.gameActions);
}

function hasDedicatedParse(id: string): boolean {
  const fn = `parse${id.charAt(0).toUpperCase()}${id.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Cost`;
  if (sources.alternateCosts.includes(`function ${fn}`) || sources.alternateCosts.includes(`export function ${fn}`)) {
    return true;
  }
  if (id === 'warp' && sources.alternateCosts.includes('parseWarpCost')) return true;
  if (id === 'mutate' && sources.alternateCosts.includes('parseMutateCost')) return true;
  if (id === 'madness' && sources.alternateCosts.includes('parseMadnessCost')) return true;
  return sources.alternateCosts.includes(`parseKeywordAlternateManaCost`) &&
    new RegExp(`['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(sources.alternateCosts);
}

function hasGenericKeywordPaymentResolve(id: string): boolean {
  return sources.gameActions.includes('resolvedKeywordAlternateCost')
    && sources.alternateCosts.includes('parseKeywordAlternateManaCost');
}

function hasPaymentReducedExtras(id: string): boolean {
  return sources.gameActions.includes('buildAlternateCostPaymentExtrasForCast')
    && sources.gameActions.includes('formatManaCostWithCostAdjustment');
}

function hasRulesEngineModule(file?: string): boolean {
  if (!file) return false;
  return fs.existsSync(path.join(repoRoot, 'rules-engine/src/keywordAbilities', file));
}

function hasGraveyardActivation(id: string): boolean {
  return new RegExp(`abilityId\\s*===\\s*['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(sources.interaction)
    || new RegExp(`abilityType\\s*===\\s*['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(sources.applyEvent);
}

function isActivatedAbilityCost(id: string): boolean {
  return id === 'unearth';
}

function hasSpellReducerOnGraveyardAlternateCast(id: string): boolean {
  if (isActivatedAbilityCost(id)) return true;
  if (id === 'embalm' || id === 'eternalize' || id === 'encore' || id === 'scavenge' || id === 'craft') return true;
  return sources.gameActions.includes('buildAlternateCastSpellManaCost')
    && sources.gameActions.includes('GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS')
    && sources.interaction.includes('buildAlternateCastSpellManaCost');
}

function hasActivatedAbilityCostReduction(id: string): boolean {
  if (!isActivatedAbilityCost(id)) return true;
  return sources.abilityCostAdjustments.includes('adjustActivationManaCostForPayment')
    && sources.interaction.includes('adjustActivationManaCostForPayment')
    && sources.activatedAbilityCostReduction.includes('parseActivatedAbilityCostReducerSpecsFromPermanent');
}

function hasDeclareBlockersCastFlow(id: string): boolean {
  if (id !== 'sneak') return true;
  return sources.sneakCast.includes('canCastWithSneakAtCurrentTiming')
    && sources.sneakCast.includes('applySneakReturnedCreatureCost')
    && sources.gameActions.includes('sneakReturnedCreatureId')
    && sources.stackResolve.includes('applySneakPermanentBattlefieldEntry');
}

function hasCastFromExileSupport(id: string): boolean {
  if (id === 'warp') {
    return sources.playableFromExile.includes('canCastWarpedCardFromExile')
      || sources.playableFromExile.includes('exiledBecauseWarped');
  }
  if (id === 'foretell' || id === 'plot') {
    return sources.gameActions.includes('USE_CAST_FORETOLD') || sources.gameActions.includes('foretold');
  }
  return false;
}

function hasDelayedEndStepRider(id: string, effect: DelayedEffect): boolean {
  if (!effect) return true;
  const corpus = `${sources.stackResolve}\n${sources.warpDelayed}\n${sources.keywordCastDelayed}\n${sources.applyEvent}\n${sources.interaction}`;
  if (effect === 'exile_end_step') {
    if (id === 'warp') return corpus.includes('scheduleWarpDelayedExileOnPermanentEntry');
    if (id === 'unearth') return corpus.includes('pendingExileAtNextEndStep');
    return corpus.includes('pendingExileAtNextEndStep') && new RegExp(id, 'i').test(corpus);
  }
  if (effect === 'sacrifice_end_step') {
    if (id === 'blitz') return corpus.includes('scheduleBlitzDelayedSacrificeOnPermanentEntry');
    if (id === 'encore') return corpus.includes('pendingSacrificeAtNextEndStep') && corpus.includes('encore');
    return corpus.includes('pendingSacrificeAtNextEndStep');
  }
  if (effect === 'return_hand_end_step') {
    if (id === 'dash') return corpus.includes('scheduleDashDelayedReturnOnPermanentEntry') && corpus.includes('pendingReturnToHandAtNextEndStep');
    return corpus.includes('pendingReturnToHandAtNextEndStep');
  }
  if (effect === 'exile_on_resolve') {
    return corpus.includes('exile') && (hasGraveyardActivation(id) || hasServerExplicitBranch(id));
  }
  return false;
}

function hasTests(id: string): { unit: boolean; integration: boolean; files: string[] } {
  const matches = testFiles.filter((file) => {
    const base = path.basename(file).toLowerCase();
    return base.includes(id.toLowerCase()) || base.includes(id.replace(/-/g, ''));
  });
  return {
    unit: matches.some((f) => f.includes('.unit.test.')),
    integration: matches.some((f) => f.includes('.integration.test.')),
    files: matches.map((f) => path.relative(repoRoot, f)).slice(0, 8),
  };
}

function scoreImplementation(spec: KeywordSpec, corpusCount: number) {
  const clientParse = hasClientParse(spec.id);
  const serverExplicit = hasServerExplicitBranch(spec.id);
  const serverParse = hasDedicatedParse(spec.id) || hasGenericKeywordPaymentResolve(spec.id);
  const paymentExtras = hasPaymentReducedExtras(spec.id);
  const rulesEngine = hasRulesEngineModule(spec.rulesEngineFile);
  const graveyard = spec.primaryCastZone === 'graveyard' ? hasGraveyardActivation(spec.id) : true;
  const graveyardSpellReducer = spec.primaryCastZone === 'graveyard' ? hasSpellReducerOnGraveyardAlternateCast(spec.id) : true;
  const activatedAbilityReducer = hasActivatedAbilityCostReduction(spec.id);
  const exileCast = spec.expectedDelayedEffect === 'exile_end_step' && spec.id !== 'unearth'
    ? hasCastFromExileSupport(spec.id)
    : (spec.primaryCastZone === 'exile' ? hasCastFromExileSupport(spec.id) : true);
  const delayed = hasDelayedEndStepRider(spec.id, spec.expectedDelayedEffect);
  const tests = hasTests(spec.id);

  const gaps: string[] = [];
  if (corpusCount > 0 && !clientParse && spec.primaryCastZone === 'hand') gaps.push('missing_client_parse');
  if (corpusCount > 0 && !serverParse && spec.primaryCastZone === 'hand') gaps.push('missing_server_payment_parse');
  if (corpusCount > 0 && spec.primaryCastZone === 'hand' && !serverExplicit && !hasGenericKeywordPaymentResolve(spec.id)) {
    gaps.push('missing_server_explicit_branch');
  }
  if (corpusCount > 0 && spec.primaryCastZone === 'hand' && !paymentExtras) gaps.push('missing_payment_reduced_extras');
  if (corpusCount > 0 && spec.expectedDelayedEffect && !delayed) gaps.push(`missing_delayed_${spec.expectedDelayedEffect}`);
  if (corpusCount > 0 && spec.primaryCastZone === 'graveyard' && !graveyard) gaps.push('missing_graveyard_activation');
  if (corpusCount > 0 && spec.primaryCastZone === 'graveyard' && !graveyardSpellReducer && !isActivatedAbilityCost(spec.id)) {
    gaps.push('missing_graveyard_alternate_cast_spell_reducer');
  }
  if (corpusCount > 0 && isActivatedAbilityCost(spec.id) && !activatedAbilityReducer) {
    gaps.push('missing_activated_ability_cost_reducer');
  }
  if (corpusCount > 0 && isActivatedAbilityCost(spec.id)) {
    const unearthBranch = sources.interaction.split('abilityId === "unearth"')[1]?.slice(0, 2500) || '';
    if (unearthBranch.includes('buildAlternateCastSpellManaCost')) {
      gaps.push('unearth_incorrectly_uses_spell_cast_reducer');
    }
  }
  if (corpusCount > 0 && spec.id === 'warp' && !exileCast) gaps.push('missing_cast_from_exile_permission');
  if (corpusCount > 0 && rulesEngine && !delayed && spec.expectedDelayedEffect) gaps.push('rules_engine_without_server_delayed_rider');
  if (corpusCount > 0 && !tests.integration && spec.expectedDelayedEffect) gaps.push('missing_integration_test');
  if (corpusCount > 0 && spec.id === 'sneak' && !clientParse) gaps.push('missing_client_parse');
  if (corpusCount > 0 && spec.id === 'sneak' && !hasDeclareBlockersCastFlow(spec.id)) gaps.push('missing_declare_blockers_cast_flow');

  let status: 'full' | 'partial' | 'parse_only' | 'rules_engine_only' | 'missing' = 'missing';
  if (gaps.length === 0 && corpusCount > 0) status = 'full';
  else if (clientParse && serverParse && delayed && graveyard) status = 'partial';
  else if (clientParse || serverParse) status = 'parse_only';
  else if (rulesEngine && corpusCount > 0) status = 'rules_engine_only';

  return {
    id: spec.id,
    label: spec.label,
    corpusCount,
    status,
    gaps,
    implementation: {
      clientParse,
      serverExplicit,
      serverParse,
      paymentReducedExtras: paymentExtras,
      rulesEngineModule: rulesEngine,
      graveyardActivation: graveyard,
      graveyardAlternateCastSpellReducer: graveyardSpellReducer,
      activatedAbilityCostReducer: activatedAbilityReducer,
      costReductionKind: isActivatedAbilityCost(spec.id) ? 'activated_ability' : 'alternate_cast_spell',
      castFromExileSupport: exileCast,
      delayedEndStepRider: delayed,
      tests,
    },
    notes: spec.notes,
    expectedDelayedEffect: spec.expectedDelayedEffect,
    primaryCastZone: spec.primaryCastZone,
  };
}

// Corpus counts
const corpusCounts = new Map<string, number>();
const corpusExamples = new Map<string, string[]>();

if (!fs.existsSync(resolveOracleCardsPath(repoRoot))) {
  console.error('Oracle corpus not found. Set CARD_LOOKUP_ORACLE_FILE or add oracle-cards.jsonl to repo root.');
  process.exit(1);
}

for (const card of readOracleCardsSync(repoRoot)) {
  const oracle = String((card as any)?.oracle_text || '');
  const name = String((card as any)?.name || '');
  if (!oracle) continue;
  for (const spec of KEYWORDS) {
    if (!spec.oraclePattern.test(oracle)) continue;
    corpusCounts.set(spec.id, (corpusCounts.get(spec.id) || 0) + 1);
    const examples = corpusExamples.get(spec.id) || [];
    if (examples.length < 5 && !examples.includes(name)) examples.push(name);
    corpusExamples.set(spec.id, examples);
  }
}

const keywordResults = KEYWORDS.map((spec) => {
  const count = corpusCounts.get(spec.id) || 0;
  return {
    ...scoreImplementation(spec, count),
    exampleCards: corpusExamples.get(spec.id) || [],
  };
}).sort((a, b) => b.corpusCount - a.corpusCount || a.id.localeCompare(b.id));

const globalGaps = {
  paymentReducedExtrasOnlyWarp: !sources.gameActions.includes('buildAlternateCostPaymentExtrasForCast'),
  graveyardAlternateCastSpellReducers: !sources.gameActions.includes('buildAlternateCastSpellManaCost'),
  activatedAbilityCostReducers: !sources.abilityCostAdjustments.includes('adjustActivationManaCostForPayment'),
  unearthUsesSpellReducerPath: sources.interaction.includes('buildAlternateCastSpellManaCost')
    && /unearth[\s\S]{0,400}buildAlternateCastSpellManaCost/.test(sources.interaction),
  delayedRidersOnlyWarpInStackResolve: sources.stackResolve.includes('scheduleWarpDelayedExileOnPermanentEntry')
    && !sources.stackResolve.includes('scheduleKeywordCastDelayedEffectsOnPermanentEntry'),
  castSpellModalMissingSneak: !hasClientParse('sneak') && (corpusCounts.get('sneak') || 0) > 0,
  genericKeywordPaymentResolve: hasGenericKeywordPaymentResolve('dash'),
  exileZoneUsesStandardCostReduction: sources.gameActions.includes('formatManaCostWithCostAdjustment')
    && sources.gameActions.includes('calculateCostReduction'),
};

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    oraclePath: resolveOracleCardsPath(repoRoot),
    keywordsAudited: KEYWORDS.length,
    scopeNotes: [
      'Hand alternate costs use resolvedKeywordAlternateCost + parseKeywordAlternateManaCost unless explicitly branched.',
      'payment_reduced_extras means server sends extraAlternateCosts with medallion-style reductions pre-applied.',
      'Delayed riders checked against pendingExileAtNextEndStep / pendingSacrificeAtNextEndStep / return-to-hand patterns.',
      'Unearth is an activated ability (adjustActivationManaCostForPayment), not a graveyard alternate cast (buildAlternateCastSpellManaCost).',
      'Flashback/escape/disturb/jump-start/retrace use buildAlternateCastSpellManaCost for spell reducers.',
    ],
  },
  summary: {
    withCorpusCards: keywordResults.filter((k) => k.corpusCount > 0).length,
    full: keywordResults.filter((k) => k.status === 'full').length,
    partial: keywordResults.filter((k) => k.status === 'partial').length,
    parseOnly: keywordResults.filter((k) => k.status === 'parse_only').length,
    rulesEngineOnly: keywordResults.filter((k) => k.status === 'rules_engine_only').length,
    highImpactGaps: keywordResults
      .filter((k) => k.corpusCount >= 20 && k.gaps.length > 0)
      .map((k) => ({ id: k.id, corpusCount: k.corpusCount, gaps: k.gaps })),
  },
  globalGaps,
  keywords: keywordResults,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('Alternate Cost Implementation Audit');
console.log('==================================');
console.log(`Keywords audited: ${KEYWORDS.length}`);
console.log(`Keywords with corpus cards: ${report.summary.withCorpusCards}`);
console.log(`Full: ${report.summary.full} | Partial: ${report.summary.partial} | Parse-only: ${report.summary.parseOnly} | Rules-engine-only: ${report.summary.rulesEngineOnly}`);
console.log('\nHigh-impact gaps (>=20 cards):');
for (const gap of report.summary.highImpactGaps) {
  console.log(`  - ${gap.id} (${gap.corpusCount} cards): ${gap.gaps.join(', ')}`);
}
console.log('\nGlobal gaps:');
for (const [key, value] of Object.entries(globalGaps)) {
  console.log(`  - ${key}: ${value}`);
}
console.log(`\nWrote report: ${outPath}`);
