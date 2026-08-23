import fs from 'node:fs';
const p = 'D:/Git/MTGEDH/server/src/socket/resolutionRegisterPreCompleteValidationForExtractedSteps.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
// Only bare returns (validation abort), not return [] / return null / return strings
s = s.replace(/^([ \t]*)return;[ \t]*$/gm, '$1return false;');
fs.writeFileSync(p, s, 'utf8');
const bare = (s.match(/^\s*return;/gm) || []).length;
const falses = (s.match(/^\s*return false;/gm) || []).length;
console.log({ bare, falses });
