/**
 * RepHeadshot — the rep's photo: the latest "Headshot" document (client request 2026-11-12, used later for
 * the ID card), opened through a short-lived signed URL. HR (hrm:edit) reads it through the rep's documents;
 * the rep's own view through the token-scoped endpoint. Anyone else, or no headshot yet → initials.
 */
import { Avatar } from '../../../components/ui';
import { useHeadshotUrl, useMyDocuments, useRepDocuments } from '../api/useRepProfile';

export function RepHeadshot({ repId, name, self = false, canOpen }: { repId: string; name: string; self?: boolean; canOpen: boolean }) {
  const adminDocs = useRepDocuments(repId, canOpen && !self);
  const ownDocs = useMyDocuments(self);
  const docs = (self ? ownDocs : adminDocs).data;
  const url = useHeadshotUrl(repId, docs, self, canOpen || self);
  return <Avatar name={name} src={url.data ?? null} size="lg" />;
}
