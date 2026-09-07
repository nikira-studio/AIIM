import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "./ipc-security";

describe("IPC sender boundary", () => {
  it("accepts app routes from the expected renderer document", () => {
    const allowed = "file:///C:/Program%20Files/AIIM/resources/app.asar/dist/index.html#/buddies";
    expect(isTrustedRendererUrl("file:///C:/Program%20Files/AIIM/resources/app.asar/dist/index.html#/chat/123", allowed)).toBe(true);
  });

  it("rejects other documents, origins, and invalid URLs", () => {
    const allowed = "http://localhost:5173/#/buddies";
    expect(isTrustedRendererUrl("http://localhost:5173/other.html#/buddies", allowed)).toBe(false);
    expect(isTrustedRendererUrl("https://localhost:5173/#/buddies", allowed)).toBe(false);
    expect(isTrustedRendererUrl("https://attacker.example/#/buddies", allowed)).toBe(false);
    expect(isTrustedRendererUrl("not a url", allowed)).toBe(false);
  });
});
