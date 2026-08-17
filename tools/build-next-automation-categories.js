/**
 * Rebuild tools/oracle-automation-next-20-categories.json (+ Markdown sibling)
 * from the canonical oracle-cards.jsonl corpus.
 *
 * Unlike tools/build-next-automation-queue.js, this generator:
 * - streams oracle-cards.jsonl (never legacy oracle-cards.json)
 * - preserves full modal blocks (header + bullets), never bare "Choose one —"
 * - never ellipsizes truncated clauses
 *
 * Usage:
 *   node tools/build-next-automation-categories.js
 *   node tools/build-next-automation-categories.js --limit 200
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const repoRoot = path.resolve(__dirname, '..');
const ORACLE_JSONL = path.join(repoRoot, 'oracle-cards.jsonl');
const EXCLUDED_QUEUE = path.join(repoRoot, 'tools', 'oracle-automation-next-10000.json');
const OUTPUT_JSON = path.join(repoRoot, 'tools', 'oracle-automation-next-20-categories.json');
const OUTPUT_MD = path.join(repoRoot, 'docs', 'oracle-automation-next-20-categories.md');

const ITEM_LIMIT_DEFAULT = 200;

function parseArgs(argv) {
  const args = { limit: ITEM_LIMIT_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '--limit') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) args.limit = Math.floor(next);
      i++;
    }
  }
  return args;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/\r\n/g, '\n')
    .trim();
}

function isBalancedParentheses(text) {
  let depth = 0;
  for (const char of String(text || '')) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isEllipsized(text) {
  return /\.\.\.|…/.test(String(text || ''));
}

function isQueueEligible(card) {
  if (!card || typeof card !== 'object') return false;
  if (!Array.isArray(card.games) || !card.games.includes('paper')) return false;
  if (['token', 'memorabilia', 'minigame'].includes(String(card.set_type || '').toLowerCase())) return false;
  if (String(card.layout || '').toLowerCase().includes('token')) return false;
  if (card.digital === true || card.oversized === true) return false;
  return typeof card.oracle_text === 'string' && card.oracle_text.trim().length > 0;
}

function loadExcludedOracleIds() {
  const excluded = new Set();
  if (!fs.existsSync(EXCLUDED_QUEUE)) return excluded;
  try {
    const report = JSON.parse(fs.readFileSync(EXCLUDED_QUEUE, 'utf8'));
    for (const item of report.queue || []) {
      const id = String(item.oracleId || item.oracle_id || '').trim();
      if (id) excluded.add(id);
    }
  } catch (error) {
    console.warn(`Warning: could not read excluded queue: ${error.message}`);
  }
  return excluded;
}

async function loadEligibleCards(excludedOracleIds) {
  if (!fs.existsSync(ORACLE_JSONL)) {
    throw new Error(`Missing oracle corpus at ${ORACLE_JSONL}`);
  }

  const byOracleId = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(ORACLE_JSONL, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let card;
    try {
      card = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isQueueEligible(card)) continue;
    const oracleId = String(card.oracle_id || card.id || '').trim();
    if (!oracleId || excludedOracleIds.has(oracleId)) continue;
    if (byOracleId.has(oracleId)) continue;
    byOracleId.set(oracleId, card);
  }

  return [...byOracleId.values()].sort((a, b) => {
    const rankA = Number.isFinite(Number(a.edhrec_rank)) ? Number(a.edhrec_rank) : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(Number(b.edhrec_rank)) ? Number(b.edhrec_rank) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

const CHOOSE_MODE_HEADER_RE =
  /^(?:You\s+(?:may\s+)?)?Choose\s+(?:one\s+at\s+random|one\s+that\s+has(?:n't| not)\s+been\s+chosen|one\s+or\s+both|one\s+or\s+more|up\s+to\s+one|one|two|three|four|up\s+to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\w+)(?:\s*\{P\}\s*worth\s+of\s+modes)?|any\s+number(?:\s+of\s+modes?)?)(?:\.\s*If\s+[^.]*?(?:you\s+may\s+)?choose\s+(?:both|any\s+number)\s+instead[.\u2014-]?)?(?:\.\s*You may choose the same mode more than once\.)?\s*(?:[-\u2014]|\.|)\s*(?:Each mode must target a different player\.?)?\s*$/i;

const P_WORTH_HEADER_RE =
  /^Choose\s+up\s+to\s+\w+\s*\{P\}\s*worth\s+of\s+modes\.(?:\s*You may choose the same mode more than once\.)?\s*$/i;

const BULLET_LINE_RE = /^(?:[•\u2022]|\+[^{—\n]*[—-]|\s*\{P\}(?:\{P\})*\s*[—-])/;

function extractModalBlock(oracleText) {
  const text = normalizeText(oracleText);
  if (!text) return null;
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeader =
      CHOOSE_MODE_HEADER_RE.test(line) ||
      P_WORTH_HEADER_RE.test(line) ||
      (/^Choose\b/i.test(line) && /[—-]|\.$/.test(line) && !/\bchoose\s+\w+\s+cards?\b/i.test(line));

    if (!isHeader) continue;

    const block = [line];
    let j = i + 1;
    while (j < lines.length && BULLET_LINE_RE.test(lines[j])) {
      block.push(lines[j]);
      j += 1;
    }

    // Require at least one mode bullet; bare headers are not executable fixtures.
    if (block.length < 2) continue;

    const clause = block.join('\n');
    if (!isBalancedParentheses(clause) || isEllipsized(clause)) continue;
    return clause;
  }

  return null;
}

function splitClauses(oracleText) {
  const text = normalizeText(oracleText);
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const clauses = [];

  for (const line of lines) {
    // Keep ability lines intact when they include reminder text or costs.
    if (/^[•\u2022]/.test(line) || / — /.test(line) || /^\{/.test(line) || /\([^)]*$/.test(line)) {
      clauses.push(line);
      continue;
    }
    const parts = line.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    clauses.push(...parts);
  }

  return clauses;
}

const categoryConfigs = [
  {
    id: 'return_to_hand',
    title: 'Bounce And Return-To-Hand Effects',
    source: 'existing queue family after library_search',
    notes: 'Battlefield bounce and zone-return effects after the current queue tail.',
    patterns: [
      /return target .* to (?:its owner's|their owner's|your) hand/i,
      /return up to .* target .* to .* hand/i,
      /return each .* to .* hand/i,
    ],
  },
  {
    id: 'discard',
    title: 'Discard Effects',
    source: 'existing queue family after library_search',
    notes: 'Deterministic discard counts plus player-choice discard families.',
    patterns: [
      /discard (?:a|an|one|two|three|four|five|x|that many) cards?/i,
      /discards? .* cards?/i,
    ],
    // Keyword/cost riders mention discard but are not discard-effect automation seams.
    excludePatterns: [
      /^Ward/i,
      /\bMadness\b/i,
      /\bCycling\b/i,
      /\bChannel\b/i,
      /rather than pay (?:this spell's |its )?mana cost/i,
    ],
  },
  {
    id: 'scry_surveil',
    title: 'Scry / Surveil / Topdeck Manipulation',
    source: 'existing queue family after library_search',
    notes: 'Visible topdeck manipulation and queue-backed choice candidates.',
    patterns: [
      /\bscry \d+/i,
      /\bscry x\b/i,
      /\bsurveil \d+/i,
      /\bsurveil x\b/i,
      /look at the top .* cards? of your library/i,
    ],
  },
  {
    id: 'tap_untap',
    title: 'Tap / Untap Effects',
    source: 'existing queue family after library_search',
    notes: 'Single-target, multi-target, and each-target tap/untap templates.',
    patterns: [
      /tap target/i,
      /untap target/i,
      /tap up to/i,
      /untap up to/i,
      /tap each /i,
      /untap each /i,
      /untap up to .* lands?/i,
    ],
  },
  {
    id: 'counterspell',
    title: 'Counterspell And Stack Interaction',
    source: 'existing queue family after library_search',
    notes: 'Explicit spell and ability countering clauses.',
    patterns: [
      /counter target spell/i,
      /counter up to .* target spells?/i,
      /counter target activated ability/i,
      /counter target triggered ability/i,
    ],
  },
  {
    id: 'mill',
    title: 'Mill Effects',
    source: 'existing queue family after library_search',
    notes: 'Library-to-graveyard movement and count scaling.',
    patterns: [
      /\bmill (?:a|one|two|three|four|five|x|that many) cards?/i,
      /mills? .* cards?/i,
    ],
  },
  {
    id: 'impulse_exile_permission',
    title: 'Impulse Exile Permission Windows',
    source: 'existing queue family after library_search',
    notes: 'Exile-top plus temporary play/cast permission windows.',
    patterns: [
      /exile the top .* you may (?:play|cast)/i,
      /until the end of .* you may (?:play|cast) .* exiled/i,
      /for as long as .* remains exiled, you may (?:play|cast)/i,
      /you may (?:play|cast) the exiled card/i,
      /you may play them this turn/i,
    ],
  },
  {
    id: 'fight_and_similar',
    title: 'Fight And Bite-Style Combat Resolution',
    source: 'existing queue family after library_search',
    notes: 'Fight, bite, and power-based creature damage clauses.',
    patterns: [
      /\bfight target/i,
      /\bfights target/i,
      /deals damage equal to its power to target creature/i,
    ],
  },
  {
    id: 'goad_and_attacking_pressure',
    title: 'Goad And Attack-Pressure Effects',
    source: 'existing queue family after library_search',
    notes: 'Goad, forced attacks, and attack restriction pressure text.',
    patterns: [
      /\bgoad target/i,
      /\bgoad each/i,
      /attacks each combat if able/i,
      /can't attack you or planeswalkers you control/i,
    ],
  },
  {
    id: 'non_graveyard_exile',
    title: 'Non-Graveyard Exile Effects',
    source: 'corpus-mined follow-on seam',
    notes: 'Targeted and sweeper exile effects excluding graveyard-target rows already covered by the current queue.',
    patterns: [
      /\bexile target\b/i,
      /\bexile all\b/i,
      /\bexile each\b/i,
      /\bexile up to\b/i,
    ],
    excludePatterns: [
      /\bgraveyard\b/i,
      /\bfrom exile\b/i,
      /\bcast .* from exile\b/i,
      /\bhas cascade\b/i,
      /\bSuspend\b/i,
      /^\(.*\)$/s,
    ],
  },
  {
    id: 'modify_power_toughness',
    title: 'Power/Toughness Modification',
    source: 'corpus-mined follow-on seam',
    notes: 'Temporary and static P/T changes, including target and team-wide buffs/debuffs.',
    patterns: [
      /gets? [+-]\d+\/[+-]\d+/i,
      /get [+-][xX]\/[+-][xX]/i,
      /base power and toughness/i,
    ],
  },
  {
    id: 'keyword_grants_and_losses',
    title: 'Keyword Grants And Losses',
    source: 'corpus-mined follow-on seam',
    notes: 'Gains/has/loses evergreen and combat keywords, especially duration-bound grants.',
    patterns: [
      /\bgains?\b.+\b(?:flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|shroud)\b/i,
      /\bhas\b.+\b(?:flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|shroud)\b/i,
      /\bloses?\b.+\b(?:flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|shroud)\b/i,
    ],
  },
  {
    id: 'combat_restrictions',
    title: 'Combat Restrictions And Evasion Rules',
    source: 'corpus-mined follow-on seam',
    notes: 'Cannot attack/block, cannot be blocked, and blocking requirement templates.',
    patterns: [
      /can't (?:be )?blocked/i,
      /can't attack/i,
      /can't block/i,
      /must (?:be )?blocked/i,
      /attacks each combat if able/i,
      /blocks? each combat if able/i,
    ],
  },
  {
    id: 'control_change_exchange',
    title: 'Control Change And Exchange Effects',
    source: 'corpus-mined follow-on seam',
    notes: 'Gain-control, donate, and exchange-control effects across permanent types.',
    patterns: [
      /gain control of/i,
      /gains control of/i,
      /exchange control/i,
      /you control target/i,
    ],
  },
  {
    id: 'copy_spells_abilities',
    title: 'Copy Spells And Abilities',
    source: 'corpus-mined follow-on seam',
    notes: 'Spell/ability copy text, copied permanent spells, and retarget follow-ups.',
    patterns: [
      /copy (?:that|target|this) (?:spell|ability)/i,
      /copy it/i,
      /\bstorm\b/i,
      /create a copy/i,
      /you may choose new targets for the copy/i,
    ],
  },
  {
    id: 'mana_generation',
    title: 'Mana Generation And Mana Riders',
    source: 'corpus-mined follow-on seam',
    notes: 'Add-mana clauses, conditional mana, and rider text attached to mana production.',
    patterns: [
      /\{T\}: Add /i,
      /Add \{[WUBRGCX0-9]+\}/i,
      /Add one mana/i,
      /adds? \{[WUBRGC]/i,
    ],
  },
  {
    id: 'cast_without_paying',
    title: 'Cast Without Paying Mana Cost',
    source: 'corpus-mined follow-on seam',
    notes: 'Free-cast windows from exile, library, hand, graveyard, and copied spells.',
    patterns: [
      /you may (?:cast|play) .{0,120}without paying (?:its |their |the )?mana costs?/i,
      /cast .{0,80}without paying (?:its |their |the )?mana costs?/i,
    ],
    // Alternate-cost riders, keyword reminders, and static continuous permissions
    // are casting rules — keep impulse/window effect clauses for parser fixtures.
    excludePatterns: [
      /^If you control a commander, you may cast this spell without paying its mana cost\.?$/i,
      /^\([^)]*without paying[^)]*\)$/i,
      /^You may cast it without paying its mana cost\.?$/i,
      /^You may cast spells from your hand without paying their mana costs?\.?$/i,
      /^Once during each of your turns,.*/i,
      /\bCascade\b/i,
      /\bSuspend\b/i,
      /\bRebound\b/i,
      /\bCipher\b/i,
      /\bFlashback\b/i,
    ],
  },
  {
    id: 'modal_choices',
    title: 'Modal Choices',
    source: 'corpus-mined follow-on seam',
    notes: 'Choose-one, choose-one-or-more, charm, command, spree, and bullet-mode parsing.',
    modal: true,
    patterns: [
      /\bChoose (?:one|two|three|four|one or both|one or more|up to|any number)\b/i,
      /\+[^{—\n]*[—-].*\n(?:[•\u2022]|\+)/i,
      /\{P\}(?:\{P\})*\s*[—-]/i,
    ],
  },
  {
    id: 'reveal_look_top_library',
    title: 'Reveal / Look At Top Library Cards',
    source: 'corpus-mined follow-on seam',
    notes: 'Top-library look/reveal actions beyond scry and surveil templates.',
    patterns: [
      /look at the top/i,
      /reveal the top/i,
      /look at target player's hand/i,
      /\bhideaway\b/i,
    ],
  },
  {
    id: 'attach_equip_aura',
    title: 'Attach / Equip / Aura Movement',
    source: 'corpus-mined follow-on seam',
    notes: 'Attach equipment/auras and move attachments to new permanents.',
    patterns: [
      /\bequip\b/i,
      /attach (?:it|this|target)/i,
      /attach .* to/i,
      /move .* attached/i,
    ],
  },
];

function extractClauseForCategory(card, config) {
  const oracleText = String(card.oracle_text || '');
  if (config.modal) {
    return extractModalBlock(oracleText);
  }

  const excludePatterns = Array.isArray(config.excludePatterns) ? config.excludePatterns : [];
  const clauses = splitClauses(oracleText);
  for (let i = 0; i < clauses.length; i++) {
    let candidate = clauses[i];
    if (!config.patterns.some(pattern => pattern.test(candidate))) continue;
    if (excludePatterns.some(pattern => pattern.test(candidate))) continue;

    let j = i + 1;
    while (!isBalancedParentheses(candidate) && j < clauses.length) {
      candidate = `${candidate} ${clauses[j]}`;
      j += 1;
    }

    if (!isBalancedParentheses(candidate) || isEllipsized(candidate)) continue;
    if (excludePatterns.some(pattern => pattern.test(candidate))) continue;
    return candidate;
  }

  // Fall back to a contiguous multi-line window that contains a match.
  const text = normalizeText(oracleText);
  for (const pattern of config.patterns) {
    const match = pattern.exec(text);
    if (!match || match.index == null) continue;
    const start = text.lastIndexOf('\n', match.index);
    const sliceStart = start >= 0 ? start + 1 : 0;
    let end = text.indexOf('\n', match.index + match[0].length);
    if (end < 0) end = text.length;
    const candidate = text.slice(sliceStart, end).trim();
    if (!candidate || !isBalancedParentheses(candidate) || isEllipsized(candidate)) continue;
    if (excludePatterns.some(exclude => exclude.test(candidate))) continue;
    return candidate;
  }

  return null;
}

function buildCategories(cards, itemLimit) {
  return categoryConfigs.map((config, index) => {
    const items = [];
    for (const card of cards) {
      if (!config.modal && !config.patterns.some(pattern => pattern.test(String(card.oracle_text || '')))) {
        continue;
      }
      if (config.modal) {
        const hasModalSignal = config.patterns.some(pattern => pattern.test(String(card.oracle_text || '')));
        if (!hasModalSignal) continue;
      }

      const clause = extractClauseForCategory(card, config);
      if (!clause) continue;

      items.push({
        itemIndex: items.length + 1,
        name: String(card.name || ''),
        oracleId: String(card.oracle_id || card.id || ''),
        edhrecRank: Number.isFinite(Number(card.edhrec_rank)) ? Number(card.edhrec_rank) : null,
        typeLine: String(card.type_line || ''),
        clause,
      });
    }

    const availableCount = items.length;
    const limited = items.slice(0, itemLimit).map((item, itemIndex) => ({
      ...item,
      itemIndex: itemIndex + 1,
    }));

    return {
      ordinal: index + 1,
      id: config.id,
      title: config.title,
      source: config.source,
      notes: config.notes,
      availableCount,
      itemCount: limited.length,
      items: limited,
    };
  });
}

function renderMarkdown(report) {
  const lines = [
    '# Oracle Automation Next 20 Work Categories',
    '',
    `Generated: \`${report.generatedAt}\``,
    `Source: \`${report.source}\``,
    `Excluded: oracle IDs already present in \`${path.relative(repoRoot, EXCLUDED_QUEUE).replace(/\\/g, '/')}\`.`,
    'Ordering: categories are ordered by the next configured queue families first, then corpus-mined follow-on seams; items are ordered by EDHREC rank, then card name.',
    '',
    '## Category Summary',
    '',
    '| # | Category | Source | Items Listed | Available | Notes |',
    '|---:|---|---|---:|---:|---|',
    ...report.categories.map(
      category =>
        `| ${category.ordinal} | ${category.title} | ${category.source} | ${category.itemCount} | ${category.availableCount} | ${category.notes.replace(/\|/g, '\\|')} |`
    ),
    '',
    '## Category Items',
    '',
  ];

  for (const category of report.categories) {
    lines.push(`### ${category.ordinal}. ${category.title}`);
    lines.push('');
    lines.push(`Source: ${category.source}`);
    lines.push(`Available after current queue exclusion: ${category.availableCount}`);
    lines.push('');
    for (const item of category.items) {
      const rankText = item.edhrecRank == null ? 'unranked' : `EDHREC ${item.edhrecRank}`;
      const clauseForMd = String(item.clause || '').replace(/\n/g, ' / ');
      lines.push(`${item.itemIndex}. ${item.name} (${rankText}) - ${clauseForMd}`);
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- Regenerate with `node tools/build-next-automation-categories.js` whenever the corpus or category patterns change.');
  lines.push('- Modal fixtures must include the choose header and all immediately following mode bullets; bare headers are rejected.');
  lines.push('- Clauses are never ellipsized; incomplete parenthetical reminders are skipped.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Loading excluded IDs from ${path.relative(repoRoot, EXCLUDED_QUEUE)}...`);
  const excluded = loadExcludedOracleIds();
  console.log(`Excluded oracle IDs: ${excluded.size}`);

  console.log(`Streaming ${path.relative(repoRoot, ORACLE_JSONL)}...`);
  const cards = await loadEligibleCards(excluded);
  console.log(`Eligible unique oracle cards: ${cards.length}`);

  const categories = buildCategories(cards, args.limit);
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'oracle-cards.jsonl',
    excludedQueue: path.relative(repoRoot, EXCLUDED_QUEUE).replace(/\\/g, '/'),
    categoryCount: categories.length,
    itemLimitPerCategory: args.limit,
    categories,
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_MD, renderMarkdown(report));

  for (const category of categories) {
    console.log(
      `${category.id}: listed ${category.itemCount} / available ${category.availableCount}`
    );
  }

  console.log(
    `Wrote ${path.relative(repoRoot, OUTPUT_JSON)} and ${path.relative(repoRoot, OUTPUT_MD)}.`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
