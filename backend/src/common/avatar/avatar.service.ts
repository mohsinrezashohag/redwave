/**
 * AvatarService — turns users' stored photo references into DISPLAYABLE URLs for API responses. Files sit
 * in the private bucket and an <img> can't send the bearer token, so each read mints a signed URL (1 h,
 * one batch call per response). `avatar_url` in responses therefore carries a display URL, never a path.
 * Storage off → null (the UI falls back to initials). Rules: avatar.logic.ts. — client decision 2026-11-12
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { avatarSource } from './avatar.logic';

export const AVATAR_URL_TTL_SECONDS = 60 * 60;

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Display URL per user id. */
  async resolve(users: { id: string; avatar_url: string | null }[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (users.length === 0) return out;
    const reps = await this.prisma.rep.findMany({
      where: { user_id: { in: users.map((u) => u.id) } },
      select: {
        user_id: true,
        rep_documents: { where: { doc_type: 'headshot', deleted_at: null }, orderBy: { uploaded_at: 'desc' }, take: 1, select: { file_url: true } },
      },
    });
    const repByUser = new Map(reps.map((r) => [r.user_id as string, r.rep_documents[0]?.file_url ?? null]));

    const sources = users.map((u) => ({ id: u.id, src: avatarSource(u.avatar_url, repByUser.get(u.id), repByUser.has(u.id)) }));
    const paths = [...new Set(sources.flatMap((s) => (s.src?.kind === 'path' ? [s.src.path] : [])))];
    const signed = await this.storage.signedUrls(paths, AVATAR_URL_TTL_SECONDS);
    for (const { id, src } of sources) {
      out.set(id, !src ? null : src.kind === 'link' ? src.url : (signed.get(src.path) ?? null));
    }
    return out;
  }

  /**
   * Display URL per REP id: their latest HR headshot, signed in one batch. For rep-shaped responses (reps
   * list, leaderboard, sales, pay runs, search…) — a rep's photo shows wherever the rep is shown. A rep with
   * no headshot (or storage off) → null, and the UI shows initials. — 2026-11-12
   */
  async resolveReps(repIds: string[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(repIds.filter(Boolean))];
    const out = new Map<string, string | null>();
    if (ids.length === 0) return out;
    const docs = await this.prisma.repDocument.findMany({
      where: { rep_id: { in: ids }, doc_type: 'headshot', deleted_at: null },
      orderBy: { uploaded_at: 'desc' },
      select: { rep_id: true, file_url: true },
    });
    const latest = new Map<string, string>();
    for (const d of docs) if (!latest.has(d.rep_id)) latest.set(d.rep_id, d.file_url);
    const paths = [...new Set([...latest.values()].filter((p) => !p.startsWith('local://')))];
    const signed = await this.storage.signedUrls(paths, AVATAR_URL_TTL_SECONDS);
    for (const id of ids) {
      const path = latest.get(id);
      out.set(id, path ? (signed.get(path) ?? null) : null);
    }
    return out;
  }

  /** Add `photo_url` to rep-shaped rows, read from `repId(row)`. */
  async withRepPhotos<T>(rows: T[], repId: (row: T) => string | null | undefined): Promise<(T & { photo_url: string | null })[]> {
    const urls = await this.resolveReps(rows.map((r) => repId(r) ?? '').filter(Boolean));
    return rows.map((r) => {
      const id = repId(r);
      return { ...r, photo_url: id ? (urls.get(id) ?? null) : null };
    });
  }

  /** Replace `avatar_url` on each user with its display URL. */
  async withDisplayUrls<T extends { id: string; avatar_url: string | null }>(users: T[]): Promise<T[]> {
    const urls = await this.resolve(users);
    return users.map((u) => ({ ...u, avatar_url: urls.get(u.id) ?? null }));
  }

  async withDisplayUrl<T extends { id: string; avatar_url: string | null }>(user: T | null): Promise<T | null> {
    if (!user) return user;
    return (await this.withDisplayUrls([user]))[0];
  }

  /** A signed URL for a just-uploaded (not yet approved) photo path — the review queue's preview. */
  async previewPath(path: string | null | undefined): Promise<string | null> {
    const src = avatarSource(path, null, false);
    if (!src) return null;
    if (src.kind === 'link') return src.url;
    return (await this.storage.signedUrls([src.path], AVATAR_URL_TTL_SECONDS)).get(src.path) ?? null;
  }
}
