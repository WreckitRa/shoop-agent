import type { ContractPiece, Slot } from "@/lib/photo-analysis/style-contract";

export type LookStatusPublic =
  | "queued"
  | "products_ready"
  | "rendering"
  | "ready"
  | "degraded"
  | "failed";

export type ProductCardPublic = {
  id: string;
  title: string;
  imageUrl: string;
  price: { amount: number; currency: string } | null;
};

export type LookPiecePublic = {
  id: string;
  slot: Slot;
  spec: ContractPiece;
  status: string;
  dropReason: string | null;
  observedFamily: string | null;
  product: ProductCardPublic | null;
};

export type LookCardPublic = {
  id: string;
  lookIndex: number;
  name: string;
  status: LookStatusPublic;
  renderUrl: string | null;
  renderNote: string | null;
  pieces: LookPiecePublic[];
};

export type SwatchCardPublic = {
  family: string;
  shade: string;
  hex: string;
  kind: "yes" | "no";
  status: string;
  renderUrl: string | null;
  shopProducts: ProductCardPublic[] | null;
};

export type ReadingLooksPayload = {
  looks: LookCardPublic[];
  swatches: SwatchCardPublic[];
  pending: boolean;
};
