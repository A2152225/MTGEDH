const fs = require('fs');
const path = require('path');
const root = 'D:\\Git\\MTGEDH';
const { detectCastTrigger } = require(path.join(root, 'server/dist/rules-engine/src/cards/castTriggers.js'));
const { resolveOnCastSpellTriggerDescription } = require(path.join(root, 'server/dist/server/src/state/modules/onCastSpellTriggerUtils.js'));

function inferMeta(effectText) {
  const lower = String(effectText || '').toLowerCase();
  const requiresTarget = lower.includes('target');
  let targetType, targetZone, targetDestination, targetGraveyardScope;
  let minTargets, maxTargets, targetFilterTypes, targetFilterRequiredTypeWords;
  if (requiresTarget) {
    if (
      lower.includes('from your graveyard') || lower.includes('from a graveyard') ||
      lower.includes('from any graveyard') || lower.includes('in your graveyard') ||
      (lower.includes('graveyard') && /from (?:an |target )?opponent/.test(lower))
    ) {
      targetZone = 'graveyard';
      targetGraveyardScope = (lower.includes('from your graveyard') || lower.includes('in your graveyard')) ? 'your' : 'any';
      if (lower.includes('to your hand') || /to its owner.?s hand/.test(lower)) targetDestination = 'hand';
      else if (lower.includes('to the battlefield')) targetDestination = 'battlefield';
      else if (/on top of/.test(lower)) targetDestination = 'library_top';
      if (lower.includes('target instant or sorcery card')) targetFilterTypes = ['instant','sorcery'];
      else if (lower.includes('target creature card')) targetFilterTypes = ['creature'];
      const req = lower.match(/target\s+([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\s+card/);
      if (req && !lower.includes('non-')) {
        targetFilterTypes = ['creature'];
        targetFilterRequiredTypeWords = req[1].trim().split(/\s+/);
      }
      if (/\bup to one target\b/.test(lower)) { minTargets = 0; maxTargets = 1; }
      else if (/\bup to two target\b/.test(lower)) { minTargets = 0; maxTargets = 2; }
    }
    if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';
    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';
    else if (lower.includes('target creature')) targetType = 'creature';
    else if (lower.includes('target player') || lower.includes('target opponent')) targetType = 'player';
    else if (lower.includes('target permanent')) targetType = 'permanent';
    else if (lower.includes('target land')) targetType = 'land';
    else if (lower.includes('target artifact')) targetType = 'artifact';
    else if (lower.includes('target enchantment')) targetType = 'enchantment';
    else if (lower.includes('target nonland')) targetType = 'nonland permanent';
    else if (lower.includes('target noncreature')) targetType = 'noncreature permanent';
  }
  return { requiresTarget, targetType, targetZone, targetDestination, targetGraveyardScope, minTargets, maxTargets, targetFilterTypes, targetFilterRequiredTypeWords };
}

const raw = JSON.parse(fs.readFileSync(path.join(root, 'tools/_oncast_audit/scryfall.json'), 'utf8'));
const uniq = new Map();
for (const c of raw.data) { const oid = c.oracle_id || c.id; if (!uniq.has(oid)) uniq.set(oid, c); }

function getOracle(c) {
  if (c.oracle_text) return c.oracle_text;
  return (c.card_faces || []).map(f => f.oracle_text || '').join('\n');
}
function extractOnCast(text) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    if (/^When you cast this spell,/i.test(line.trim())) out.push(line.trim());
  }
  if (!out.length && /take an extra turn after this one/i.test(text) && !/whenever you cast/i.test(text)) {
    out.push('Take an extra turn after this one.');
  }
  return out;
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
  if (!pats.filter(p => p !== 'optional_you_may' && p !== 'intervening_if').length) pats.push('other');
  return pats;
}

const rows = [];
for (const c of uniq.values()) {
  const oracle = getOracle(c);
  const sentences = extractOnCast(oracle);
  const resolved = resolveOnCastSpellTriggerDescription({ name: c.name, type_line: c.type_line, oracle_text: oracle });
  const detected = detectCastTrigger(oracle, c.type_line);
  const effectForMeta = resolved?.description || sentences[0] || '';
  const meta = inferMeta(effectForMeta);
  const fullJoin = sentences.join(' | ');
  let truncated = false;
  if (resolved?.description && sentences.length) {
    const body = sentences[0].replace(/^When you cast this spell,\s*/i, '');
    const firstClause = body.split('.')[0].trim();
    const gotBody = resolved.description.replace(/^When you cast this spell,\s*/i, '').replace(/\.$/, '').trim();
    const periods = (sentences[0].match(/\./g) || []).length;
    truncated = periods >= 1 && firstClause.toLowerCase() === gotBody.toLowerCase() && body.replace(/\.$/, '').length > firstClause.length + 2;
  }
  rows.push({
    name: c.name,
    type_line: c.type_line,
    sentences,
    sentenceCount: sentences.length,
    patterns: classify(fullJoin || effectForMeta),
    resolvedDescription: resolved?.description || null,
    detectedEffect: detected?.effect || null,
    hasCastTrigger: !!detected?.hasCastTrigger,
    truncatedExtraction: truncated,
    multiOnCast: sentences.length > 1,
    meta,
    needsTarget: !!meta.requiresTarget,
  });
}

fs.writeFileSync(path.join(root, 'tools/_oncast_audit/probe.json'), JSON.stringify(rows, null, 2));
const byPat = {};
for (const r of rows) for (const p of r.patterns) {
  if (!byPat[p]) byPat[p] = [];
  byPat[p].push(r.name);
}
console.log('TOTAL', rows.length);
console.log('resolved', rows.filter(r => r.resolvedDescription).length);
console.log('truncated', JSON.stringify(rows.filter(r => r.truncatedExtraction).map(r => r.name)));
console.log('multi', JSON.stringify(rows.filter(r => r.multiOnCast).map(r => r.name)));
console.log('needsTarget', rows.filter(r => r.needsTarget).length);
console.log('gy missing dest', JSON.stringify(rows.filter(r => r.meta.targetZone && !r.meta.targetDestination).map(r => r.name)));
console.log('---PATTERNS---');
for (const [k, v] of Object.entries(byPat).sort((a, b) => b[1].length - a[1].length)) {
  const u = [...new Set(v)];
  console.log(k + '\t' + u.length + '\t' + u.slice(0, 5).join('; '));
}
