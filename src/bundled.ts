import path from 'node:path';

// At runtime this module lives at `<package-root>/dist/bundled.js`, so
// `../docs/templates/<filename>` resolves to the templates directory shipped
// alongside `dist/` in the published npm package.
export function resolveBundledFile(filename: string): string {
  return path.resolve(__dirname, '..', 'docs', 'templates', filename);
}
