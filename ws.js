// Deriv WebSocket handler: connect/disconnect, ping, market loading, ticks subscription
(function() {
  const DERIV_WSS = 'wss://ws.derivws.com/websockets/v3?app_id=';
  const STORAGE_KEY = 'derivCredentials';
  const SYMBOL_KEY = 'selectedSymbol';
  const DIGIT_STATS_KEY = 'digitStats';
  const externalListeners = new Set();

  const connectBtn = document.getElementById('connectBtn');
  const apiKeyInput = document.getElementById('apiKey');
  const appIdInput = document.getElementById('appId');
  const marketSelect = document.getElementById('market');
  const priceField = document.getElementById('price');
  const lastDigitField = document.getElementById('lastDigit');
  // Stake fields are user-controlled; do not auto-fill from ticks
  const actualBalanceInput = document.getElementById('actualBalance');
  const logContainer = document.getElementById('logContainer');
  const clearLogsBtn = document.getElementById('clearLogs');

  let ws = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let isManualClose = false;
  let currentSymbol = null;
  let pipBySymbol = new Map();
  let accountCurrency = 'USD';
  let digitStats = loadDigitStats();

  function loadDigitStats() {
    try {
      const raw = JSON.parse(localStorage.getItem(DIGIT_STATS_KEY));
      if (!raw || typeof raw !== 'object') return {};
      return raw;
    } catch (_) {
      return {};
    }
  }

  function persistDigitStats() {
    try {
      localStorage.setItem(DIGIT_STATS_KEY, JSON.stringify(digitStats));
    } catch (_) {
      // ignore persistence issues
    }
  }

  function getOrInitStat(symbol) {
    if (!symbol) return null;
    if (!digitStats[symbol]) {
      digitStats[symbol] = {
        total: 0,
        counts: Array.from({ length: 10 }, () => 0),
        queue: []
      };
    }
    return digitStats[symbol];
  }

  function resetDigitStat(symbol) {
    if (!symbol) return;
    digitStats[symbol] = {
      total: 0,
      counts: Array.from({ length: 10 }, () => 0),
      queue: []
    };
    persistDigitStats();
    document.dispatchEvent(new CustomEvent('ws:digit-stats', { detail: { symbol, stats: digitStats[symbol] } }));
  }

  function loadStoredCredentials() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }

  function saveCredentials(data) {
    try {
      const next = { ...loadStoredCredentials(), ...data };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
      // ignore storage errors
    }
  }

  const storedCreds = loadStoredCredentials();
  if (apiKeyInput && storedCreds.apiKey) apiKeyInput.value = storedCreds.apiKey;
  if (appIdInput && storedCreds.appId) appIdInput.value = storedCreds.appId;
  const storedSymbol = (() => {
    try {
      return localStorage.getItem(SYMBOL_KEY) || null;
    } catch (_) {
      return null;
    }
  })();

  function log(message, type = 'info') {
    if (!logContainer) return;
    const line = document.createElement('div');
    line.className = type === 'error' ? 'text-red-700' : type === 'warn' ? 'text-navy/80' : 'text-navy';
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  if (clearLogsBtn && logContainer) {
    clearLogsBtn.addEventListener('click', () => (logContainer.innerHTML = ''));
  }

  function updateConnectUi(connected) {
    if (!connectBtn) return;
    connectBtn.querySelector('span + span').textContent = connected ? 'Disconnect' : 'Connect';
    connectBtn.classList.toggle('bg-leaf', !connected);
    connectBtn.classList.toggle('bg-navy', connected);
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (isManualClose) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      log('Reconnecting...');
      connect();
    }, 1000);
  }

  function connect() {
    let appId = (appIdInput && appIdInput.value || '').trim();
    let apiKey = (apiKeyInput && apiKeyInput.value || '').trim();
    if (!appId || (!apiKey && !apiKeyInput)) {
      const cached = loadStoredCredentials();
      if (!appId && cached.appId) appId = cached.appId;
      if (!apiKey && cached.apiKey) apiKey = cached.apiKey;
    }
    if (!appId) { log('Missing App ID', 'error'); return; }

    try { ws && ws.close(); } catch (_) {}
    isManualClose = false;
    saveCredentials({ appId, apiKey, autoConnect: true });
    ws = new WebSocket(DERIV_WSS + encodeURIComponent(appId));

    ws.onopen = () => {
      updateConnectUi(true);
      log('Connected to Deriv WebSocket');
      startPing();
      if (apiKey) {
        ws.send(JSON.stringify({ authorize: apiKey }));
      } else {
        log('No API Key provided. Some endpoints may be restricted.', 'warn');
        // Still proceed to load markets and subscribe to public ticks
        loadMarkets();
      }
      document.dispatchEvent(new CustomEvent('ws:connected'));
    };

    ws.onclose = () => {
      updateConnectUi(false);
      stopPing();
      log('Disconnected');
      document.dispatchEvent(new CustomEvent('ws:disconnected'));
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      log('WebSocket error occurred', 'error');
    };

    ws.onmessage = async (evt) => {
      try {
        const raw = evt.data;
        let text = '';
        if (typeof raw === 'string') {
          text = raw;
        } else if (raw instanceof Blob) {
          text = await raw.text();
        } else if (raw instanceof ArrayBuffer) {
          text = new TextDecoder().decode(raw);
        } else if (raw && typeof raw === 'object' && 'data' in raw) {
          // Fallback for unexpected shapes
          text = String(raw.data);
        }
        if (!text) return;
        const data = JSON.parse(text);
        handleMessage(data);
        notifyExternal(data);
      } catch (_) {
        // Silently ignore unparsable frames
      }
    };
  }

  function disconnect() {
    isManualClose = true;
    try { ws && ws.close(); } catch (_) {}
    stopPing();
    updateConnectUi(false);
    saveCredentials({ autoConnect: false });
    log('Disconnected by user');
  }

  function handleMessage(msg) {
    if (msg.error) {
      log(`Error: ${msg.error.message || 'Unknown error'}`, 'error');
      return;
    }

    if (msg.msg_type === 'authorize') {
      log('Authorization success');
      requestBalance();
      loadMarkets();
      return;
    }

    if (msg.msg_type === 'balance') {
      const { balance } = msg;
      if (balance) {
        accountCurrency = balance.currency || accountCurrency;
        if (actualBalanceInput) {
          const display = `${accountCurrency} ${Number(balance.balance).toFixed(2)}`.trim();
          actualBalanceInput.value = display;
        }
      }
      return;
    }

    if (msg.msg_type === 'active_symbols') {
      const all = Array.isArray(msg.active_symbols) ? msg.active_symbols : [];
      // Prefer robust filtering using display names per user instruction
      const list = all.filter((s) => (
        (s.market_display_name === 'Synthetic Indices' || s.market === 'synthetic_index') &&
        (s.submarket_display_name === 'Continuous Indices' || (s.submarket && s.submarket.includes('continuous')))
      ));
      // Sort by display name
      list.sort((a,b) => a.display_name.localeCompare(b.display_name));
      // Build options and pip map
      pipBySymbol.clear();
      if (marketSelect) {
        marketSelect.innerHTML = '';
        for (const sym of list) {
          const opt = document.createElement('option');
          opt.value = sym.symbol;
          opt.textContent = sym.display_name;
          marketSelect.appendChild(opt);
          // pip value: prefer provided pip, else derive from spot_decimals/display_decimals
          let pip = undefined;
          if (sym.pip !== undefined && sym.pip !== null) {
            pip = Number(sym.pip);
          }
          if (!pip || Number.isNaN(pip)) {
            const decimals = (typeof sym.display_decimals === 'number' ? sym.display_decimals : sym.spot_decimals) || 2;
            pip = 1 / Math.pow(10, decimals);
          }
          pipBySymbol.set(sym.symbol, pip);
        }
        log(`Loaded ${list.length} markets with pip values`);
        if (list.length > 0) {
          let targetSymbol = marketSelect.options[0]?.value || null;
          if (storedSymbol && list.some((s) => s.symbol === storedSymbol)) {
            targetSymbol = storedSymbol;
          }
          if (targetSymbol) {
            marketSelect.value = targetSymbol;
            currentSymbol = targetSymbol;
            subscribeTicks(currentSymbol);
          }
        }
      }
      document.dispatchEvent(new CustomEvent('ws:markets-loaded', { detail: { count: list.length } }));
      return;
    }

    if (msg.msg_type === 'tick') {
      const { tick } = msg;
      if (!tick) return;
      if (tick.symbol !== currentSymbol) return; // ignore others
      const pip = pipBySymbol.get(tick.symbol) || 0.01;
      const price = Number(tick.quote);
      const decimals = Math.max(0, String(pip).split('.')[1]?.length || 2);
      const priceText = price.toFixed(decimals);
      if (priceField) priceField.value = priceText;
      // compute last digit respecting pip
      const normalized = priceText.split('.');
      const frac = normalized[1] || '';
      const last = decimals > 0 ? (frac.slice(-1) || '0') : String(Math.floor(price)).slice(-1);
      if (lastDigitField) lastDigitField.value = last;
      document.dispatchEvent(new CustomEvent('ws:tick', { detail: { tick, lastDigit: last, priceText } }));
      updateDigitStats(tick.symbol, Number(last));
      return;
    }

    // Seed from historical ticks (rolling 1000) and continue live via subscription
    if (msg.msg_type === 'history') {
      const h = msg.history;
      if (!h || !Array.isArray(h.prices) || !h.prices.length) return;
      const symbol = h.symbol || currentSymbol;
      if (!symbol) return;
      // Reset and rebuild queue from history
      resetDigitStat(symbol);
      const stats = getOrInitStat(symbol);
      const pip = pipBySymbol.get(symbol) || 0.01;
      const decimals = Math.max(0, String(pip).split('.')[1]?.length || 2);
      // Take up to last 1000 prices
      const start = Math.max(0, h.prices.length - 1000);
      for (let i = start; i < h.prices.length; i++) {
        const price = Number(h.prices[i]);
        const priceText = price.toFixed(decimals);
        const frac = priceText.split('.')[1] || '';
        const digit = decimals > 0 ? Number(frac.slice(-1) || '0') : Number(String(Math.floor(price)).slice(-1));
        if (!Number.isNaN(digit) && digit >= 0 && digit <= 9) {
          stats.queue.push(digit);
          stats.counts[digit] = (stats.counts[digit] || 0) + 1;
        }
      }
      stats.total = stats.queue.length;
      persistDigitStats();
      document.dispatchEvent(new CustomEvent('ws:digit-stats', { detail: { symbol, stats } }));
      return;
    }
  }

  function requestBalance() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
  }

  function loadMarkets() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Request full details to ensure pip/decimals are available
      ws.send(JSON.stringify({ active_symbols: 'full', product_type: 'basic' }));
    }
  }

  function subscribeTicks(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // First, forget previous ticks
    ws.send(JSON.stringify({ forget_all: 'ticks' }));
    // Request rolling history of 1000 with live subscription
    ws.send(JSON.stringify({
      ticks_history: symbol,
      count: 1000,
      end: 'latest',
      style: 'ticks',
      adjust_start_time: 1,
      subscribe: 1
    }));
    // subscription confirmed silently
    document.dispatchEvent(new CustomEvent('ws:market-subscribed', { detail: { symbol } }));
    try {
      localStorage.setItem(SYMBOL_KEY, symbol || '');
    } catch (_) {
      // ignore storage issues
    }
  }

  if (marketSelect) {
    marketSelect.addEventListener('change', (e) => {
      currentSymbol = marketSelect.value;
      subscribeTicks(currentSymbol);
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connect();
      } else if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        disconnect();
      }
    });
  }

  function notifyExternal(msg) {
    externalListeners.forEach((handler) => {
      try { handler(msg); } catch (_) { /* swallow listener errors */ }
    });
  }

  function updateDigitStats(symbol, digit) {
    if (Number.isNaN(digit) || digit < 0 || digit > 9) return;
    const stats = getOrInitStat(symbol);
    if (!stats) return;
    // Push new digit to rolling queue
    stats.queue.push(digit);
    stats.counts[digit] = (stats.counts[digit] || 0) + 1;
    // Evict if window exceeds 1000
    if (stats.queue.length > 1000) {
      const old = stats.queue.shift();
      if (typeof old === 'number' && old >= 0 && old <= 9) {
        stats.counts[old] = Math.max(0, (stats.counts[old] || 0) - 1);
      }
    }
    stats.total = stats.queue.length;
    persistDigitStats();
    document.dispatchEvent(new CustomEvent('ws:digit-stats', { detail: { symbol, stats } }));
  }

  // Expose minimal API for trading.js
  window.AppWS = {
    send: (payload) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); },
    onMessage: (handler) => {
      if (typeof handler !== 'function') return () => {};
      externalListeners.add(handler);
      return () => externalListeners.delete(handler);
    },
    getCurrentSymbol: () => currentSymbol,
    getPip: (symbol) => pipBySymbol.get(symbol || currentSymbol),
    getCurrency: () => accountCurrency,
    isOpen: () => !!ws && ws.readyState === WebSocket.OPEN,
    getDigitStats: (symbol) => {
      const key = symbol || currentSymbol;
      const stats = key ? digitStats[key] : null;
      if (!stats) return { total: 0, counts: Array.from({ length: 10 }, () => 0) };
      return {
        total: stats.total,
        counts: Array.from({ length: 10 }, (_, i) => stats.counts[i] || 0)
      };
    },
    getDigitQueue: (symbol) => {
      const key = symbol || currentSymbol;
      const stats = key ? digitStats[key] : null;
      if (!stats || !Array.isArray(stats.queue)) return [];
      return stats.queue.slice();
    },
    resetDigitStats: (symbol) => resetDigitStat(symbol || currentSymbol),
    connect,
    disconnect,
    log
  };

  if (storedCreds.autoConnect && storedCreds.appId) {
    setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
      }
    }, 150);
  }
})();

