import fs from 'node:fs';

const parentPath = 'server/src/socket/ai.ts';
const leafPath = 'server/src/socket/ai-handlers/aiSpellPaymentSourceHandlers.ts';
const parent = fs.readFileSync(parentPath, 'utf8');
const leaf = fs.readFileSync(leafPath, 'utf8').replace(/\r\n/g, '\n');
const marker = 'function getAISpellPaymentSourceCostText(';
const idx = leaf.indexOf(marker);
if (idx < 0) {
  console.error('leaf body marker not found');
  process.exit(1);
}
let body = leaf.slice(idx)
  .replace(/getAIHandlerDeps\(\)\.buildAIActivatedAbilityResolverCandidates\(/g, 'buildAIActivatedAbilityResolverCandidates(')
  .replace(/getAIHandlerDeps\(\)\.executeAIActivateAbility\(/g, 'executeAIActivateAbility(')
  .replace(/^export function getPaymentSources\(/m, 'function getPaymentSources(');
const crlf = body.replace(/\n/g, '\r\n');
const insertAt = parent.indexOf(' * Check the maximum hand size for a player');
if (insertAt < 0) {
  console.error('parent insert marker not found');
  process.exit(1);
}
const commentStart = parent.lastIndexOf('/**', insertAt);
const next = parent.slice(0, commentStart) + crlf + (crlf.endsWith('\r\n') ? '' : '\r\n') + '\r\n' + parent.slice(commentStart);
fs.writeFileSync(parentPath, next);
console.log('restored payment body at', commentStart, 'new size', next.length);
