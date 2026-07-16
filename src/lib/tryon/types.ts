/** Avatar silhouette attributes — never numeric weight/body-fat. */
export type HeightBand =
  | "under_160"
  | "160_170"
  | "170_180"
  | "180_190"
  | "over_190";

export type BuildBand = "slim" | "average" | "broad" | "athletic" | "plus";

export type MuscularityBand = "low" | "moderate" | "high";

/** Body silhouette only — face / hair / skin come from the face photo. */
export type AvatarAttributes = {
  height_band?: HeightBand;
  build?: BuildBand;
  muscularity?: MuscularityBand;
};

export type StoredAvatar = {
  url: string;
  storage_path: string;
  /** MIME type of storage_path — used by dress providers (PNG vs JPEG). */
  content_type?: string;
  attributes: AvatarAttributes;
  created_at: string;
  version: string;
};

export type GarmentType =
  | "top"
  | "bottom"
  | "shoes"
  | "dress"
  | "outerwear";

export type TryonDisclaimer =
  "AI visualization — actual fit and details may differ";

export const TRYON_DISCLAIMER: TryonDisclaimer =
  "AI visualization — actual fit and details may differ";

export type AvatarCompareVariant = {
  provider_key: "fashn";
  provider: string;
  label: string;
  job_id: string;
  status: TryonJobStatus;
  preview_url?: string;
  preview_path?: string;
  ms?: number;
  error?: string;
};

export type AvatarDraftStep =
  | "upload"
  | "attributes"
  | "generate"
  | "approval"
  | "complete"
  | "refused_minor";

export type AttributeIntakeResult = {
  clear: Partial<AvatarAttributes>;
  missing: Array<keyof AvatarAttributes>;
  minor_refused: boolean;
  refusal_message?: string;
};

export type ProviderCallResult = {
  imageUrl: string;
  storagePath?: string;
  ms: number;
  costEstimate: number;
  provider: string;
};

export type TryonJobStatus = "pending" | "processing" | "completed" | "failed";

export type TryonCompareVariant = {
  provider_key: "fashn";
  provider: string;
  label: string;
  job_id: string;
  status: TryonJobStatus;
  image_url?: string;
  ms?: number;
  error?: string;
};

export type TryonPickContract = {
  available: boolean;
  image_url?: string;
  job_id?: string;
  compare?: boolean;
  disclaimer: TryonDisclaimer;
};

export type TryonLookStepContract = {
  ref: string;
  title?: string;
  price?: { amount: number; currency: string };
  status: TryonJobStatus;
  image_url?: string;
  note?: string;
};

export type TryonLookContract = {
  status: TryonJobStatus;
  steps: TryonLookStepContract[];
  final_image_url?: string;
  disclaimer: TryonDisclaimer;
  job_id?: string;
  partial_note?: string;
  compare?: boolean;
  variants?: TryonCompareVariant[];
};
