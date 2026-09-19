// Writes the browse tree the car service serves natively (no JS needed to
// browse) from the same surah list the app uses. Re-run when surahs.json changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../packages/quran-data/surahs.json');
const out = resolve(here, '../modules/car-media/android/src/main/assets/car-library.json');
const surahs = JSON.parse(readFileSync(src, 'utf8'));
const library = surahs.map(({ id, nameSimple, nameArabic, nameEnglish, ayahCount }) => ({ id, nameSimple, nameArabic, nameEnglish, ayahCount }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(library) + '\n');
console.log(`car-library.json: ${library.length} surahs`);
