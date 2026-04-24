function hashCode(str) {
  let hash = 0;
  if (str.length === 0) {
    return '';
  }
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    // Convert to 32bit integer
    hash = hash & hash;
  }
  return hash.toString();
}

export function loadLocalMetrics() {
  return new Promise((resolve, _reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      if (!tabs || !tabs[0]) {
        resolve({error: 'No active tab found'});
        return;
      }

      const thisTab = tabs[0];

      // Retrieve the stored latest metrics
      if (thisTab.url) {
        const key = hashCode(thisTab.url);
        const loadedInBackgroundKey = thisTab.id.toString();

        chrome.storage.local.get([loadedInBackgroundKey, key], result => {
          const tabLoadedInBackground = result[loadedInBackgroundKey] || false;

          if (result[key] !== undefined) {
            if (result[key].type && result[key].type === 'error') {
              // It's an error message, not a metrics object
              resolve({error: result[key].message});
            } else {
              resolve({
                metrics: result[key],
                background: tabLoadedInBackground
              });
            }
          } else {
            resolve({error: `Storage empty for key ${key}`});
          }
        });
      } else {
        resolve({error: 'Active tab has no URL'});
      }
    });
  });
}

export function getOptions() {
  return new Promise(resolve => {
    chrome.storage.sync.get({preferPhoneField: false}, resolve);
  });
}

export function getURL() {
  return new Promise((resolve, _reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      if (!tabs || !tabs[0] || !tabs[0].url) {
        resolve('');
        return;
      }
      resolve(tabs[0].url);
    });
  });
}
