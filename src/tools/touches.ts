// ============================================================================
// Helpers
// ============================================================================

function stripBackticks(s: string): string {
  return s.replace(/`/g, '').trim();
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** File extensions that mark a token as a repo source/config file. Domain
 * TLDs (`.app`, `.dev`, `.io`) are deliberately absent so that an entry like
 * "Cloudflare DNS zone for goodgesture.app" is NOT read as a repo path. */
const CODE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|ya?ml|toml|css|scss|sass|less|html|sh|bash|zsh|fish|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sql|env|lock|txt|cfg|conf|ini|xml|gradle|proto|graphql|prisma)$/i;

/** Extensionless filenames and dotfiles that still name a repo file. */
const BARE_FILE_RE =
  /^(Makefile|Dockerfile|Procfile|Gemfile|Rakefile|\.[\w.-]+)$/;

/**
 * Extracts the list-item entries under a task body's `## Touches` heading, up
 * to the next `## ` heading. Returns backtick-stripped, trimmed strings.
 */
export function parseTouchesEntries(body: string): string[] {
  const entries: string[] = [];
  let inSection = false;
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      inSection = /^touches\b/i.test(heading[1].trim());
      continue;
    }
    if (!inSection) continue;
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (item) entries.push(stripBackticks(item[1].trim()));
  }
  return entries;
}

/**
 * Heuristic: does this `## Touches` entry name a repository file path (vs an
 * external system like "Cloudflare DNS zone")? True when any token contains a
 * path separator, ends in a known code/config extension, or is a recognized
 * bare filename. URLs and bare prose names ("Firebase Hosting") are false.
 *
 * Errs toward `true` (treat as a normal code task) so the operator-owned
 * refusal only fires when an entry is clearly external — a false skip here
 * just preserves today's behavior, while a false refusal would block real work.
 */
export function isRepoPathLike(entry: string): boolean {
  const e = stripBackticks(entry);
  if (e.length === 0) return false;
  for (const raw of e.split(/\s+/)) {
    const token = raw.replace(/[),.;:]+$/, '');
    if (token.length === 0 || URL_RE.test(token)) continue;
    if (token.includes('/')) return true;
    if (CODE_EXT_RE.test(token)) return true;
    if (BARE_FILE_RE.test(token)) return true;
  }
  return false;
}

/**
 * A task is operator-owned when its `## Touches` lists at least one entry and
 * none of them name a repo file path — i.e. every entry points at an external
 * system a worker cannot satisfy (DNS zones, dashboards, accounts). An empty
 * or absent Touches section is NOT flagged, to avoid false positives on
 * under-specified code tasks.
 */
export function isOperatorOwned(body: string): boolean {
  const entries = parseTouchesEntries(body);
  if (entries.length === 0) return false;
  return entries.every((entry) => !isRepoPathLike(entry));
}
