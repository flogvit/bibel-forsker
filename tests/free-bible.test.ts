import { describe, it, expect } from 'bun:test';
import { FreeBible } from '../src/data/free-bible.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FREE_BIBLE_PATH = resolve(import.meta.dirname, '../../free-bible/generate');
const hasFreeBible = existsSync(FREE_BIBLE_PATH);

describe.skipIf(!hasFreeBible)('FreeBible data access', () => {
  const fb = new FreeBible(FREE_BIBLE_PATH);

  it('reads Hebrew source text for Genesis 1:1', async () => {
    const verse = await fb.getOriginalVerse(1, 1, 1);
    expect(verse).toBeDefined();
    expect(verse.text).toBeTruthy();
    expect(verse.bookId).toBe(1);
  });

  it('reads Greek source text for Matthew 1:1', async () => {
    const verse = await fb.getOriginalVerse(40, 1, 1);
    expect(verse).toBeDefined();
    expect(verse.text).toBeTruthy();
  });

  it('reads Norwegian translation for Genesis 1:1', async () => {
    const verse = await fb.getTranslation('osnb2', 1, 1, 1);
    expect(verse).toBeDefined();
    expect(verse.text).toBeTruthy();
  });

  it('reads a full chapter', async () => {
    const chapter = await fb.getChapter('osnb2', 1, 1);
    expect(chapter.length).toBeGreaterThan(0);
    expect(chapter[0].verseId).toBe(1);
  });

  it('reads word-by-word data when available', async () => {
    const w4w = await fb.getWordByWord('osnb1', 1, 1, 1);
    if (w4w) {
      expect(w4w.words).toBeDefined();
      expect(Array.isArray(w4w.words)).toBe(true);
    }
  });

  it('reads cross-references when available', async () => {
    const refs = await fb.getReferences(1, 1, 1);
    if (refs) {
      expect(refs.references).toBeDefined();
    }
  });

  it('returns book metadata', () => {
    const books = fb.getBooks();
    expect(books.length).toBe(66);
    expect(books[0].id).toBe(1);
    expect(books[39].id).toBe(40);
  });
});
