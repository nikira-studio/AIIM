import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { OpenAiSubscriptionClient } from "./openai-subscription";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("ChatGPT subscription session", () => {
  it("disconnects by deleting the saved token and clearing the loaded session", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-subscription-"));
    directories.push(directory);
    const tokenPath = path.join(directory, "openai-subscription.bin");
    await fs.writeFile(tokenPath, Buffer.from(JSON.stringify({ accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60_000 }), "utf8"));

    const client = new OpenAiSubscriptionClient(directory);
    await client.load();
    expect(await client.status()).toMatchObject({ kind: "signed-in" });

    await expect(client.disconnect()).resolves.toEqual({ kind: "signed-out" });
    await expect(fs.access(tokenPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await client.status()).toEqual({ kind: "signed-out" });
  });
});
