const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');

{
  const p = 'D:/Git/MTGEDH/client/src/components/SettingsMenu.tsx';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`                {user.email ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{user.email}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>No email on file</div>
                )}
`,
`                {user.email ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{user.email}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>No email on file</div>
                )}
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Role</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: user.isAdmin ? '#fbbf24' : '#d1d5db',
                      background: user.isAdmin ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid ' + (user.isAdmin ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'),
                      borderRadius: 999,
                      padding: '1px 8px',
                    }}
                  >
                    {user.isAdmin ? 'Admin' : 'User'}
                  </span>
                </div>
`, 'settings role badge');
  writeText(p, next, eol);
  console.log('patched SettingsMenu.tsx');
}

{
  const p = 'D:/Git/MTGEDH/client/src/App-handlers/appPlayLayoutMain.tsx';
  const { text, eol } = readText(p);
  let next = text;
  next = mustReplaceOnce(next,
`                <GameList onJoin={joinFromList} currentPlayerId={you} />
`,
`                <GameList onJoin={joinFromList} currentPlayerId={you} isAdmin={!!authSession?.user?.isAdmin} />
`, 'layout GameList isAdmin');
  writeText(p, next, eol);
  console.log('patched appPlayLayoutMain.tsx');
}
