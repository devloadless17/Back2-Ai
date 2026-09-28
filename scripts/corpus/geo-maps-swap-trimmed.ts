/**
 * Point four geography map occurrences at their header-trimmed images.
 *
 *   node --conditions=react-server --env-file=.env --import tsx scripts/corpus/geo-maps-swap-trimmed.ts [--undo]
 *
 * geo_maps_trim.py wrote the trimmed bytes beside the originals; the original
 * crop files stay untouched, because backfill-visuals checks them against C2.
 * This uploads each trimmed image content-addressed, records it as a visual
 * asset, and moves the occurrence onto it. The previous asset and key are kept
 * in corpus/geo-maps/trimmed/swap-receipt.json; --undo restores them. A later
 * backfill run may put an occurrence back on its original crop — the relation
 * survives either way, only the header strip returns.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { db } from '../../src/lib/db';
import { putContentAddressed } from '../../src/lib/storage';

const TRIM = 'corpus/geo-maps/trimmed/trim.json';
// On production corpus/ is a read-only mount: pass --receipt ops-in/geo-swap-receipt.json.
const i = process.argv.indexOf('--receipt');
const RECEIPT = i > 0 ? process.argv[i + 1]! : 'corpus/geo-maps/trimmed/swap-receipt.json';

async function main() {
  if (process.argv.includes('--undo')) {
    const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8')) as Array<{ occurrenceId: string; assetId: string; storageKey: string }>;
    for (const r of receipt) {
      await db.visualOccurrence.update({ where: { id: r.occurrenceId }, data: { assetId: r.assetId, storageKey: r.storageKey } });
    }
    console.log(`restored ${receipt.length}`);
    return;
  }
  const trims = JSON.parse(readFileSync(TRIM, 'utf8')) as Record<string, { src: string; dst: string }>;
  const receipt = [];
  for (const t of Object.values(trims)) {
    // By natural key, so the same file works where occurrence ids differ:
    // corpus/text/<paper sha256>/figures/<crop name>.jpg
    const [, paperSha256, cropName] = /text\/([0-9a-f]{64})\/figures\/([0-9a-f]+)\.jpg$/.exec(t.src)!;
    const occ = await db.visualOccurrence.findFirst({ where: { paperSha256, cropName }, select: { id: true, assetId: true, storageKey: true, access: true } });
    if (!occ) { console.log('not here, skipped:', cropName); continue; }
    const occurrenceId = occ.id;
    if (occ.access !== 'question') throw new Error(`${occurrenceId} is not question-access`);
    const bytes = readFileSync(t.dst);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `question-images/${hash}.jpg`;
    const put = await putContentAddressed(key, bytes, 'image/jpeg');
    const asset = await db.visualAsset.upsert({
      where: { contentHash: hash },
      create: { contentHash: hash, mediaType: 'image/jpeg', byteSize: bytes.length },
      update: {},
    });
    receipt.push({ occurrenceId, assetId: occ.assetId, storageKey: occ.storageKey, newKey: key });
    await db.visualOccurrence.update({ where: { id: occurrenceId }, data: { assetId: asset.id, storageKey: key } });
    console.log(occurrenceId.slice(0, 8), put, key);
  }
  writeFileSync(RECEIPT, JSON.stringify(receipt, null, 1));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
