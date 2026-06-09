/**
 * StorageService — real object-storage uploads to a Supabase Storage bucket, with access-controlled
 * (signed) URLs. Env-gated + graceful: reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 * SUPABASE_STORAGE_BUCKET; when any is missing it returns a selection-only reference (no real upload),
 * so the feature works without storage configured and the operator lights it up later. The service-role
 * key is a server-only secret (never exposed to the browser). — arch §11 / CLAUDE §12
 */
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
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

export interface StoredFile {
  /** A viewable URL (signed when stored in Supabase; a placeholder reference in fallback mode). */
  url: string;
  /** True when the file was really uploaded to object storage; false in selection-only fallback mode. */
  stored: boolean;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year — re-signing on read is a future refinement

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

  /**
   * Upload a receipt under a unique key and return a signed URL. When storage is unconfigured, returns a
   * selection-only reference (graceful fallback) so the receipt field still works.
   */
  async uploadReceipt(file: UploadedFile): Promise<StoredFile> {
    const safeName = sanitize(file.originalname);
    if (!this.client) {
      // No storage configured — selection-only reference (matches the prior stubbed behaviour).
      return { url: `local://receipts/${safeName}`, stored: false };
    }

    const key = `${new Date().getUTCFullYear()}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await this.client.storage
      .from(this.bucket)
      .upload(key, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadError) {
      this.logger.error(`Receipt upload failed: ${uploadError.message}`);
      throw new InternalServerErrorException('failed to store the receipt');
    }

    const { data, error: signError } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (signError || !data) {
      this.logger.error(`Receipt sign-url failed: ${signError?.message ?? 'no data'}`);
      throw new InternalServerErrorException('failed to sign the receipt URL');
    }
    return { url: data.signedUrl, stored: true };
  }
}

/** Keep the original filename's stem/extension but strip path + unsafe characters for the storage key. */
function sanitize(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}
