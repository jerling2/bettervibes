import { isOperatorOwned, isRepoPathLike, parseTouchesEntries } from './touches';

// ============================================================================
// parseTouchesEntries
// ============================================================================

describe('parseTouchesEntries', () => {
  it('extracts list items under ## Touches up to the next heading', () => {
    const body = [
      '# Task: x',
      '',
      '## Acceptance Criteria',
      '- not a touch',
      '',
      '## Touches',
      '- `packages/frontend/src/a.ts`',
      '- Cloudflare DNS zone',
      '',
      '## Spec Sections',
      '- §1',
    ].join('\n');
    expect(parseTouchesEntries(body)).toEqual([
      'packages/frontend/src/a.ts',
      'Cloudflare DNS zone',
    ]);
  });

  it('returns [] when there is no Touches section', () => {
    expect(parseTouchesEntries('# Task: x\n\nbody')).toEqual([]);
  });
});

// ============================================================================
// isRepoPathLike
// ============================================================================

describe('isRepoPathLike', () => {
  it.each([
    ['`packages/frontend/src/index.ts`', true],
    ['src/cli/runner.ts', true],
    ['tsconfig.json', true],
    ['.gitignore', true],
    ['Dockerfile', true],
    ['Cloudflare DNS zone for goodgesture.app', false],
    ['Firebase Hosting custom domain', false],
    ['https://dash.cloudflare.com', false],
    ['', false],
  ])('classifies %p as repo-path=%p', (entry, expected) => {
    expect(isRepoPathLike(entry)).toBe(expected);
  });
});

// ============================================================================
// isOperatorOwned
// ============================================================================

describe('isOperatorOwned', () => {
  it('flags a task whose Touches are all external systems', () => {
    const body = [
      '## Touches',
      '- Cloudflare DNS zone for goodgesture.app',
      '- Firebase Hosting custom domain',
    ].join('\n');
    expect(isOperatorOwned(body)).toBe(true);
  });

  it('does not flag when at least one entry is a repo path', () => {
    const body = ['## Touches', '- Cloudflare DNS zone', '- `firebase.json`'].join(
      '\n'
    );
    expect(isOperatorOwned(body)).toBe(false);
  });

  it('does not flag an empty or absent Touches section', () => {
    expect(isOperatorOwned('# Task: x\n\nbody')).toBe(false);
    expect(isOperatorOwned('## Touches\n\n## Next\n- x')).toBe(false);
  });
});
