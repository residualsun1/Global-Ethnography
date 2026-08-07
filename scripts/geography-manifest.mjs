import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const geographyDirectory = new URL('../public/assets/geography/', import.meta.url);
const adminDirectory = new URL('../public/assets/geography/admin1/', import.meta.url);
const manifestPath = new URL('../public/assets/geography/manifest.json', import.meta.url);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = async url => sha256(await readFile(url));
const adminFiles = (await readdir(adminDirectory)).filter(name => name.endsWith('.json')).sort();
const adminEntries = await Promise.all(adminFiles.map(async name => `${name}:${await fileHash(new URL(name, adminDirectory))}`));

const countries = JSON.parse(await readFile(new URL('../public/assets/geography/countries.json', import.meta.url), 'utf8'));
const cities = JSON.parse(await readFile(new URL('../src/data/cities.json', import.meta.url), 'utf8'));
const manifest = {
  schemaVersion: 1,
  policy: 'version-controlled-read-only-geography',
  countries: { count: countries.length, sha256: await fileHash(new URL('../public/assets/geography/countries.json', import.meta.url)) },
  admin1: { fileCount: adminFiles.length, sha256: sha256(adminEntries.join('\n')) },
  cities: { count: cities.length, sha256: await fileHash(new URL('../src/data/cities.json', import.meta.url)) }
};

if (process.argv.includes('--verify')) {
  const stored = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (JSON.stringify(stored) !== JSON.stringify(manifest)) {
    console.error('Geography integrity check failed. Run npm run geography:manifest only after reviewing an intentional geography update.');
    process.exitCode = 1;
  } else {
    console.log(`Verified ${manifest.countries.count} countries, ${manifest.admin1.fileCount} admin-1 files and ${manifest.cities.count} cities.`);
  }
} else {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${join(geographyDirectory.pathname, 'manifest.json')}`);
}
