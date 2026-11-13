/** Display helpers for the product-type behaviour classification. No tiers since 2026-11-13. — §6 */
import type { BadgeTone } from '../../components/ui';
import type { ProductTypeBehaviour } from './productTypes.types';

export const behaviourLabel = (b: ProductTypeBehaviour): string =>
  b === 'internet' ? 'Internet' : b === 'greenfield' ? 'Greenfield internet' : 'Add-on';

export const behaviourTone = (b: ProductTypeBehaviour): BadgeTone =>
  b === 'internet' ? 'info' : b === 'greenfield' ? 'warning' : 'neutral';
