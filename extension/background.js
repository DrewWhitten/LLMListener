// Background: owns the "session", i.e. the one Claude tab opened by a wake word.
//
//   listener page --vl-wake--> background --opens tab--> content script clicks voice button
//   content script --vl-voice-started / vl-voice-ended / vl-failed--> background
//   background --vl-started / vl-ended--> listener page (which then resumes listening)
//
// The service worker can be shut down at any time, so session state lives in session storage.

const NEW_CHAT_URL = 'https://claude.ai/new';
const CHAT_URL_PREFIX = 'https://claude.ai/chat/';
const DEFAULT_LABEL = 'voice mode';

async function getSession() {
  return (await chrome.storage.session.get('session')).session || null;
}

async function setSession(session) {
  if (session) await chrome.storage.session.set({ session });
  else await chrome.storage.session.remove('session');
}

function notifyListener(message) {
  // Rejects when no extension page is open to receive it; that is fine.
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function findListener() {
  const url = chrome.runtime.getURL('listener.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts.find((c) => c.documentUrl === url) || null;
}

// Toolbar icon: open the listener page, or switch to it if it is already open.
async function openListener() {
  const existing = await findListener();
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: chrome.runtime.getURL('listener.html') });
  }
}

// True while a session is recorded and its Claude tab still exists. A session whose tab has
// vanished without us hearing about it is forgotten here.
async function sessionIsActive() {
  const session = await getSession();
  if (!session) return false;
  try {
    await chrome.tabs.get(session.tabId);
    return true;
  } catch (e) {
    await setSession(null);
    return false;
  }
}

// Requests are handled strictly one after another, so two wake words arriving together cannot
// both find "no session" and each open a tab.
let startQueue = Promise.resolve();
function startSession(requestedAction) {
  const result = startQueue.then(() => startSessionNow(requestedAction));
  startQueue = result.catch(() => {});
  return result;
}

async function startSessionNow(requestedAction) {
  // One session at a time. While its Claude tab exists, every further wake word is refused.
  if (await sessionIsActive()) {
    return { ok: false, active: true, reason: 'a conversation is already open' };
  }

  let action = requestedAction === 'continue' ? 'continue' : 'new';
  let url = NEW_CHAT_URL;
  if (action === 'continue') {
    const { lastChatUrl } = await chrome.storage.local.get('lastChatUrl');
    if (lastChatUrl) url = lastChatUrl;
    else action = 'new'; // nothing to continue yet
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await setSession({ tabId: tab.id, action, voiceStarted: false, startedAt: Date.now() });
  console.log('[LLMListener] session started', action, url, 'tab', tab.id);
  return { ok: true, action, requestedAction };
}

async function endSession(reason, detail) {
  const session = await getSession();
  if (!session) return false;
  await setSession(null);
  console.log('[LLMListener] session ended:', reason, detail || '');

  try {
    await chrome.tabs.remove(session.tabId); // closing the tab is what stops Claude's voice mode
  } catch (e) {
    // already closed
  }
  const listener = await findListener();
  if (listener) {
    try {
      await chrome.tabs.update(listener.tabId, { active: true });
    } catch (e) {
      // listener tab went away
    }
  }
  notifyListener({ type: 'vl-ended', reason, detail });
  return true;
}

chrome.action.onClicked.addListener(() => openListener());

// Bring the home/listener page up when Chrome starts and when the extension is (re)loaded.
chrome.runtime.onStartup.addListener(() => openListener());
chrome.runtime.onInstalled.addListener(() => openListener());

// Manual launch (Ctrl+Shift+1), for testing without speaking.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'launch-script') return;
  const result = await startSession('new');
  if (result.ok) notifyListener({ type: 'vl-wake-external', action: result.action });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session && session.tabId === tabId) endSession('tab-closed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  // ---- from the listener page ----
  if (msg.type === 'vl-wake') {
    startSession(msg.action).then(sendResponse, (err) =>
      sendResponse({ ok: false, reason: String(err && err.message ? err.message : err) })
    );
    return true;
  }
  if (msg.type === 'vl-status') {
    sessionIsActive().then((active) => sendResponse({ active }));
    return true;
  }
  if (msg.type === 'vl-end') {
    endSession(msg.reason || 'requested').then((ended) => sendResponse({ ended }));
    return true;
  }

  // ---- from the content script in the session's Claude tab ----
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return false;

  (async () => {
    const session = await getSession();
    const mine = !!session && session.tabId === tabId;

    switch (msg.type) {
      case 'vl-ready': {
        // Answer "launch" on every page load until voice mode has started, so a redirect
        // (for example to the login page) still gets handled.
        if (!mine || session.voiceStarted) return sendResponse({ launch: false });
        const { voiceButtonLabel } = await chrome.storage.local.get('voiceButtonLabel');
        return sendResponse({ launch: true, label: voiceButtonLabel || DEFAULT_LABEL });
      }
      case 'vl-voice-started':
        if (!mine) return;
        await setSession({ ...session, voiceStarted: true });
        await chrome.storage.local.set({ lastVoiceReport: msg.report });
        return notifyListener({ type: 'vl-started', report: msg.report });
      case 'vl-voice-ended':
        if (mine) await endSession('voice-ended', msg.how);
        return;
      case 'vl-failed':
        if (mine) await endSession('failed', msg.reason);
        return;
      case 'vl-chat-url':
        // Remember the conversation so the continue phrase can reopen it.
        if (mine && typeof msg.url === 'string' && msg.url.startsWith(CHAT_URL_PREFIX)) {
          await chrome.storage.local.set({ lastChatUrl: msg.url });
        }
        return;
    }
  })();
  return msg.type === 'vl-ready';
});
