import { LEGAL_DOC_VERSION } from "./constants";

export type PhotoConsentRow = {
  withdrawnAt: Date | null;
  documentVersion: string;
  ageAttested: boolean;
  ownPhotoAttested: boolean;
  abandonDeleteAck: boolean;
} | null;

export function guestPhotoConsentSatisfied(row: PhotoConsentRow): boolean {
  return Boolean(
    row &&
      !row.withdrawnAt &&
      row.documentVersion === LEGAL_DOC_VERSION &&
      row.ageAttested &&
      row.ownPhotoAttested &&
      row.abandonDeleteAck,
  );
}
