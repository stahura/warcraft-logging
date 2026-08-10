export type SpecTarget = {
  className: string;
  specName: string;
};

/**
 * DPS specs ingested for PTR Season 2.
 * WCL ranking filters use these slug forms (title case matches site filters).
 */
export const SPEC_ALLOWLIST: SpecTarget[] = [
  // Death Knight
  { className: "DeathKnight", specName: "Frost" },
  { className: "DeathKnight", specName: "Unholy" },
  // Demon Hunter
  { className: "DemonHunter", specName: "Havoc" },
  { className: "DemonHunter", specName: "Devourer" },
  // Druid
  { className: "Druid", specName: "Balance" },
  { className: "Druid", specName: "Feral" },
  // Evoker
  { className: "Evoker", specName: "Devastation" },
  { className: "Evoker", specName: "Augmentation" },
  // Hunter
  { className: "Hunter", specName: "BeastMastery" },
  { className: "Hunter", specName: "Marksmanship" },
  { className: "Hunter", specName: "Survival" },
  // Mage
  { className: "Mage", specName: "Arcane" },
  { className: "Mage", specName: "Fire" },
  { className: "Mage", specName: "Frost" },
  // Monk
  { className: "Monk", specName: "Windwalker" },
  // Paladin
  { className: "Paladin", specName: "Retribution" },
  // Priest
  { className: "Priest", specName: "Shadow" },
  // Rogue
  { className: "Rogue", specName: "Assassination" },
  { className: "Rogue", specName: "Outlaw" },
  { className: "Rogue", specName: "Subtlety" },
  // Shaman
  { className: "Shaman", specName: "Elemental" },
  { className: "Shaman", specName: "Enhancement" },
  // Warlock
  { className: "Warlock", specName: "Affliction" },
  { className: "Warlock", specName: "Demonology" },
  { className: "Warlock", specName: "Destruction" },
  // Warrior
  { className: "Warrior", specName: "Arms" },
  { className: "Warrior", specName: "Fury" },
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
  return className.replace(/([a-z])([A-Z])/g, "$1 $2");
}
