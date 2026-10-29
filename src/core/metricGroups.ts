export function metricGroupLabels(value: unknown, histogram = false): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 4 ||
    value.some(
      name =>
        typeof name !== 'string' ||
        name.length > 256 ||
        /^[A-Za-z_][A-Za-z0-9_]*$/.exec(name)?.[0] !== name ||
        name === '__name__'
    ) ||
    new Set(value).size !== value.length ||
    value.join('').length > 256
  )
    throw new Error(
      'Metric grouping requires at most 4 distinct label names totaling at most 256 characters, excluding __name__'
    );
  if (histogram && value.includes('le'))
    throw new Error('Classic histogram grouping cannot retain the reserved le bucket label');
  return [...value];
}

export function metricGroupIdentity(
  labels: Readonly<Record<string, string>>,
  groups: readonly string[]
) {
  if (Object.keys(labels).some(key => !groups.includes(key)))
    throw new Error('Metric series returned an undeclared grouping label');
  const values = groups.map(name => {
    const present = Object.prototype.hasOwnProperty.call(labels, name);
    const value = present ? labels[name] : undefined;
    if (
      present &&
      (typeof value !== 'string' || value.length > 256 || /[\ud800-\udfff]/u.test(value))
    )
      throw new Error(
        'Metric group values require at most 256 characters without unpaired surrogates'
      );
    return { name, value };
  });
  const caption = `{${values
    .map(({ name, value }) => `${name}=${value === undefined ? '<absent>' : JSON.stringify(value)}`)
    .join(', ')}}`;
  if (caption.length > 1024) throw new Error('Metric group caption exceeds 1024 characters');
  return {
    // Prometheus treats absent and empty labels as the same group; never merge duplicate rows.
    key: JSON.stringify(values.map(({ name, value }) => [name, value || null])),
    caption,
  };
}
