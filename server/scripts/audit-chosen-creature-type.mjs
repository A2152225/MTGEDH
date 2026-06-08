import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = path.join(repoRoot, 'server/data/card-lookup.sqlite');

function loadCards() {
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT payload FROM card_lookup').all();
      const out = [];
      const seen = new Set();
      for (const row of rows) {
        let payload;
        try {
          payload = JSON.parse(String(row.payload || '{}'));
        } catch {
          continue;
        }
        const name = String(payload?.name || '').trim();
        const oracleText = String(payload?.oracle_text || '').trim();
        if (!name || !/choose a creature type/i.test(oracleText)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, oracle_text: oracleText });
      }
      if (out.length > 0) return out;
    } finally {
      db.close();
    }
  }

  const atomicPath = path.join(repoRoot, 'AtomicCards.json');
  if (fs.existsSync(atomicPath)) {
    const data = JSON.parse(fs.readFileSync(atomicPath, 'utf8'));
    const out = [];
    for (const [name, printings] of Object.entries(data.data || {})) {
      const text = String((printings?.[0] || {}).text || '');
      if (/choose a creature type/i.test(text)) {
        out.push({ name, oracle_text: text });
      }
    }
    return out;
  }

  throw new Error('No card data source found');
}

function classify(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = t.toLowerCase();
  const tags = [];
  if (/as .+ enters(?: the battlefield)?,? choose a creature type/i.test(lower)) tags.push('etb_choose');
  if (/choose a creature type(?!\s+in addition)/i.test(lower) && !/as .+ enters/i.test(lower)) tags.push('non_etb_choose');
  if (/is the chosen type/i.test(lower)) tags.push('becomes_chosen_type');
  if (/spell(?:s)? of the chosen type/i.test(lower)) tags.push('cast_chosen_type');
  if (/creature(?:s)? you control of the chosen type/i.test(lower)) tags.push('controlled_chosen_type');
  if (/creatures? of the chosen type/i.test(lower) && !/you control/.test(lower)) tags.push('creatures_of_chosen_type');
  if (/enters or attacks/i.test(lower)) tags.push('enters_or_attacks');
  if (/cost(?:s)?\s+(?:\{[^}]+\}|\d+)\s*less/i.test(lower)) tags.push('cost_reduction');
  if (/add .*mana/i.test(lower) || /\{t\}: add/i.test(lower)) tags.push('mana');
  if (/draw a card/i.test(lower)) tags.push('draw');
  if (/copy that spell/i.test(lower)) tags.push('copy_spell');
  if (/trigger(?:s)? an additional time/i.test(lower)) tags.push('double_trigger');
  if (/search your library/i.test(lower)) tags.push('search');
  if (/\+1\/\+1 counter/i.test(lower)) tags.push('counter');
  if (/get \+[+-]?\d+\/\+?[+-]?\d+/i.test(lower)) tags.push('pt_buff');
  if (/have [^.]+/i.test(lower) && /chosen type have/i.test(lower)) tags.push('grant_ability');
  if (/can't be countered/i.test(lower)) tags.push('uncounterable');
  if (/sacrifice/i.test(lower)) tags.push('sacrifice');
  if (/create .*token/i.test(lower)) tags.push('token');
  if (/look at the top/i.test(lower)) tags.push('top_library');
  return tags;
}

const cards = loadCards().sort((a, b) => String(a.name).localeCompare(String(b.name)));
const byTag = new Map();
for (const card of cards) {
  const tags = classify(card.oracle_text);
  for (const tag of tags) {
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(card.name);
  }
}

function clearImplementedGaps(oracleText, tags, gaps) {
  const lower = String(oracleText || '').toLowerCase();
  const has = (tag) => tags.includes(tag);
  const out = new Set(gaps);

  if (has('etb_choose')) {
    out.delete('cast_time_choice');
  }

  if (
    has('non_etb_choose')
    && /choose a creature type/i.test(lower)
    && !/as .+ enters/i.test(lower)
  ) {
    out.delete('cast_time_choice');
  }

  if (
    /reveal the top card of your library.*creature card of the chosen type/i.test(lower)
    || /\{t\}: choose a creature type\. reveal the top card/i.test(lower)
  ) {
    out.delete('cast_time_choice');
  }

  if (
    /look at the top six cards of your library.*cards? of the chosen type from among them/i.test(lower)
    || /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal any number of cards? of the chosen type/i.test(lower)
  ) {
    out.delete('top_library_chosen_type');
    out.delete('cast_time_choice');
  }

  if (
    /cast creature spells of the chosen type from the top of your library/i.test(lower)
    || /look at the top card of your library.*card of the chosen type.*put it into your hand/i.test(lower)
    || /look at the top card of your library.*creature card of the chosen type/i.test(lower)
  ) {
    out.delete('top_library_chosen_type');
  }

  if (
    /search your library for a creature card with mana value x or less/i.test(lower)
    && /additional cost was paid/i.test(lower)
  ) {
    out.delete('search_chosen_type');
  }

  if (/draw a card for each permanent you control of that type/i.test(lower)) {
    out.delete('draw_spell_chosen_type');
    out.delete('cast_time_choice');
  }

  if (/draw a card for each creature you control of (?:that|the chosen) type/i.test(lower)) {
    out.delete('draw_spell_chosen_type');
    out.delete('cast_time_choice');
  }

  if (
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library.*creature card of the chosen type.*put it into your hand/i.test(lower)
    || /\{3\}, \{t\}: look at the top three cards/i.test(lower)
  ) {
    out.delete('top_library_chosen_type');
  }

  if (/each other creature you control of the chosen type enters with an additional \+1\/\+1 counter/i.test(lower)) {
    out.delete('counter_chosen_type');
  }

  if (/sacrifice a creature of the chosen type/i.test(lower)) {
    out.delete('global_chosen_type_sacrifice');
  }

  if (
    (
      /spend this mana only to cast a creature spell of the chosen type/i.test(lower)
      || /spend this mana only to cast spells of the chosen type/i.test(lower)
    )
    && has('etb_choose')
    && has('mana')
  ) {
    out.delete('chosen_type_mana_land');
  }

  if (
    has('etb_choose')
    && has('mana')
    && /\{t\}: add one mana of any color/i.test(lower)
    && !/spend this mana only/i.test(lower)
  ) {
    out.delete('chosen_type_mana_land');
  }

  if (
    has('etb_choose')
    && has('mana')
    && /choose a color\. add an amount of mana of that color equal to the number of creatures you control of the chosen type/i.test(lower)
  ) {
    out.delete('chosen_type_mana_land');
  }

  if (
    /search your library for a creature card with mana value x or less/i.test(lower)
    && /additional cost was paid/i.test(lower)
  ) {
    out.delete('cost_reduction_cast_only');
    out.delete('search_chosen_type');
    out.delete('cast_time_choice');
  }

  if (/put a \+1\/\+1 counter on each creature you control of (?:that|the chosen) type/i.test(lower)) {
    out.delete('token_spell_chosen_type');
    out.delete('cast_time_choice');
    out.delete('counter_chosen_type');
  }

  if (/for each creature you control of the chosen type, create a token/i.test(lower)) {
    out.delete('token_spell_chosen_type');
    out.delete('cast_time_choice');
  }

  if (/reveal cards from the top of your library until you reveal x creature cards of the chosen type/i.test(lower)) {
    out.delete('search_chosen_type');
    out.delete('cast_time_choice');
  }

  if (/destroy all creatures that aren't of the chosen type/i.test(lower)) {
    out.delete('cast_time_choice');
  }

  if (/whenever you cast a spell of the chosen type, copy that spell/i.test(lower)) {
    out.delete('spell_copy_chosen_type');
  }

  if (
    /whenever (another |a )?creatures? you control of the chosen type enters/i.test(lower)
    && /\+1\/\+1 counter/i.test(lower)
  ) {
    out.delete('counter_chosen_type');
  }

  if (
    /whenever a creature you control of the chosen type enters/i.test(lower)
    && /create a token that's a copy/i.test(lower)
  ) {
    out.delete('counter_chosen_type');
  }

  if (
    /creature spells of the chosen type cost \{1\} less/i.test(lower)
    && has('etb_choose')
  ) {
    out.delete('cost_reduction_cast_only');
  }

  return [...out];
}

function assessSupport(tags, oracleText) {
  const has = (tag) => tags.includes(tag);
  const gaps = [];

  if (has('etb_choose')) {
    // ETB choose prompt is generic.
  } else if (has('non_etb_choose')) {
    gaps.push('cast_time_choice');
  }

  if (has('cost_reduction') && !has('etb_choose')) gaps.push('cost_reduction_cast_only');
  if (has('mana') && has('etb_choose')) gaps.push('chosen_type_mana_land');
  if (has('copy_spell')) gaps.push('spell_copy_chosen_type');
  if (has('search')) gaps.push('search_chosen_type');
  if (has('top_library')) gaps.push('top_library_chosen_type');
  if (has('token') && has('non_etb_choose')) gaps.push('token_spell_chosen_type');
  if (has('sacrifice') && has('creatures_of_chosen_type')) gaps.push('global_chosen_type_sacrifice');
  if (has('draw') && has('non_etb_choose')) gaps.push('draw_spell_chosen_type');
  if (has('counter') && has('etb_choose')) gaps.push('counter_chosen_type');

  const clearedGaps = clearImplementedGaps(oracleText, tags, gaps);

  let tier = 'partial';
  if (clearedGaps.length === 0) tier = 'core';
  if (clearedGaps.length >= 3) tier = 'needs_work';
  if (has('non_etb_choose') && clearedGaps.includes('cast_time_choice')) tier = 'needs_work';

  return { tier, gaps: clearedGaps };
}

const assessed = cards.map((c) => {
  const tags = classify(c.oracle_text);
  const support = assessSupport(tags, c.oracle_text);
  return { name: c.name, tags, support };
});

const tierCounts = assessed.reduce((acc, card) => {
  acc[card.support.tier] = (acc[card.support.tier] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  total: cards.length,
  byTag: Object.fromEntries([...byTag.entries()].map(([k, v]) => [k, v.length])),
  tierCounts,
  cards: assessed,
}, null, 2));
