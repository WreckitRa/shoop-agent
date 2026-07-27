import { SHOPIFY_COUNTRIES } from "@/lib/cart/countries";

/**
 * Major cities by ISO country code for onboarding location pickers.
 * Not exhaustive — SearchableSelect allowCustom covers everywhere else.
 */
export const CITIES_BY_COUNTRY_CODE: Record<string, readonly string[]> = {
  AE: ["Abu Dhabi", "Ajman", "Dubai", "Sharjah"],
  AR: ["Buenos Aires", "Córdoba", "Mendoza", "Rosario"],
  AT: ["Graz", "Innsbruck", "Linz", "Salzburg", "Vienna"],
  AU: [
    "Adelaide",
    "Brisbane",
    "Canberra",
    "Gold Coast",
    "Hobart",
    "Melbourne",
    "Perth",
    "Sydney",
  ],
  BE: ["Antwerp", "Bruges", "Brussels", "Ghent", "Leuven", "Liège"],
  BR: [
    "Belo Horizonte",
    "Brasília",
    "Curitiba",
    "Fortaleza",
    "Porto Alegre",
    "Recife",
    "Rio de Janeiro",
    "Salvador",
    "São Paulo",
  ],
  CA: [
    "Calgary",
    "Edmonton",
    "Halifax",
    "Montreal",
    "Ottawa",
    "Quebec City",
    "Toronto",
    "Vancouver",
    "Victoria",
    "Winnipeg",
  ],
  CH: ["Basel", "Bern", "Geneva", "Lausanne", "Lucerne", "Zurich"],
  CL: ["Santiago", "Valparaíso", "Viña del Mar"],
  CN: [
    "Beijing",
    "Chengdu",
    "Guangzhou",
    "Hangzhou",
    "Nanjing",
    "Shanghai",
    "Shenzhen",
    "Wuhan",
  ],
  CO: ["Bogotá", "Cali", "Cartagena", "Medellín"],
  CZ: ["Brno", "Prague"],
  DE: [
    "Berlin",
    "Cologne",
    "Düsseldorf",
    "Frankfurt",
    "Hamburg",
    "Munich",
    "Stuttgart",
  ],
  DK: ["Aarhus", "Copenhagen", "Odense"],
  EG: ["Alexandria", "Cairo", "Giza"],
  ES: [
    "Barcelona",
    "Bilbao",
    "Madrid",
    "Málaga",
    "Seville",
    "Valencia",
    "Zaragoza",
  ],
  FI: ["Helsinki", "Tampere", "Turku"],
  FR: [
    "Bordeaux",
    "Lille",
    "Lyon",
    "Marseille",
    "Nice",
    "Paris",
    "Strasbourg",
    "Toulouse",
  ],
  GB: [
    "Belfast",
    "Birmingham",
    "Bristol",
    "Cardiff",
    "Edinburgh",
    "Glasgow",
    "Leeds",
    "Liverpool",
    "London",
    "Manchester",
    "Newcastle",
  ],
  GR: ["Athens", "Thessaloniki"],
  HK: ["Hong Kong"],
  HU: ["Budapest"],
  IE: ["Cork", "Dublin", "Galway", "Limerick"],
  IL: ["Haifa", "Jerusalem", "Tel Aviv"],
  IN: [
    "Ahmedabad",
    "Bangalore",
    "Chennai",
    "Delhi",
    "Hyderabad",
    "Kolkata",
    "Mumbai",
    "Pune",
  ],
  IT: [
    "Bologna",
    "Florence",
    "Milan",
    "Naples",
    "Rome",
    "Turin",
    "Venice",
  ],
  JP: [
    "Fukuoka",
    "Kyoto",
    "Nagoya",
    "Osaka",
    "Sapporo",
    "Tokyo",
    "Yokohama",
  ],
  KR: ["Busan", "Incheon", "Seoul"],
  KW: ["Kuwait City"],
  LB: ["Beirut", "Byblos", "Jounieh", "Tripoli"],
  MX: [
    "Cancún",
    "Guadalajara",
    "Mexico City",
    "Monterrey",
    "Puebla",
    "Tijuana",
  ],
  MY: ["George Town", "Kuala Lumpur", "Penang"],
  NL: ["Amsterdam", "Eindhoven", "Rotterdam", "The Hague", "Utrecht"],
  NO: ["Bergen", "Oslo", "Stavanger", "Trondheim"],
  NZ: ["Auckland", "Christchurch", "Wellington"],
  PE: ["Lima"],
  PH: ["Cebu", "Manila", "Quezon City"],
  PL: ["Kraków", "Warsaw", "Wrocław"],
  PT: ["Lisbon", "Porto"],
  QA: ["Doha"],
  RO: ["Bucharest", "Cluj-Napoca"],
  RU: ["Moscow", "Saint Petersburg"],
  SA: ["Jeddah", "Riyadh"],
  SE: ["Gothenburg", "Malmö", "Stockholm"],
  SG: ["Singapore"],
  TH: ["Bangkok", "Chiang Mai", "Phuket"],
  TR: ["Ankara", "Antalya", "Istanbul", "Izmir"],
  TW: ["Kaohsiung", "Taipei", "Taichung"],
  UA: ["Kyiv", "Lviv", "Odesa"],
  US: [
    "Atlanta",
    "Austin",
    "Boston",
    "Chicago",
    "Dallas",
    "Denver",
    "Houston",
    "Las Vegas",
    "Los Angeles",
    "Miami",
    "Minneapolis",
    "New York",
    "Philadelphia",
    "Phoenix",
    "Portland",
    "San Diego",
    "San Francisco",
    "Seattle",
    "Washington, D.C.",
  ],
  VN: ["Da Nang", "Hanoi", "Ho Chi Minh City"],
  ZA: ["Cape Town", "Durban", "Johannesburg", "Pretoria"],
};

export function countryCodeFromLabel(countryLabel: string): string | null {
  const trimmed = countryLabel.trim();
  if (!trimmed) return null;
  const match = SHOPIFY_COUNTRIES.find(
    (c) => c.label.toLowerCase() === trimmed.toLowerCase(),
  );
  return match?.code ?? null;
}

/** Sorted city names for a country label (Shopify display name). */
export function citiesForCountryLabel(countryLabel: string): string[] {
  const code = countryCodeFromLabel(countryLabel);
  if (!code) return [];
  return [...(CITIES_BY_COUNTRY_CODE[code] ?? [])];
}

export function cityOptionsForCountry(countryLabel: string): Array<{
  value: string;
  label: string;
}> {
  return citiesForCountryLabel(countryLabel).map((city) => ({
    value: city,
    label: city,
  }));
}
