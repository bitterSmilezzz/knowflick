import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(1) }));

import { invoke } from "@tauri-apps/api/core";
import { profileClaimAdd } from "./store";

describe("profileClaimAdd", () => {
  it("completes the DTO fields required by Rust while leaving new claims unconfirmed", async () => {
    const claim = {
      id: "claim-1",
      kind: "inference" as const,
      content: "偏好先明确验收条件",
      evidenceJson: '["note-1"]',
      scope: "global",
    };

    await expect(profileClaimAdd(claim, "/library")).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("profile_claim_add", {
      claim: {
        ...claim,
        createdAt: expect.any(Number),
        confirmedAt: null,
        expiresAt: null,
        deniedAt: null,
        supersededBy: null,
        status: "active",
      },
      dir: "/library",
    });
  });
});
