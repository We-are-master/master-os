import { describe, expect, it } from "vitest";
import { responsiveDrawerWidthClass } from "./responsive-drawer-width";

describe("responsiveDrawerWidthClass", () => {
  it("clamps fixed px widths to viewport", () => {
    expect(responsiveDrawerWidthClass("w-[540px]")).toBe("w-full max-w-[min(100vw,540px)]");
  });

  it("leaves already-responsive widths unchanged", () => {
    expect(responsiveDrawerWidthClass("w-[min(100vw-1rem,580px)]")).toBe("w-[min(100vw-1rem,580px)]");
  });
});
