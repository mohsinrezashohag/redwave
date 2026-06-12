/**
 * StorageService — real object-storage uploads to a Supabase Storage bucket, with access-controlled
 * (signed) URLs. Env-gated + graceful: reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 * SUPABASE_STORAGE_BUCKET; when any is missing it returns a selection-only `local://` reference (no real
 * upload), so callers work without storage configured and the operator lights it up later. The
 * service-role key is a server-only secret (never exposed to the browser). — arch §11 / CLAUDE §12
 *
 * Two shapes of result:
 *  - `StoredObject { path, stored }` — `upload`/`uploadBuffer` return the object PATH (the row stores the
 *    path; access goes through a freshly-signed short-TTL URL on each read via `signedUrl`). This is the
 *    "access-controlled, not public" model used by Documents/HRM.
 *  - `StoredFile { url, stored }` — the legacy `uploadReceipt` returns a long-lived signed URL stored
 *    directly on the row (Batch-5 receipts; kept for backward compatibility).
 */
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/** Minimal uploaded-file shape (a subset of Express.Multer.File) — keeps callers decoupled from multer. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Result of storing an object — the PATH to persist (re-signed on read), + whether it was really stored. */
export interface StoredObject {
  /** The object key within the bucket (real) or a `local://…` reference (fallback mode). */
  path: string;
  /** True when the file was really uploaded to object storage; false in selection-only fallback mode. */
  stored: boolean;
}

/** Legacy result — a viewable URL stored directly on the row (receipts). */
export interface StoredFile {
  url: string;
  stored: boolean;
}

const SIGNED_URL_TTL_RECEIPT = 60 * 60 * 24 * 365; // 1 year — receipts store the URL directly (legacy)
const SIGNED_URL_TTL_SHORT = 60 * 5; // 5 minutes — minted per access for path-backed files (documents/HRM)

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: SupabaseClient | null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const serviceKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'receipts';
    this.client =
      url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  }

  /** True when a Supabase bucket is configured (so uploads are real + access-controlled). */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /** The configured bucket name (recorded on stored_files rows). */
  get bucketName(): string {
    return this.bucket;
  }

  /**
   * FAIL-SAFE gate for the unified file pipeline: unlike the legacy graceful `local://` fallback, the
   * /v1/files endpoints REFUSE to run without storage — a clear 503, never a silent stub reference.
   */
  assertConfigured(): void {
    if (!this.client) {
      throw new ServiceUnavailableException('file storage not configured');
    }
  }

  /**
   * Store a buffer under an EXACT server-generated key (the /v1/files pipeline builds
   * "{purpose}s/yyyy/mm/uuid.ext" itself — never a client-supplied or filename-derived path).
   * Requires configured storage (assertConfigured) — no fallback reference here.
   */
  async uploadObject(path: string, buffer: Buffer, contentType: string): Promise<void> {
    this.assertConfigured();
    await this.putObject(path, buffer, contentType);
  }

  /** Store an uploaded file under `${folder}/${yyyy}/${uuid}-${name}`; returns the PATH (re-signed on read). */
  async upload(folder: string, file: UploadedFile): Promise<StoredObject> {
    const safeName = sanitize(file.originalname);
    if (!this.client) {
      return { path: `local://${folder}/${safeName}`, stored: false };
    }
    const key = objectKey(folder, safeName);
    await this.putObject(key, file.buffer, file.mimetype);
    return { path: key, stored: true };
  }

  /** Store a server-generated buffer (e.g. a pdf-lib stamped copy, or a signature PNG); returns the PATH. */
  async uploadBuffer(folder: string, filename: string, buffer: Buffer, contentType: string): Promise<StoredObject> {
    const safeName = sanitize(filename);
    if (!this.client) {
      return { path: `local://${folder}/${safeName}`, stored: false };
    }
    const key = objectKey(folder, safeName);
    await this.putObject(key, buffer, contentType);
    return { path: key, stored: true };
  }

  /** Download a stored object's bytes (e.g. the original PDF to stamp). Null when unstored/unconfigured. */
  async download(path: string): Promise<Buffer | null> {
    if (!this.client || !path || path.startsWith('local://')) return null;
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) {
      this.logger.warn(`Storage download failed for ${path}: ${error?.message ?? 'no data'}`);
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** Mint a fresh short-TTL signed URL for a stored PATH; null when unconfigured / a local ref / on error. */
  async signedUrl(path: string, ttlSeconds: number = SIGNED_URL_TTL_SHORT): Promise<string | null> {
    if (!this.client || !path || path.startsWith('local://')) return null;
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) {
      this.logger.warn(`Sign-url failed for ${path}: ${error?.message ?? 'no data'}`);
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Legacy: upload a receipt and return a long-lived signed URL stored directly on the row. When storage
   * is unconfigured, returns a selection-only reference (graceful fallback). — Batch 5
   */
  async uploadReceipt(file: UploadedFile): Promise<StoredFile> {
    const obj = await this.upload('receipts', file);
    if (!obj.stored) {
      return { url: obj.path, stored: false };
    }
    const url = await this.signedUrl(obj.path, SIGNED_URL_TTL_RECEIPT);
    if (!url) {
      throw new InternalServerErrorException('failed to sign the receipt URL');
    }
    return { url, stored: true };
  }

  private async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client!.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: false });
    if (error) {
      this.logger.error(`Storage upload failed for ${key}: ${error.message}`);
      throw new InternalServerErrorException('failed to store the file');
    }
  }
}

/** Build a unique object key: `${folder}/${yyyy}/${uuid}-${safeName}`. */
function objectKey(folder: string, safeName: string): string {
  return `${folder}/${new Date().getUTCFullYear()}/${randomUUID()}-${safeName}`;
}

/** Keep the original filename's stem/extension but strip path + unsafe characters for the storage key. */
function sanitize(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}
