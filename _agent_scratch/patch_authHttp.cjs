const { readText, writeText, mustReplaceOnce, mustReplace } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/server/src/auth/authHttp.ts';
const { text, eol } = readText(p);
let next = text;

next = mustReplaceOnce(next, "import { expireSessionCookie, serializeSessionCookie } from './sessionCookie.js';\n",
"import { expireSessionCookie, serializeSessionCookie } from './sessionCookie.js';\nimport { isLoopbackSocket } from './loopback.js';\n",
'authHttp import');

next = mustReplaceOnce(next, "const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;\n",
"const USERNAME_CHARSET_RE = /^[a-zA-Z0-9_]+$/;\nconst USERNAME_MAX = 24;\n",
'authHttp USERNAME_RE');

next = mustReplaceOnce(next,
`function validateRegisterBody(body: any): { ok: true; username: string; password: string; displayName: string; email?: string } | { ok: false; error: string } {
  const username = readString(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = readString(body?.displayName) || username;
  const emailRaw = readString(body?.email);

  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Username must be 3-24 characters (letters, numbers, underscore).' };
  }
`,
`export type RegisterBodyOk = {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  isAdmin: boolean;
};

export function validateRegisterBody(
  body: any,
  opts?: { allowPrivileged?: boolean },
): { ok: true } & RegisterBodyOk | { ok: false; error: string } {
  const username = readString(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = readString(body?.displayName) || username;
  const emailRaw = readString(body?.email);
  const allowPrivileged = !!opts?.allowPrivileged;
  const minLen = allowPrivileged ? 2 : 3;
  const wantAdmin = body?.isAdmin === true || body?.isAdmin === 1 || body?.isAdmin === 'true';

  if (!username || username.length < minLen || username.length > USERNAME_MAX || !USERNAME_CHARSET_RE.test(username)) {
    return { ok: false, error: 'Username must be ' + minLen + '-24 characters (letters, numbers, underscore).' };
  }
`,
'authHttp validateRegisterBody start');

next = mustReplaceOnce(next,
"  return { ok: true, username, password, displayName, email };\n}",
"  const isAdmin = allowPrivileged && wantAdmin;\n  return { ok: true, username, password, displayName, email, isAdmin };\n}",
'authHttp validateRegisterBody return');

next = mustReplaceOnce(next,
"      const parsed = validateRegisterBody(req.body || {});\n",
"      const parsed = validateRegisterBody(req.body || {}, { allowPrivileged: isLoopbackSocket(req) });\n",
'authHttp register call');

next = mustReplaceOnce(next,
"      const result = registerUser(parsed.username, parsed.password, parsed.displayName, parsed.email);\n",
"      const result = registerUser(parsed.username, parsed.password, parsed.displayName, parsed.email, parsed.isAdmin);\n",
'authHttp registerUser call');

writeText(p, next, eol);
console.log('patched authHttp.ts');
