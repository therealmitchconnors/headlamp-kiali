import oracleText from '../../test-files/parity/validation-annotations-oracle.json?raw';
import { trimGoSpace } from './goStrings';
import { initialValidation } from './validation';
import {
  initialValidationExclusionDraft,
  VALIDATION_IGNORE_ANNOTATION,
  validationExclusions,
  validationExclusionValue,
} from './validationAnnotations';

const fixtures: {
  cases: {
    input: { annotations: unknown };
    expected: { present: boolean; all: boolean; codes: string[]; ignored: Record<string, boolean> };
  }[];
} = JSON.parse(oracleText);
it.each(fixtures.cases)(
  'matches original Go exclusion parsing and matching %#',
  ({ input, expected }) => {
    const parsed = validationExclusions(input.annotations);
    expect(parsed).toEqual({ present: expected.present, all: expected.all, codes: expected.codes });
    for (const [code, ignored] of Object.entries(expected.ignored))
      expect(parsed.all || parsed.codes.includes(code)).toBe(ignored);
  }
);
it('distinguishes inherited properties, Unicode NEL and BOM instead of accidentally hiding findings', () => {
  expect(validationExclusions(Object.create({ [VALIDATION_IGNORE_ANNOTATION]: '' })).present).toBe(
    false
  );
  expect(validationExclusions({ [VALIDATION_IGNORE_ANNOTATION]: '\u0085' }).all).toBe(true);
  expect(validationExclusions({ [VALIDATION_IGNORE_ANNOTATION]: '\ufeff' }).all).toBe(false);
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Sidecar',
    spec: { outboundTrafficPolicy: {} },
    annotations: { [VALIDATION_IGNORE_ANNOTATION]: '\ufeff' },
    workloads: [],
    complete: false,
  });
  expect(result.findings[0].code).toBe('KIA1007');
  expect(result.suppressed).toBe(0);
});
it('does not suppress findings when the annotation is malformed or exceeds native bounds', () => {
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Sidecar',
    spec: { outboundTrafficPolicy: {} },
    annotations: { [VALIDATION_IGNORE_ANNOTATION]: ' '.repeat(32769) },
    workloads: [],
    complete: false,
  });
  expect(result.findings[0].code).toBe('KIA1007');
  expect(result.skipped[0]).toContain('32768');
  expect(() => validationExclusions({ [VALIDATION_IGNORE_ANNOTATION]: true })).toThrow();
  expect(() =>
    validationExclusions({ [VALIDATION_IGNORE_ANNOTATION]: Array(1001).fill('KIA0004').join(',') })
  ).toThrow('1000');
});
it('uses bounded linear edge trimming without removing interior whitespace', () => {
  const value = 'a' + ' '.repeat(32766) + 'b';
  expect(trimGoSpace(value)).toBe(value);
  expect(validationExclusions({ [VALIDATION_IGNORE_ANNOTATION]: value }).codes).toEqual([value]);
});
it('models restore/selective/all operations explicitly and preserves existing meaning in drafts', () => {
  expect(initialValidationExclusionDraft({})).toEqual({ mode: 'none', codes: '' });
  expect(initialValidationExclusionDraft({ [VALIDATION_IGNORE_ANNOTATION]: '' })).toEqual({
    mode: 'all',
    codes: '',
  });
  expect(
    initialValidationExclusionDraft({ [VALIDATION_IGNORE_ANNOTATION]: ' KIA0004 ,GWAPI' })
  ).toEqual({ mode: 'codes', codes: 'KIA0004,GWAPI' });
  expect(validationExclusionValue({ mode: 'none', codes: 'ignored' })).toBeNull();
  expect(validationExclusionValue({ mode: 'all', codes: 'ignored' })).toBe('');
  expect(validationExclusionValue({ mode: 'codes', codes: ' KIA0004,GWAPI,KIA0004 ' })).toBe(
    'KIA0004,GWAPI'
  );
});
it.each([
  '',
  ' ',
  ',',
  'KIA0004,',
  'kia0004',
  'KIA4',
  'KIA0004\nnot-a-code',
  'KIA0004\ufeff',
  Array(101).fill('KIA0004').join(','),
  'x'.repeat(4097),
])('rejects invalid editor codes %j', codes => {
  expect(() => validationExclusionValue({ mode: 'codes', codes })).toThrow();
});
it('rejects unsupported editor modes and oversized existing lists rather than silently rewriting them', () => {
  expect(() => validationExclusionValue(JSON.parse('{"mode":"invalid","codes":""}'))).toThrow();
  expect(() =>
    initialValidationExclusionDraft({
      [VALIDATION_IGNORE_ANNOTATION]: Array(101).fill('KIA0004').join(','),
    })
  ).toThrow('editor limit');
});
