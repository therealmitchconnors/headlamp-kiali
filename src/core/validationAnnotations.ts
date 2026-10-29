import { trimGoSpace } from './goStrings';
import { isRecord } from './object';

export const VALIDATION_IGNORE_ANNOTATION = 'kiali.io/ignore-validations';
export interface ValidationExclusions {
  present: boolean;
  all: boolean;
  codes: readonly string[];
}
export interface ValidationExclusionDraft {
  mode: 'none' | 'codes' | 'all';
  codes: string;
}

export function validationExclusions(annotations: unknown): ValidationExclusions {
  if (annotations === undefined || annotations === null)
    return { present: false, all: false, codes: [] };
  if (!isRecord(annotations)) throw new Error('Resource annotations are malformed');
  if (!Object.prototype.hasOwnProperty.call(annotations, VALIDATION_IGNORE_ANNOTATION))
    return { present: false, all: false, codes: [] };
  const raw = annotations[VALIDATION_IGNORE_ANNOTATION];
  if (typeof raw !== 'string' || raw.length > 32768)
    throw new Error('Validation exclusion annotation must be a string of at most 32768 characters');
  const value = trimGoSpace(raw);
  if (value === '') return { present: true, all: true, codes: [] };
  const codes = value.split(',').map(trimGoSpace);
  if (codes.length > 1000) throw new Error('Validation exclusion annotation exceeds 1000 codes');
  return { present: true, all: false, codes };
}

export function initialValidationExclusionDraft(annotations: unknown): ValidationExclusionDraft {
  const rule = validationExclusions(annotations);
  const codes = rule.codes.join(',');
  if (codes.length > 4096 || rule.codes.length > 100)
    throw new Error(
      'Existing validation exclusions exceed the editor limit; use Kubernetes tooling to edit them'
    );
  return { mode: !rule.present ? 'none' : rule.all ? 'all' : 'codes', codes };
}

export function validationExclusionValue(draft: ValidationExclusionDraft): string | null {
  if (draft.mode === 'none') return null;
  if (draft.mode === 'all') return '';
  if (draft.mode !== 'codes' || typeof draft.codes !== 'string' || draft.codes.length > 4096)
    throw new Error('Validation exclusions require a supported mode and at most 4096 characters');
  const codes = draft.codes.split(',').map(trimGoSpace);
  if (
    !codes.length ||
    codes.length > 100 ||
    codes.some(code => !/^(?:KIA[0-9]{4}|GWAPI)$/.test(code))
  )
    throw new Error(
      'Enter 1 to 100 comma-separated KIA#### or GWAPI codes, or choose another exclusion mode'
    );
  return [...new Set(codes)].join(',');
}
