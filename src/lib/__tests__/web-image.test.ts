import { describe, expect, it } from "vitest";
import { planWebImage, renameForType, WEB_IMAGE_MAX_EDGE } from "@/lib/web-image";

describe("planWebImage", () => {
  it("shrinks a large photo to a 2000px long edge, keeping the ratio", () => {
    expect(planWebImage({ type: "image/png", size: 15_600_000, width: 6000, height: 4000 }))
      .toEqual({ width: WEB_IMAGE_MAX_EDGE, height: 1333, resize: true });
    expect(planWebImage({ type: "image/jpeg", size: 9_000_000, width: 3000, height: 4500 }))
      .toEqual({ width: 1333, height: 2000, resize: true });
  });

  it("re-encodes a heavy image that is already small in pixels", () => {
    expect(planWebImage({ type: "image/png", size: 4_800_000, width: 1600, height: 1200 }))
      .toEqual({ width: 1600, height: 1200, resize: false });
  });

  it("leaves small images and other formats alone", () => {
    expect(planWebImage({ type: "image/jpeg", size: 300_000, width: 1800, height: 1200 })).toBeNull();
    expect(planWebImage({ type: "image/gif", size: 9_000_000, width: 4000, height: 3000 })).toBeNull();
    expect(planWebImage({ type: "image/svg+xml", size: 900_000, width: 4000, height: 3000 })).toBeNull();
    expect(planWebImage({ type: "image/jpeg", size: 9_000_000, width: 0, height: 0 })).toBeNull();
  });
});

describe("renameForType", () => {
  it("swaps the extension to match the new type", () => {
    expect(renameForType("모모스커피 온천 본점.png", "image/jpeg")).toBe("모모스커피 온천 본점.jpg");
    expect(renameForType("logo.webp", "image/png")).toBe("logo.png");
    expect(renameForType("센터커피.JPG", "image/jpeg")).toBe("센터커피.jpg");
    expect(renameForType(".png", "image/jpeg")).toBe("image.jpg");
  });
});
