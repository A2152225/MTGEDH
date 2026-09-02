const fs = require('fs');
const { writeText } = require('./patch_util.cjs');

const src = [
  '/**',
  ' * Immediate-socket loopback checks. Do not use X-Forwarded-For here:',
  ' * public clients can spoof it. Privileges (short username, isAdmin on',
  ' * register) are granted only when the TCP peer is loopback.',
  ' */',
  'export function isLoopbackRemoteAddress(addr: string | undefined | null): boolean {',
  '  if (!addr) return false;',
  '  let ip = String(addr).trim().toLowerCase();',
  "  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);",
  "  if (ip.startsWith('::ffff:')) ip = ip.slice(7);",
  '  const ipv4Port = /^(\\d{1,3}(?:\\.\\d{1,3}){3}):\\d+$/.exec(ip);',
  '  if (ipv4Port) ip = ipv4Port[1];',
  "  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';",
  '}',
  '',
  'export function isLoopbackSocket(req: { socket?: { remoteAddress?: string } }): boolean {',
  '  return isLoopbackRemoteAddress(req.socket?.remoteAddress);',
  '}',
  '',
].join('\n');

writeText('D:/Git/MTGEDH/server/src/auth/loopback.ts', src, '\r\n');
const buf = fs.readFileSync('D:/Git/MTGEDH/server/src/auth/loopback.ts');
console.log('bytes', buf.length, 'bom', buf[0], buf[1], 'cr', [...buf].filter(b => b === 13).length);
