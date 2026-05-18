import { readFileSync } from 'node:fs';
import path from 'node:path';

// At runtime this module lives at `<package-root>/dist/version.js`, so
// `../package.json` resolves to the published package's package.json — same
// convention used by `src/bundled.ts` to locate `docs/templates/`.
export function getBvVersion(): string {
  const raw = readFileSync(
    path.resolve(__dirname, '..', 'package.json'),
    'utf8'
  );
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('bettervibes package.json is missing a version string');
  }
  return parsed.version;
}
