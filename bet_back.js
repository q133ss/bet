(function () {
  const manifest = chrome.runtime.getManifest();
  const extensionId = chrome.runtime.id || 'offline-mode';

  const DEFAULT_STATE = {
    appActive: false,
    prepType: 'instant',
    prepareBet: false,
    connectionStatus: 'disconnected',
    isProcessing: false,
    betHistory: [],
    proxy: {
      protocol: 'http',
      ip: '',
      port: '',
      user: '',
      password: ''
    },
    danger: {
      label: 'Idle',
      command: 'Awaiting activation',
      safe: false
    },
    license: {
      id: extensionId,
      expiresAt: 'Unlimited'
    }
  };

  const SOUND_MAP = {
    activated: 'audio/active.mp3',
    success: 'audio/success.mp3',
    error: 'audio/error.mp3',
    warmup: 'audio/warmup.mp3',
    notification: 'audio/notif.mp3'
  };

  const DANGER_LEVELS = [
    { label: 'Calm phase', command: 'Monitor opportunities', safe: true },
    { label: 'Low risk', command: 'Look for value bets', safe: true },
    { label: 'Medium risk', command: 'Reduce stake size', safe: false },
    { label: 'High risk', command: 'Hold fire', safe: false },
    { label: 'Critical', command: 'Abort betting', safe: false }
  ];

  const ports = new Set();
  let state = { ...DEFAULT_STATE };
  let dangerInterval = null;

  function getPersistableState() {
    return {
      appActive: state.appActive,
      prepType: state.prepType,
      prepareBet: state.prepareBet,
      betHistory: state.betHistory,
      proxy: state.proxy
    };
  }

  function getStateForUi() {
    return {
      ...state,
      version: manifest.version,
      timestamp: Date.now()
    };
  }

  function storageGet(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, resolve);
    });
  }

  function storageSet(payload) {
    return new Promise(resolve => {
      chrome.storage.local.set(payload, resolve);
    });
  }

  async function persistState() {
    await storageSet({ betState: getPersistableState() });
  }

  function broadcastState() {
    const snapshot = getStateForUi();
    ports.forEach(port => {
      try {
        port.postMessage({ type: 'stateUpdate', state: snapshot });
      } catch (error) {
        console.warn('Failed to post state to port', error);
      }
    });
  }

  function playSound(key) {
    const soundPath = SOUND_MAP[key];
    if (!soundPath) {
      return;
    }

    try {
      const audio = new Audio(chrome.runtime.getURL(soundPath));
      audio.volume = 0.6;
      audio.play().catch(() => {
        /* Audio playback may be blocked in background scripts */
      });
    } catch (error) {
      console.warn('Unable to play sound', error);
    }
  }

  function showNotification(title, message, soundKey = 'notification') {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'images/icon.png',
      title,
      message,
      priority: 1
    });

    playSound(soundKey);
  }

  function startDangerSimulation() {
    if (dangerInterval) {
      return;
    }

    const updateDanger = () => {
      const next = DANGER_LEVELS[Math.floor(Math.random() * DANGER_LEVELS.length)];
      state.danger = { ...next };
      broadcastState();
    };

    updateDanger();
    dangerInterval = setInterval(updateDanger, 7000);
  }

  function stopDangerSimulation() {
    if (!dangerInterval) {
      return;
    }

    clearInterval(dangerInterval);
    dangerInterval = null;
    state.danger = { ...DEFAULT_STATE.danger };
    broadcastState();
  }

  async function handleToggleApp(active) {
    if (state.appActive === active) {
      return state.appActive;
    }

    state.appActive = active;
    state.connectionStatus = active ? 'connected' : 'disconnected';
    if (!active) {
      state.isProcessing = false;
    }

    if (active) {
      startDangerSimulation();
      showNotification('Automation activated', 'The betting workflow is now active.', 'activated');
    } else {
      stopDangerSimulation();
      showNotification('Automation deactivated', 'The betting workflow has been stopped.');
    }

    await persistState();
    broadcastState();
    return state.appActive;
  }

  function simulateCoupon() {
    const now = new Date();
    const basePrice = (Math.random() * 2.2 + 1.2).toFixed(2);
    const stake = (Math.random() * 9 + 1).toFixed(2);

    return {
      id: `BET-${now.getTime().toString().slice(-6)}`,
      createdAt: now.toISOString(),
      event: state.prepType === 'danger' ? 'High volatility market' : 'Primary market',
      market: state.prepType === 'danger' ? 'Lay — Rapid cashout' : 'Back — Value bet',
      price: Number(basePrice),
      stake: Number(stake),
      currency: 'USD',
      prepared: state.prepareBet,
      mode: state.prepType,
      status: 'Sent'
    };
  }

  async function handlePlaceBet(origin) {
    if (!state.appActive) {
      throw new Error('Activate the app before placing bets.');
    }

    if (state.isProcessing) {
      throw new Error('Another bet is currently being processed.');
    }

    state.isProcessing = true;
    broadcastState();

    await new Promise(resolve => setTimeout(resolve, 600));

    const coupon = simulateCoupon();
    coupon.origin = origin;

    state.betHistory = [coupon, ...state.betHistory].slice(0, 10);
    state.isProcessing = false;

    showNotification('Bet placed', `${coupon.id} placed successfully.`, 'success');
    await persistState();
    broadcastState();
    return coupon;
  }

  async function handlePrepareBet(enabled) {
    state.prepareBet = Boolean(enabled);
    if (enabled) {
      playSound('warmup');
    }
    await persistState();
    broadcastState();
    return state.prepareBet;
  }

  async function handleSetPrepType(type) {
    const nextType = type === 'danger' ? 'danger' : 'instant';
    state.prepType = nextType;
    await persistState();
    broadcastState();
    return state.prepType;
  }

  async function handleProxyUpdate(proxy) {
    state.proxy = {
      protocol: proxy?.protocol === 'socks' ? 'socks' : 'http',
      ip: proxy?.ip ? String(proxy.ip).trim() : '',
      port: proxy?.port ? String(proxy.port).trim() : '',
      user: proxy?.user ? String(proxy.user).trim() : '',
      password: proxy?.password ? String(proxy.password).trim() : ''
    };
    await persistState();
    broadcastState();
    return state.proxy;
  }

  async function openSeparateWindow() {
    chrome.windows.create({
      url: chrome.runtime.getURL('html/popup.html'),
      type: 'popup',
      width: 460,
      height: 640
    });
  }

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'popup') {
      return;
    }

    ports.add(port);
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });

    port.postMessage({ type: 'stateUpdate', state: getStateForUi() });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    (async () => {
      switch (message.type) {
        case 'getState':
          return getStateForUi();
        case 'toggleApp':
          return handleToggleApp(Boolean(message.payload?.active));
        case 'placeBet':
          return handlePlaceBet(message.payload?.origin || 'popup');
        case 'setPrepareBet':
          return handlePrepareBet(Boolean(message.payload?.enabled));
        case 'setPrepType':
          return handleSetPrepType(message.payload?.type || DEFAULT_STATE.prepType);
        case 'updateProxy':
          return handleProxyUpdate(message.payload || {});
        case 'openSeparateWindow':
          await openSeparateWindow();
          return true;
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    })()
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error(error);
        showNotification('Error', error.message, 'error');
        sendResponse({ success: false, error: error.message });
      });

    return true;
  });

  chrome.commands.onCommand.addListener(async command => {
    try {
      if (command === 'do_bet') {
        await handlePlaceBet('shortcut');
      } else if (command === 'danger_moment') {
        state.danger = {
          label: 'Manual danger signal',
          command: 'Hold positions',
          safe: false
        };
        broadcastState();
      }
    } catch (error) {
      console.error(error);
    }
  });

  async function initializeBackground() {
    try {
      const stored = await storageGet('betState');
      if (stored && stored.betState) {
        state = {
          ...state,
          ...stored.betState
        };
      }
    } catch (error) {
      console.error('Failed to restore state', error);
    }

    state.proxy = {
      ...DEFAULT_STATE.proxy,
      ...state.proxy
    };

    state.connectionStatus = state.appActive ? 'connected' : 'disconnected';

    if (state.appActive) {
      startDangerSimulation();
    }

    broadcastState();
  }

  initializeBackground();
})();
