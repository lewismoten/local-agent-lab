const modelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareModelNames(left: string, right: string): number {
  return modelCollator.compare(left, right);
}
