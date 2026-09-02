const fs = require('fs');

function writeUtf8NoBom(filePath, text) {
  fs.writeFileSync(filePath, text, { encoding: 'utf8' });
}

function readUtf8(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

function assertNoBom(filePath) {
  const b = fs.readFileSync(filePath);
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    throw new Error('BOM written: ' + filePath);
  }
}

const crlf = '\r\n';
const helperPath = 'D:/Git/MTGEDH/client/src/utils/deckAccess.ts';
const helperLines = [
  "import type { AuthUser } from './authApi';",
  '',
  '/** Admin may mutate any server deck; otherwise only the owner. */',
  'export function canMutateDeck(',
  '  deck: { created_by_id?: string | null },',
  '  accountUser?: AuthUser | null,',
  '): boolean {',
  '  if (!accountUser) return false;',
  '  if (accountUser.isAdmin) return true;',
  '  return !!accountUser.id && deck.created_by_id === accountUser.id;',
  '}',
  '',
];
writeUtf8NoBom(helperPath, helperLines.join(crlf));
assertNoBom(helperPath);

const modalPath = 'D:/Git/MTGEDH/client/src/components/DeckManagerModal.tsx';
let modal = readUtf8(modalPath);
const nl = modal.includes('\r\n') ? '\r\n' : '\n';

const importNeedle = "import type { AuthUser } from '../utils/authApi';";
const importInsert = "import type { AuthUser } from '../utils/authApi';" + nl + "import { canMutateDeck } from '../utils/deckAccess';";
if (!modal.includes(importNeedle)) throw new Error('import needle missing');
if (modal.includes("from '../utils/deckAccess'")) {
  console.log('import already present');
} else {
  modal = modal.replace(importNeedle, importInsert);
}

const oldFn = [
  '  const canEditServerDeck = (deck: SavedDeckSummary) =>',
  '    !!accountUser && deck.created_by_id === accountUser.id;',
].join(nl);
const newFn = '  const canEditServerDeck = (deck: SavedDeckSummary) => canMutateDeck(deck, accountUser);';
if (!modal.includes(oldFn)) throw new Error('canEditServerDeck needle missing');
modal = modal.replace(oldFn, newFn);

const oldFilter = [
  "    if (serverScope === 'mine') {",
  '      list = accountUser ? list.filter(d => d.created_by_id === accountUser.id) : [];',
  '    } else {',
  "      list = list.filter(d => (d.visibility || 'public') !== 'private');",
  '    }',
].join(nl);
const newFilter = [
  "    if (serverScope === 'mine') {",
  '      list = accountUser ? list.filter(d => d.created_by_id === accountUser.id) : [];',
  '    } else if (!accountUser?.isAdmin) {',
  "      list = list.filter(d => (d.visibility || 'public') !== 'private');",
  '    }',
].join(nl);
if (!modal.includes(oldFilter)) throw new Error('filter needle missing');
modal = modal.replace(oldFilter, newFilter);

writeUtf8NoBom(modalPath, modal);
assertNoBom(modalPath);

const verify = readUtf8(modalPath);
if (!verify.includes("import { canMutateDeck } from '../utils/deckAccess';")) throw new Error('import verify fail');
if (!verify.includes('canMutateDeck(deck, accountUser)')) throw new Error('fn verify fail');
if (!verify.includes('} else if (!accountUser?.isAdmin) {')) throw new Error('filter verify fail');
if (verify.includes('!!accountUser && deck.created_by_id === accountUser.id')) throw new Error('old owner-only still present');

const hb = fs.readFileSync(helperPath);
const mb = fs.readFileSync(modalPath);
function counts(buf) {
  let crlfN = 0, lfN = 0, crN = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 13) {
      if (i + 1 < buf.length && buf[i + 1] === 10) { crlfN++; i++; }
      else crN++;
    } else if (buf[i] === 10) lfN++;
  }
  return { size: buf.length, crlf: crlfN, lf: lfN, cr: crN };
}
console.log('helper', counts(hb));
console.log('modal', counts(mb));
console.log('ok');