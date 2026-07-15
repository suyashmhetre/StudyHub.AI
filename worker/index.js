require('dotenv').config();
const path = require('node:path');
const { createStore, id, now } = require('../lib/store');
const { createFileStorage } = require('../lib/storage');
const { extractText, chunkText } = require('../lib/document');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS || 5000);

async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function processResource(store, fileStorage, resource) {
  try {
    await store.updateResourceIndexStatus(resource.id, 'indexing', null);
    const buffer = await fileStorage.download(resource.storagePath);
    let text = '';
    try { text = await extractText({ buffer, mimeType: resource.mimeType, fileName: resource.fileName }); } catch (err) { text = ''; }
    if (!text || text.length < 20) {
      await store.updateResourceIndexStatus(resource.id, 'needs_ai', 'No usable text was found during indexing.');
      return;
    }
    const chunks = chunkText(text).map((content, position) => ({ id: id('chunk'), groupId: resource.groupId, resourceId: resource.id, resourceTitle: resource.title, position, content, createdAt: now() }));
    await store.addChunks(resource.id, chunks);
    await store.updateResource(resource.id, { indexStatus: 'indexed', indexError: null, textLength: text.length });
    console.log(`Indexed resource ${resource.id} -> ${chunks.length} chunks`);
  } catch (error) {
    console.error('Worker failed processing resource', resource.id, error);
    try { await store.updateResourceIndexStatus(resource.id, 'failed', String(error.message || error)); } catch (_) { /* ignore */ }
  }
}

async function run() {
  const store = await createStore({ mongoUri: process.env.MONGODB_URI, databaseName: process.env.MONGODB_DATABASE, dataFile: path.join(DATA_DIR, 'db.json') });
  const fileStorage = await createFileStorage({ storageProvider: process.env.STORAGE_PROVIDER, localRoot: path.join(DATA_DIR, 'uploads'), s3Bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET, s3Key: process.env.S3_KEY || process.env.AWS_ACCESS_KEY_ID, s3Secret: process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY, s3Endpoint: process.env.S3_ENDPOINT, s3Region: process.env.S3_REGION || process.env.AWS_REGION });
  console.log('Worker started — watching for resources to index.');
  while (true) {
    try {
      const pending = await store.getResourcesByIndexStatus('pending', 10);
      for (const resource of pending) {
        // process sequentially for simplicity
        await processResource(store, fileStorage, resource);
      }
    } catch (err) { console.error('Worker loop error:', err); }
    await sleep(POLL_INTERVAL_MS);
  }
}

if (require.main === module) run().catch((err) => { console.error('Worker failed to start:', err); process.exitCode = 1; });

module.exports = { run };
