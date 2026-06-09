/**
 * NotificationSettingsEditor — the Super-Admin per-event MANAGEMENT surface (SRS §14 / AUTH-013). Per
 * event it edits the channels (in-app / email) and the title/body TEMPLATES (with a documented {variable}
 * hint), and shows the INTRINSIC recipients read-only (from eventCatalogue — recipients are not editable
 * here; free targeting is the Broadcast feature). Local edits are dirty-tracked vs the loaded settings;
 * "Save changes" PATCHes ONLY the changed rows (channels + templates). No per-user override (global, SA-set).
 * Read-only (controls disabled, no Save) without settings:edit. An empty template falls back to the
 * built-in call-site text at render time.
 */
import { useState } from 'react';
import { Badge, Button, FormField, Input, Switch, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useSaveNotificationSettings } from '../../notifications/api/useNotificationSettingsMutation';
import { eventDoc, humanizeEvent } from '../../notifications/eventCatalogue';
import type { NotificationSetting } from '../../notifications/notifications.types';
import styles from './NotificationSettingsEditor.module.css';

interface RowDraft {
  in_app: boolean;
  email: boolean;
  title: string;
  body: string;
}
type Draft = Record<string, RowDraft>;

const toDraft = (s: NotificationSetting): RowDraft => ({
  in_app: s.in_app_enabled,
  email: s.email_enabled,
  title: s.title_template ?? '',
  body: s.body_template ?? '',
});

export function NotificationSettingsEditor({
  settings,
  canEdit,
}: {
  settings: NotificationSetting[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const save = useSaveNotificationSettings();

  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(settings.map((s) => [s.event_type, toDraft(s)])),
  );

  const changedRows = settings.filter((s) => {
    const d = draft[s.event_type];
    if (!d) return false;
    return (
      d.in_app !== s.in_app_enabled ||
      d.email !== s.email_enabled ||
      d.title !== (s.title_template ?? '') ||
      d.body !== (s.body_template ?? '')
    );
  });
  const dirty = changedRows.length > 0;

  const patch = (eventType: string, next: Partial<RowDraft>) =>
    setDraft((prev) => ({ ...prev, [eventType]: { ...prev[eventType], ...next } }));

  const onSave = () => {
    if (!dirty) return;
    const payload = changedRows.map((s) => ({
      event_type: s.event_type,
      in_app_enabled: draft[s.event_type].in_app,
      email_enabled: draft[s.event_type].email,
      title_template: draft[s.event_type].title,
      body_template: draft[s.event_type].body,
    }));
    save.mutate(
      { settings: payload },
      { onSuccess: () => toast({ title: 'Notification settings saved', tone: 'success' }), onError },
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        {settings.map((s) => {
          const d = draft[s.event_type] ?? toDraft(s);
          const doc = eventDoc(s.event_type);
          const isBroadcast = s.event_type === 'broadcast';
          return (
            <section key={s.id} className={styles.card}>
              <header className={styles.head}>
                <div className={styles.headText}>
                  <h3 className={styles.title}>{s.label ?? humanizeEvent(s.event_type)}</h3>
                  <code className={styles.eventKey}>{s.event_type}</code>
                </div>
                <div className={styles.channels}>
                  <label className={styles.channel}>
                    <span>In-app</span>
                    <Switch
                      aria-label={`${s.event_type} in-app`}
                      checked={d.in_app}
                      disabled={!canEdit}
                      onCheckedChange={(c) => patch(s.event_type, { in_app: c })}
                    />
                  </label>
                  <label className={styles.channel}>
                    <span>Email</span>
                    <Switch
                      aria-label={`${s.event_type} email`}
                      checked={d.email}
                      disabled={!canEdit}
                      onCheckedChange={(c) => patch(s.event_type, { email: c })}
                    />
                  </label>
                </div>
              </header>

              <p className={styles.recipients}>
                <span className={styles.recipientsLabel}>Recipients</span> {doc.recipients}
              </p>

              {isBroadcast ? (
                <p className={styles.hint}>
                  The Super Admin supplies the title and body when sending a broadcast — there is no fixed
                  template here.
                </p>
              ) : (
                <div className={styles.templates}>
                  <FormField label="Title template">
                    <Input
                      value={d.title}
                      disabled={!canEdit}
                      placeholder="Built-in default"
                      onChange={(e) => patch(s.event_type, { title: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Body template">
                    <Textarea
                      rows={2}
                      value={d.body}
                      disabled={!canEdit}
                      placeholder="Built-in default"
                      onChange={(e) => patch(s.event_type, { body: e.target.value })}
                    />
                  </FormField>
                  {doc.variables.length > 0 && (
                    <div className={styles.vars}>
                      <span className={styles.varsLabel}>Variables</span>
                      {doc.variables.map((v) => (
                        <Badge key={v} tone="neutral">{`{${v}}`}</Badge>
                      ))}
                      <span className={styles.varsNote}>Leave blank to use the built-in text.</span>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {canEdit && (
        <div className={styles.saveBar}>
          {dirty && <span className={styles.dirtyHint}>{changedRows.length} unsaved change(s)</span>}
          <Button variant="primary" onClick={onSave} disabled={!dirty} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
