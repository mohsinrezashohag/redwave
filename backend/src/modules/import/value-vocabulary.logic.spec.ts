/**
 * Value-vocabulary specs. The three `Product type` cell shapes below are taken VERBATIM from the UAT file
 * `docs/uat/Sales Upload.xlsx`, whose 16 rows every one classified as `error` before this layer existed.
 */
import {
  buildProductTypeVocab,
  MARKET_VOCAB,
  RATE_KIND_VOCAB,
  resolveSingle,
  resolveVocabValue,
  SALE_STATUS_VOCAB,
  splitValues,
} from './value-vocabulary.logic';

/** The four seeded core types (bootstrap) — key + human label, exactly as the catalogue stores them. */
const CORE = buildProductTypeVocab([
  { key: 'internet', label: 'Internet' },
  { key: 'tv', label: 'TV' },
  { key: 'home_phone', label: 'Home Phone' },
  { key: 'greenfield_internet', label: 'Greenfield Internet' },
]);

describe('resolveVocabValue — the real UAT file shapes', () => {
  it('resolves a capitalised single type ("Internet" → internet)', () => {
    expect(resolveVocabValue('Internet', CORE)).toEqual({ keys: ['internet'], unknown: [], suggestion: 'internet' });
  });

  it('resolves a comma-separated pair ("Internet, TV")', () => {
    const res = resolveVocabValue('Internet, TV', CORE);
    expect(res.keys).toEqual(['internet', 'tv']);
    expect(res.unknown).toEqual([]);
    expect(res.suggestion).toBe('internet + tv');
  });

  it('resolves a comma-separated triple including a two-word label ("Internet, TV, Home Phone")', () => {
    const res = resolveVocabValue('Internet, TV, Home Phone', CORE);
    expect(res.keys).toEqual(['internet', 'tv', 'home_phone']);
    expect(res.unknown).toEqual([]);
  });
});

describe('resolveVocabValue — separators humans actually type', () => {
  it.each([
    ['Internet / TV', ['internet', 'tv']],
    ['Internet + TV', ['internet', 'tv']],
    ['Internet; TV', ['internet', 'tv']],
    ['Internet | TV', ['internet', 'tv']],
    ['Internet\nTV', ['internet', 'tv']],
    ['INTERNET,TV', ['internet', 'tv']],
    ['  internet ,   tv  ', ['internet', 'tv']],
  ])('%s', (input, expected) => {
    expect(resolveVocabValue(input, CORE).keys).toEqual(expected);
  });

  it('de-duplicates a repeated type', () => {
    expect(resolveVocabValue('Internet, internet, TV', CORE).keys).toEqual(['internet', 'tv']);
  });
});

describe('resolveVocabValue — spelling tolerance', () => {
  it.each([
    ['home_phone', 'home_phone'],
    ['Home Phone', 'home_phone'],
    ['homephone', 'home_phone'],
    ['HP', 'home_phone'],
    ['Landline', 'home_phone'],
    ['Cable', 'tv'],
    ['Greenfield', 'greenfield_internet'],
    ['green field', 'greenfield_internet'],
    ['GF', 'greenfield_internet'],
  ])('%s → %s', (input, expected) => {
    expect(resolveVocabValue(input, CORE).keys).toEqual([expected]);
  });

  it('resolves a single unambiguous containment ("Internet 1Gb" → internet)', () => {
    expect(resolveVocabValue('Internet 1Gb', CORE).keys).toEqual(['internet']);
  });
});

describe('resolveVocabValue — catalogue-driven, not hard-coded', () => {
  // The whole point of the layer: an SA adds a `standard_addon` at runtime and it resolves with NO code change.
  const withAddon = buildProductTypeVocab([
    { key: 'internet', label: 'Internet' },
    { key: 'protection_plan', label: 'Protection Plan' },
  ]);

  it.each(['Protection Plan', 'protection_plan', 'PROTECTION PLAN', 'protectionplan'])('%s', (input) => {
    expect(resolveVocabValue(input, withAddon).keys).toEqual(['protection_plan']);
  });

  it('resolves an SA type alongside a core one', () => {
    expect(resolveVocabValue('Internet, Protection Plan', withAddon).keys).toEqual(['internet', 'protection_plan']);
  });

  it('does NOT resolve a type absent from the catalogue', () => {
    expect(resolveVocabValue('Protection Plan', CORE).keys).toEqual([]);
  });
});

describe('resolveVocabValue — a label containing a separator is not torn apart', () => {
  const slashed = buildProductTypeVocab([
    { key: 'tv_streaming', label: 'TV/Streaming' },
    { key: 'internet', label: 'Internet' },
  ]);

  it('matches the whole label before falling back to splitting', () => {
    expect(resolveVocabValue('TV/Streaming', slashed).keys).toEqual(['tv_streaming']);
  });

  // The two-tier split: the comma is the OUTER list separator, so the `/` inside the label is never reached.
  it('splits on the comma first, leaving a slashed label intact', () => {
    const res = resolveVocabValue('Internet, TV/Streaming', slashed);
    expect(res.keys).toEqual(['internet', 'tv_streaming']);
    expect(res.unknown).toEqual([]);
  });

  // With no comma to go on, `/` IS the separator — genuinely ambiguous input, so the unresolvable
  // fragment is reported rather than guessed.
  it('falls back to slash-splitting when there is no primary separator', () => {
    const res = resolveVocabValue('Internet/TV/Streaming', slashed);
    expect(res.keys).toEqual(['internet']);
    expect(res.unknown).toEqual(['TV', 'Streaming']);
  });
});

describe('resolveVocabValue — an ambiguous cell is reported, never silently halved', () => {
  it('refuses a space-separated pair rather than dropping one type', () => {
    const res = resolveVocabValue('Internet TV', CORE);
    expect(res.keys).toEqual([]);
    expect(res.unknown).toEqual(['Internet TV']);
  });
});

describe('resolveVocabValue — unknown values stay unknown (never guessed)', () => {
  it('reports an unrecognised type rather than forcing a near miss', () => {
    const res = resolveVocabValue('Fibre Optic', CORE);
    expect(res.keys).toEqual([]);
    expect(res.unknown).toEqual(['Fibre Optic']);
    expect(res.suggestion).toBeNull();
  });

  it('reports the partial resolution so the operator gets a "did you mean" hint', () => {
    const res = resolveVocabValue('Internet, Fibre Optic', CORE);
    expect(res.keys).toEqual(['internet']);
    expect(res.unknown).toEqual(['Fibre Optic']);
    expect(res.suggestion).toBe('internet');
  });

  it('an empty cell is absent, not invalid', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(resolveVocabValue(empty, CORE)).toEqual({ keys: [], unknown: [], suggestion: null });
    }
  });
});

describe('resolveSingle', () => {
  it('returns the key for a clean single value', () => {
    expect(resolveSingle('Internet', CORE)).toEqual({ key: 'internet', unknown: null });
  });

  it('rejects a multi-value cell in a single-valued field (verbatim, for the message)', () => {
    expect(resolveSingle('Internet, TV', CORE)).toEqual({ key: null, unknown: 'Internet, TV' });
  });

  it('treats an empty cell as absent so required-ness stays the classifier’s call', () => {
    expect(resolveSingle('  ', CORE)).toEqual({ key: null, unknown: null });
  });
});

describe('the static vocabularies', () => {
  it.each([
    ['Canada', 'CA'],
    ['canada', 'CA'],
    ['CA', 'CA'],
    ['United States', 'US'],
    ['USA', 'US'],
  ])('market %s → %s', (input, expected) => {
    expect(resolveSingle(input, MARKET_VOCAB).key).toBe(expected);
  });

  it.each([
    ['Product', 'product'],
    ['TV add-on', 'tv_addon'],
    ['tv addon', 'tv_addon'],
    ['Spiff', 'spiff'],
    ['Bundle bonus', 'bundle_bonus'],
  ])('rate_kind %s → %s', (input, expected) => {
    expect(resolveSingle(input, RATE_KIND_VOCAB).key).toBe(expected);
  });

  it.each([
    ['Validated', 'validated'],
    ['ENTERED', 'entered'],
  ])('sale status %s → %s', (input, expected) => {
    expect(resolveSingle(input, SALE_STATUS_VOCAB).key).toBe(expected);
  });
});

describe('splitValues', () => {
  it('splits on every supported separator and trims', () => {
    expect(splitValues('a, b; c / d + e | f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('drops empty fragments from a trailing separator', () => {
    expect(splitValues('internet,,tv,')).toEqual(['internet', 'tv']);
  });

  it('returns nothing for an empty cell', () => {
    expect(splitValues(null)).toEqual([]);
    expect(splitValues('')).toEqual([]);
  });
});
