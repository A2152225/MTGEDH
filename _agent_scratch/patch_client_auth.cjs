const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');

{
  const p = 'D:/Git/MTGEDH/client/src/utils/authApi.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
};
`,
`export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  isAdmin?: boolean;
};
`, 'authApi AuthUser');
  next = mustReplaceOnce(next,
`export async function registerAccount(payload: {
  username: string;
  password: string;
  displayName: string;
  email?: string;
}): Promise<{ user: AuthUser; token: string }> {
`,
`export async function registerAccount(payload: {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  isAdmin?: boolean;
}): Promise<{ user: AuthUser; token: string }> {
`, 'authApi register payload');
  writeText(p, next, eol);
  console.log('patched authApi.ts');
}

{
  const p = 'D:/Git/MTGEDH/client/src/hooks/useAuthSession.ts';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`  const register = useCallback(async (payload: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
  }) => {
`,
`  const register = useCallback(async (payload: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
    isAdmin?: boolean;
  }) => {
`, 'useAuthSession register');
  writeText(p, next, eol);
  console.log('patched useAuthSession.ts');
}

{
  const p = 'D:/Git/MTGEDH/client/src/components/AuthSessionPanel.tsx';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next, 'const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;', 'const USERNAME_RE = /^[a-zA-Z0-9_]{2,24}$/;', 'username re');
  next = mustReplaceOnce(next,
`  onRegister: (payload: { username: string; password: string; displayName: string; email?: string }) => Promise<unknown>;
`,
`  onRegister: (payload: { username: string; password: string; displayName: string; email?: string; isAdmin?: boolean }) => Promise<unknown>;
`, 'onRegister type');
  next = mustReplaceOnce(next,
`  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
`,
`  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const localCreatorHost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '::1'
    || window.location.hostname === '[::1]'
  );
`, 'admin state');
  next = mustReplaceOnce(next,
`      return 'Username must be 3-24 characters (letters, numbers, underscore).';
`,
`      return 'Username must be 2-24 characters (letters, numbers, underscore).';
`, 'username message');
  next = mustReplaceOnce(next,
`          : onRegister({
              username: u,
              password,
              displayName: displayName.trim() || u,
              email: em || undefined,
            }),
`,
`          : onRegister({
              username: u,
              password,
              displayName: displayName.trim() || u,
              email: em || undefined,
              isAdmin: localCreatorHost ? isAdmin : undefined,
            }),
`, 'register payload');
  next = mustReplaceOnce(next,
`          <button type="button" onClick={() => { setMode('register'); setLocalError(null); }} style={{ ...btnStyle, backgroundColor: '#6366f1' }}>
`,
`          <button type="button" onClick={() => { setMode('register'); setLocalError(null); setIsAdmin(false); }} style={{ ...btnStyle, backgroundColor: '#6366f1' }}>
`, 'open register');
  next = mustReplaceOnce(next,
`              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" style={inputStyle} />
            </>
          )}
`,
`              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" style={inputStyle} />
              {localCreatorHost && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#e5e5e5' }}>
                  <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
                  Admin
                </label>
              )}
            </>
          )}
`, 'admin checkbox');
  writeText(p, next, eol);
  console.log('patched AuthSessionPanel.tsx');
}
