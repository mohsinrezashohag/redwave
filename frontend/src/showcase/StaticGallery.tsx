/**
 * StaticGallery — the in-flow components, rendered inside each ThemePanel (light + dark). Stateless
 * enough to render twice independently. Tokens only. Demonstrates §6 components + §4 typography + §3
 * palette in both themes.
 */
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  BulkActionBar,
  Banner,
  Button,
  Card,
  Checkbox,
  Delta,
  FormField,
  IconButton,
  Input,
  Logo,
  MoneyInput,
  ProposedChip,
  RadioGroup,
  SegmentedControl,
  Skeleton,
  StatusPill,
  Switch,
  Table,
  TableSkeleton,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
  type Density,
  type SaleStatus,
} from '../components/ui';
import styles from './Showcase.module.css';

const STATUSES: SaleStatus[] = ['entered', 'validated', 'in_pay_run', 'paid', 'clawed_back', 'deleted', 'pending'];
const PALETTE = ['--brand-900', '--accent-600', '--surface-1', '--surface-2', '--success', '--warning', '--danger', '--info'];

const ROWS = [
  { id: '2026-03-10-VF', cust: 'Jane Doe', status: 'validated' as SaleStatus, amt: '145.00' },
  { id: '2026-03-10-RF-1', cust: 'Sam Lee', status: 'paid' as SaleStatus, amt: '110.00' },
  { id: '2026-03-11-CTI', cust: 'Aria Khan', status: 'clawed_back' as SaleStatus, amt: '30.00' },
];

export function StaticGallery() {
  const [density, setDensity] = useState<Density>('comfortable');
  const [selected, setSelected] = useState(false);

  return (
    <>
      {/* Brand / Logo — full + icon-mark; ink follows the theme text token, orange is var(--brand-orange). */}
      <div>
        <p className={styles.label}>Brand / Logo</p>
        <div className={styles.row} style={{ alignItems: 'center' }}>
          <Logo variant="full" size="lg" />
          <Logo variant="full" size="md" />
          <Logo variant="mark" size="lg" />
          <Logo variant="mark" size="md" />
        </div>
      </div>

      {/* Typography & KPI */}
      <div>
        <p className={styles.label}>Typography &amp; KPI</p>
        <div className={styles.row}>
          <div>
            <div className={styles.kpiLabel}>Estimated commission</div>
            <div className={styles.kpi}>$3,310.00</div>
          </div>
          <div className={styles.stack}>
            <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>Page title</h1>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>Section header</h2>
            <p style={{ fontSize: 'var(--text-base)' }}>Body text — 14px operations default.</p>
            <p className="mono" style={{ fontSize: 'var(--text-sm)' }}>SALE-2026-03-10-VF · $1,234.56</p>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div>
        <p className={styles.label}>Buttons</p>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="destructive" leftIcon={<Trash2 size={16} />}>
            Delete
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="primary" size="sm">
            sm
          </Button>
          <Button variant="primary" size="lg">
            lg
          </Button>
          <IconButton label="Edit" icon={<Pencil size={18} />} variant="outline" />
        </div>
      </div>

      {/* Status & badges */}
      <div>
        <p className={styles.label}>Status, badges &amp; deltas</p>
        <div className={styles.row}>
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
          <ProposedChip />
          <Badge tone="accent">Accent</Badge>
          <Delta value="+12" direction="up" />
          <Delta value="-3" direction="down" />
        </div>
      </div>

      {/* Form controls */}
      <div>
        <p className={styles.label}>Form controls</p>
        <div className={styles.grid}>
          <FormField label="Rep name" help="As it appears on documents.">
            <Input placeholder="Jane Doe" />
          </FormField>
          <FormField label="Rep code" error="Rep code already in use" required>
            <Input defaultValue="RW-014" />
          </FormField>
          <FormField label="Commission amount">
            <MoneyInput defaultValue="145.00" />
          </FormField>
          <FormField label="Notes">
            <Textarea placeholder="Add a note…" maxLength={120} />
          </FormField>
        </div>
        <div className={styles.row} style={{ marginTop: 'var(--space-3)' }}>
          <Checkbox label="Greenfield request" defaultChecked />
          <Checkbox label="Indeterminate" checked="indeterminate" />
          <Switch label="Email notifications" defaultChecked />
          <RadioGroup
            ariaLabel="Trip type"
            defaultValue="round"
            options={[
              { value: 'single', label: 'Single trip' },
              { value: 'round', label: 'Round trip' },
            ]}
          />
          <SegmentedControl
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'dense', label: 'Dense' },
            ]}
            value={density}
            onChange={setDensity}
            ariaLabel="Table density"
          />
        </div>
      </div>

      {/* Table */}
      <div>
        <p className={styles.label}>Table (money mono, right-aligned)</p>
        {selected && (
          <BulkActionBar count={1}>
            <Button variant="primary" size="sm">
              Validate
            </Button>
          </BulkActionBar>
        )}
        <Table density={density}>
          <THead>
            <TR>
              <TH>
                <Checkbox aria-label="Select all" checked={selected ? true : false} onCheckedChange={(c) => setSelected(c === true)} />
              </TH>
              <TH sortable sortDirection="asc">
                Sale ID
              </TH>
              <TH>Customer</TH>
              <TH>Status</TH>
              <TH align="right">Amount</TH>
              <TH align="right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((r) => (
              <TR key={r.id} selected={selected}>
                <TD>
                  <Checkbox aria-label={`Select ${r.id}`} checked={selected ? true : false} onCheckedChange={(c) => setSelected(c === true)} />
                </TD>
                <TD numeric>{r.id}</TD>
                <TD>{r.cust}</TD>
                <TD>
                  <StatusPill status={r.status} />
                </TD>
                <TD numeric>${r.amt}</TD>
                <TD align="right">
                  <IconButton label="Edit" icon={<Pencil size={15} />} size="sm" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Containers */}
      <div>
        <p className={styles.label}>Cards, banners &amp; loading</p>
        <div className={styles.grid}>
          <Card title="Pending holdback">
            <div className={styles.kpi}>$993.00</div>
            <p className={styles.kpiLabel}>Releases next cycle</p>
          </Card>
          <Card title="Add a rep" actions={<IconButton label="Add" icon={<Plus size={16} />} variant="outline" size="sm" />}>
            <Skeleton height="14px" width="80%" />
            <div style={{ height: 'var(--space-2)' }} />
            <Skeleton height="14px" width="60%" />
          </Card>
        </div>
        <div className={styles.col} style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="info" title="This sale is paid">
            Snapshots are locked — corrections happen via a new clawback.
          </Banner>
          <Banner tone="warning" title="Proposed rule">
            Holdback release timing is proposed — confirm with Redwave.
          </Banner>
          <TableSkeleton rows={3} columns={4} />
        </div>
      </div>

      {/* Palette */}
      <div>
        <p className={styles.label}>Palette (this theme)</p>
        <div className={styles.grid}>
          {PALETTE.map((token) => (
            <div className={styles.swatch} key={token}>
              <div className={styles.swatchChip} style={{ background: `var(${token})` }} />
              <span className={styles.swatchName}>{token}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
