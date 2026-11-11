import { avatarSource } from './avatar.logic';
import { AvatarService } from './avatar.service';

describe('avatarSource — which value is a user\'s photo (2026-11-12)', () => {
  it('a rep: their latest HR headshot, never their own avatar_url', () => {
    expect(avatarSource('https://x/y.png', 'rep-docs/2026/h.jpg', true)).toEqual({ kind: 'path', path: 'rep-docs/2026/h.jpg' });
    expect(avatarSource('avatars/2026/11/a.jpg', null, true)).toBeNull();
    expect(avatarSource(null, 'local://rep-docs/h.jpg', true)).toBeNull(); // stub ref (no storage) → initials
  });
  it('anyone else: their uploaded photo; an old link still shows; anything else → none', () => {
    expect(avatarSource('avatars/2026/11/a.jpg', null, false)).toEqual({ kind: 'path', path: 'avatars/2026/11/a.jpg' });
    expect(avatarSource('https://cdn/x.png', null, false)).toEqual({ kind: 'link', url: 'https://cdn/x.png' });
    expect(avatarSource('receipts/2026/11/r.jpg', null, false)).toBeNull();
    expect(avatarSource('', null, false)).toBeNull();
  });
});

describe('AvatarService.resolve', () => {
  const make = (configured = true) => {
    const prisma = {
      rep: {
        findMany: jest.fn().mockResolvedValue([{ user_id: 'u-rep', rep_documents: [{ file_url: 'rep-docs/2026/head.jpg' }] }, { user_id: 'u-rep2', rep_documents: [] }]),
      },
    };
    const storage = {
      signedUrls: jest.fn(async (paths: string[]) => new Map(configured ? paths.map((p) => [p, `https://signed/${p}`]) : [])),
    };
    return { service: new AvatarService(prisma as never, storage as never), prisma, storage };
  };

  it('signs every path in ONE batch: rep → headshot, admin → own upload, legacy link passes through', async () => {
    const { service, storage, prisma } = make();
    const urls = await service.resolve([
      { id: 'u-rep', avatar_url: 'https://ignored' },
      { id: 'u-rep2', avatar_url: 'avatars/2026/11/x.jpg' },
      { id: 'u-admin', avatar_url: 'avatars/2026/11/a.jpg' },
      { id: 'u-old', avatar_url: 'https://cdn/old.png' },
    ]);
    expect(prisma.rep.findMany.mock.calls[0][0].where).toEqual({ user_id: { in: ['u-rep', 'u-rep2', 'u-admin', 'u-old'] } });
    expect(storage.signedUrls).toHaveBeenCalledTimes(1);
    expect(urls.get('u-rep')).toBe('https://signed/rep-docs/2026/head.jpg');
    expect(urls.get('u-rep2')).toBeNull(); // a rep with no headshot shows initials, even with an avatar_url
    expect(urls.get('u-admin')).toBe('https://signed/avatars/2026/11/a.jpg');
    expect(urls.get('u-old')).toBe('https://cdn/old.png');
  });

  it('storage off → null (initials), never a raw path', async () => {
    const { service } = make(false);
    const [u] = await service.withDisplayUrls([{ id: 'u-admin', avatar_url: 'avatars/2026/11/a.jpg' }]);
    expect(u.avatar_url).toBeNull();
  });
});
