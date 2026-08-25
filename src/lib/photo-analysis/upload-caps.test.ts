import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  PhotoUploadCapError,
  assertPhotoUploadCaps,
} from "./upload-caps";

function fakeReq(ip: string) {
  return {
    headers: {
      get(name: string) {
        if (name === "x-forwarded-for") return ip;
        return null;
      },
    },
  };
}

describe("assertPhotoUploadCaps", () => {
  beforeEach(() => {
    process.env.PHOTO_UPLOAD_USER_DAILY_CAP = "2";
    process.env.PHOTO_UPLOAD_IP_DAILY_CAP = "3";
    process.env.PHOTO_UPLOAD_CAP_NS = `t-${Date.now()}-${Math.random()}`;
  });

  it("allows a user up to the daily cap, then blocks", async () => {
    const userId = `user-${Date.now()}-${Math.random()}`;
    const req = fakeReq(`203.0.113.${Math.floor(Math.random() * 200) + 1}`);
    await assertPhotoUploadCaps({ userId, req });
    await assertPhotoUploadCaps({ userId, req });
    await assert.rejects(
      () => assertPhotoUploadCaps({ userId, req }),
      PhotoUploadCapError,
    );
  });

  it("allows an IP up to the daily cap across users, then blocks", async () => {
    const req = fakeReq(`198.51.100.${Math.floor(Math.random() * 200) + 1}`);
    await assertPhotoUploadCaps({ userId: "u1", req });
    await assertPhotoUploadCaps({ userId: "u2", req });
    await assertPhotoUploadCaps({ userId: "u3", req });
    await assert.rejects(
      () => assertPhotoUploadCaps({ userId: "u4", req }),
      PhotoUploadCapError,
    );
  });
});
