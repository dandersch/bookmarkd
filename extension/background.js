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
