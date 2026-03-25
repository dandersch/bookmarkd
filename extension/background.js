// Open side panel on extension icon click
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'popup.html',
      enabled: true
    });
    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    });
    chrome.sidePanel.open({ tabId: tab.id });
  } else {
    browser.sidebarAction.toggle();
  }
});

// Broadcast current tab info to sidebar
async function broadcastCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const tabInfo = {
        type: 'TAB_UPDATED',
        tab: {
          id: tab.id,
          url: tab.url || '',
          title: tab.title || '',
          favIconUrl: tab.favIconUrl || ''
        }
      };
      chrome.runtime.sendMessage(tabInfo).catch(() => {
        // Sidebar not open, ignore
      });
    }
  } catch (err) {
    // Ignore errors when no active tab
  }
}

// Listen for tab activation (switching tabs)
chrome.tabs.onActivated.addListener(() => {
  broadcastCurrentTab();
});

// Listen for tab updates (navigation, title changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl)) {
    broadcastCurrentTab();
  }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    broadcastCurrentTab();
  }
});

// --- Time Tracking ---

const FLUSH_INTERVAL_NAME = 'bookmarkd-time-flush';
const REFRESH_DOMAINS_NAME = 'bookmarkd-refresh-domains';
const FLUSH_SECONDS = 60;
const IDLE_THRESHOLD = 120; // seconds before considered idle

let trackedDomains = new Set();
let currentDomain = null;
let accumulatedSeconds = 0;
let lastTick = null;
let isIdle = false;
let windowFocused = true;

function normalizeDomain(hostname) {
  return hostname.replace(/^www\./, '');
}

function getActiveTabDomain() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.url) {
      try {
        return normalizeDomain(new URL(tab.url).hostname);
      } catch {}
    }
    return null;
  }).catch(() => null);
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['serverUrl', 'username', 'password'], (items) => {
      let authHeader = null;
      if (items.username && items.password) {
        const credentials = btoa(`${items.username}:${items.password}`);
        authHeader = `Basic ${credentials}`;
      }
      resolve({
        serverUrl: (items.serverUrl || 'http://localhost:8080').replace(/\/$/, ''),
        authHeader
      });
    });
  });
}

async function refreshTrackedDomains() {
  try {
    const config = await getConfig();
    const headers = {};
    if (config.authHeader) headers['Authorization'] = config.authHeader;

    const res = await fetch(`${config.serverUrl}/api/bookmarks`, { headers });
    if (!res.ok) return;

    const bookmarks = await res.json();
    const domains = new Set();
    for (const bm of bookmarks) {
      if (bm.track_time) {
        try {
          domains.add(normalizeDomain(new URL(bm.url).hostname));
        } catch {}
      }
    }
    trackedDomains = domains;
  } catch (err) {
    // Server unreachable, keep existing set
  }
}

async function flushTime() {
  if (!currentDomain || accumulatedSeconds <= 0) return;

  const domain = currentDomain;
  const seconds = accumulatedSeconds;
  accumulatedSeconds = 0;

  try {
    const config = await getConfig();
    const headers = { 'Content-Type': 'application/json' };
    if (config.authHeader) headers['Authorization'] = config.authHeader;

    await fetch(`${config.serverUrl}/api/time-tracking/${domain}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        seconds
      })
    });
  } catch (err) {
    // Failed to flush, re-add seconds so they aren't lost
    if (currentDomain === domain) {
      accumulatedSeconds += seconds;
    }
  }
}

function tick() {
  const now = Date.now();

  if (lastTick && currentDomain && trackedDomains.has(currentDomain) && !isIdle && windowFocused) {
    const elapsed = Math.round((now - lastTick) / 1000);
    if (elapsed > 0 && elapsed < FLUSH_SECONDS * 2) {
      accumulatedSeconds += elapsed;
    }
  }

  lastTick = now;
}

async function updateCurrentDomain() {
  const domain = await getActiveTabDomain();
  if (domain !== currentDomain) {
    // Domain changed — flush accumulated time for previous domain
    if (currentDomain && accumulatedSeconds > 0) {
      await flushTime();
    }
    currentDomain = domain;
    lastTick = Date.now();
  }
}

// Alarms
chrome.alarms.create(FLUSH_INTERVAL_NAME, { periodInMinutes: 1 });
chrome.alarms.create(REFRESH_DOMAINS_NAME, { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_INTERVAL_NAME) {
    tick();
    await flushTime();
  } else if (alarm.name === REFRESH_DOMAINS_NAME) {
    await refreshTrackedDomains();
  }
});

// Idle detection
chrome.idle.setDetectionInterval(IDLE_THRESHOLD);
chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'active') {
    isIdle = false;
    lastTick = Date.now();
  } else {
    // 'idle' or 'locked'
    tick(); // capture time up to now
    isIdle = true;
  }
});

// Track tab/window changes for domain switching
chrome.tabs.onActivated.addListener(() => updateCurrentDomain());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === 'complete') {
    updateCurrentDomain();
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    tick();
    windowFocused = false;
  } else {
    windowFocused = true;
    lastTick = Date.now();
    updateCurrentDomain();
  }
});

// Respond to queries from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'IS_DOMAIN_TRACKED') {
    sendResponse({ tracked: trackedDomains.has(message.domain) });
  }
});

// Initialize on service worker startup
refreshTrackedDomains();
updateCurrentDomain();
