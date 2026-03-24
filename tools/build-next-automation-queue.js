const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');

function parseArgs(argv) {
  const args = {
    count: 500,
    jsonOut: '',
    markdownOut: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg === '--count') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) args.count = Math.floor(next);
      i++;
      continue;
    }
    if (arg === '--json-out') {
      args.jsonOut = String(argv[i + 1] || '').trim();
      i++;
      continue;
    }
    if (arg === '--md-out') {
      args.markdownOut = String(argv[i + 1] || '').trim();
      i++;
      continue;
    }
  }

  return args;
}

function resolveOutputPaths(args) {
  const basename = `oracle-automation-next-${args.count}`;
  return {
    outputJsonPath: path.join(repoRoot, args.jsonOut || path.join('tools', `${basename}.json`)),
    outputMarkdownPath: path.join(repoRoot, args.markdownOut || path.join('docs', `${basename}.md`)),
  };
}

function readOracleCards() {
  const raw = fs.readFileSync(oracleCardsPath, 'utf8');
  return JSON.parse(raw);
}

function isQueueEligible(card) {
  if (!card || typeof card !== 'object') return false;
  if (!Array.isArray(card.games) || !card.games.includes('paper')) return false;
  if (['token', 'memorabilia', 'minigame'].includes(String(card.set_type || '').toLowerCase())) return false;
  if (String(card.layout || '').toLowerCase().includes('token')) return false;
  if ((card.digital === true) || (card.oversized === true)) return false;
  return typeof card.oracle_text === 'string' && card.oracle_text.trim().length > 0;
}

function dedupeCards(cards) {
  const seen = new Set();
  const out = [];
  for (const card of cards) {
    const key = String(card.oracle_id || card.id || `${card.name}|${card.oracle_text}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const rankA = Number.isFinite(Number(a.edhrec_rank)) ? Number(a.edhrec_rank) : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(Number(b.edhrec_rank)) ? Number(b.edhrec_rank) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractClause(card, patterns) {
  const text = String(card.oracle_text || '');
  const segments = text
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(segment => normalizeText(segment))
    .filter(Boolean);

  for (const segment of segments) {
    for (const pattern of patterns) {
      if (pattern.test(segment)) return segment;
    }
  }

  const normalized = normalizeText(text);
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

const familyConfigs = [
  {
    id: 'gy_dynamic_mv_reanimate',
    title: 'Dynamic Graveyard Mana-Value Reanimation',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'High-yield follow-up to the new static mana-value cap support; keep runtime-dependent caps explicit and conservative.',
    targetCount: 12,
    patterns: [
      /target .* card with mana value (?:less than|less than or equal to|equal to|x or less|that many or less|the chosen number or less).* from a graveyard/i,
      /target .* card with mana value .* from a graveyard .* onto the battlefield/i,
    ],
  },
  {
    id: 'gy_counter_reanimate',
    title: 'Counter-Bearing Graveyard Reanimation',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Extends the current with-counters support to more real-card variants, especially where extra legality or follow-up state matters.',
    targetCount: 16,
    patterns: [
      /from a graveyard onto the battlefield .* with .* counter/i,
      /from your graveyard onto the battlefield .* with .* counter/i,
      /from a graveyard onto the battlefield under your control .* with .* counter/i,
    ],
  },
  {
    id: 'gy_reanimate_under_your_control',
    title: 'Exact-Target Reanimation Under Your Control',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Broadens the exact-target graveyard move family with remaining qualifiers, riders, and follow-up text.',
    targetCount: 45,
    patterns: [
      /put target .* from a graveyard onto the battlefield under your control/i,
      /return target .* from a graveyard to the battlefield under your control/i,
    ],
  },
  {
    id: 'gy_reanimate_under_owner_control',
    title: 'Exact-Target Reanimation Under Owner Control',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Small but important owner-control corner for deterministic reanimation.',
    targetCount: 10,
    patterns: [
      /put target .* from a graveyard onto the battlefield under (?:its|their) owner'?s control/i,
      /return target .* from a graveyard to the battlefield under (?:its|their) owner'?s control/i,
    ],
  },
  {
    id: 'gy_to_owner_hand',
    title: 'Exact-Target Graveyard To Hand',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Useful parity family for real recursion spells that still need variant coverage and corpus locks.',
    targetCount: 30,
    patterns: [
      /return target .* from a graveyard to (?:its|their) owner'?s hand/i,
      /put target .* from a graveyard into (?:its|their) owner'?s hand/i,
    ],
  },
  {
    id: 'gy_to_library',
    title: 'Exact-Target Graveyard To Library',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Covers top/bottom placement variants that reuse current exact-target graveyard selectors.',
    targetCount: 30,
    patterns: [
      /put target .* from a graveyard on (?:top of|the top of|the bottom of|bottom of) .* library/i,
      /shuffle target .* from a graveyard into .* library/i,
    ],
  },
  {
    id: 'gy_exile_target',
    title: 'Exact-Target Graveyard Exile',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'Large real-card family that benefits from variant locks and remaining qualifier coverage.',
    targetCount: 110,
    patterns: [
      /exile target .* from a graveyard/i,
      /exile up to one target .* from a graveyard/i,
    ],
  },
  {
    id: 'your_gy_to_hand',
    title: 'Your Graveyard To Hand',
    category: 'Near-Term Graveyard Move-Zone',
    notes: 'High-volume self-recursion family; good for tightening direct target binding and context-driven return paths.',
    targetCount: 80,
    patterns: [
      /(?:return|put) target .* from your graveyard (?:to|into) your hand/i,
      /(?:return|put) up to one target .* from your graveyard (?:to|into) your hand/i,
    ],
  },
  {
    id: 'dies_return_battlefield',
    title: 'Dies Triggers Returning The Card To Battlefield',
    category: 'Contextual Graveyard Recursion',
    notes: 'Needs stronger antecedent binding from the dying object into the follow-up move-zone action.',
    targetCount: 40,
    patterns: [
      /when(?:ever)? .* dies,? return that card to the battlefield/i,
      /when(?:ever)? .* dies,? return it to the battlefield/i,
    ],
  },
  {
    id: 'dies_return_hand',
    title: 'Dies Triggers Returning The Card To Hand',
    category: 'Contextual Graveyard Recursion',
    notes: 'Similar contextual binding seam, but with hand destination instead of battlefield.',
    targetCount: 35,
    patterns: [
      /when(?:ever)? .* dies,? return (?:that card|it) to (?:its|their|your) owner'?s hand/i,
      /when(?:ever)? .* dies,? return (?:that card|it) to your hand/i,
    ],
  },
  {
    id: 'nim_deathmantle_cluster',
    title: 'Pay-To-Return Deathmantle-Style Recursion',
    category: 'Contextual Graveyard Recursion',
    notes: 'Includes Nim Deathmantle-style payment + return + attachment bundles.',
    targetCount: 12,
    patterns: [
      /you may pay .* if you do, return that card to the battlefield.*attach/i,
      /you may pay .* if you do, return that card to the battlefield/i,
    ],
  },
  {
    id: 'entered_from_graveyard_checks',
    title: 'Entered Or Cast From Graveyard Checks',
    category: 'Graveyard Context / Conditional',
    notes: 'Good follow-up once provenance is threaded more broadly across server and rules-engine paths.',
    targetCount: 25,
    patterns: [
      /entered from your graveyard/i,
      /was cast from your graveyard/i,
      /cast it from your graveyard/i,
    ],
  },
  {
    id: 'graveyard_leave_exile_replacement',
    title: 'Leave-Battlefield Exile Replacement Riders',
    category: 'Graveyard Context / Conditional',
    notes: 'Important support glue for temporary recursion families such as unearth and similar reanimation effects.',
    targetCount: 20,
    patterns: [
      /if it would leave the battlefield, exile it instead/i,
      /exile it instead of putting it anywhere else any time it would leave the battlefield/i,
    ],
  },
  {
    id: 'cast_from_graveyard_permission',
    title: 'Cast From Graveyard Permission Windows',
    category: 'Graveyard Permission / Replacement',
    notes: 'Useful for later test runs because these create lots of visible automation gaps when not modeled cleanly.',
    targetCount: 35,
    patterns: [
      /you may cast .* from your graveyard/i,
      /you may cast this card from your graveyard/i,
    ],
  },
  {
    id: 'play_from_graveyard_permission',
    title: 'Play From Graveyard Permission Windows',
    category: 'Graveyard Permission / Replacement',
    notes: 'Covers lands and mixed play-permission text from graveyard.',
    targetCount: 25,
    patterns: [
      /you may play .* from your graveyard/i,
    ],
  },
  {
    id: 'flashback_family',
    title: 'Flashback Cards',
    category: 'Graveyard Permission / Replacement',
    notes: 'Stable, populous graveyard-casting family to validate once permission windows and replacement text are tightened.',
    targetCount: 60,
    patterns: [
      /\bflashback\b/i,
    ],
  },
  {
    id: 'unearth_family',
    title: 'Unearth Cards',
    category: 'Graveyard Permission / Replacement',
    notes: 'Pairs graveyard reanimation with the leave-battlefield exile replacement rider.',
    targetCount: 40,
    patterns: [
      /\bunearth\b/i,
      /return this card from your graveyard to the battlefield.*it gains haste.*exile it at the beginning of the next end step/i,
    ],
  },
  {
    id: 'escape_family',
    title: 'Escape And Similar Graveyard Alternate Costs',
    category: 'Graveyard Permission / Replacement',
    notes: 'Includes escape-style casting/replay from graveyard with additional costs or modifiers.',
    targetCount: 55,
    patterns: [
      /\bescape\b/i,
      /\bdisturb\b/i,
      /\bembalm\b/i,
      /\beternalize\b/i,
      /jump-start/i,
      /\bretrace\b/i,
    ],
  },
  {
    id: 'create_token',
    title: 'Token Creation',
    category: 'High-Population Follow-On Seams',
    notes: 'Large practical seam spanning straightforward token creation, tapped/token modifier variants, and delayed cleanup follow-ups.',
    targetCount: 1800,
    patterns: [
      /create (?:one|two|three|four|five|six|seven|eight|nine|ten|x|that many|a|an) .* token/i,
      /create .* tokens/i,
    ],
  },
  {
    id: 'deal_damage',
    title: 'Direct Damage And Damage-Based Follow-Ups',
    category: 'High-Population Follow-On Seams',
    notes: 'Covers direct damage sentences, symmetric sweepers, and that-much/excess-damage follow-up families.',
    targetCount: 1600,
    patterns: [
      /deals? \d+ damage/i,
      /deals? x damage/i,
      /deals? that much damage/i,
      /deals? damage equal/i,
      /excess damage/i,
    ],
  },
  {
    id: 'draw_cards',
    title: 'Draw And Draw-Scaling Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Dense seam for raw draw, target draw, each-player draw, and draw-scaling follow-up text.',
    targetCount: 1400,
    patterns: [
      /draw (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|that many) cards?/i,
      /draw cards? equal/i,
      /each player draws/i,
      /target player draws/i,
    ],
  },
  {
    id: 'sacrifice_followups',
    title: 'Sacrifice And Sacrifice Follow-Up Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Useful after the graveyard slice because it overlaps strongly with death/reanimation bookkeeping and delayed cleanup.',
    targetCount: 1200,
    patterns: [
      /sacrifice /i,
    ],
  },
  {
    id: 'plus1_counters',
    title: '+1/+1 Counter Placement And Counter Scaling',
    category: 'High-Population Follow-On Seams',
    notes: 'Large seam with lots of deterministic counter placement, ETB modifiers, and count-based follow-up clauses.',
    targetCount: 1200,
    patterns: [
      /\+1\/\+1 counters?/i,
      /put .* counter on/i,
      /enters? .* with .* counters?/i,
    ],
  },
  {
    id: 'life_swings',
    title: 'Life Gain And Life Loss',
    category: 'High-Population Follow-On Seams',
    notes: 'Dense practical seam for gain/lose life, target-player life swings, and equal-to/reference clauses.',
    targetCount: 1000,
    patterns: [
      /gain \d+ life/i,
      /gain x life/i,
      /gain that much life/i,
      /lose \d+ life/i,
      /loses \d+ life/i,
      /life equal to/i,
    ],
  },
  {
    id: 'destroy_target',
    title: 'Targeted Destroy Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Broad removal seam that tends to be straightforward once target binding and rider text are preserved.',
    targetCount: 900,
    patterns: [
      /destroy target/i,
      /destroy up to one target/i,
      /destroy each /i,
    ],
  },
  {
    id: 'library_search',
    title: 'Library Search And Tutor Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Large queue for search workflows, especially once resolution-queue driven player choice paths are tightened further.',
    targetCount: 900,
    patterns: [
      /search your library/i,
      /search target player's library/i,
      /search their library/i,
      /search that player's library/i,
    ],
  },
  {
    id: 'return_to_hand',
    title: 'Bounce And Return-To-Hand Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Captures both battlefield bounce and zone-return effects that tend to be good deterministic automation candidates.',
    targetCount: 700,
    patterns: [
      /return target .* to (?:its owner's|their owner's|your) hand/i,
      /return up to .* target .* to .* hand/i,
      /return each .* to .* hand/i,
    ],
  },
  {
    id: 'discard',
    title: 'Discard Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Useful for queueing both deterministic discard counts and player-choice discard families for later resolution support.',
    targetCount: 700,
    patterns: [
      /discard (?:a|an|one|two|three|four|five|x|that many) cards?/i,
      /discards? .* cards?/i,
    ],
  },
  {
    id: 'scry_surveil',
    title: 'Scry / Surveil / Topdeck Manipulation',
    category: 'High-Population Follow-On Seams',
    notes: 'Good post-graveyard seam because it is common, visible in tests, and already has some queue-backed infrastructure on the server side.',
    targetCount: 500,
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
    category: 'High-Population Follow-On Seams',
    notes: 'Broad tactical seam with many deterministic single-target and each-target templates.',
    targetCount: 500,
    patterns: [
      /tap target/i,
      /untap target/i,
      /tap up to/i,
      /untap up to/i,
      /tap each /i,
      /untap each /i,
    ],
  },
  {
    id: 'counterspell',
    title: 'Counterspell And Stack Interaction',
    category: 'High-Population Follow-On Seams',
    notes: 'Queue for explicit spell/ability countering and related stack-target clauses.',
    targetCount: 400,
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
    category: 'High-Population Follow-On Seams',
    notes: 'Smaller but clean seam for library-to-graveyard movement and count scaling.',
    targetCount: 300,
    patterns: [
      /\bmill (?:a|one|two|three|four|five|x|that many) cards?/i,
      /mills? .* cards?/i,
    ],
  },
  {
    id: 'impulse_exile_permission',
    title: 'Impulse Exile Permission Windows',
    category: 'High-Population Follow-On Seams',
    notes: 'Natural next seam after graveyard and cast-from-zone work; high visibility in actual gameplay and already partially automated.',
    targetCount: 500,
    patterns: [
      /exile the top .* you may (?:play|cast)/i,
      /until the end of .* you may (?:play|cast) .* exiled/i,
      /for as long as .* remains exiled, you may (?:play|cast)/i,
      /you may (?:play|cast) the exiled card/i,
    ],
  },
  {
    id: 'fight_and_similar',
    title: 'Fight And Bite-Style Combat Resolution',
    category: 'High-Population Follow-On Seams',
    notes: 'Smaller seam, but useful for concrete combat-automation expansion after damage families are mined.',
    targetCount: 150,
    patterns: [
      /\bfight target/i,
      /\bfights target/i,
      /deals damage equal to its power to target creature/i,
    ],
  },
  {
    id: 'goad_and_attacking_pressure',
    title: 'Goad And Attack-Pressure Effects',
    category: 'High-Population Follow-On Seams',
    notes: 'Included as a modest spillover seam once higher-volume deterministic text families are exhausted.',
    targetCount: 120,
    patterns: [
      /\bgoad target/i,
      /\bgoad each/i,
      /attacks each combat if able/i,
      /can't attack you or planeswalkers you control/i,
    ],
  },
];

function buildFamilyMatches(cards, config) {
  const matches = [];
  for (const card of cards) {
    const oracleText = normalizeText(card.oracle_text);
    if (!oracleText) continue;
    if (!config.patterns.some(pattern => pattern.test(oracleText))) continue;

    matches.push({
      card,
      clause: extractClause(card, config.patterns),
    });
  }

  return sortCards(matches.map(entry => entry.card)).map(card => ({
    card,
    clause: extractClause(card, config.patterns),
  }));
}

function buildQueue(cards, targetQueueSize) {
  const seenOracleIds = new Set();
  const queue = [];
  const familySummaries = [];

  for (const config of familyConfigs) {
    const matches = buildFamilyMatches(cards, config);
    let queuedForFamily = 0;

    for (const match of matches) {
      const oracleId = String(match.card.oracle_id || match.card.id || match.card.name);
      if (seenOracleIds.has(oracleId)) continue;
      if (queuedForFamily >= config.targetCount) break;
      if (queue.length >= targetQueueSize) break;

      seenOracleIds.add(oracleId);
      queuedForFamily++;
      queue.push({
        queueIndex: queue.length + 1,
        familyId: config.id,
        familyTitle: config.title,
        category: config.category,
        notes: config.notes,
        name: String(match.card.name || ''),
        oracleId,
        edhrecRank: Number.isFinite(Number(match.card.edhrec_rank)) ? Number(match.card.edhrec_rank) : null,
        typeLine: String(match.card.type_line || ''),
        clause: match.clause,
      });
    }

    familySummaries.push({
      id: config.id,
      title: config.title,
      category: config.category,
      targetCount: config.targetCount,
      queuedCount: queuedForFamily,
      availableCount: matches.length,
      notes: config.notes,
    });
  }

  if (queue.length < targetQueueSize) {
    const overflowPool = [];
    for (const config of familyConfigs) {
      const matches = buildFamilyMatches(cards, config);
      for (const match of matches) {
        overflowPool.push({
          config,
          match,
        });
      }
    }

    overflowPool.sort((a, b) => {
      const rankA = Number.isFinite(Number(a.match.card.edhrec_rank)) ? Number(a.match.card.edhrec_rank) : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(Number(b.match.card.edhrec_rank)) ? Number(b.match.card.edhrec_rank) : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return String(a.match.card.name || '').localeCompare(String(b.match.card.name || ''));
    });

    for (const { config, match } of overflowPool) {
      if (queue.length >= targetQueueSize) break;
      const oracleId = String(match.card.oracle_id || match.card.id || match.card.name);
      if (seenOracleIds.has(oracleId)) continue;
      seenOracleIds.add(oracleId);
      queue.push({
        queueIndex: queue.length + 1,
        familyId: config.id,
        familyTitle: `${config.title} (Overflow)`,
        category: config.category,
        notes: config.notes,
        name: String(match.card.name || ''),
        oracleId,
        edhrecRank: Number.isFinite(Number(match.card.edhrec_rank)) ? Number(match.card.edhrec_rank) : null,
        typeLine: String(match.card.type_line || ''),
        clause: match.clause,
      });
    }
  }

  return { queue, familySummaries };
}

function renderMarkdown(report) {
  const generatedAt = new Date().toISOString();
  const lines = [
    `# Oracle Automation Next ${report.targetQueueSize}`,
    '',
    `Generated: \`${generatedAt}\``,
    'Source: `oracle-cards.json`',
    'Scope: black-border paper-card automation candidates ordered by seam priority. The queue exhausts the active graveyard / recursion seam first, then spills into the next highest-population seams.',
    '',
    `Queued items: \`${report.queue.length}\``,
    '',
    '## Queue Rules',
    '',
    '- Ordered by family priority first, then by EDHREC rank, then by card name.',
    '- Cards are deduped by `oracle_id`, so multi-print duplicates do not crowd out breadth.',
    '- This queue is intentionally seam-priority driven: graveyard/recursion work comes first, then the generator rolls into broader high-population seams like token creation, direct damage, draw, sacrifice, counters, and search effects.',
    '- Nim Deathmantle-style payment + return + attach recursion is explicitly kept in the queue even when the family is small.',
    '',
    '## Family Summary',
    '',
    '| Family | Category | Queued | Available | Notes |',
    '|---|---|---:|---:|---|',
    ...report.familySummaries.map(
      family =>
        `| ${family.title} | ${family.category} | ${family.queuedCount} | ${family.availableCount} | ${family.notes.replace(/\|/g, '\\|')} |`
    ),
    '',
    '## Ordered Queue',
    '',
  ];

  let currentFamily = '';
  for (const item of report.queue) {
    if (item.familyTitle !== currentFamily) {
      currentFamily = item.familyTitle;
      lines.push(`### ${currentFamily}`);
      lines.push('');
    }

    const rankText = item.edhrecRank === null ? 'unranked' : `EDHREC ${item.edhrecRank}`;
    lines.push(
      `${item.queueIndex}. ${item.name} (${rankText}) - ${item.clause}`
    );
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(`- Regenerate this file with \`node tools/build-next-automation-queue.js --count ${report.targetQueueSize}\` whenever the corpus or family priorities change.`);
  lines.push('- If product scope widens beyond graveyard-heavy seams, add new family configs rather than manually editing the queue body.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { outputJsonPath, outputMarkdownPath } = resolveOutputPaths(args);
  const cards = dedupeCards(readOracleCards().filter(isQueueEligible));
  const { queue, familySummaries } = buildQueue(cards, args.count);
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'oracle-cards.json',
    targetQueueSize: args.count,
    actualQueueSize: queue.length,
    familySummaries,
    queue,
  };

  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(outputMarkdownPath, renderMarkdown(report));

  console.log(`Wrote ${queue.length} queued items to ${path.relative(repoRoot, outputMarkdownPath)} and ${path.relative(repoRoot, outputJsonPath)}.`);
}

main();
