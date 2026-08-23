import fs from 'node:fs';

const PATH = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n');

function cutValidationBlock(src, commentText) {
  const start = src.indexOf(commentText);
  if (start < 0) {
    console.warn('missing validation comment', commentText.slice(0, 60));
    return src;
  }
  // find if (step.type
  let i = start;
  while (i < src.length && !src.slice(i, i + 40).includes('if (step.type === ResolutionStepType.')) {
    i = src.indexOf('\n', i) + 1;
    if (i <= 0) break;
  }
  const ifIdx = src.indexOf('if (step.type === ResolutionStepType.', start);
  if (ifIdx < 0) return src;
  // brace match from ifIdx (no regex mode - use simple depth; these blocks are simpler)
  const openBrace = src.indexOf('{', ifIdx);
  let depth = 0, inStr = null, escape = false, inLine = false, inBlock = false, end = openBrace;
  for (let j = openBrace; j < src.length; j++) {
    const ch = src[j], next = src[j+1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; j++; } continue; }
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; j++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; j++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    // skip regex: if / after (=,[!\s etc) - rough: treat /.../ as string-like when prev nonspace is ( = : ! & | ? , [ { return
    if (ch === '/' ) {
      let k = j - 1;
      while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
      const prev = k >= 0 ? src[k] : '';
      if ('(=,:!&|?[{;+\n'.includes(prev) || src.slice(Math.max(0,k-5), k+1).endsWith('return')) {
        // enter regex
        j++;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '/') { break; }
          if (src[j] === '\n') break;
          j++;
        }
        continue;
      }
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = j + 1; break; }
    }
  }
  // also eat following blank lines
  while (end < src.length && src[end] === '\n') end++;
  console.log('cut validation', commentText.slice(0, 40), 'bytes', end - start);
  return src.slice(0, start) + src.slice(end);
}

const comments = [
  '// Validate MODAL_CHOICE selections before completing the step.',
  '// Validate CLASH selections before completing the step.',
  '// Validate TWO_PILE_SPLIT selections before completing the step.',
  '// Validate PONDER_EFFECT selections before completing the step.',
  '// Validate SCRY selections before completing the step.',
  '// Validate SURVEIL selections before completing the step.',
  '// Validate FATESEAL selections before completing the step.',
  '// Validate BOTTOM_ORDER selections before completing the step.',
];

// Insert call at MODAL position first, then remove all blocks
const modalComment = comments[0];
const insertAt = src.indexOf(modalComment);
if (insertAt < 0) throw new Error('MODAL validation missing');

const call = `    if (!validateExtractedStepTypesBeforeComplete({ socket, step, response, cancelled })) {
      return;
    }

`;

src = src.slice(0, insertAt) + call + src.slice(insertAt);

// Now cut each block (including the original MODAL that still follows the call)
for (const c of comments) {
  src = cutValidationBlock(src, c);
}

fs.writeFileSync(PATH, src, 'utf8');
console.log('validation wired, KB', (src.length/1024).toFixed(1));
console.log('call present', src.includes('validateExtractedStepTypesBeforeComplete'));
console.log('modal comment leftover', src.includes(modalComment));
