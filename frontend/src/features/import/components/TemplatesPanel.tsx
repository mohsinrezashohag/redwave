/**
 * TemplatesPanel — downloadable import templates (Excel + CSV) for every target, grouped, each with its
 * column data-dictionary. Their explicit ask: "give us the formats." Generated client-side (exportRows).
 */
import { Download, FileSpreadsheet } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import { TEMPLATES, downloadTemplate, type TemplateDef } from '../templates';
import styles from './import.module.css';

const GROUPS: TemplateDef['group'][] = ['Master data', 'Sales', 'Balances', 'Client reports'];

function TemplateRow({ def }: { def: TemplateDef }) {
  return (
    <details className={styles.template}>
      <summary className={styles.templateHead}>
        <span className={styles.templateTitle}>
          <FileSpreadsheet size={16} /> {def.label}
        </span>
        <span className={styles.templateActions}>
          <Button variant="tertiary" size="sm" leftIcon={<Download size={14} />} onClick={(e) => { e.preventDefault(); downloadTemplate(def, 'xlsx'); }}>
            Excel
          </Button>
          <Button variant="tertiary" size="sm" leftIcon={<Download size={14} />} onClick={(e) => { e.preventDefault(); downloadTemplate(def, 'csv'); }}>
            CSV
          </Button>
        </span>
      </summary>
      <p className={styles.hint}>{def.description}</p>
      <table className={styles.dictTable}>
        <thead>
          <tr>
            <th>Column</th>
            <th>Required</th>
            <th>Example</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {def.fields.map((fld) => (
            <tr key={fld.field}>
              <td className="mono">{fld.label}</td>
              <td>{fld.required ? <Badge tone="warning">Required</Badge> : <Badge tone="muted">Optional</Badge>}</td>
              <td className="mono">{fld.example}</td>
              <td>{fld.dict}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function TemplatesPanel() {
  return (
    <Card title="Download templates">
      <p className={styles.hint}>
        Each template has the exact expected columns + example rows. Import is mapping-driven, so your real layout still works —
        these are starting points (VF / RF / CTI report formats are sensible defaults to refine from a real file).
      </p>
      {GROUPS.map((group) => {
        const defs = TEMPLATES.filter((t) => t.group === group);
        if (defs.length === 0) return null;
        return (
          <div key={group} className={styles.templateGroup}>
            <h4 className={styles.templateGroupTitle}>{group}</h4>
            {defs.map((def) => (
              <TemplateRow key={def.id} def={def} />
            ))}
          </div>
        );
      })}
    </Card>
  );
}
