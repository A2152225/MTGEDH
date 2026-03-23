/*
 * Builds a corpus-grounded audit for sacrifice-related oracle text against the
 * current effect parser + sacrifice executor scope.
 *
 * Usage:
 *   node tools/audit-sacrifice-executor-coverage.js
 *
 * Output:
 *   tools/sacrifice-executor-coverage.json
 *   docs/sacrifice-executor-coverage.md
 */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');
const atomicIndexPath = path.join(repoRoot, 'tools', 'atomic-oracle-index.json');
const atomicCardsPath = path.join(repoRoot, 'AtomicCards.json');
const outputJsonPath = path.join(repoRoot, 'tools', 'sacrifice-executor-coverage.json');
const outputMarkdownPath = path.join(repoRoot, 'docs', 'sacrifice-executor-coverage.md');
const SAMPLE_LIMIT = Math.max(1, Number.parseInt(process.env.SACRIFICE_AUDIT_SAMPLE_LIMIT || '25', 10) || 25);

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[â€™’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeObjectText(value) {
  return normalizeText(value)
    .replace(/^[,;:\s]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim()
    .toLowerCase();
}

function parseSimplePermanentTypeFromText(text) {
  const lower = normalizeObjectText(text);
  if (!lower) return null;
  if (/\bnonland\s+permanent(s)?\b/i.test(lower)) return 'nonland_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\bpermanent(s)?\b/i.test(lower)) return 'permanent';
  return null;
}

function parseSacrificeWhat(objectText) {
  const cleaned = normalizeObjectText(objectText);
  if (!cleaned) return null;

  {
    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['"]s?\s+/i.test(cleaned) ||
      /^opponent['"]s?\s+/i.test(cleaned) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(cleaned) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(cleaned) ||
      /\byou\s+(?:don't|do not)\s+control\b/i.test(cleaned);

    if (!mentionsOpponentControl && (/^your\s+/i.test(cleaned) || /\b(?:you control|under your control)\b/i.test(cleaned))) {
      const stripped = cleaned
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
    }
  }

  if (/^all\b/i.test(cleaned)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    return type ? { mode: 'all', type } : null;
  }

  const mCount = cleaned.match(/^(a|an|\d+)\s+(.+)$/i);
  if (!mCount) return null;
  const countRaw = String(mCount[1] || '').toLowerCase();
  const rest = String(mCount[2] || '').trim();
  const count = countRaw === 'a' || countRaw === 'an' ? 1 : parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const type = parseSimplePermanentTypeFromText(rest);
  if (!type) return null;
  return { mode: 'count', count: Math.max(1, count | 0), type };
}

function classifySacrificeText(clause) {
  const normalized = normalizeText(clause);
  let working = normalized;
  if (!/\bsacrific(?:e|es|ed|ing)\b/i.test(normalized)) return null;

  if (/\s+—\s+/.test(working)) {
    const tail = working.split(/\s+—\s+/).slice(-1)[0];
    if (/\bsacrific(?:e|es|ed|ing)\b/i.test(tail)) {
      working = tail.trim();
    }
  }

  const loyaltyTail = working.match(/^[^:]+:\s*(.+)$/);
  if (loyaltyTail && /\bsacrific(?:e|es|ed|ing)\b/i.test(loyaltyTail[1])) {
    working = String(loyaltyTail[1] || '').trim();
  }

  if (/^(?:then|and)\s+/i.test(working)) {
    working = working.replace(/^(?:then|and)\s+/i, '').trim();
  }

  const lower = working.toLowerCase();

  if (
    /\bdidn't sacrifice\b/i.test(normalized) ||
    /\bdid not sacrifice\b/i.test(normalized) ||
    /\bthe sacrificed\b/i.test(normalized) ||
    /\bsacrificed creature'?s\b/i.test(normalized) ||
    /\bsacrificed artifact'?s\b/i.test(normalized)
  ) {
    return {
      bucket: 'other_sacrifice_text',
      objectText: null,
      parsed: null,
      choiceLikely: false,
    };
  }

  const colonIndex = working.indexOf(':');
  const sacrificeIndex = lower.search(/\bsacrific(?:e|es)\b/);
  const sacrificeBeforeColon = colonIndex >= 0 && sacrificeIndex >= 0 && sacrificeIndex < colonIndex;

  const isAdditionalCostOrKeyword =
    sacrificeBeforeColon ||
    /\bas an additional cost\b/i.test(working) ||
    /\brather than pay\b/i.test(working) ||
    /\bas you cast this spell\b/i.test(working) ||
    /\bsacrifice\s+after\s+[ivx]+\b/i.test(lower) ||
    /^[a-z0-9'" -]+\s*\([^)]*\bsacrific(?:e|es)\b/i.test(lower) ||
    /^(?:kicker|bargain|casualty|buyback|conspire|flashback|emerge|offering|cleave|multikicker|exploit)\b/i.test(lower) ||
    /^\([^)]*\bsacrific(?:e|es)\b/i.test(working);

  if (isAdditionalCostOrKeyword) {
    return {
      bucket: 'additional_cost_or_keyword',
      objectText: null,
      parsed: null,
      choiceLikely: false,
    };
  }

  if (/^(?:when|whenever|if|at)\b/i.test(working) && working.includes(',')) {
    working = working.slice(working.indexOf(',') + 1).trim();
  } 

  const subjectPattern = '(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*[\'’]s (?:controller|owner)|any opponent)';
  const subjectSupportedPattern = new RegExp(`^(?:${subjectPattern})$`, 'i');

  const effectMatch =
    working.match(new RegExp(`^(?:${subjectPattern}\\s+)?(?:may\\s+)?sacrific(?:e|es)\\s+(.+)$`, 'i')) ||
    working.match(/^sacrifice\s+(.+)$/i);

  if (!effectMatch) {
    return {
      bucket: 'other_sacrifice_text',
      objectText: null,
      parsed: null,
      choiceLikely: false,
    };
  }

  const subjectMatch = working.match(new RegExp(`^(${subjectPattern})\\s+`, 'i'));
  const subject = subjectMatch ? String(subjectMatch[1] || '').trim() : 'you';
  const subjectSupported = subjectSupportedPattern.test(subject) && !/^any opponent$/i.test(subject);
  const objectCapture = effectMatch[effectMatch.length - 1];
  const objectText = normalizeObjectText(String(objectCapture || '').split(':')[0] || '');
  const choiceLikely =
    /\bof (?:their|his or her|that player's|that opponent's) choice\b/i.test(objectText) ||
    /\bchosen\b/i.test(objectText) ||
    /\brandom\b/i.test(objectText);
  const parsed = parseSacrificeWhat(objectText);

  if (parsed && !choiceLikely && subjectSupported) {
    return {
      bucket: 'effect_supported',
      objectText,
      parsed,
      choiceLikely,
    };
  }

  return {
    bucket: choiceLikely ? 'effect_choice_or_gap' : 'effect_gap',
    objectText,
    parsed,
    choiceLikely,
  };
}

function splitIntoClauses(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const pieces = normalized
    .split(/\n+/)
    .flatMap(part => part.split(/(?<=[.?!])\s+/))
    .map(part => normalizeText(part))
    .filter(Boolean);
  return pieces;
}

function loadOracleCardsRows() {
  if (!fs.existsSync(oracleCardsPath)) return [];
  const raw = fs.readFileSync(oracleCardsPath, 'utf8');
  const cards = JSON.parse(raw);
  if (!Array.isArray(cards)) return [];
  return cards.map(card => ({
    source: 'oracle-cards',
    name: String(card?.name || '').trim(),
    oracleId: String(card?.oracle_id || '').trim(),
    text: String(card?.oracle_text || ''),
  }));
}

function loadAtomicRowsFromIndex() {
  if (!fs.existsSync(atomicIndexPath)) return null;
  const raw = fs.readFileSync(atomicIndexPath, 'utf8');
  const index = JSON.parse(raw);
  const byOracleId = index?.byOracleId;
  if (!byOracleId || typeof byOracleId !== 'object') return null;
  return Object.entries(byOracleId).map(([oracleId, entry]) => ({
    source: 'atomic-index',
    name: Array.isArray(entry?.names) && entry.names.length > 0 ? String(entry.names[0]) : String(oracleId),
    oracleId: String(oracleId),
    text: String(entry?.oracleText || ''),
  }));
}

function pickBestPrinting(printings) {
  if (!Array.isArray(printings) || printings.length === 0) return undefined;
  const withText = printings.find(printing => typeof printing?.text === 'string' && printing.text.trim().length > 0);
  return withText || printings[0];
}

function loadAtomicRowsFromRaw() {
  if (!fs.existsSync(atomicCardsPath)) return [];
  const raw = fs.readFileSync(atomicCardsPath, 'utf8');
  const atomic = JSON.parse(raw);
  const data = atomic?.data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([name, printings]) => {
    const best = pickBestPrinting(printings);
    return {
      source: 'AtomicCards',
      name: String(name),
      oracleId: String(best?.identifiers?.scryfallOracleId || `name:${normalizeText(name).toLowerCase()}`),
      text: String(best?.text || ''),
    };
  });
}

function loadRows() {
  const oracleRows = loadOracleCardsRows();
  const atomicRows = loadAtomicRowsFromIndex() || loadAtomicRowsFromRaw();
  return [...oracleRows, ...atomicRows];
}

function pushSample(target, item) {
  if (target.length < SAMPLE_LIMIT) {
    target.push(item);
  }
}

function toCardSample(hit) {
  return {
    name: hit.name,
    oracleId: hit.oracleId || 'n/a',
    source: hit.source,
    clause: hit.clause,
    objectText: hit.objectText || null,
    parsed: hit.parsed || null,
  };
}

function main() {
  const rows = loadRows();
  const seenClauseKeys = new Set();
  const supported = [];
  const choiceOrGap = [];
  const gaps = [];
  const additionalCostOrKeyword = [];
  const otherSacrificeText = [];
  const impactedCards = new Map();
  const unsupportedObjectCounts = new Map();

  let sourceRowCount = 0;
  let distinctSacrificeClauses = 0;

  for (const row of rows) {
    sourceRowCount++;
    const clauses = splitIntoClauses(row.text);
    for (const clause of clauses) {
      if (!/\bsacrific(?:e|es|ed|ing)\b/i.test(clause)) continue;

      const key = `${row.oracleId}::${normalizeText(clause)}`;
      if (seenClauseKeys.has(key)) continue;
      seenClauseKeys.add(key);
      distinctSacrificeClauses++;

      const classified = classifySacrificeText(clause);
      if (!classified) continue;

      const hit = {
        name: row.name,
        oracleId: row.oracleId,
        source: row.source,
        clause: normalizeText(clause),
        objectText: classified.objectText,
        parsed: classified.parsed,
      };

      if (classified.bucket === 'effect_supported') {
        pushSample(supported, toCardSample(hit));
        impactedCards.set(`${row.oracleId}::${row.name}`, {
          name: row.name,
          oracleId: row.oracleId,
          source: row.source,
          clause: hit.clause,
          objectText: hit.objectText,
          parsed: hit.parsed,
        });
        continue;
      }

      if (classified.bucket === 'effect_choice_or_gap') {
        pushSample(choiceOrGap, toCardSample(hit));
        if (hit.objectText) {
          unsupportedObjectCounts.set(hit.objectText, (unsupportedObjectCounts.get(hit.objectText) || 0) + 1);
        }
        continue;
      }

      if (classified.bucket === 'effect_gap') {
        pushSample(gaps, toCardSample(hit));
        if (hit.objectText) {
          unsupportedObjectCounts.set(hit.objectText, (unsupportedObjectCounts.get(hit.objectText) || 0) + 1);
        }
        continue;
      }

      if (classified.bucket === 'additional_cost_or_keyword') {
        pushSample(additionalCostOrKeyword, toCardSample(hit));
        continue;
      }

      pushSample(otherSacrificeText, toCardSample(hit));
    }
  }

  const impactedCardList = [...impactedCards.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(card => ({
      name: card.name,
      oracleId: card.oracleId,
      source: card.source,
      clause: card.clause,
      objectText: card.objectText,
      parsed: card.parsed,
    }));

  const unsupportedObjects = [...unsupportedObjectCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([objectText, count]) => ({ objectText, count }));

  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      oracleCardsPath: fs.existsSync(oracleCardsPath) ? oracleCardsPath : null,
      atomicIndexPath: fs.existsSync(atomicIndexPath) ? atomicIndexPath : null,
      atomicCardsPath: fs.existsSync(atomicCardsPath) ? atomicCardsPath : null,
    },
    summary: {
      sourceRowCount,
      distinctSacrificeClauses,
      impactedSupportedEffectCards: impactedCardList.length,
      supportedEffectClauseSamples: supported.length,
      choiceOrGapClauseSamples: choiceOrGap.length,
      unsupportedEffectClauseSamples: gaps.length,
      additionalCostOrKeywordClauseSamples: additionalCostOrKeyword.length,
      otherSacrificeTextClauseSamples: otherSacrificeText.length,
    },
    buckets: {
      supportedEffectCards: impactedCardList,
      supportedEffectSamples: supported,
      choiceOrGapSamples: choiceOrGap,
      unsupportedEffectSamples: gaps,
      additionalCostOrKeywordSamples: additionalCostOrKeyword,
      otherSacrificeTextSamples: otherSacrificeText,
    },
    unsupportedObjectPhrases: unsupportedObjects,
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2));

  const markdown = [
    '# Sacrifice Executor Coverage Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Distinct sacrifice-related clauses scanned: ${report.summary.distinctSacrificeClauses}`,
    `- Supported effect cards matching the current sacrifice executor shape: ${report.summary.impactedSupportedEffectCards}`,
    `- Sample supported effect clauses captured: ${report.summary.supportedEffectClauseSamples}`,
    `- Sample effect clauses that still imply player choice or executor gaps: ${report.summary.choiceOrGapClauseSamples + report.summary.unsupportedEffectClauseSamples}`,
    `- Sample sacrifice clauses classified as additional-cost or keyword surfaces: ${report.summary.additionalCostOrKeywordClauseSamples}`,
    '',
    '## Migration Notes',
    '',
    '- Treat `supportedEffectCards` in the JSON report as the first-pass compatibility set when refactoring sacrifice handling.',
    '- Treat `choiceOrGapSamples` and `unsupportedEffectSamples` as the safest backlog for extending sacrifice coverage without broad regressions.',
    '- Treat `additionalCostOrKeywordSamples` as adjacent sacrifice wording that likely belongs to cost or keyword handling, not the standalone `sacrifice` executor step.',
    '',
    '## Sample Supported Cards',
    '',
    ...supported.slice(0, 20).map(sample => `- ${sample.name}: ${sample.clause}`),
    '',
    '## Top Unsupported Object Phrases',
    '',
    ...unsupportedObjects.slice(0, 20).map(item => `- \`${item.objectText}\`: ${item.count}`),
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputMarkdownPath, markdown);

  console.log(`Wrote ${outputJsonPath}`);
  console.log(`Wrote ${outputMarkdownPath}`);
  console.log(`Supported effect cards: ${report.summary.impactedSupportedEffectCards}`);
}

main();
