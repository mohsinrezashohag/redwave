/**
 * Product-type display labels. The 4 core types have curated labels; SA-added catalogue types fall back to
 * a humanized key (e.g. 'fixed_wireless' → 'Fixed Wireless'). Where the live catalogue label is available
 * (forms), prefer it; this is the static display fallback used by tables/snapshots.
 */
export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  internet: 'Internet',
  tv: 'TV',
  home_phone: 'Home Phone',
  greenfield_internet: 'Greenfield Internet',
};

const humanizeKey = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const productTypeLabel = (type: string): string => PRODUCT_TYPE_LABEL[type] ?? humanizeKey(type);
