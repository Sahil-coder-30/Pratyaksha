/**
 * PRATYAKSHA Quick Launcher Popup
 * Sovereign Privacy-First Browser Agent
 */

document.addEventListener('DOMContentLoaded', async () => {
  const popupDomain = document.getElementById('popupDomain');
  const openSidePanelBtn = document.getElementById('openSidePanelBtn');

  // Query current tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      const url = tabs[0].url || '';
      try {
        popupDomain.textContent = new URL(url).hostname;
      } catch {
        popupDomain.textContent = 'Active Page';
      }
    }
  } catch (err) {
    popupDomain.textContent = 'Ready';
  }

  openSidePanelBtn.addEventListener('click', async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close(); // close popup once side panel opens
    } catch (err) {
      console.error('Error opening side panel:', err);
    }
  });
});
