import fs from 'node:fs';

const PATH = 'D:/Git/MTGEDH/server/src/socket/resolution.ts';
let src = fs.readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n');

// Locate handleOptionChoiceResponse and PREFIX region
const fnStart = src.indexOf('async function handleOptionChoiceResponse(');
if (fnStart < 0) throw new Error('handleOptionChoiceResponse missing');
const legend = src.indexOf('if (stepData?.legendRuleChoice === true)', fnStart);
const importWipe = src.indexOf('// ===== DECK IMPORT WIPE CONFIRM =====', legend);
if (legend < 0 || importWipe < 0) throw new Error(`markers missing legend=${legend} wipe=${importWipe}`);

// Find the extractId block end (keep extractId for remaining specials)
const extractIdStart = src.indexOf('const extractId = (sel: any)', fnStart);
if (extractIdStart < 0 || extractIdStart > legend) throw new Error('extractId missing');

const prefixReplacement = `  if (await getResolutionHandlerDeps().tryHandleOptionChoiceEarlySpecialsPrefix(io, game, gameId, step, response)) {
    return;
  }

`;

src = src.slice(0, legend) + prefixReplacement + src.slice(importWipe);
fs.writeFileSync(PATH, src, 'utf8');
console.log('PREFIX replaced; file KB', (src.length/1024).toFixed(1));

// Verify import wipe still there and legend gone
const s2 = fs.readFileSync(PATH, 'utf8');
console.log({
  hasTryHandle: s2.includes('tryHandleOptionChoiceEarlySpecialsPrefix'),
  hasLegendInline: s2.includes('legendRuleChoice === true'),
  hasImportWipe: s2.includes('DECK IMPORT WIPE CONFIRM'),
  hasCastRevealedInline: s2.includes('castRevealedFromLibraryChoice === true'),
});
