function space(code: number): boolean {
  switch (code) {
    case 0x20:
    case 0x85:
    case 0xa0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
      return true;
    default:
      return (code >= 9 && code <= 13) || (code >= 0x2000 && code <= 0x200a);
  }
}

export function trimGoSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && space(value.charCodeAt(start))) start++;
  while (end > start && space(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}

export function compareGoStrings(a: string, b: string): number {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}
