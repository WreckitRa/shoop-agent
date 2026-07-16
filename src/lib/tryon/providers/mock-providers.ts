import type { GarmentType } from "../types";
import type {
  AvatarProvider,
  AvatarProviderInput,
  AvatarProviderResult,
  TryOnProvider,
  TryOnProviderInput,
} from "./types";

const MOCK_AVATAR_URL = "https://tryon-mock.local/avatar.png";
const MOCK_DRESS_URL = "https://tryon-mock.local/dressed.png";

let dressCallLog: TryOnProviderInput[] = [];

export function getMockDressCallLog(): TryOnProviderInput[] {
  return dressCallLog;
}

export function clearMockDressCallLog(): void {
  dressCallLog = [];
}

export class MockAvatarProvider implements AvatarProvider {
  readonly name: string;

  constructor(name = "mock-avatar") {
    this.name = name;
  }

  async createAvatar(_input: AvatarProviderInput): Promise<AvatarProviderResult> {
    return {
      imageUrl: `${MOCK_AVATAR_URL}?provider=${encodeURIComponent(this.name)}`,
    };
  }
}

export class MockTryOnProvider implements TryOnProvider {
  readonly name: string;
  failOnRef: string | null = null;

  constructor(name = "mock-tryon") {
    this.name = name;
  }

  async dress(input: TryOnProviderInput): Promise<AvatarProviderResult> {
    dressCallLog.push({ ...input });
    if (
      this.failOnRef &&
      input.garmentImageUrl.includes(this.failOnRef)
    ) {
      throw new Error("mock dress failure");
    }
    return {
      imageUrl: `${MOCK_DRESS_URL}?garment=${encodeURIComponent(input.garmentType)}`,
    };
  }
}

/** Neckwear / small accessories — collage-eligible on tryon-max, skip in sequential. */
export function isAccessoryGarment(garment: string): boolean {
  const g = garment.toLowerCase().replace(/[_-]+/g, " ").trim();
  return /\b(tie|ties|necktie|neckties|cravate|scarf|scarves|belt|belts|pocket\s*square|cufflink|watch|hat|cap|sunglasses)\b/.test(
    g,
  );
}

/**
 * Map planner/catalog garment slots to FASHN try-on categories.
 * Order matters: "dress shirt" must be top, not a one-piece dress.
 */
export function garmentTypeFromSlot(garment: string): GarmentType | null {
  const g = garment.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (!g) return null;

  // Footwear — don't treat "oxford shirt" as shoes.
  if (
    /\b(shoes?|sneakers?|boots?|loafers?|heels?|sandals?|derbys?)\b/.test(g) ||
    (/\boxfords?\b/.test(g) && !/\bshirt\b/.test(g))
  ) {
    return "shoes";
  }

  // Tops that contain the word "dress" (never one-piece).
  if (/\bdress\s*shirts?\b/.test(g)) return "top";

  // True one-pieces (check before generic "dress").
  if (
    /\b(jumpsuit|romper|playsuit|gown|sundress|maxi dress|midi dress|mini dress|shirt dress)\b/.test(
      g,
    )
  ) {
    return "dress";
  }
  if (/\bdress\b/.test(g) && !/\bshirt\b/.test(g)) return "dress";

  // Suit / tailoring — planner often uses "suit" for a blazer look piece.
  if (
    /\b(suit|suits|suiting|tuxedo|tux|sport\s*coats?|sports?\s*coats?)\b/.test(g)
  ) {
    return "outerwear";
  }

  if (
    /(jacket|coat|blazer|parka|outerwear|vest|overshirt|windbreaker|trench|raincoat|anorak)/.test(
      g,
    )
  ) {
    return "outerwear";
  }

  if (
    /(pant|trouser|jean|denim|chino|khaki|short|skirt|bottom|legging|cargo|jogger|culotte)/.test(
      g,
    )
  ) {
    return "bottom";
  }

  if (
    /(shirt|tee|t shirt|top|blouse|sweater|hoodie|polo|knitwear|jumper|pullover|cardigan|crew|henley|tank|camisole|sweatshirt|jersey)/.test(
      g,
    )
  ) {
    return "top";
  }

  return null;
}
