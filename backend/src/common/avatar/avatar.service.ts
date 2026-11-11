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
        rep_documents: { where: { doc_type: 'headshot' }, orderBy: { uploaded_at: 'desc' }, take: 1, select: { file_url: true } },
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
