/**
 * Best-effort server build identifier stored with each issue report (git commit + package version).
 * Never throws; returns null when nothing can be determined.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null | undefined;

export function getServerBuildVersion(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const env = String(process.env.GIT_COMMIT || process.env.GIT_SHA || '').trim();
    if (env) {
      cached = env.slice(0, 40);
      return cached;
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const gitDir = path.join(root, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    let hash = head;
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      const refFile = path.join(gitDir, ref);
      if (fs.existsSync(refFile)) {
        hash = fs.readFileSync(refFile, 'utf8').trim();
      } else {
        const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split(/\r?\n/);
        hash = (packed.find((l) => l.endsWith(' ' + ref)) || '').split(' ')[0] || '';
      }
    }
    cached = /^[0-9a-f]{7,40}$/i.test(hash) ? hash.slice(0, 12) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function resetServerBuildVersionCacheForTests(): void {
  cached = undefined;
}