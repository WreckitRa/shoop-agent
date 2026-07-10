export type RegionOption = { code: string; label: string };

const US_REGIONS: RegionOption[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, label]) => ({ code, label }));

const CA_REGIONS: RegionOption[] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"],
  ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
].map(([code, label]) => ({ code, label }));

export function regionsForCountry(countryCode: string): RegionOption[] {
  switch (countryCode.trim().toUpperCase()) {
    case "US":
      return US_REGIONS;
    case "CA":
      return CA_REGIONS;
    default:
      return [];
  }
}

export function normalizeRegionInput(countryCode: string | undefined, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const regions = regionsForCountry(countryCode ?? "");
  if (!regions.length) return trimmed;
  const upper = trimmed.toUpperCase();
  const exact = regions.find((region) => region.code === upper);
  if (exact) return exact.code;
  const byLabel = regions.find((region) => region.label.toUpperCase() === upper);
  return byLabel?.code ?? trimmed;
}
