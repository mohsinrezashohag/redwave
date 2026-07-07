/**
 * Client EXPENSE billing document response DTOs (BILL-012 / EXP-014). — Batch A #2 style
 *
 * #3: carries NO commission data — km is priced from the CLIENT-BILL km rate, food is native-currency. Money
 * is a decimal STRING (#1). One line per (type × rep × day); receipts never appear.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One aggregated line = one (type × rep × day) cell (from the frozen line_detail snapshot). */
export class ExpenseDocLineResponse {
  @ApiProperty({ enum: ['km', 'meals'] })
  type!: 'km' | 'meals';

  @ApiProperty({ description: 'Rep id (or "unassigned" for an item with no rep).' })
  rep_id!: string;

  @ApiProperty()
  rep_name!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-10' })
  date!: string;

  @ApiProperty({ example: '120.00 km' })
  description!: string;

  @ApiProperty({ type: String, example: '60.00', description: 'Decimal string in the document currency.' })
  amount!: string;
}

/** Which reps/days were included (dynamic selection, frozen on the document). */
export class ExpenseDocSelectionResponse {
  @ApiPropertyOptional({ type: [String] })
  rep_ids?: string[];

  @ApiPropertyOptional({ type: [String] })
  dates?: string[];
}

export class ClientExpenseDocumentResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true, example: 1, description: 'Gapless sequential number (CEXP-00001), minted on issue.' })
  document_number!: number | null;

  @ApiProperty({ enum: ['issued', 'superseded'], description: 'issued = current; superseded = an earlier version (immutable).' })
  status!: 'issued' | 'superseded';

  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: () => ExpenseDocSelectionResponse, description: 'The frozen rep/day selection used at issue.' })
  selection_filters!: ExpenseDocSelectionResponse;

  @ApiProperty({ type: () => [ExpenseDocLineResponse], description: 'The frozen grouped line detail (km + food, per rep/day).' })
  line_detail!: ExpenseDocLineResponse[];

  @ApiProperty({ type: String, example: '100.00', description: 'Decimal string. Document total in `currency` (km@client-bill + native food). No GST.' })
  total_amount!: string;

  @ApiProperty({ type: String, example: 'CAD', description: 'Billing currency (the client’s currency at issue).' })
  currency!: string;

  @ApiProperty({ type: String, example: '1.00000000', description: 'Frozen currency→CAD rate (8 dp); 1 for CAD; never re-converted (#12).' })
  fx_rate!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The frozen rate’s day (audit).' })
  fx_rate_date!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '136.50', description: 'Frozen CAD value (= total_amount × fx_rate); reconciliation reads THIS.' })
  amount_cad!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Storage object path of a rendered artifact (or null — rendered on demand).' })
  file_url!: string | null;

  @ApiProperty()
  generated_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generated_at!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The newer version that superseded this one (null if current).' })
  superseded_by_id!: string | null;
}

/** A food item left off the document because its entry currency ≠ the client's currency (native rule). */
export class ExcludedExpenseItemResponse {
  @ApiProperty()
  item_id!: string;

  @ApiProperty({ example: 'meals' })
  category!: string;

  @ApiProperty({ example: 'currency_mismatch' })
  reason!: string;
}

/** A PREVIEW — the grouped draft, NOT persisted (no number minted, no FX frozen). */
export class ExpenseDocPreviewResponse {
  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  pay_period_id!: string;

  @ApiProperty({ type: () => [ExpenseDocLineResponse], description: 'Grouped lines (km + food, per rep/day), amounts in the client currency.' })
  lines!: ExpenseDocLineResponse[];

  @ApiProperty({ type: String, example: '100.00', description: 'Decimal string. Draft total in the client currency.' })
  total_amount!: string;

  @ApiProperty({ type: () => [ExcludedExpenseItemResponse], description: 'Items dropped (e.g. food not in the client currency).' })
  excluded!: ExcludedExpenseItemResponse[];
}
