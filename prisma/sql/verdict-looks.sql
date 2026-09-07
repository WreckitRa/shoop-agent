-- Onboarding verdict look rail (Prisma VerdictLook / VerdictLookPiece / ColorSwatchRender).

DO $$ BEGIN
  CREATE TYPE public."LookStatus" AS ENUM (
    'queued',
    'products_ready',
    'rendering',
    'ready',
    'degraded',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.verdict_looks (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  "lookIndex" INTEGER NOT NULL,
  name TEXT NOT NULL,
  status public."LookStatus" NOT NULL DEFAULT 'queued',
  "renderUrl" TEXT,
  "renderPath" TEXT,
  "renderNote" TEXT,
  "creditsUsed" INTEGER NOT NULL DEFAULT 0,
  timings JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("userId", "photoHash", "lookIndex")
);

CREATE INDEX IF NOT EXISTS verdict_looks_user_hash
  ON public.verdict_looks ("userId", "photoHash");

CREATE TABLE IF NOT EXISTS public.verdict_look_pieces (
  id TEXT PRIMARY KEY,
  "lookId" TEXT NOT NULL REFERENCES public.verdict_looks(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  spec JSONB NOT NULL,
  "productId" TEXT,
  "variantId" TEXT,
  "productSnapshot" JSONB,
  "garmentImageUrl" TEXT,
  "garmentPhotoType" TEXT,
  "observedFamily" TEXT,
  alternates JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  "dropReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS verdict_look_pieces_lookId
  ON public.verdict_look_pieces ("lookId");

CREATE TABLE IF NOT EXISTS public.color_swatch_renders (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "photoHash" TEXT NOT NULL,
  family TEXT NOT NULL,
  shade TEXT NOT NULL DEFAULT '',
  hex TEXT NOT NULL,
  kind TEXT NOT NULL,
  "templateUrl" TEXT,
  "renderUrl" TEXT,
  "renderPath" TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  "dropReason" TEXT,
  "shopProducts" JSONB,
  "creditsUsed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("userId", "photoHash", family, kind, hex)
);

CREATE INDEX IF NOT EXISTS color_swatch_renders_user_hash
  ON public.color_swatch_renders ("userId", "photoHash");
