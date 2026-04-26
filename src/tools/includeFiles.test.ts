jest.mock('fs/promises');

import path from 'node:path';
import { readFile } from 'fs/promises';
import { readIncludeFiles } from './includeFiles';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe('readIncludeFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty array when given no paths', async () => {
    const out = await readIncludeFiles([]);
    expect(out).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('reads each file in argv order with absolute paths', async () => {
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('a.ts')) return Promise.resolve('content of a');
      if (s.endsWith('b.ts')) return Promise.resolve('content of b');
      throw new Error(`unexpected path ${s}`);
    });

    const out = await readIncludeFiles(['a.ts', 'b.ts']);

    expect(out.map((f) => f.content)).toEqual(['content of a', 'content of b']);
    expect(out.every((f) => path.isAbsolute(f.path))).toBe(true);
  });

  it('throws "Include file not found" with the original path on ENOENT', async () => {
    mockReadFile.mockImplementation(() => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT',
      });
      return Promise.reject(err);
    });

    await expect(readIncludeFiles(['missing.ts'])).rejects.toThrow(
      /Include file not found: missing\.ts/
    );
  });

  it('propagates non-ENOENT filesystem errors verbatim', async () => {
    mockReadFile.mockImplementation(() => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), {
        code: 'EACCES',
      });
      return Promise.reject(err);
    });

    await expect(readIncludeFiles(['restricted.ts'])).rejects.toThrow(
      /EACCES/
    );
  });
});
