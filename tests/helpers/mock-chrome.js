/**
 * Mock Chrome Extension API for Unit & Integration Testing
 */

export function createMockChrome(initialState = {}) {
  const tabs = new Map();
  const windows = [{ id: 1, focused: true }];
  let activeTabId = initialState.activeTabId || 1;

  if (initialState.tabs) {
    for (const t of initialState.tabs) {
      tabs.set(t.id, { ...t });
    }
  } else {
    tabs.set(1, {
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      title: 'Example Domain',
      status: 'complete',
      active: true
    });
  }

  const updateListeners = new Set();
  const messagesSent = [];
  let nextMessageResponse = null;
  let simulateChannelClosed = false;

  return {
    _state: { tabs, windows, messagesSent },
    _setSimulateChannelClosed(val) { simulateChannelClosed = val; },
    _setNextMessageResponse(resp) { nextMessageResponse = resp; },

    tabs: {
      get(id) {
        const tab = tabs.get(id);
        if (!tab) return Promise.reject(new Error(`No tab with id: ${id}`));
        return Promise.resolve({ ...tab });
      },
      update(id, props) {
        const tab = tabs.get(id);
        if (!tab) return Promise.reject(new Error(`No tab with id: ${id}`));
        Object.assign(tab, props);
        if (props.url) {
          tab.status = 'loading';
          setTimeout(() => {
            tab.status = 'complete';
            updateListeners.forEach(fn => fn(id, { status: 'complete' }));
          }, 50);
        }
        return Promise.resolve({ ...tab });
      },
      query(queryInfo) {
        let results = Array.from(tabs.values());
        if (queryInfo.active) results = results.filter(t => t.id === activeTabId);
        if (queryInfo.windowId) results = results.filter(t => t.windowId === queryInfo.windowId);
        return Promise.resolve(results);
      },
      goBack(id) {
        const tab = tabs.get(id);
        if (tab) tab.url = 'https://example.com/previous';
        return Promise.resolve();
      },
      goForward(id) {
        const tab = tabs.get(id);
        if (tab) tab.url = 'https://example.com/next';
        return Promise.resolve();
      },
      captureVisibleTab(winId, options) {
        return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      },
      sendMessage(id, message, callback) {
        messagesSent.push({ id, message });
        if (simulateChannelClosed) {
          const err = new Error('The message channel closed before a response was received.');
          return callback ? callback(undefined) : Promise.reject(err);
        }

        const resp = nextMessageResponse !== null
          ? nextMessageResponse
          : { success: true, result: 'OK' };

        if (callback) {
          callback(resp);
        }
        return Promise.resolve(resp);
      },
      onUpdated: {
        addListener(fn) { updateListeners.add(fn); },
        removeListener(fn) { updateListeners.delete(fn); }
      }
    },

    windows: {
      getCurrent() {
        return Promise.resolve({ id: 1 });
      }
    },

    scripting: {
      insertCSS: () => Promise.resolve(),
      executeScript: () => Promise.resolve()
    },

    runtime: {
      lastError: null
    }
  };
}
