import fs from 'fs';
import path from 'path';
import { detectCastTrigger, extractSelfCastEffectClauses } from '../../rules-engine/src/cards/castTriggers.ts';
import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.ts';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.ts';
import { isTriggerEffectFullyIrWired, collectOracleEffectSteps } from '../src/state/modules/oracleIrTriggerLegacyRouting.ts';

// collectOracleEffectSteps is from trigger-runtime-wiring; isTriggerEffectFullyIrWired from routing
import { collectOracleEffectSteps as collectSteps } from '../src/state/modules/trigger-runtime-wiring.ts';
import { isTriggerEffectFullyIrWired as irWiredFn } from '../src/state/modules/oracleIrTriggerLegacyRouting.ts';

const root = path.resolve('..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'tools/_oncast_audit/scryfall.json'), 'utf8'));
const uniq = new Map();
for (const c of raw.data) {
  const oid = c.oracle_id || c.id;
  if (!uniq.has(oid)) uniq.set(oid, c);
}
function getOracle(c) {
  if (c.oracle_text) return c.oracle_text;
  return (c.card_faces || []).map((f) => f.oracle_text || '').join('\n');
}
function classify(body) {
  const s = body.toLowerCase();
  const pats = [];
  const add = (p, cond) => { if (cond) pats.push(p); };
  add('return_from_graveyard', /return .+ from (your|a) graveyard|return all cards named .+ from your graveyard|return a creature card from your graveyard/.test(s));
  add('create_tokens', /create .+ token|create a number of|create x |create two|create three/.test(s));
  add('draw', /draw (a card|two cards|three cards|four cards|cards equal|half x cards)/.test(s));
  add('exile_library_top', /exile.+top|exiles the top/.test(s));
  add('exile_target_permanent', /exile (two )?target|exile up to|exile target/.test(s));
  add('copy_spell_or_permanent', /copy (it|this spell|target)|that's a copy|copy it for each|copy it x|copy it if|copy this spell/.test(s));
  add('put_counters', /put .+ counters?|stun counter|takeover counter/.test(s));
  add('pump', /gets? [+-]\d+\/[+-]\d+|get \+2\/\+2/.test(s));
  add('sacrifice', /sacrifice/.test(s));
  add('mill_amass', /\bmill\b|amass /.test(s));
  add('search_library', /search your library/.test(s));
  add('destroy', /destroy target/.test(s));
  add('gain_life', /gain \d+ life|gains? half|you gain/.test(s));
  add('lose_life', /loses? \d+ life|lose half|loses half/.test(s));
  add('counter_related', /counter (target|it)|any player may.*(pay|sacrifice|discard)/.test(s));
  add('modal', /choose one/.test(s) || body.includes('\u2022'));
  add('tap', /tap (up to|target)/.test(s));
  add('untap', /untap/.test(s));
  add('gain_control', /gain control/.test(s));
  add('discard', /discard/.test(s));
  add('put_onto_battlefield', /put .+ onto the battlefield|put any number of land|manifest/.test(s));
  add('put_on_library_top', /put target .+ on top of/.test(s));
  add('extra_turn', /extra turn/.test(s));
  add('optional_you_may', /you may /.test(s));
  add('intervening_if', /if it was kicked|if \{c\} wasn't|if you have fewer|if a creature died|if you've cast|if there are eight|if you gained|if you control|if a player does|if you do/.test(s));
  add('any_player_may_tax', /any player may/.test(s));
  add('commander_cast_copy', /for each time you've cast your commander/.test(s));
  add('remove_counters_cost_reduce', /remove all counters/.test(s));
  add('reveal_library', /reveal (cards|the top)/.test(s));
  if (!pats.filter((p) => p !== 'optional_you_may' && p !== 'intervening_if').length) pats.push('other');
  return pats;
}

const rows = [];
for (const c of uniq.values()) {
  const oracle = getOracle(c);
  const clauses = extractSelfCastEffectClauses(oracle);
  const resolvedAll = resolveOnCastSpellTriggerDescriptions({ name: c.name, type_line: c.type_line, oracle_text: oracle });
  const primary = resolvedAll[0]?.description || '';
  const meta = inferTriggeredAbilityTargetMetadata(primary, { controllerId: 'p1', sourceName: c.name });
  const body = primary.replace(/^when you cast this spell,\s*/i, '');
  let irWired = false;
  let irKinds = [];
  try {
    const steps = collectSteps(body, c.name);
    irKinds = (steps || []).map((s) => s.kind);
    irWired = irWiredFn(body, c.name) || irWiredFn(primary, c.name);
  } catch {
    irWired = false;
  }
  const full = (resolvedAll.map((r) => r.description).join(' | ')) || clauses.join(' | ');
  rows.push({
    name: c.name,
    type_line: c.type_line,
    clauses,
    resolvedAll: resolvedAll.map((r) => r.description),
    patterns: classify(full),
    meta: {
      requiresTarget: !!meta.requiresTarget,
      targetType: meta.targetType || null,
      targetZone: meta.targetZone || null,
      targetDestination: meta.targetDestination || null,
      targetGraveyardScope: meta.targetGraveyardScope || null,
      minTargets: meta.minTargets ?? null,
      maxTargets: meta.maxTargets ?? null,
      targetFilterTypes: meta.targetFilterTypes || null,
    },
    irWired,
    irKinds,
    multi: resolvedAll.length > 1,
  });
}
fs.writeFileSync(path.join(root, 'tools/_oncast_audit/probe-post.json'), JSON.stringify(rows, null, 2));
console.log('TOTAL', rows.length);
console.log('multi', rows.filter((r) => r.multi).map((r) => r.name));
const bearer = rows.find((r) => r.name === 'Bearer of Silence');
console.log('Bearer', bearer?.resolvedAll?.[0]);
const wb = rows.find((r) => r.name === 'World Breaker');
console.log('World Breaker meta', wb?.meta);
const ed = rows.find((r) => r.name === 'Elder Deep-Fiend');
console.log('Elder Deep-Fiend meta', ed?.meta);
console.log('irWired', rows.filter((r) => r.irWired).length);
