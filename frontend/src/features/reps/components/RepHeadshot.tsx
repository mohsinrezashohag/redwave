/**
 * The rep's photo: the latest "Headshot" document (client request 2026-11-12, also used for the ID card),
 * opened through a short-lived signed URL. HR (hrm:edit) reads it through the rep's documents; the rep's own
 * view through the token-scoped endpoint. Anyone else, or no headshot yet → initials.
 *
 * `EditableRepHeadshot` adds the hover pen: pick → crop / zoom / rotate → saved straight away as a new
 * headshot (the older ones stay under Documents as history).
 */
import { Avatar, EditableAvatar, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useRepHeadshotUrl, useUploadHeadshot } from '../api/useRepProfile';

export function RepHeadshot({ repId, name, self = false, canOpen }: { repId: string; name: string; self?: boolean; canOpen: boolean }) {
  const url = useRepHeadshotUrl(repId, { self, canOpen });
  return <Avatar name={name} src={url} size="xl" />;
}

export function EditableRepHeadshot({ repId, name }: { repId: string; name: string }) {
  const url = useRepHeadshotUrl(repId, { canOpen: true });
  const upload = useUploadHeadshot();
  const onError = useApiErrorToast();
  const { toast } = useToast();
  return (
    <EditableAvatar
      name={name}
      src={url}
      saveLabel="Save photo"
      onChange={async ({ file }) => {
        try {
          await upload.mutateAsync({ repId, file });
          toast({ title: 'Photo updated', tone: 'success' });
        } catch (e) {
          onError(e);
          throw e;
        }
      }}
    />
  );
}
