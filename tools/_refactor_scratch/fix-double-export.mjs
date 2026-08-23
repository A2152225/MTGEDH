import fs from 'node:fs';
const files = [
  'D:/Git/MTGEDH/server/src/socket/resolutionSyntheticCastSocketUtils.ts',
  'D:/Git/MTGEDH/server/src/socket/resolutionColorTypeNameChoiceResponseHandlers.ts',
  'D:/Git/MTGEDH/server/src/socket/resolutionVoteProliferateLimDulResponseHandlers.ts',
  'D:/Git/MTGEDH/server/src/socket/resolutionOptionChoiceEarlySpecialsPrefixHandlers.ts',
];
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const before = (s.match(/export async export function/g) || []).length + (s.match(/export export function/g) || []).length;
  s = s.replace(/export async export function/g, 'export async function');
  s = s.replace(/export export function/g, 'export function');
  fs.writeFileSync(f, s, 'utf8');
  console.log(f.split('/').pop(), 'fixed', before);
}
