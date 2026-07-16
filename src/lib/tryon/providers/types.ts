import type { AvatarAttributes, GarmentType } from "../types";

export type AvatarProviderInput = {
  photoUrl?: string;
  photoBytes?: Uint8Array;
  photoContentType?: string;
  attributes: AvatarAttributes;
};

export type AvatarProviderResult = {
  imageUrl: string;
  /** Raw bytes when provider returns inline data — caller uploads to private storage. */
  imageBytes?: Uint8Array;
  contentType?: string;
};

export interface AvatarProvider {
  readonly name: string;
  createAvatar(input: AvatarProviderInput): Promise<AvatarProviderResult>;
}

export type TryOnProviderInput = {
  avatarUrl: string;
  /** Optional pre-fetched avatar bytes (used by FASHN base64 upload). */
  avatarBytes?: Uint8Array;
  avatarContentType?: string;
  garmentImageUrl: string;
  garmentType: GarmentType;
  product?: import("../dress/product-context").TryonProductContext;
  chain?: {
    stepIndex: number;
    stepTotal: number;
    priorGarmentTitles?: string[];
  };
  /**
   * Full-look collage: garmentImageUrl is a multi-tile product image.
   * FASHN docs: put multiple products in one image for a single try-on call.
   */
  outfitCollage?: {
    titles: string[];
    types: GarmentType[];
  };
};

export interface TryOnProvider {
  readonly name: string;
  dress(input: TryOnProviderInput): Promise<AvatarProviderResult>;
}
