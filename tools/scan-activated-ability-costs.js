#!/usr/bin/env node
/* eslint-disable no-console */

// Streaming scan of Scryfall oracle-cards.json (and optionally MTGJSON AtomicCards.json)
// to find common activated-ability cost patterns.
//
// Usage:
//   node tools/scan-activated-ability-costs.js --oracle oracle-cards.json
//   node tools/scan-activated-ability-costs.js --oracle oracle-cards.json --atomic AtomicCards.json
//   node tools/scan-activated-ability-costs.js --oracle oracle-cards.json --out tools/activated-ability-costs-report.json

const fs = require('node:fs');
const path = require('node:path');

const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { streamObject } = require('stream-json/streamers/StreamObject');

function parseArgs(argv) {
  const args = {
    oracle: null,
    atomic: null,
    out: null,
    maxCards: 0,
    includeNonBattlefieldZones: false,
    includeNonPermanents: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === '--oracle') {
      args.oracle = next;
      i += 1;
    } else if (a === '--atomic') {
      args.atomic = next;
      i += 1;
    } else if (a === '--out') {
      args.out = next;
      i += 1;
    } else if (a === '--max-cards') {
      args.maxCards = Number(next || '0') || 0;
      i += 1;
    } else if (a === '--include-nonbattlefield') {
      args.includeNonBattlefieldZones = true;
    } else if (a === '--include-nonpermanents') {
      args.includeNonPermanents = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }

  return args;
}

function normalizeLine(line) {
  return String(line || '')
    .replace(/\r/g, '')
    .trim();
}

function isPermanentTypeLine(typeLine) {
  const t = String(typeLine || '');
  if (!t) return false;

  // Scryfall uses type_line like "Artifact Creature — ..."
  // We treat these as battlefield permanents.
  const permanentWords = ['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Battle'];
  const nonPermanentWords = ['Instant', 'Sorcery'];

  if (nonPermanentWords.some((w) => t.includes(w))) return false;
  return permanentWords.some((w) => t.includes(w));
}

function looksLikeActivatedAbilityLine(line) {
  // Heuristic: Activated abilities are typically "<cost>: <effect>".
  // Avoid "Landfall —" and other ability words.
  const l = normalizeLine(line);
  if (!l) return false;
  if (!l.includes(':')) return false;

  // Must have something before ':' that resembles a cost.
  const idx = l.indexOf(':');
  if (idx <= 0) return false;

  const costPart = l.slice(0, idx);

  // Exclude common false positives
  if (/^\s*Illustration by\b/i.test(costPart)) return false;
  if (/^\s*Reminder text\b/i.test(costPart)) return false;

  // Typical costs involve mana symbols, tap/untap, or action verbs.
  if (/[{][^}]+[}]/.test(costPart)) return true;
  if (/\b(Tap|Untap|Discard|Sacrifice|Pay|Remove|Exile|Return|Reveal)\b/i.test(costPart)) return true;

  return false;
}

function categorizeCost(costPartRaw) {
  const costPart = String(costPartRaw || '');

  const categories = new Set();
  const manaSymbols = new Set();

  const allSymbols = costPart.match(/\{[^}]+\}/g) || [];
  for (const sym of allSymbols) {
    manaSymbols.add(sym);
  }

  const hasT = allSymbols.includes('{T}') || /\{T\}/.test(costPart);
  const hasQ = allSymbols.includes('{Q}') || /\{Q\}/.test(costPart);
  if (hasT) categories.add('tap_self_{T}');
  if (hasQ) categories.add('untap_symbol_{Q}');

  if (/\bPay\s+(\d+|X)\s+life\b/i.test(costPart)) categories.add('pay_life');
  if (/\bDiscard\b/i.test(costPart)) categories.add('discard');

  if (/\bSacrifice\b/i.test(costPart)) {
    if (/\bSacrifice\s+(this|~)\b/i.test(costPart)) categories.add('sacrifice_self');
    else categories.add('sacrifice_other');
  }

  if (/\bRemove\b/i.test(costPart) && /\bcounter\b/i.test(costPart)) categories.add('remove_counters');
  if (/\bExile\b/i.test(costPart) && /\bgraveyard\b/i.test(costPart)) categories.add('exile_from_graveyard_as_cost');
  if (/\bReturn\b/i.test(costPart) && /\byou control\b/i.test(costPart)) categories.add('return_permanent_you_control_as_cost');
  if (/\bReveal\b/i.test(costPart)) categories.add('reveal_as_cost');

  if (/\bTap\b/i.test(costPart) && !hasT) {
    // e.g. "Tap an untapped Wizard you control".
    categories.add('tap_other_as_cost');
    if (/\buntapped\b/i.test(costPart)) categories.add('tap_untapped_you_control');
  }

  // Mana details
  const manaOnlySymbols = allSymbols.filter((s) => s !== '{T}' && s !== '{Q}');
  if (manaOnlySymbols.length > 0) {
    categories.add('mana_in_cost');

    if (manaOnlySymbols.some((s) => /\/[WUBRGC]/.test(s))) categories.add('hybrid_mana');
    if (manaOnlySymbols.some((s) => /\{[WUBRG]\/P\}/.test(s))) categories.add('phyrexian_mana');
    if (manaOnlySymbols.some((s) => /\{S\}/.test(s))) categories.add('snow_mana');
    if (manaOnlySymbols.some((s) => /\{C\}/.test(s))) categories.add('colorless_mana_symbol_{C}');
    if (manaOnlySymbols.some((s) => /\{X\}/.test(s))) categories.add('x_in_cost');
    if (manaOnlySymbols.some((s) => /\{E\}/.test(s))) categories.add('energy_symbol_{E}');
  }

  // If it has only mana (and optionally {T}/{Q}), capture that explicitly.
  if (categories.has('mana_in_cost') && categories.size === 1) categories.add('cost_is_only_mana');

  return {
    categories: Array.from(categories).sort(),
    manaSymbols: Array.from(manaSymbols).sort(),
  };
}

function categorizeRestrictions(fullOracleText) {
  const t = String(fullOracleText || '');
  const categories = new Set();

  if (/Activate only as a sorcery\./i.test(t) || /Activate only any time you could cast a sorcery\./i.test(t)) {
    categories.add('activate_only_as_sorcery');
  }
  if (/Activate only once each turn\./i.test(t) || /Activate this ability only once each turn\./i.test(t)) {
    categories.add('activate_once_each_turn');
  }
  if (/Activate only during your turn\./i.test(t) || /Activate this ability only during your turn\./i.test(t)) {
    categories.add('activate_only_during_your_turn');
  }

  return Array.from(categories).sort();
}

function addExample(map, key, example) {
  if (!map[key]) map[key] = [];
  if (map[key].includes(example)) return;
  if (map[key].length >= 12) return;
  map[key].push(example);
}

function bumpCount(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function makeReportSkeleton() {
  return {
    scanned: {
      oracleCards: 0,
      atomicCards: 0,
      permanentCardsConsidered: 0,
      activatedAbilityLines: 0,
      activatedAbilityLinesWithTargets: 0,
    },
    costCategoryCounts: {},
    costCategoryExamples: {},
    restrictionCounts: {},
    restrictionExamples: {},
    comboCounts: {},
    comboExamples: {},
    rawExamples: {
      // For debugging: a few full lines.
      activatedLines: [],
    },
  };
}

function registerActivatedLine(report, cardName, typeLine, oracleText, line) {
  report.scanned.activatedAbilityLines += 1;

  const idx = line.indexOf(':');
  const costPart = line.slice(0, idx).trim();
  const effectPart = line.slice(idx + 1).trim();

  const costInfo = categorizeCost(costPart);
  const restrictions = categorizeRestrictions(oracleText);

  const hasTargets = /\btarget\b/i.test(effectPart);
  if (hasTargets) report.scanned.activatedAbilityLinesWithTargets += 1;

  const label = `${cardName} — ${typeLine}`;

  // Per-category
  for (const c of costInfo.categories) {
    bumpCount(report.costCategoryCounts, c);
    addExample(report.costCategoryExamples, c, label);
  }

  // Restrictions are card-level; count them once per activated line to weight by prevalence.
  for (const r of restrictions) {
    bumpCount(report.restrictionCounts, r);
    addExample(report.restrictionExamples, r, label);
  }

  // Combo key for prioritization
  const comboKey = costInfo.categories.join(' + ') || '(uncategorized)';
  bumpCount(report.comboCounts, comboKey);
  addExample(report.comboExamples, comboKey, label);

  if (report.rawExamples.activatedLines.length < 25) {
    report.rawExamples.activatedLines.push({
      card: cardName,
      typeLine,
      costPart,
      effectPart,
      categories: costInfo.categories,
      restrictions,
      fullLine: line,
    });
  }
}

async function scanOracleCards(oraclePath, args, report) {
  return new Promise((resolve, reject) => {
    const absolute = path.resolve(oraclePath);
    if (!fs.existsSync(absolute)) {
      reject(new Error(`oracle file not found: ${absolute}`));
      return;
    }

    const pipeline = chain([
      fs.createReadStream(absolute, { encoding: 'utf8' }),
      parser(),
      streamArray(),
    ]);

    pipeline.on('data', (data) => {
      const card = data?.value;
      if (!card || typeof card !== 'object') return;

      report.scanned.oracleCards += 1;
      if (args.maxCards > 0 && report.scanned.oracleCards > args.maxCards) {
        pipeline.destroy();
        return;
      }

      const name = card.name;
      const typeLine = card.type_line;
      const oracleText = card.oracle_text;

      if (!name || !oracleText) return;

      if (!args.includeNonPermanents && !isPermanentTypeLine(typeLine)) return;
      report.scanned.permanentCardsConsidered += 1;

      // By default, try to focus on battlefield-relevant activations.
      // Exclude lines that clearly say they function in hand/graveyard if requested.
      const nonBattlefieldZoneHint = /\b(Channel|Cycling|Swampcycling|Plainscycling|Forestcycling|Mountaincycling|Islandcycling|Basic landcycling|Bloodrush|Transmute|Forecast|Ninjutsu|Encore|Scavenge|Embalm|Eternalize|Reinforce)\b/i;
      const lines = String(oracleText).split('\n').map(normalizeLine).filter(Boolean);

      for (const line of lines) {
        if (!looksLikeActivatedAbilityLine(line)) continue;

        if (!args.includeNonBattlefieldZones && nonBattlefieldZoneHint.test(line)) {
          // Many of these are activated abilities but not battlefield activations.
          continue;
        }

        registerActivatedLine(report, name, typeLine || '', oracleText, line);
      }
    });

    pipeline.on('error', reject);
    pipeline.on('end', resolve);
    pipeline.on('close', resolve);
  });
}

async function scanAtomicCards(atomicPath, args, report) {
  return new Promise((resolve, reject) => {
    const absolute = path.resolve(atomicPath);
    if (!fs.existsSync(absolute)) {
      reject(new Error(`atomic file not found: ${absolute}`));
      return;
    }

    const seenNameText = new Set();

    const pipeline = chain([
      fs.createReadStream(absolute, { encoding: 'utf8' }),
      parser(),
      pick({ filter: 'data' }),
      streamObject(),
    ]);

    pipeline.on('data', (data) => {
      // data = { key: cardName, value: printings[] }
      const cardName = data?.key;
      const printings = data?.value;
      if (!cardName || !Array.isArray(printings)) return;

      // Pick first printing that has text and type
      for (const printing of printings) {
        const typeLine = printing?.type;
        const text = printing?.text;
        if (!text || !typeLine) continue;

        if (!args.includeNonPermanents) {
          // AtomicCards uses lower-cased sometimes ("instant")
          const tl = String(typeLine);
          if (/\b(instant|sorcery)\b/i.test(tl)) continue;
        }

        const key = `${cardName}::${text}`;
        if (seenNameText.has(key)) continue;
        seenNameText.add(key);

        report.scanned.atomicCards += 1;

        const lines = String(text).split(/\n/).map(normalizeLine).filter(Boolean);
        for (const line of lines) {
          if (!looksLikeActivatedAbilityLine(line)) continue;

          // Atomic text lacks the full oracle; use the line as "oracleText" for restrictions.
          registerActivatedLine(report, cardName, typeLine, text, line);
        }

        break;
      }
    });

    pipeline.on('error', reject);
    pipeline.on('end', resolve);
    pipeline.on('close', resolve);
  });
}

function sortCountsDesc(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.oracle && !args.atomic) {
    console.error('Provide at least one input: --oracle <path> and/or --atomic <path>');
    process.exit(2);
  }

  const report = makeReportSkeleton();

  if (args.oracle) {
    console.log(`[scan] oracle: ${args.oracle}`);
    await scanOracleCards(args.oracle, args, report);
  }

  if (args.atomic) {
    console.log(`[scan] atomic: ${args.atomic}`);
    await scanAtomicCards(args.atomic, args, report);
  }

  report.costCategoryCounts = sortCountsDesc(report.costCategoryCounts);
  report.restrictionCounts = sortCountsDesc(report.restrictionCounts);
  report.comboCounts = Object.entries(report.comboCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

  const json = JSON.stringify(report, null, 2);

  if (args.out) {
    const outAbs = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, json, 'utf8');
    console.log(`[scan] wrote: ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
