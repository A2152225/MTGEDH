const { readText, writeText, mustReplaceOnce } = require('./patch_util.cjs');
const p = 'D:/Git/MTGEDH/server/src/db/users.ts';
const { text, eol } = readText(p);
let next = text;

next = mustReplaceOnce(next,
`  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0
);
`,
`  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0
);
`, 'users CREATE TABLE');

next = mustReplaceOnce(next,
`} catch (err) {
  debugWarn(1, '[DB] users email unique index skipped:', err);
}
`,
`} catch (err) {
  debugWarn(1, '[DB] users email unique index skipped:', err);
}

try {
  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((col) => col.name === 'is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    debug(2, '[DB] Added is_admin column to users table');
  }
} catch (err) {
  debugWarn(1, '[DB] users is_admin migration skipped:', err);
}
`, 'users is_admin migration');

next = mustReplaceOnce(next,
`const insertUserStmt = db.prepare(\`
  INSERT INTO users (id, username, display_name, password_hash, email, created_at)
  VALUES (@id, @username, @display_name, @password_hash, @email, @created_at)
\`);
`,
`const insertUserStmt = db.prepare(\`
  INSERT INTO users (id, username, display_name, password_hash, email, created_at, is_admin)
  VALUES (@id, @username, @display_name, @password_hash, @email, @created_at, @is_admin)
\`);
`, 'users insert stmt');

next = mustReplaceOnce(next,
`  rating: number;
  games_played: number;
  games_won: number;
}

export interface PublicUser {
`,
`  rating: number;
  games_played: number;
  games_won: number;
  is_admin?: number;
}

export interface PublicUser {
`, 'users User interface');

next = mustReplaceOnce(next,
`export function registerUser(username: string, password: string, displayName?: string, email?: string): RegisterUserResult {
`,
`export function registerUser(username: string, password: string, displayName?: string, email?: string, isAdmin = false): RegisterUserResult {
`, 'users registerUser signature');

next = mustReplaceOnce(next,
`    insertUserStmt.run({
      id,
      username: normalizedUsername,
      display_name: displayName || username,
      password_hash: passwordHash,
      email: normalizedEmail,
      created_at: now,
    });
`,
`    insertUserStmt.run({
      id,
      username: normalizedUsername,
      display_name: displayName || username,
      password_hash: passwordHash,
      email: normalizedEmail,
      created_at: now,
      is_admin: isAdmin ? 1 : 0,
    });
`, 'users insert run');

writeText(p, next, eol);
console.log('patched users.ts');
