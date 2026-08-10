export type SpecTarget = {
  className: string;
  specName: string;
};

/**
 * Specs ingested by the scheduled job.
 * WCL ranking filters use these slug forms (title case matches site filters).
 */
export const SPEC_ALLOWLIST: SpecTarget[] = [
  { className: "Evoker", specName: "Devastation" },
  { className: "DemonHunter", specName: "Devourer" },
  { className: "DeathKnight", specName: "Unholy" },
  { className: "Warrior", specName: "Arms" },
  { className: "Rogue", specName: "Outlaw" },
  { className: "Druid", specName: "Feral" },
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

export function formatSpecLabel(target: SpecTarget): string {
  return `${target.specName} ${humanClassName(target.className)}`;
}

export function humanClassName(className: string): string {
  return className
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^Death Knight$/i, "Death Knight")
    .replace(/^Demon Hunter$/i, "Demon Hunter");
}
