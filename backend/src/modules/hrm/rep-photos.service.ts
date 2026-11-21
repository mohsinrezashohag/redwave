/**
 * RepPhotosService — the admin export of rep photos as one ZIP. — client meeting 2026-11-16
 *
 * Inputs: the same filters as the rep list (status / field manager / search; default active reps). For each
 * rep, the photo is their LATEST LIVE headshot (rep_documents doc_type 'headshot', deleted_at null — the same
 * one AvatarService shows). Output: a ZIP of `<rep_code>-<full_name>.jpg|png` plus `manifest.txt` listing the
 * reps that were skipped (no photo, or the stored file could not be read). Owns no table; reads reps +
 * rep_documents. The export is audited (who, filters, how many) without any names or paths in the audit row.
 * Gated hrm:edit in the controller: the photos are the ID-card pictures.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { todayInWinnipeg } from '../../common/timezone';
import { repStatusWhere } from './reps.service';
import { sortByRepCode } from './rep-code.logic';
import { buildZip, ZipEntry } from './zip.logic';

export interface PhotoExportFilters {
  status?: 'active' | 'terminated' | 'all';
  fieldManagerId?: string;
  search?: string;
}

export interface PhotoExportFile {
  filename: string;
  bytes: Buffer;
  included: number;
  skipped: number;
}

/** Safe file-name part: letters/digits/dot/dash/underscore kept, anything else collapsed to one dash. Pure. */
export function safeNamePart(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // drop accents (é → e) so every unzipper shows the name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'rep'
  );
}

/** The photo's extension from its stored path ('.png' → png; everything else is a JPEG). Pure. */
export function photoExtension(path: string): 'jpg' | 'png' {
  return /\.png$/i.test(path) ? 'png' : 'jpg';
}

/** `<rep_code>-<full_name>.<ext>`, made unique within the archive. Pure. */
export function photoFileName(repCode: string, fullName: string, ext: string, taken: Set<string>): string {
  const base = `${safeNamePart(repCode)}-${safeNamePart(fullName)}`;
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}.${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

const CONCURRENCY = 5;

@Injectable()
export class RepPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async exportZip(filters: PhotoExportFilters, actorId: string, now: Date = new Date()): Promise<PhotoExportFile> {
    // The photos live in object storage; without it there is nothing to export (a clear 503, not an empty zip).
    this.storage.assertConfigured();

    const where: Prisma.RepWhereInput = {
      ...repStatusWhere(filters.status),
      ...(filters.fieldManagerId ? { field_manager_id: filters.fieldManagerId } : {}),
      ...(filters.search
        ? {
            OR: [
              { full_name: { contains: filters.search, mode: 'insensitive' } },
              { rep_code: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const reps = sortByRepCode(
      await this.prisma.rep.findMany({ where, select: { id: true, rep_code: true, full_name: true } }),
      'asc',
    );
    const docs = reps.length
      ? await this.prisma.repDocument.findMany({
          where: { rep_id: { in: reps.map((r) => r.id) }, doc_type: 'headshot', deleted_at: null },
          orderBy: { uploaded_at: 'desc' },
          select: { rep_id: true, file_url: true },
        })
      : [];
    const latest = new Map<string, string>();
    for (const d of docs) if (!latest.has(d.rep_id)) latest.set(d.rep_id, d.file_url);

    // Download in small parallel batches (a roster is hundreds of photos at most).
    const bytes = new Map<string, Buffer | null>();
    const withPhoto = reps.filter((r) => latest.has(r.id));
    for (let i = 0; i < withPhoto.length; i += CONCURRENCY) {
      const chunk = withPhoto.slice(i, i + CONCURRENCY);
      const got = await Promise.all(chunk.map((r) => this.storage.download(latest.get(r.id)!)));
      chunk.forEach((r, j) => bytes.set(r.id, got[j]));
    }

    const entries: ZipEntry[] = [];
    const skipped: string[] = [];
    const taken = new Set<string>(['manifest.txt']);
    for (const rep of reps) {
      const path = latest.get(rep.id);
      const data = bytes.get(rep.id);
      if (!path) {
        skipped.push(`${rep.rep_code}  ${rep.full_name}  (no photo on file)`);
      } else if (!data) {
        skipped.push(`${rep.rep_code}  ${rep.full_name}  (the photo file could not be read)`);
      } else {
        entries.push({ name: photoFileName(rep.rep_code, rep.full_name, photoExtension(path), taken), data });
      }
    }

    const today = todayInWinnipeg(now);
    const manifest = [
      `Redwave rep photos, exported ${today}`,
      `${entries.length} photo(s) included, ${skipped.length} rep(s) skipped.`,
      '',
      ...(skipped.length ? ['Skipped:', ...skipped] : ['Every rep in this export has a photo.']),
      '',
    ].join('\r\n');
    const zip = buildZip([...entries, { name: 'manifest.txt', data: Buffer.from(manifest, 'utf8') }], now);

    await this.audit.log({
      actorId,
      entityType: 'reps',
      entityId: actorId,
      action: 'export_photos',
      after: {
        status: filters.status ?? 'active',
        field_manager_id: filters.fieldManagerId ?? null,
        search: filters.search ?? null,
        included: entries.length,
        skipped: skipped.length,
      },
    });
    return { filename: `redwave-rep-photos-${today}.zip`, bytes: zip, included: entries.length, skipped: skipped.length };
  }
}
