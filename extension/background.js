chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) /* only for chrome */ {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'popup.html',
      enabled: true
    });
    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true // toggles sidebar when clicking extension icon
    });
    chrome.sidePanel.open({ tabId: tab.id });
  } else /* only for firefox */ {
    browser.sidebarAction.toggle();
  }
});
