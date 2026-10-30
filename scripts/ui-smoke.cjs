const { app, BrowserWindow } = require("electron");
const { appendFileSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "aiim-ui-smoke-"));
const logFile = path.join(dataDirectory, "smoke.log");
app.disableHardwareAcceleration();
writeFileSync(logFile, "smoke process started\n");
process.env.AIIM_DATA_DIRECTORY = dataDirectory;
process.env.AIIM_UI_SMOKE = "1";
process.on("exit", () => rmSync(dataDirectory, { recursive: true, force: true }));
require(path.join(root, packageJson.main));
log("loaded AIIM main process");

void app.whenReady().then(async () => {
  log("electron ready");
  try {
    const buddyWindow = await findWindow("/buddies");
    log("buddy list found");
    const apiState = await runRenderer(buddyWindow, `({ api: typeof window.aiMessenger, body: document.body.innerText.slice(0, 80) })`);
    log(`renderer ready: ${JSON.stringify(apiState)}`);
    await runRenderer(buddyWindow, `window.aiMessenger.snapshot()`);
    log("initial snapshot loaded");
    log("saving first provider");
    const firstId = await runRenderer(buddyWindow, `window.aiMessenger.saveProvider({ kind: "minimax", name: "Smoke MiniMax" }).then(snapshot => snapshot.providers.find(provider => provider.name === "Smoke MiniMax").id)`);
    log("saving second provider");
    const secondId = await runRenderer(buddyWindow, `window.aiMessenger.saveProvider({ kind: "ollama", name: "Temporary Ollama", baseUrl: "http://localhost:11434" }).then(snapshot => snapshot.providers.find(provider => provider.name === "Temporary Ollama").id)`);
    log("saving buddy");
    await runRenderer(buddyWindow, `window.aiMessenger.saveBuddy({
        screenName: "smokeFriend", displayName: "Smoke Friend", providerId: firstId, modelId: "MiniMax-M3", reasoningEffort: "medium",
        systemPrompt: "Be concise.", group: "Test", color: "#2046a0", statusMessage: "Available", awayMessage: "Away",
        typingStyle: "quick", profileBio: "", profileLocation: "", profileInterests: "", profileQuote: "", presencePattern: "always",
        notificationSound: "none", fontFamily: "Tahoma", fontColor: "#1b489a", userRole: "", relationshipNotes: "", checkInFrequency: "off"
      })`.replace("firstId", JSON.stringify(firstId)));
    log("opening preferences");
    await runRenderer(buddyWindow, `window.aiMessenger.openSettings()`);
    const providerIds = { firstId, secondId };

    const settingsWindow = await findWindow("/settings");
    log("preferences found");
    await waitForSelector(settingsWindow, ".settings-tabs");
    const buddyTabOpened = await settingsWindow.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll(".settings-tabs button")].find((item) => item.textContent.includes("AI buddies")); if (!button) return false; button.click(); return true; })()`);
    assert(buddyTabOpened, "AI buddies tab was not available");
    log("AI buddies tab opened");
    await waitForSelector(settingsWindow, ".section-heading button");
    const buddyEditorOpened = await settingsWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector(".section-heading button"); if (!button) return false; button.click(); return true; })()`);
    assert(buddyEditorOpened, "Add buddy button was not available");
    log("buddy editor opened");
    await waitForSelector(settingsWindow, 'select[name="providerId"]');
    const editorStateReady = await settingsWindow.webContents.executeJavaScript(`(() => {
      const provider = document.querySelector('select[name="providerId"]');
      const model = [...document.querySelectorAll("label")].find((label) => label.firstChild?.textContent?.trim() === "Model")?.querySelector("select");
      const loading = document.querySelector(".model-loading");
      if (!provider || !model || provider.disabled) return false;
      provider.value = ${JSON.stringify(providerIds.secondId)};
      provider.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    assert(editorStateReady, "buddy editor did not keep its provider and model controls usable");
    log("buddy editor provider and model controls ready");
    await settingsWindow.webContents.executeJavaScript(`window.aiMessenger.removeProvider(${JSON.stringify(providerIds.secondId)})`);
    await pause(250);
    const selectedAfterRemoval = await settingsWindow.webContents.executeJavaScript(`document.querySelector('select[name="providerId"]')?.value`);
    assert(selectedAfterRemoval === providerIds.firstId, "provider dropdown did not recover after its selected provider was removed");
    log("dropdown reconciled");

    await buddyWindow.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('select[aria-label="Your status"]');
      status.value = "away";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await pause(200);
    const profileStatus = await buddyWindow.webContents.executeJavaScript(`window.aiMessenger.snapshot().then((snapshot) => snapshot.profile.status)`);
    assert(profileStatus === "away", "availability did not save without reopening the window");
    log("availability saved");

    const buddyId = await buddyWindow.webContents.executeJavaScript(`window.aiMessenger.snapshot().then((snapshot) => snapshot.buddies[0].id)`);
    await buddyWindow.webContents.executeJavaScript(`window.aiMessenger.openChat(${JSON.stringify(buddyId)})`);
    const chatWindow = await findWindow("/chat/");
    await waitForSelector(chatWindow, "textarea.composer");
    const clearClicked = await chatWindow.webContents.executeJavaScript(`(() => {
      window.confirm = () => true;
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Clear history");
      if (!button) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    assert(clearClicked, "the Clear history button was not available");
    await pause(150);
    const composerFocused = await chatWindow.webContents.executeJavaScript(`document.activeElement === document.querySelector("textarea.composer")`);
    assert(composerFocused, "Clear history did not return keyboard focus to the composer");
    await chatWindow.webContents.executeJavaScript(`(() => {
      const box = document.querySelector("textarea.composer");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, "still works");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await pause(50);
    const composerWorks = await chatWindow.webContents.executeJavaScript(`(() => { const box = document.querySelector("textarea.composer"); const send = document.querySelector(".send-row .primary"); return box.value === "still works" && !box.disabled && !send.disabled; })()`);
    assert(composerWorks, "the composer did not accept text after history was cleared");
    log("composer works after clear");

    const roomId = await buddyWindow.webContents.executeJavaScript(`(async () => {
      const snapshot = await window.aiMessenger.snapshot();
      const first = snapshot.buddies[0];
      const secondSnapshot = await window.aiMessenger.saveBuddy({ ...first, id: undefined, screenName: "smokeTwo", displayName: "Smoke Two" });
      const second = secondSnapshot.buddies.find((buddy) => buddy.screenName === "smokeTwo");
      await window.aiMessenger.saveBuddy({ ...first, id: undefined, screenName: "smokeThree", displayName: "Smoke Three" });
      const room = await window.aiMessenger.newBuddyChat([first.id, second.id]);
      await window.aiMessenger.openConversation(room.id);
      return room.id;
    })()`);
    const buddyChatWindow = await findWindow(`/chat/${roomId}`);
    await waitForSelector(buddyChatWindow, ".participants-card");
    const roomIdentityReady = await buddyChatWindow.webContents.executeJavaScript(`document.querySelector(".participants-card")?.innerText.includes("@smokeFriend") && document.querySelector(".participants-card")?.innerText.includes("@smokeTwo")`);
    assert(roomIdentityReady, "Buddy Chat did not show participant screen names");
    await buddyChatWindow.webContents.executeJavaScript(`(() => {
      const box = document.querySelector("textarea.composer");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, "@sm");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await waitForSelector(buddyChatWindow, ".mention-menu");
    const mentionChoices = await buddyChatWindow.webContents.executeJavaScript(`document.querySelector(".mention-menu")?.innerText`);
    assert(mentionChoices.includes("@smokeFriend") && mentionChoices.includes("@smokeTwo"), "Buddy Chat mention suggestions were incomplete");
    await buddyChatWindow.webContents.executeJavaScript(`document.querySelector("textarea.composer").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`);
    await pause(50);
    await buddyChatWindow.webContents.executeJavaScript(`document.querySelector("textarea.composer").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))`);
    await pause(50);
    const mentionCompletion = await buddyChatWindow.webContents.executeJavaScript(`(() => { const box = document.querySelector("textarea.composer"); return { value: box.value, focused: document.activeElement === box, selectionStart: box.selectionStart, selectionEnd: box.selectionEnd }; })()`);
    assert(mentionCompletion.value === "@smokeTwo ", "Tab did not complete the highlighted Buddy Chat handle");
    assert(mentionCompletion.focused && mentionCompletion.selectionStart === mentionCompletion.value.length && mentionCompletion.selectionEnd === mentionCompletion.value.length, "mention completion did not leave the caret after the handle");
    const inviteOpened = await buddyChatWindow.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll(".to-row button")].find((item) => item.textContent?.trim() === "Invite buddy"); button?.click(); return Boolean(button); })()`);
    assert(inviteOpened, "Buddy Chat invite control was not available");
    await waitForSelector(buddyChatWindow, '[aria-label="Invite a buddy"] input[type="radio"]');
    await buddyChatWindow.webContents.executeJavaScript(`(() => { const radio = document.querySelector('[aria-label="Invite a buddy"] input[type="radio"]'); radio.click(); const button = [...document.querySelectorAll('[aria-label="Invite a buddy"] button')].find((item) => item.textContent?.trim() === "Invite"); button.click(); })()`);
    await pause(250);
    const invitePersisted = await buddyChatWindow.webContents.executeJavaScript(`document.querySelector(".participants-card")?.innerText.includes("@smokeThree") && document.querySelector(".transcript")?.innerText.includes("Smoke Three joined the Buddy Chat.")`);
    assert(invitePersisted, "Buddy Chat invite did not update the participants and transcript");
    log("Buddy Chat participants, mentions, and invite work");

    await buddyWindow.webContents.executeJavaScript(`window.aiMessenger.openHelp()`);
    const helpWindow = await findWindow("/help");
    await waitForSelector(helpWindow, ".help-content");
    const helpSections = await helpWindow.webContents.executeJavaScript(`document.querySelectorAll(".help-content section").length`);
    assert(helpSections >= 6, "the in-app help did not render");
    log("help rendered");

    console.log("AIIM Electron smoke test passed: live dropdown reconciliation, availability, clear-history composer, Buddy Chat UI, and Help.");
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.quit();
  } catch (error) {
    log(error instanceof Error ? `${error.stack}` : String(error));
    console.error(error);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(1);
  }
});

async function findWindow(route) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const match = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes(`#${route}`));
    if (match) { await waitForLoad(match); return match; }
    await pause(100);
  }
  throw new Error(`Window not found for route: ${route}`);
}

async function waitForLoad(window) {
  if (!window.webContents.isLoading()) return;
  await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
}

async function waitForSelector(window, selector) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    } catch {
      // The renderer can still be transitioning from its loading view.
    }
    await pause(100);
  }
  throw new Error(`Element not ready: ${selector}`);
}

function pause(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function log(message) { appendFileSync(logFile, `${message}\n`); console.log(`[smoke] ${message}`); }
async function runRenderer(window, code) {
  return Promise.race([
    window.webContents.executeJavaScript(code),
    pause(5000).then(() => { throw new Error(`Renderer step timed out: ${code.slice(0, 80)}`); }),
  ]);
}
