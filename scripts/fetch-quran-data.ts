import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { normalizeAyah } from '../lib/normalize/segments';
import { stripPrivateUse } from '../lib/normalize/arabic';
import type { RawSegment, WordTiming } from '../lib/normalize/types';
import type {
  AyahTiming, SurahMeta, SurahText, SurahTimings, SurahWord,
} from '../lib/data/types';

const API = 'https://api.quran.com/api/v4';
const RECITATION_ID = 2;                    // AbdulBaset AbdulSamad, Murattal
const RECITER_SLUG = 'abdulbasit-murattal';
const AUDIO_HOST = 'https://verses.quran.com/';
const UA = 'quran-word-sync-build-script';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const AUDIO_DIR = path.join(ROOT, 'public', 'audio', RECITER_SLUG);
const TIMINGS_DIR = path.join(ROOT, 'public', 'timings', RECITER_SLUG);

// --- Retry with exponential backoff -------------------------------------

// 8 attempts with the cap below spends roughly two minutes before giving up on
// a file. Five attempts topped out after ~7 seconds, which was not enough to
// ride out a CDN connect timeout during a multi-gigabyte transfer.
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
/** Transient — worth retrying. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

/**
 * Raised when a request exhausts every retry. Distinct from a programming
 * error: the caller can reasonably skip this surah and continue, because a
 * later run will pick it up — the script skips files already on disk.
 */
export class NetworkExhaustedError extends Error {
  constructor(readonly label: string, cause: unknown) {
    super(`network failed after ${MAX_ATTEMPTS} attempts: ${label}`);
    this.name = 'NetworkExhaustedError';
    this.cause = cause;
  }
}

/** Honours Retry-After as either delta-seconds or an HTTP-date. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/**
 * fetch() with exponential backoff. Retries network errors and 429/500/502/
 * 503/504, honouring a Retry-After header when the response carries one.
 * 400/401/403/404 and any other 4xx are permanent failures and are returned
 * to the caller immediately, un-retried — retrying those wastes time and
 * looks like abuse. `label` is only for the retry log line.
 *
 * The body is read by `consume` INSIDE the retry loop, deliberately. Reading
 * it outside means a connection that drops mid-body — `UND_ERR_SOCKET: other
 * side closed`, which the CDN does periodically on a multi-gigabyte transfer —
 * throws past all of this and kills the run. That is exactly how a 63-surah
 * fetch died once already.
 */
async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  label: string,
  consume: (res: Response) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, init);

      if (!res.ok && RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        const delay = retryAfterMs(res) ?? backoffDelayMs(attempt);
        console.warn(
          `  [retry] ${res.status} ${res.statusText} for ${label} ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} for ${label}`);
      }

      // Inside the try: a mid-body socket close lands in the catch below and
      // is retried like any other network error.
      return await consume(res);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw new NetworkExhaustedError(label, err);
      const delay = backoffDelayMs(attempt);
      console.warn(
        `  [retry] network error for ${label} (attempt ${attempt}/${MAX_ATTEMPTS}): ` +
        `${(err as Error).message} — retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}

async function api<T>(pathname: string): Promise<T> {
  return fetchWithRetry<T>(
    `${API}${pathname}`,
    { headers: { 'User-Agent': UA } },
    pathname,
    res => res.json() as Promise<T>,
  );
}

/** Walks a paginated endpoint and returns every item. */
async function paginate<T>(
  build: (page: number) => string,
  pick: (body: any) => T[],
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const body = await api<any>(build(page));
    out.push(...pick(body));
    const next = body.pagination?.next_page;
    if (!next) return out;
    page = next;
  }
}

function parseSurahArg(): number[] {
  const arg = process.argv.slice(2).find(a => a.startsWith('--surahs='))?.split('=')[1]
    ?? process.argv[process.argv.indexOf('--surahs') + 1];
  if (!arg) return [1];
  if (arg.includes('-')) {
    const [from, to] = arg.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return arg.split(',').map(Number);
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Downloads one MP3 byte-for-byte. Skips files already on disk. */
async function downloadAudio(remotePath: string): Promise<string> {
  const filename = remotePath.split('/').pop()!;
  const dest = path.join(AUDIO_DIR, filename);
  if (!(await exists(dest))) {
    const bytes = await fetchWithRetry(
      AUDIO_HOST + remotePath,
      { headers: { 'User-Agent': UA } },
      remotePath,
      async res => Buffer.from(await res.arrayBuffer()),
    );
    await writeFile(dest, bytes);
  }
  return `/audio/${RECITER_SLUG}/${filename}`;
}

async function fetchSurahMeta(): Promise<Omit<SurahMeta, 'available'>[]> {
  const body = await api<any>('/chapters?language=en');
  return body.chapters.map((c: any) => ({
    id: c.id,
    nameArabic: c.name_arabic,
    nameSimple: c.name_simple,
    nameEnglish: c.translated_name.name,
    ayahCount: c.verses_count,
    revelationPlace: c.revelation_place,
  }));
}

/** A surah is available once its text and timings files actually exist on disk. */
async function isSurahAvailable(surah: number): Promise<boolean> {
  const textPath = path.join(DATA, 'text', `${surah}.json`);
  const timingsPath = path.join(TIMINGS_DIR, `${surah}.json`);
  return (await exists(textPath)) && (await exists(timingsPath));
}

/**
 * Checks two invariants required of every emitted word timing before it is
 * trusted downstream: each timing must have positive duration, and the set of
 * timings must cover exactly the ayah's word positions in order, with no gaps
 * or duplicates. Violations are returned as human-readable strings prefixed
 * with the offending verse key.
 */
function validateAyahTimings(
  surah: number,
  ayah: number,
  words: { position: number }[],
  timings: WordTiming[],
): string[] {
  const violations: string[] = [];
  const verseKey = `${surah}:${ayah}`;

  for (const t of timings) {
    if (!(t.startMs < t.endMs)) {
      violations.push(`${verseKey} word ${t.id}: startMs(${t.startMs}) >= endMs(${t.endMs})`);
    }
  }

  const expectedPositions = [...words].map(w => w.position).sort((a, b) => a - b);
  const actualPositions = timings.map(t => t.position);
  if (actualPositions.length !== expectedPositions.length) {
    violations.push(
      `${verseKey}: expected ${expectedPositions.length} word timings, got ${actualPositions.length}`,
    );
  } else {
    for (let i = 0; i < expectedPositions.length; i += 1) {
      if (actualPositions[i] !== expectedPositions[i]) {
        violations.push(
          `${verseKey}: position gap/out-of-order at index ${i} — ` +
          `expected ${expectedPositions[i]}, got ${actualPositions[i]}`,
        );
        break;
      }
    }
  }

  return violations;
}

/** Thrown when segment validation fails; carries the partial report so main() can still write it. */
class SegmentValidationError extends Error {
  report: SurahReport;

  constructor(message: string, report: SurahReport) {
    super(message);
    this.report = report;
  }
}

interface SurahReport {
  surah: number;
  ayahs: number;
  mergedGroups: number;
  interpolatedWords: number;
  uncoveredWords: number;
  invalidSegments: number;
  untimedAyahs: number[];
  violations: string[];
}

async function buildSurah(surah: number): Promise<SurahReport> {
  // 1. Words, both scripts
  const verses = await paginate<any>(
    p => `/verses/by_chapter/${surah}?words=true&per_page=50&page=${p}` +
         `&word_fields=text_uthmani_tajweed,text_indopak`,
    b => b.verses,
  );

  // 2. Segments and durations for this reciter
  const audioFiles = await paginate<any>(
    p => `/recitations/${RECITATION_ID}/by_chapter/${surah}?per_page=50&page=${p}` +
         `&fields=segments,duration`,
    b => b.audio_files,
  );
  const byKey = new Map(audioFiles.map(f => [f.verse_key, f]));

  const text: SurahText = { surah, ayahs: [] };
  const ayahTimings: AyahTiming[] = [];
  const report: SurahReport = {
    surah, ayahs: 0, mergedGroups: 0, interpolatedWords: 0, uncoveredWords: 0, invalidSegments: 0,
    untimedAyahs: [], violations: [],
  };

  let offset = 0;

  for (const verse of verses) {
    const ayah = verse.verse_number as number;
    const words = (verse.words as any[])
      .filter(w => w.char_type_name === 'word')
      .map((w): SurahWord => ({
        id: `${surah}:${ayah}:${w.position}`,
        position: w.position,
        tajweed: w.text_uthmani_tajweed ?? '',
        indopak: stripPrivateUse(w.text_indopak ?? ''),
      }));

    text.ayahs.push({ ayah, words });

    const file = byKey.get(`${surah}:${ayah}`);
    if (!file) throw new Error(`no audio entry for ${surah}:${ayah}`);

    const result = normalizeAyah({
      surah,
      ayah,
      words: words.map(w => ({ position: w.position, text: w.tajweed })),
      segments: (file.segments ?? []) as RawSegment[],
    });

    report.ayahs += 1;
    report.mergedGroups += result.mergedGroups;
    report.interpolatedWords += result.interpolatedWords;
    report.uncoveredWords += result.uncoveredWords;
    report.invalidSegments += result.invalidSegments;
    if (result.timings.length === 0) report.untimedAyahs.push(ayah);

    const ayahViolations = validateAyahTimings(surah, ayah, words, result.timings);
    report.violations.push(...ayahViolations);

    const durationMs = Math.round((file.duration ?? 0) * 1000);
    const audioUrl = await downloadAudio(file.url);

    ayahTimings.push({ ayah, audioUrl, startOffsetMs: offset, durationMs, words: result.timings });
    offset += durationMs;

    process.stdout.write(`\r  ${surah}:${ayah} `);
  }

  if (report.violations.length > 0) {
    throw new SegmentValidationError(
      `Segment validation failed for surah ${surah}: ${report.violations.join('; ')}`,
      report,
    );
  }

  const timings: SurahTimings = {
    surah,
    reciterId: RECITER_SLUG,
    surahDurationMs: offset,
    ayahs: ayahTimings,
  };

  await writeFile(path.join(DATA, 'text', `${surah}.json`), JSON.stringify(text));
  await writeFile(
    path.join(TIMINGS_DIR, `${surah}.json`),
    JSON.stringify(timings),
  );

  console.log(`\n  surah ${surah}: ${report.ayahs} ayahs, ` +
    `${report.mergedGroups} merged groups, ${report.uncoveredWords} uncovered words, ` +
    `${report.invalidSegments} invalid segments`);
  return report;
}

/** Reads the existing validation report, if any, keyed by surah number. */
async function loadExistingReports(): Promise<Map<number, SurahReport>> {
  try {
    const raw = await readFile(path.join(DATA, 'validation-report.json'), 'utf-8');
    const parsed = JSON.parse(raw) as SurahReport[];
    return new Map(parsed.map(r => [r.surah, r]));
  } catch {
    return new Map();
  }
}

async function main() {
  const surahs = parseSurahArg();
  const failedSurahs: number[] = [];
  console.log(`Fetching surahs: ${surahs.join(', ')}`);

  await mkdir(path.join(DATA, 'text'), { recursive: true });
  await mkdir(TIMINGS_DIR, { recursive: true });
  await mkdir(AUDIO_DIR, { recursive: true });

  // reciters.json is static and independent of the surah loop, so it is safe
  // to write up front rather than deferring it to a successful full run.
  await writeFile(
    path.join(DATA, 'reciters.json'),
    JSON.stringify([{ id: RECITER_SLUG, name: 'AbdulBaset AbdulSamad', style: 'Murattal' }], null, 2),
  );

  const meta = await fetchSurahMeta();

  // Merge with whatever an earlier invocation already recorded, so surahs
  // fetched in a previous run keep their entries even though this run only
  // touches a subset.
  const reportsById = await loadExistingReports();

  /**
   * Writes surahs.json and validation-report.json from current in-memory
   * state. Called after every surah (success or validation failure) so an
   * interrupted multi-surah run leaves the manifests consistent with what is
   * actually on disk, instead of only writing them once at the very end.
   */
  async function writeManifests(): Promise<void> {
    const withAvailability: SurahMeta[] = await Promise.all(
      meta.map(async m => ({ ...m, available: await isSurahAvailable(m.id) })),
    );
    await writeFile(path.join(DATA, 'surahs.json'), JSON.stringify(withAvailability, null, 2));

    const sortedReports = [...reportsById.values()].sort((a, b) => a.surah - b.surah);
    await writeFile(
      path.join(DATA, 'validation-report.json'),
      JSON.stringify(sortedReports, null, 2),
    );
  }

  for (const surah of surahs) {
    try {
      const report = await buildSurah(surah);
      reportsById.set(surah, report);
    } catch (err) {
      if (err instanceof SegmentValidationError) {
        // Malformed upstream data for one surah — the normalizer's own
        // repair path (dropping invalid segments, re-absorbing their words,
        // flagging them `estimated`) already handles the known bad shapes,
        // so a SegmentValidationError here means a NEW, unrecognised shape
        // slipped through. Record it and carry on to the next surah rather
        // than aborting a 114-surah run over one bad ayah; the corrupt
        // surah's text/timings files are simply never written, and its
        // entry stays absent from surahs.json until this is fixed upstream.
        // A genuine programming error (network, parsing, etc.) is NOT a
        // SegmentValidationError and falls through to the rethrow below,
        // failing the run loudly as it should.
        reportsById.set(surah, err.report);
        console.error(`\n${err.message}`);
      } else if (err instanceof NetworkExhaustedError) {
        // Transient infrastructure, not a defect in this script. Skipping the
        // surah keeps a 114-surah run going; a later run resumes it, since
        // audio already on disk is skipped and JSON is rewritten identically.
        failedSurahs.push(surah);
        console.error(`\nsurah ${surah}: ${err.message} — skipping, re-run to retry`);
      } else {
        throw err;
      }
    }
    // Write manifests after every surah attempt (success or recorded data
    // problem) so an interrupted run leaves them consistent with disk.
    await writeManifests();
  }

  if (failedSurahs.length > 0) {
    console.log(`\nDone, with ${failedSurahs.length} surah(s) skipped on network failure: ${failedSurahs.join(', ')}`);
    console.log('Re-run the same command to retry them — completed files are skipped.');
  } else {
    console.log('Done.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
