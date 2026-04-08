import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Verse {
  bookId: number;
  chapterId: number;
  verseId: number;
  text: string;
  [key: string]: unknown;
}

export interface WordEntry {
  word: string;
  wordId: number;
  original: string;
  explanation: string;
}

export interface WordByWord {
  bookId: number;
  chapterId: number;
  verseId: number;
  words: WordEntry[];
}

export interface CrossReference {
  bookId: number;
  chapterId: number;
  verseId: number;
  references: Array<{
    bookId: number;
    chapterId: number;
    fromVerseId: number;
    toVerseId: number;
    text: string;
  }>;
}

interface BookDef {
  id: number;
  chapters: number;
  name: string;
  testament: 'OT' | 'NT';
}

const BOOKS: BookDef[] = [
  { id: 1, chapters: 50, name: 'Genesis', testament: 'OT' },
  { id: 2, chapters: 40, name: 'Exodus', testament: 'OT' },
  { id: 3, chapters: 27, name: 'Leviticus', testament: 'OT' },
  { id: 4, chapters: 36, name: 'Numbers', testament: 'OT' },
  { id: 5, chapters: 34, name: 'Deuteronomy', testament: 'OT' },
  { id: 6, chapters: 24, name: 'Joshua', testament: 'OT' },
  { id: 7, chapters: 21, name: 'Judges', testament: 'OT' },
  { id: 8, chapters: 4, name: 'Ruth', testament: 'OT' },
  { id: 9, chapters: 31, name: '1 Samuel', testament: 'OT' },
  { id: 10, chapters: 24, name: '2 Samuel', testament: 'OT' },
  { id: 11, chapters: 22, name: '1 Kings', testament: 'OT' },
  { id: 12, chapters: 25, name: '2 Kings', testament: 'OT' },
  { id: 13, chapters: 29, name: '1 Chronicles', testament: 'OT' },
  { id: 14, chapters: 36, name: '2 Chronicles', testament: 'OT' },
  { id: 15, chapters: 10, name: 'Ezra', testament: 'OT' },
  { id: 16, chapters: 13, name: 'Nehemiah', testament: 'OT' },
  { id: 17, chapters: 10, name: 'Esther', testament: 'OT' },
  { id: 18, chapters: 42, name: 'Job', testament: 'OT' },
  { id: 19, chapters: 150, name: 'Psalms', testament: 'OT' },
  { id: 20, chapters: 31, name: 'Proverbs', testament: 'OT' },
  { id: 21, chapters: 12, name: 'Ecclesiastes', testament: 'OT' },
  { id: 22, chapters: 8, name: 'Song of Solomon', testament: 'OT' },
  { id: 23, chapters: 66, name: 'Isaiah', testament: 'OT' },
  { id: 24, chapters: 52, name: 'Jeremiah', testament: 'OT' },
  { id: 25, chapters: 5, name: 'Lamentations', testament: 'OT' },
  { id: 26, chapters: 48, name: 'Ezekiel', testament: 'OT' },
  { id: 27, chapters: 12, name: 'Daniel', testament: 'OT' },
  { id: 28, chapters: 14, name: 'Hosea', testament: 'OT' },
  { id: 29, chapters: 3, name: 'Joel', testament: 'OT' },
  { id: 30, chapters: 9, name: 'Amos', testament: 'OT' },
  { id: 31, chapters: 1, name: 'Obadiah', testament: 'OT' },
  { id: 32, chapters: 4, name: 'Jonah', testament: 'OT' },
  { id: 33, chapters: 7, name: 'Micah', testament: 'OT' },
  { id: 34, chapters: 3, name: 'Nahum', testament: 'OT' },
  { id: 35, chapters: 3, name: 'Habakkuk', testament: 'OT' },
  { id: 36, chapters: 3, name: 'Zephaniah', testament: 'OT' },
  { id: 37, chapters: 2, name: 'Haggai', testament: 'OT' },
  { id: 38, chapters: 14, name: 'Zechariah', testament: 'OT' },
  { id: 39, chapters: 4, name: 'Malachi', testament: 'OT' },
  { id: 40, chapters: 28, name: 'Matthew', testament: 'NT' },
  { id: 41, chapters: 16, name: 'Mark', testament: 'NT' },
  { id: 42, chapters: 24, name: 'Luke', testament: 'NT' },
  { id: 43, chapters: 21, name: 'John', testament: 'NT' },
  { id: 44, chapters: 28, name: 'Acts', testament: 'NT' },
  { id: 45, chapters: 16, name: 'Romans', testament: 'NT' },
  { id: 46, chapters: 16, name: '1 Corinthians', testament: 'NT' },
  { id: 47, chapters: 13, name: '2 Corinthians', testament: 'NT' },
  { id: 48, chapters: 6, name: 'Galatians', testament: 'NT' },
  { id: 49, chapters: 6, name: 'Ephesians', testament: 'NT' },
  { id: 50, chapters: 4, name: 'Philippians', testament: 'NT' },
  { id: 51, chapters: 4, name: 'Colossians', testament: 'NT' },
  { id: 52, chapters: 5, name: '1 Thessalonians', testament: 'NT' },
  { id: 53, chapters: 3, name: '2 Thessalonians', testament: 'NT' },
  { id: 54, chapters: 6, name: '1 Timothy', testament: 'NT' },
  { id: 55, chapters: 4, name: '2 Timothy', testament: 'NT' },
  { id: 56, chapters: 3, name: 'Titus', testament: 'NT' },
  { id: 57, chapters: 1, name: 'Philemon', testament: 'NT' },
  { id: 58, chapters: 13, name: 'Hebrews', testament: 'NT' },
  { id: 59, chapters: 5, name: 'James', testament: 'NT' },
  { id: 60, chapters: 5, name: '1 Peter', testament: 'NT' },
  { id: 61, chapters: 3, name: '2 Peter', testament: 'NT' },
  { id: 62, chapters: 5, name: '1 John', testament: 'NT' },
  { id: 63, chapters: 1, name: '2 John', testament: 'NT' },
  { id: 64, chapters: 1, name: '3 John', testament: 'NT' },
  { id: 65, chapters: 1, name: 'Jude', testament: 'NT' },
  { id: 66, chapters: 22, name: 'Revelation', testament: 'NT' },
];

export class FreeBible {
  private basePath: string;
  private cache = new Map<string, unknown>();

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  getBooks(): BookDef[] {
    return BOOKS;
  }

  private sourceDir(bookId: number): string {
    return bookId <= 39 ? 'hebrew' : 'sblgnt';
  }

  private async readJSON<T>(path: string): Promise<T | null> {
    if (this.cache.has(path)) return this.cache.get(path) as T;
    const fullPath = join(this.basePath, path);
    if (!existsSync(fullPath)) return null;
    const data = JSON.parse(await readFile(fullPath, 'utf-8')) as T;
    this.cache.set(path, data);
    return data;
  }

  async getOriginalVerse(bookId: number, chapterId: number, verseId: number): Promise<Verse> {
    const dir = this.sourceDir(bookId);
    const chapter = await this.readJSON<Verse[]>(`bibles_raw/${dir}/${bookId}/${chapterId}.json`);
    if (!chapter) throw new Error(`Chapter not found: ${dir}/${bookId}/${chapterId}`);
    const verse = chapter.find((v) => v.verseId === verseId);
    if (!verse) throw new Error(`Verse not found: ${bookId}:${chapterId}:${verseId}`);
    return verse;
  }

  async getOriginalChapter(bookId: number, chapterId: number): Promise<Verse[]> {
    const dir = this.sourceDir(bookId);
    const chapter = await this.readJSON<Verse[]>(`bibles_raw/${dir}/${bookId}/${chapterId}.json`);
    if (!chapter) throw new Error(`Chapter not found: ${dir}/${bookId}/${chapterId}`);
    return chapter;
  }

  async getTranslation(bible: string, bookId: number, chapterId: number, verseId: number): Promise<Verse> {
    const chapter = await this.readJSON<Verse[]>(`bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!chapter) throw new Error(`Translation not found: ${bible}/${bookId}/${chapterId}`);
    const verse = chapter.find((v) => v.verseId === verseId);
    if (!verse) throw new Error(`Verse not found: ${bible}/${bookId}:${chapterId}:${verseId}`);
    return verse;
  }

  async getChapter(bible: string, bookId: number, chapterId: number): Promise<Verse[]> {
    const chapter = await this.readJSON<Verse[]>(`bibles_raw/${bible}/${bookId}/${chapterId}.json`);
    if (!chapter) throw new Error(`Chapter not found: ${bible}/${bookId}/${chapterId}`);
    return chapter;
  }

  async getWordByWord(bible: string, bookId: number, chapterId: number, verseId: number): Promise<WordByWord | null> {
    const data = await this.readJSON<WordEntry[] | WordByWord>(`word4word/${bible}/${bookId}/${chapterId}/${verseId}.json`);
    if (!data) return null;
    if (Array.isArray(data)) {
      return { bookId, chapterId, verseId, words: data };
    }
    return data;
  }

  async getReferences(bookId: number, chapterId: number, verseId: number): Promise<CrossReference | null> {
    return this.readJSON<CrossReference>(`references/nb/${bookId}/${chapterId}/${verseId}.json`);
  }
}
