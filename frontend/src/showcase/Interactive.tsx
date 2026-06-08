/**
 * Interactive & overlays — the portaled / stateful components, rendered ONCE in the global theme
 * (portals render at <body>, so they follow the top-bar toggle, not a panel's data-theme). Tokens only.
 */
import { Calendar, Eye, Pencil, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  DatePicker,
  DropdownMenu,
  Drawer,
  FileUpload,
  IconButton,
  Modal,
  ModalClose,
  MultiSelect,
  Placeholder,
  Popover,
  Select,
  SelectWithOther,
  type SelectWithOtherValue,
  SplitButton,
  Tabs,
  Tooltip,
  useToast,
} from '../components/ui';
import styles from './Showcase.module.css';

export function Interactive() {
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(['valley_fiber']);
  const [date, setDate] = useState('');
  const [source, setSource] = useState<SelectWithOtherValue>({ value: '' });

  return (
    <div className={styles.row}>
      <Modal
        title="Finalize pay run?"
        description="This will freeze the snapshots and pay 14 reps. It cannot be undone."
        trigger={<Button variant="primary">Open modal</Button>}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button variant="primary">Finalize</Button>
            </ModalClose>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          This will deduct $145 from one rep&rsquo;s next pay run.
        </p>
      </Modal>

      <Drawer title="Sale detail" trigger={<Button variant="secondary">Open drawer</Button>}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          A detail / quick-edit panel without leaving the list.
        </p>
      </Drawer>

      <div className={styles.stack}>
        <Select
          placeholder="Select a client…"
          options={[
            { value: 'vf', label: 'Valley Fiber' },
            { value: 'rf', label: 'RF Now' },
            { value: 'cti', label: 'CTI' },
          ]}
        />
        <MultiSelect
          value={tags}
          onChange={setTags}
          options={[
            { value: 'valley_fiber', label: 'Valley Fiber' },
            { value: 'rf_now', label: 'RF Now' },
            { value: 'cti', label: 'CTI' },
          ]}
        />
        <DatePicker value={date} onChange={setDate} />
        <SelectWithOther
          placeholder="Lead source…"
          value={source.value}
          otherText={source.other_text}
          onChange={setSource}
          options={[
            { value: 'referral', label: 'Referral' },
            { value: 'event', label: 'Event' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>

      <Popover trigger={<Button variant="secondary">Popover</Button>}>
        <p style={{ fontSize: 'var(--text-sm)' }}>Quick filters / column settings live here.</p>
      </Popover>

      <DropdownMenu
        trigger={<Button variant="secondary">Row actions ▾</Button>}
        items={[
          { label: 'View', icon: <Eye size={15} /> },
          { label: 'Edit', icon: <Pencil size={15} /> },
          'separator',
          { label: 'Delete', icon: <Trash2 size={15} />, danger: true },
        ]}
      />

      <SplitButton label="Export" variant="secondary" items={[{ label: 'Export CSV' }, { label: 'Export Excel' }]} />

      <Button variant="secondary" onClick={() => toast({ title: 'Expense approved', description: 'Week of Mar 10.', tone: 'success' })}>
        Show toast
      </Button>

      <Tooltip content="Gross internet tally → tier rate">
        <IconButton label="Help" icon={<Search size={18} />} variant="outline" />
      </Tooltip>

      <div className={styles.stack} style={{ minWidth: 280 }}>
        <Placeholder icon={<Calendar size={16} />} label="Date range" note="deferred" />
        <Placeholder icon={<Search size={16} />} label="Combobox" note="deferred" />
        <FileUpload />
      </div>

      <div className={styles.col} style={{ maxWidth: 460 }}>
        <Tabs
          ariaLabel="Rep detail"
          items={[
            { value: 'profile', label: 'Profile', content: <p style={{ fontSize: 'var(--text-sm)' }}>Profile fields…</p> },
            { value: 'docs', label: 'Documents', content: <p style={{ fontSize: 'var(--text-sm)' }}>Documents…</p> },
            { value: 'equip', label: 'Equipment', content: <p style={{ fontSize: 'var(--text-sm)' }}>Equipment…</p> },
          ]}
        />
      </div>
    </div>
  );
}
