import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const { remoteDnsProxyUrl } = await import("./proxy");

describe("remoteDnsProxyUrl", () => {
  it("upgrades socks5 to socks5h so the proxy resolves DNS", () => {
    expect(remoteDnsProxyUrl("socks5://127.0.0.1:9050")).toBe("socks5h://127.0.0.1:9050");
  });

  it("leaves an already-remote socks5h url alone", () => {
    expect(remoteDnsProxyUrl("socks5h://127.0.0.1:9050")).toBe("socks5h://127.0.0.1:9050");
  });

  it("leaves http proxies alone — they already resolve remotely", () => {
    expect(remoteDnsProxyUrl("http://127.0.0.1:8118")).toBe("http://127.0.0.1:8118");
  });

  it("trims surrounding whitespace", () => {
    expect(remoteDnsProxyUrl("  socks5://127.0.0.1:9050  ")).toBe("socks5h://127.0.0.1:9050");
  });

  it("only rewrites the scheme, not a host that mentions it", () => {
    expect(remoteDnsProxyUrl("http://socks5.example:8118")).toBe("http://socks5.example:8118");
  });
});
