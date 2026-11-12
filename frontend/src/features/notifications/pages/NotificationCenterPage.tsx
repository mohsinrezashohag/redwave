/**
 * NotificationCenterPage — the full notification surface (SRS §14). Server-paginated via <DataTable> with
 * an unread/all filter + search, bulk-select → mark read / mark unread, and row click → deep-link + mark
 * read. Any authenticated user (own-scoped server-side). Reuses the Batch-1 DataTable + the notification hooks.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Input, PageHeader, SegmentedControl } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { relativeTime } from '../../../lib/format/date';
import { resolveNotificationLink } from '../../../lib/notifications/resolveLink';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useBulkMarkRead, useMarkAllRead, useNotificationsList, useSetNotificationRead } from '../api/useNotifications';
import type { AppNotification, NotificationsFilters } from '../notifications.types';
import styles from './NotificationCenter.module.css';

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return <Input type="search" placeholder="Search notifications…" aria-label="Search notifications" value={local} onChange={(e) => setLocal(e.target.value)} />;
}

export default function NotificationCenterPage() {
  const onError = useApiErrorToast(); // mark-read failures surface, never silent
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const filters = useMemo<NotificationsFilters>(
    () => ({ is_read: tab === 'unread' ? false : undefined, search: search || undefined }),
    [tab, search],
  );
  const list = useNotificationsList(filters);
  const setRead = useSetNotificationRead();
  const markAll = useMarkAllRead();
  const bulkMark = useBulkMarkRead();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = list.rows.length > 0 && list.rows.every((n) => selected.has(n.id));
  const setOne = (id: string, next: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (allSelected) list.rows.forEach((n) => s.delete(n.id));
      else list.rows.forEach((n) => s.add(n.id));
      return s;
    });
  const clear = () => setSelected(new Set());

  const activate = (n: AppNotification) => {
    if (!n.is_read) setRead.mutate({ id: n.id, is_read: true }, { onError });
    const to = resolveNotificationLink(n);
    if (to) navigate(to);
  };
  const runBulk = (read: boolean) =>
    bulkMark.mutate({ ids: [...selected], read }, { onSuccess: clear, onError });

  const columns: DataColumn<AppNotification>[] = [
    { id: 'status', header: '', render: (n) => <span className={styles.dot} data-on={!n.is_read} aria-label={n.is_read ? 'read' : 'unread'} /> },
    {
      id: 'content',
      header: 'Notification',
      render: (n) => (
        <button type="button" className={styles.content} onClick={() => activate(n)}>
          <span className={n.is_read ? styles.title : styles.titleUnread}>{n.title}</span>
          <span className={styles.text}>{n.body}</span>
        </button>
      ),
    },
    { id: 'type', header: 'Type', render: (n) => <Badge tone="neutral">{humanize(n.type)}</Badge> },
    { id: 'when', header: 'When', render: (n) => relativeTime(n.created_at) },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notifications"
        subtitle="Your activity and approvals across the platform."
        actions={
          <Button variant="secondary" onClick={() => markAll.mutate(undefined, { onError })} loading={markAll.isPending}>
            Mark all read
          </Button>
        }
      />
      <div className={styles.filters}>
        <SegmentedControl<'all' | 'unread'>
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className={styles.search}>
          <SearchBox value={search} onChange={setSearch} />
        </div>
      </div>
      <DataTable<AppNotification>
        columns={columns}
        rows={list.rows}
        getRowId={(n) => n.id}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        selectedIds={selected}
        onSelect={setOne}
        onToggleAll={toggleAll}
        allSelectableSelected={allSelected}
        bulkActions={
          <>
            <Button variant="secondary" size="sm" onClick={() => runBulk(true)} loading={bulkMark.isPending}>
              Mark read
            </Button>
            <Button variant="secondary" size="sm" onClick={() => runBulk(false)} loading={bulkMark.isPending}>
              Mark unread
            </Button>
            <Button variant="tertiary" size="sm" onClick={clear}>
              Clear
            </Button>
          </>
        }
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyNode={<p className="mono">You're all caught up.</p>}
        aria-label="Notifications"
      />
    </div>
  );
}
