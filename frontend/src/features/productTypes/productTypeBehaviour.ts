/** Display helpers for the product-type behaviour classification (engine semantics). — §6 */
import type { BadgeTone } from '../../components/ui';
import type { ProductTypeBehaviour } from './productTypes.types';

export const behaviourLabel = (b: ProductTypeBehaviour): string =>
  b === 'tiered' ? 'Tiered (counts toward tally)' : b === 'greenfield' ? 'Greenfield (flat, excluded)' : 'Standard add-on';

export const behaviourTone = (b: ProductTypeBehaviour): BadgeTone =>
  b === 'tiered' ? 'info' : b === 'greenfield' ? 'warning' : 'neutral';
