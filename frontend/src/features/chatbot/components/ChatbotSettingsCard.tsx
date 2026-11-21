/**
 * ChatbotSettingsCard — the Super Admin's switch for the AI assistant: turn the language model on or off and
 * pick its model id. Reads GET /v1/chatbot/config (settings:view) and saves PATCH /v1/chatbot/config
 * (settings:edit, Super Admin; the server is the real gate). The API key is never shown: the card only says
 * whether GEMINI_API_KEY is set on the server, because without it the assistant stays in basic mode.
 * Mounted by the coordinator in Settings. Tokens only.
 */
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Banner, Button, Card, FormField, Input, Switch, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { useChatbotConfig, useSaveChatbotConfig } from '../api/useChatMutations';
import { MODEL_SUGGESTIONS } from '../chatbot.types';
import styles from './chatbot.module.css';

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function ChatbotSettingsCard() {
  const canView = useCan('settings:view');
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const q = useChatbotConfig(canView);
  const save = useSaveChatbotConfig();

  const [active, setActive] = useState(false);
  const [model, setModel] = useState('');

  useEffect(() => {
    if (q.data) {
      setActive(q.data.is_active);
      setModel(q.data.model);
    }
  }, [q.data]);

  if (!canView || isForbidden(q.error)) return null;

  const trimmed = model.trim();
  const modelError =
    trimmed.length === 0 ? 'Enter a model id.' : trimmed.length > 64 || !MODEL_ID.test(trimmed) ? 'Use a model id like gemini-2.5-flash.' : undefined;
  const dirty = !!q.data && (active !== q.data.is_active || trimmed !== q.data.model);

  const onSave = () => {
    if (modelError) return;
    save.mutate(
      { is_active: active, model: trimmed },
      { onSuccess: () => toast({ title: 'Assistant settings saved', tone: 'success' }), onError },
    );
  };

  return (
    <Card
      title="AI assistant"
      actions={q.data ? <Badge tone={q.data.mode === 'ai' ? 'success' : 'muted'}>{q.data.mode === 'ai' ? 'AI on' : 'Basic'}</Badge> : undefined}
    >
      <DataState isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()}>
        <div className={styles.settings}>
          <div className={styles.settingsRow}>
            <div>
              <strong className={styles.settingsLabel}>Use the language model</strong>
              <p className={styles.note}>
                When on, the assistant understands free-form questions and answers from the asker&apos;s own data
                only. When off, it answers a few set questions.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} disabled={!canEdit} aria-label="Use the language model" tone="success" />
          </div>

          <FormField label="Model" help="The Gemini model id. Faster models answer sooner and cost less." error={modelError}>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!canEdit}
              list="chatbot-model-suggestions"
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <datalist id="chatbot-model-suggestions">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {q.data && !q.data.api_key_configured && (
            <Banner tone="warning" title="No API key on the server">
              Set GEMINI_API_KEY in the backend environment. Until then the assistant stays in basic mode, even
              when the switch is on.
            </Banner>
          )}

          {canEdit && (
            <div>
              <Button leftIcon={<Save size={16} />} variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty || !!modelError}>
                Save changes
              </Button>
            </div>
          )}
        </div>
      </DataState>
    </Card>
  );
}
