/**
 * Refined audit: Brave-class spell follow-ups dropped via STATIC typing.
 *
 * Filters out alt-cost / gift / keyword-cost noise, then reports:
 *  1) spell_plus_static_steps — first half SPELL, later STATIC with real effect steps
 *  2) all_static_with_steps — entire instant/sorcery effect typed STATIC (collect empty)
 *
 * Run from server/:
 *   npx tsx scripts/spell-static-drop-audit.ts
 *
 * Writes:
 *   scripts/out/spell-static-drop-audit.json
 * Optional summary cleanup is inline in the report (alt-cost / gift filtered).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { resolveOracleCardsPath } from '../src/services/oracleCardsIndex.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../..');
const outPath = path.resolve(moduleDir, 'out/spell-static-drop-audit.json');

type DroppedAbility = {
  type: string;
  text: string;
  stepKinds: string[];
};

type Hit = {
  name: string;
  typeLine: string;
  oracleText: string;
  spellStepKinds: string[];
  droppedAbilities: DroppedAbility[];
  reason: 'spell_plus_static_steps' | 'all_static_with_steps';
};

function isInstantOrSorcery(typeLine: string): boolean {
  const lower = typeLine.toLowerCase();
  return /\binstant\b/.test(lower) || /\bsorcery\b/.test(lower);
}

function stepKinds(steps: readonly any[]): string[] {
  return steps.map((step) => String(step?.kind || 'unknown'));
}

function hasExecutableSteps(steps: readonly any[]): boolean {
  return steps.some((step) => {
    const kind = String(step?.kind || '');
    return kind.length > 0 && kind !== 'unknown';
  });
}

/** Cast-time / non-resolution text that should not count as dropped effect. */
function isCastTimeOrKeywordNoise(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;

  if (/^(?:flashback|overload|retrace|jump-start|buyback|kicker|multikicker|splice|miracle|cascade|storm|cipher|rebound|aftermath|suspend|replicate|gravestorm|haunt|forecast|entwine|reinforce|transmute|cycling|basic landcycling|typecycling|channel|evoke|dash|exploit|bestow|conspire|madnes|spectacle|surge|emerge|improvise|delve|affinity|partner|awaken|escalate|embalm|eternalize|augment|assist|jump.?start)\b/i.test(t)) {
    return true;
  }

  // Alternative / additional costs
  if (/\brather than pay (?:this|the) spell's mana cost\b/i.test(t)) return true;
  if (/^as an additional cost to (?:cast|play)\b/i.test(t)) return true;
  if (/^you may (?:pay|exile|discard|sacrifice|tap).+rather than pay\b/i.test(t)) return true;
  if (/\bif you (?:attacked|cast a creature|control).+you may pay .+ rather than pay\b/i.test(t)) return true;
  if (/^(?:raid|addendum|revolt|spectacle|magecraft|landfall)\s*[—-]/i.test(t) && /\brather than pay\b|\bcost\b/i.test(t) && !/\buntil end of turn\b|\bdraw\b|\bdestroy\b|\bgain\b|\bget\b|\bcreate\b/i.test(t)) {
    return true;
  }

  // Gift / promise-as-you-cast reminder (cast-time, not resolution follow-up)
  if (/^gift\b/i.test(t) && /\bpromise an opponent a gift as you cast\b/i.test(t)) return true;

  // Standalone keywords without temporary duration
  if (
    /^(flying|trample|haste|vigilance|lifelink|deathtouch|menace|reach|hexproof|indestructible|defender|flash|first strike|double strike|protection from .+|ward\b)\b/i.test(t)
    && !/\buntil\s+(?:end of turn|your next turn)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

function classifyLeadPattern(text: string): string {
  const t = String(text || '').trim();
  if (/^(?:white|blue|black|red|green)\s+creatures?\b/i.test(t)) return 'color_creatures_lead';
  if (/^creatures?\b/i.test(t)) return 'creatures_lead';
  if (/^permanents?\b/i.test(t)) return 'permanents_lead';
  if (/^players?\b/i.test(t)) return 'players_lead';
  if (/^each\b/i.test(t)) return 'each_lead';
  if (/^all\b/i.test(t)) return 'all_lead';
  if (/^until end of turn\b/i.test(t)) return 'until_eot_lead';
  if (/^you\b/i.test(t)) return 'you_lead';
  if (/^that\b/i.test(t)) return 'that_lead';
  if (/^they\b/i.test(t)) return 'they_lead';
  if (/^it\b/i.test(t)) return 'it_lead';
  if (/^then\b/i.test(t)) return 'then_lead';
  if (/^if you do\b/i.test(t)) return 'if_you_do_lead';
  if (/^if\b/i.test(t)) return 'if_lead';
  const first = t.split(/\s+/)[0] || 'other';
  return `other:${first.toLowerCase().replace(/[^a-z0-9']/g, '')}`;
}

async function main(): Promise<void> {
  const oraclePath = resolveOracleCardsPath(repoRoot);
  const hits: Hit[] = [];
  const reasonCounts: Record<string, number> = {};
  const leadCounts: Record<string, number> = {};
  const droppedKindCounts: Record<string, number> = {};
  let scanned = 0;
  let instantSorcery = 0;
  let noiseSkipped = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(oraclePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let card: any;
    try {
      card = JSON.parse(trimmed);
    } catch {
      continue;
    }
    scanned += 1;

    const typeLine = String(card?.type_line || '');
    if (!isInstantOrSorcery(typeLine)) continue;
    if (String(card?.layout || '') === 'art_series') continue;

    const name = String(card?.name || '').trim();
    const oracleText = String(card?.oracle_text || '').trim();
    if (!name || !oracleText) continue;
    instantSorcery += 1;

    let ir: any;
    try {
      ir = parseOracleTextToIR(oracleText, name);
    } catch {
      continue;
    }

    const abilities = Array.isArray(ir?.abilities) ? ir.abilities : [];
    const spellAbs = abilities.filter((a: any) => String(a?.type || '').toLowerCase() === 'spell');
    const droppedAbs = abilities.filter((a: any) => {
      const type = String(a?.type || '').toLowerCase();
      if (type === 'spell' || type === 'triggered' || type === 'activated' || type === 'keyword') {
        return false;
      }
      const steps = Array.isArray(a?.steps) ? a.steps : [];
      if (!hasExecutableSteps(steps)) return false;
      if (isCastTimeOrKeywordNoise(String(a?.text || a?.effectText || ''))) {
        noiseSkipped += 1;
        return false;
      }
      return true;
    });

    if (droppedAbs.length === 0) continue;

    const spellSteps = collectSpellResolutionEffectStepsWithOverlay(oracleText, name);
    const spellKinds = stepKinds(spellSteps);
    const reason: Hit['reason'] =
      spellAbs.length > 0 ? 'spell_plus_static_steps' : 'all_static_with_steps';

    const hit: Hit = {
      name,
      typeLine,
      oracleText,
      spellStepKinds: spellKinds,
      droppedAbilities: droppedAbs.map((a: any) => ({
        type: String(a?.type || ''),
        text: String(a?.text || a?.effectText || '').trim(),
        stepKinds: stepKinds(a.steps || []),
      })),
      reason,
    };
    hits.push(hit);
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

    for (const dropped of hit.droppedAbilities) {
      const lead = classifyLeadPattern(dropped.text);
      leadCounts[lead] = (leadCounts[lead] || 0) + 1;
      for (const kind of dropped.stepKinds) {
        droppedKindCounts[kind] = (droppedKindCounts[kind] || 0) + 1;
      }
    }
  }

  hits.sort((a, b) => a.name.localeCompare(b.name));

  const clusters = new Map<string, { signature: string; count: number; examples: string[] }>();
  for (const hit of hits) {
    const signature = `${hit.reason} :: ${hit.droppedAbilities.map((a) => a.stepKinds.join('+')).join(' | ')}`;
    const existing = clusters.get(signature) || { signature, count: 0, examples: [] };
    existing.count += 1;
    if (existing.examples.length < 10) existing.examples.push(hit.name);
    clusters.set(signature, existing);
  }

  const followUps = hits.filter((h) => h.reason === 'spell_plus_static_steps');
  const wholeEffectStatic = hits.filter((h) => h.reason === 'all_static_with_steps');

  const report = {
    generatedAt: new Date().toISOString(),
    oraclePath,
    scanned,
    instantSorcery,
    noiseSkippedAbilities: noiseSkipped,
    hitCount: hits.length,
    reasonCounts,
    leadCounts: Object.entries(leadCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([lead, count]) => ({ lead, count })),
    topDroppedKinds: Object.entries(droppedKindCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([kind, count]) => ({ kind, count })),
    clusters: [...clusters.values()].sort((a, b) => b.count - a.count),
    sampleFollowUps: followUps.slice(0, 40).map((h) => ({
      name: h.name,
      spell: h.spellStepKinds,
      dropped: h.droppedAbilities.map((d) => ({ kinds: d.stepKinds, text: d.text.slice(0, 120) })),
    })),
    sampleWholeEffectStatic: wholeEffectStatic.slice(0, 40).map((h) => ({
      name: h.name,
      dropped: h.droppedAbilities.map((d) => ({ kinds: d.stepKinds, text: d.text.slice(0, 120) })),
    })),
    hits,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Wrote report: ${outPath}`);
  console.log(JSON.stringify({
    scanned,
    instantSorcery,
    hitCount: hits.length,
    reasonCounts,
    topLeads: report.leadCounts.slice(0, 15),
    topClusters: report.clusters.slice(0, 20),
    sampleFollowUps: report.sampleFollowUps.slice(0, 15),
    sampleWholeEffectStatic: report.sampleWholeEffectStatic.slice(0, 15),
  }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
