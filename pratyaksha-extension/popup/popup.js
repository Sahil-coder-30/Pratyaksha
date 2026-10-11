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
        if (popupDomain) {
          popupDomain.textContent = new URL(url).hostname;
        }
      } catch {
        if (popupDomain) {
          popupDomain.textContent = 'Active Page';
        }
      }
    }
  } catch (err) {
    if (popupDomain) popupDomain.textContent = 'Ready';
  }

  if (openSidePanelBtn) {
    openSidePanelBtn.addEventListener('click', async () => {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow?.id) {
          await chrome.sidePanel.open({ windowId: currentWindow.id });
        }
        window.close(); // close popup once side panel opens
      } catch (err) {
        console.error('Error opening side panel:', err);
      }
    });
  }
});
