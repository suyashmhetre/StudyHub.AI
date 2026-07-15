const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// Supabase support removed — use S3 or local storage instead
const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
}

class LocalFileStorage {
  constructor(root) { this.root = root; this.kind = 'local'; }
  async init() { fs.mkdirSync(this.root, { recursive: true }); }
  resolved(storagePath) {
    const file = path.resolve(this.root, storagePath);
    if (!file.startsWith(`${this.root}${path.sep}`)) throw new Error('Invalid storage path.');
    return file;
  }
  async upload({ groupId, fileName, buffer }) {
    const storagePath = `${safeSegment(groupId)}/${crypto.randomUUID()}-${safeSegment(fileName)}`;
    const target = this.resolved(storagePath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, buffer);
    return { storagePath };
  }
  async download(storagePath) { return fs.promises.readFile(this.resolved(storagePath)); }
  async remove(storagePath) { if (!storagePath) return; await fs.promises.rm(this.resolved(storagePath), { force: true }); }
  async signedDownload() { return null; }
}

// SupabaseFileStorage removed

class S3FileStorage {
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region }) {
    this.bucket = bucket;
    this.kind = 's3';
    const clientConfig = { region: region || 'us-east-1' };
    if (endpoint) clientConfig.endpoint = endpoint;
    if (accessKeyId && secretAccessKey) clientConfig.credentials = { accessKeyId, secretAccessKey };
    this.client = new S3Client(clientConfig);
  }
  async init() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      // Try to create the bucket if it doesn't exist (best-effort)
      if (err.name === 'NotFound' || /NotFound/i.test(String(err))) {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        } catch (createErr) {
          // ignore create errors and let uploads surface meaningful errors
        }
      }
    }
  }
  async upload({ groupId, fileName, buffer, mimeType }) {
    const storagePath = `${safeSegment(groupId)}/${crypto.randomUUID()}-${safeSegment(fileName)}`;
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: storagePath, Body: buffer, ContentType: mimeType });
    await this.client.send(cmd);
    return { storagePath };
  }
  async download(storagePath) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: storagePath });
    const resp = await this.client.send(cmd);
    const stream = resp.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  async remove(storagePath) { if (!storagePath) return; await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath })); }
  async signedDownload(storagePath, expiresSeconds = 60) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: storagePath });
    return await getSignedUrl(this.client, cmd, { expiresIn: expiresSeconds });
  }
}

async function createFileStorage(config) {
  let storage;
  const provider = (config.storageProvider || '').toLowerCase();
  if (provider === 's3' || config.s3Bucket) {
    storage = new S3FileStorage({ endpoint: config.s3Endpoint, bucket: config.s3Bucket, accessKeyId: config.s3Key, secretAccessKey: config.s3Secret, region: config.s3Region });
  } else {
    // Default to local storage when S3 isn't configured.
    storage = new LocalFileStorage(config.localRoot || path.join(process.cwd(), 'uploads'));
  }
  await storage.init();
  return storage;
}

module.exports = { createFileStorage };
