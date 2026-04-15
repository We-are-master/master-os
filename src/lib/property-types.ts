/** Property / site classification for account_properties.property_type */
export const PROPERTY_TYPE_OPTIONS = [
  "Commercial",
  "Residential",
  "Retail",
  "Industrial / Warehouse",
  "Mixed use",
  "Land",
  "Other",
] as const;

export type PropertyTypeOption = (typeof PROPERTY_TYPE_OPTIONS)[number];
