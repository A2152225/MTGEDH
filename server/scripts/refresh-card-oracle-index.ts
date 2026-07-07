import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

type RefreshPair = {
  readonly source: string;
  readonly target: string;
};

const refreshPairs: RefreshPair[] = [
  { source: 'oracle-cards-20260629210229.jsonl', target: 'oracle-cards.jsonl' },
  { source: 'oracle-cards-20260629210229.json', target: 'oracle-cards.json' },
  { source: 'AtomicCards (2).json', target: 'AtomicCards.json' },
  { source: 'rulings-20260629210037.json', target: 'rulings.json' },
];

function copyIfNewer(sourceName: string, targetName: string): void {
  const sourcePath = path.join(repoRoot, sourceName);
  const targetPath = path.join(repoRoot, targetName);

  if (!fs.existsSync(sourcePath)) {
    console.log(`[skip] ${sourceName} not found`);
    return;
  }

  const sourceStat = fs.statSync(sourcePath);
  const targetExists = fs.existsSync(targetPath);
  const targetStat = targetExists ? fs.statSync(targetPath) : null;
  const shouldCopy = !targetExists
    || sourceStat.mtimeMs > (targetStat?.mtimeMs ?? 0)
    || sourceStat.size !== (targetStat?.size ?? -1);

  if (!shouldCopy) {
    console.log(`[skip] ${targetName} already up to date`);
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[copy] ${sourceName} -> ${targetName}`);
}

for (const pair of refreshPairs) {
  copyIfNewer(pair.source, pair.target);
}

const rulesSource = path.join(repoRoot, 'MagicCompRules 20260619.txt');
const rulesTargetDir = path.join(repoRoot, 'docs', 'rules');
const rulesTarget = path.join(rulesTargetDir, 'MagicCompRules_20260619.txt');
if (fs.existsSync(rulesSource)) {
  if (!fs.existsSync(rulesTargetDir)) {
    fs.mkdirSync(rulesTargetDir, { recursive: true });
  }
  copyIfNewer('MagicCompRules 20260619.txt', path.relative(repoRoot, rulesTarget));
}

console.log('Rebuilding local card lookup database...');
ensureLocalCardLookupIndexSync({
  onStatus: ({ phase, message }) => {
    console.log(`[${phase}] ${message}`);
  },
});
console.log('Card oracle index refresh complete.');
