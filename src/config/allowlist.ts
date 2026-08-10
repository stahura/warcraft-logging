export type SpecTarget = {
  className: string;
  specName: string;
};

/**
 * Specs ingested by the scheduled job.
 * Add more entries here to expand beyond Devastation Evoker.
 * WCL ranking filters use these slug forms (title case matches site filters).
 */
export const SPEC_ALLOWLIST: SpecTarget[] = [
  { className: "Evoker", specName: "Devastation" },
];

export function isAllowedSpec(className: string, specName: string): boolean {
  return SPEC_ALLOWLIST.some(
    (s) =>
      s.className.toLowerCase() === className.toLowerCase() &&
      s.specName.toLowerCase() === specName.toLowerCase(),
  );
}

export function findAllowedSpec(className: string, specName: string): SpecTarget | undefined {
  return SPEC_ALLOWLIST.find(
    (s) =>
      s.className.toLowerCase() === className.toLowerCase() &&
      s.specName.toLowerCase() === specName.toLowerCase(),
  );
}
