import { describe, test, expect } from "bun:test";
import { detectPlatform } from "./index";

describe("detectPlatform", () => {
  test("returns 'vercel' when VERCEL=1", () => {
    expect(detectPlatform({ VERCEL: "1" })).toBe("vercel");
  });

  test("returns 'cloudflare' on CF Pages (CF_PAGES=1)", () => {
    expect(detectPlatform({ CF_PAGES: "1" })).toBe("cloudflare");
  });

  test("returns 'cloudflare' on Workers Builds (WORKERS_CI=true)", () => {
    expect(detectPlatform({ WORKERS_CI: "true" })).toBe("cloudflare");
    expect(detectPlatform({ WORKERS_CI: "1" })).toBe("cloudflare");
  });

  test("returns undefined when no CI env signals match", () => {
    expect(detectPlatform({})).toBeUndefined();
    expect(detectPlatform({ NODE_ENV: "production" })).toBeUndefined();
  });

  test("returns undefined when both Vercel and Cloudflare are set — caller picks", () => {
    expect(detectPlatform({ VERCEL: "1", CF_PAGES: "1" })).toBeUndefined();
    expect(detectPlatform({ VERCEL: "1", WORKERS_CI: "1" })).toBeUndefined();
  });
});
