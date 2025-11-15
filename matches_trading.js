(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  const btn = document.getElementById('btnMatchesV1');
  const stakeInput = document.getElementById('actualTradeStake');
  const resultsBody = document.getElementById('resultsBody');
  const overallPnLEl = document.getElementById('overallPnL');
  const tpInput = document.getElementById('actualTargetProfit');
  const slInput = document.getElementById('actualStopLoss');

  let running = false;
  let wsUnsub = null;
  let cumulativePnL = 0;
  let activeContracts = new Map(); // contract_id -> metadata
  const pendingMetaByProposalId = new Map();
  const batchState = {
    current: null,
    queuedBatches: [],
    activeByBatch: new Map()
  };
  let lastEntryDigit = null; // to avoid repeat triggers on same digit tick
  let lastTop8Key = ''; // cached string of top8 to detect changes

  const rankTracker = (() => {
    if (window.MatchesRankTracker) return window.MatchesRankTracker;
    const stats = Array.from({ length: 10 }, () => ({
      wins: 0,
      losses: 0,
      total: 0,
      currentDigit: null,
      lastDigit: null
    }));
    const tracker = {
      syncDigits(digits) {
        if (!Array.isArray(digits)) return;
        let updated = false;
        digits.forEach((digit, idx) => {
          if (stats[idx] && stats[idx].currentDigit !== digit) {
            stats[idx].currentDigit = digit;
            updated = true;
          }
        });
        if (updated) {
          document.dispatchEvent(new CustomEvent('matches:rank-stats-changed', { detail: { stats: tracker.getStats() } }));
        }
      },
      recordResult(rank, digit, pnl) {
        const bucket = stats[rank];
        if (!bucket) return;
        bucket.total += 1;
        if (pnl > 0) bucket.wins += 1;
        else bucket.losses += 1;
        bucket.lastDigit = digit;
        document.dispatchEvent(new CustomEvent('matches:rank-stats-changed', { detail: { stats: tracker.getStats() } }));
      },
      getStats() {
        return stats.map((entry, idx) => ({
          rank: idx,
          wins: entry.wins,
          losses: entry.losses,
          total: entry.total,
          currentDigit: entry.currentDigit,
          lastDigit: entry.lastDigit
        }));
      }
    };
    window.MatchesRankTracker = tracker;
    return tracker;
  })();

  function log(msg) { if (wsApi && wsApi.log) wsApi.log('[Matches v1] ' + msg); }

  function setButtonState(isRunning) {
    if (!btn) return;
    btn.textContent = isRunning ? 'Stop Matches v1' : 'Matches v1';
    btn.classList.toggle('bg-navy', isRunning);
    btn.classList.toggle('bg-teal', !isRunning);
  }

  function addResultRow(type, entry, exit, pnl) {
    if (!resultsBody) return;
    const tr = document.createElement('tr');
    tr.className = 'bg-mint/40';
    const pnlNum = Number(pnl || 0);
    tr.innerHTML = `
      <td class="px-3 py-2 rounded-l-md">${type}</td>
      <td class="px-3 py-2">${entry != null ? entry : '—'}</td>
      <td class="px-3 py-2">${exit != null ? exit : '—'}</td>
      <td class="px-3 py-2 rounded-r-md ${pnlNum >= 0 ? 'text-leaf' : 'text-red-600'}">${pnlNum.toFixed(2)}</td>
    `;
    resultsBody.appendChild(tr);
    if (overallPnLEl) {
      overallPnLEl.textContent = cumulativePnL.toFixed(2);
      overallPnLEl.classList.toggle('text-leaf', cumulativePnL >= 0);
      overallPnLEl.classList.toggle('text-red-600', cumulativePnL < 0);
    }
  }

  function withinLimits() {
    const tp = Number(tpInput?.value || 0);
    const sl = Number(slInput?.value || 0);
    if (tp > 0 && cumulativePnL >= tp) return false;
    if (sl > 0 && cumulativePnL <= -Math.abs(sl)) return false;
    return true;
  }

  function getRankedDigits() {
    const queue = wsApi.getDigitQueue(wsApi.getCurrentSymbol()) || [];
    const counts = Array.from({ length: 10 }, () => 0);
    for (let i = 0; i < queue.length; i++) {
      const d = queue[i];
      if (d >= 0 && d <= 9) counts[d] += 1;
    }
    const ranked = counts.map((c, digit) => ({ digit, count: c })).sort((a, b) => b.count - a.count || a.digit - b.digit);
    const orderedDigits = ranked.map((entry) => entry.digit);
    const top8 = orderedDigits.slice(0, 8);
    const top8Key = top8.join(',');
    return { orderedDigits, ranked, top8, top8Key, topDigit: orderedDigits[0], counts };
  }

  function resetBatchState() {
    batchState.current = null;
    batchState.queuedBatches = [];
    batchState.activeByBatch.clear();
  }

  function finalizeBatch(batchId) {
    const data = batchState.activeByBatch.get(batchId);
    if (!data || data.settled) return;
    const net = data.legs.reduce((sum, leg) => sum + Number(leg.profit || 0), 0);
    cumulativePnL += net;
    addResultRow('Matches Batch', null, null, net);
    log(`Matches batch ${batchId} settled. Net P/L: ${net.toFixed(2)}. Cumulative: ${cumulativePnL.toFixed(2)}`);
    data.settled = true;
    batchState.activeByBatch.delete(batchId);
    if (batchState.current && batchState.current.id === batchId) {
      batchState.current = null;
      const next = batchState.queuedBatches.shift();
      if (next) {
        batchState.current = next;
        sendBatch(next);
      }
    }
    const stillWithin = withinLimits();
    if (running && stillWithin) {
      const next = batchState.queuedBatches.shift();
      if (next) {
        batchState.current = next;
        sendBatch(next);
      }
    }
    if (!stillWithin && running) {
      log('Take profit / stop loss threshold hit. Stopping Matches v1.');
      stop();
      return;
    }
    if (!running && batchState.activeByBatch.size === 0 && wsUnsub) {
      wsUnsub();
      wsUnsub = null;
      log('All outstanding Match contracts settled.');
    }
  }

  function createBatch(digits, orderedDigits) {
    const rankByDigit = new Map();
    orderedDigits.forEach((digit, idx) => rankByDigit.set(digit, idx));
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const legs = digits.map((digit) => ({
      digit,
      rank: rankByDigit.get(digit),
      status: 'pending',
      contractId: null,
      profit: 0
    }));
    const payload = { id: batchId, digits, orderedDigits: orderedDigits.slice(), legs };
    batchState.activeByBatch.set(batchId, payload);
    return payload;
  }

  function sendBatch(batch) {
    if (!batch) return;
    if (!wsApi.isOpen()) { setTimeout(() => sendBatch(batch), 300); return; }
    const symbol = wsApi.getCurrentSymbol();
    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) { log('Invalid stake'); running = false; setButtonState(false); return; }
    if (!withinLimits()) { log('Take profit / stop loss reached. Stopping.'); stop(); return; }
    const currency = wsApi.getCurrency() || 'USD';
    log(`Triggering batch ${batch.id}. Digits: [${batch.digits.join(', ')}]`);
    for (const leg of batch.legs) {
      const meta = {
        batchId: batch.id,
        digit: leg.digit,
        rank: leg.rank,
        orderedDigits: batch.orderedDigits.slice()
      };
      wsApi.send({
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: 'DIGITMATCH',
        currency,
        duration: 1,
        duration_unit: 't',
        symbol,
        barrier: Number(leg.digit),
        passthrough: { matches_meta: meta }
      });
    }
  }

  function triggerIfEntryMatches(lastDigit) {
    const { orderedDigits, top8, top8Key, topDigit } = getRankedDigits();
    if (!Array.isArray(top8) || top8.length < 8) return;
    // Debounce same composition and same lastDigit trigger
    if (lastDigit === lastEntryDigit && top8Key === lastTop8Key) return;
    if (lastDigit !== topDigit) return;
    lastEntryDigit = lastDigit;
    lastTop8Key = top8Key;
    rankTracker.syncDigits(orderedDigits);
    if (!withinLimits()) {
      log('Take profit / stop loss reached. Ignoring new entry.');
      stop();
      return;
    }
    buyMatches(top8, topDigit, orderedDigits);
  }

  function buyMatches(digits, entryDigit, orderedDigits) {
    if (!running) return;
    rankTracker.syncDigits(orderedDigits);
    const batch = createBatch(digits, orderedDigits);
    if (batchState.current) {
      batchState.queuedBatches.push(batch);
      log(`Queued batch ${batch.id}; awaiting completion of current batch ${batchState.current.id}.`);
    } else {
      batchState.current = batch;
      sendBatch(batch);
    }
  }

  function onMessage(msg) {
    const hasActive = activeContracts.size > 0;
    if ((!running && !hasActive) || !msg || msg.error) return;
    if (msg.msg_type === 'tick') {
      const { tick } = msg;
      if (!tick) return;
      // get normalized last digit like in ws.js
      const pip = wsApi.getPip(tick.symbol) || 0.01;
      const decimals = Math.max(0, String(pip).split('.')[1]?.length || 2);
      const price = Number(tick.quote);
      const priceText = price.toFixed(decimals);
      const frac = priceText.split('.')[1] || '';
      const lastDigit = decimals > 0 ? Number(frac.slice(-1) || '0') : Number(String(Math.floor(price)).slice(-1));
      triggerIfEntryMatches(lastDigit);
      return;
    }

    if (msg.msg_type === 'proposal') {
      const p = msg.proposal;
      if (!p) return;
      const meta = msg.passthrough?.matches_meta || msg.echo_req?.passthrough?.matches_meta;
      if (!meta) return;
      const rank = Number(meta.rank);
      const digit = Number(meta.digit);
      if (!Number.isFinite(rank) || !Number.isFinite(digit)) return;
      const normalizedMeta = {
        ...meta,
        rank,
        digit
      };
      pendingMetaByProposalId.set(p.id, normalizedMeta);
      wsApi.send({ buy: p.id, price: Number(p.ask_price), passthrough: { matches_meta: normalizedMeta } });
      return;
    }

    if (msg.msg_type === 'buy') {
      const b = msg.buy;
      if (!b) return;
      const contractId = b.contract_id;
      const metaFromMsg = msg.passthrough?.matches_meta || msg.echo_req?.passthrough?.matches_meta;
      const fallbackMeta = pendingMetaByProposalId.get(b.proposal_id || b.id);
      const meta = metaFromMsg || fallbackMeta;
      if (fallbackMeta && (!metaFromMsg || metaFromMsg === fallbackMeta)) {
        pendingMetaByProposalId.delete(b.proposal_id || b.id);
      }
      if (!meta) return;
      const batch = batchState.activeByBatch.get(meta.batchId);
      if (!batch) return;
      const leg = batch.legs.find((l) => l.digit === meta.digit && l.contractId == null);
      if (!leg) return;
      leg.status = 'open';
      leg.contractId = contractId;
      activeContracts.set(contractId, { ...meta });
      wsApi.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
      return;
    }

    if (msg.msg_type === 'proposal_open_contract') {
      const c = msg.proposal_open_contract;
      const meta = c ? activeContracts.get(c.contract_id) : null;
      if (!c || !meta) return;
      if (c.status === 'sold' || c.is_sold || c.status === 'expired' || c.is_expired) {
        const pnl = Number(c.profit);
        const batch = batchState.activeByBatch.get(meta.batchId);
        if (batch) {
          const leg = batch.legs.find((l) => l.contractId === c.contract_id);
          if (leg) {
            leg.status = 'done';
            leg.profit = pnl;
          }
        }
        rankTracker.recordResult(meta.rank, meta.digit, pnl);
        activeContracts.delete(c.contract_id);
        const allSettled = batch && batch.legs.every((leg) => leg.status === 'done');
        if (allSettled) {
          finalizeBatch(meta.batchId);
        }
      }
      return;
    }
  }

  function start() {
    if (running) { stop(); return; }
    running = true;
    cumulativePnL = 0;
    lastEntryDigit = null;
    lastTop8Key = '';
    setButtonState(true);
    resetBatchState();
    if (wsUnsub) wsUnsub();
    wsUnsub = wsApi.onMessage(onMessage);
    const { orderedDigits, top8, topDigit } = getRankedDigits();
    rankTracker.syncDigits(orderedDigits);
    if (Array.isArray(top8) && top8.length) {
      log(`Started Matches v1. Initial digits: [${top8.join(', ')}], entry digit: ${topDigit}`);
    } else {
      log('Started Matches v1. Waiting for sufficient digit data.');
    }
  }

  function stop() {
    const wasRunning = running;
    running = false;
    setButtonState(false);
    if (wasRunning) {
      log('Stopped Matches v1 (awaiting open contracts to settle if any)');
    }
    if (activeContracts.size === 0 && wsUnsub) {
      wsUnsub();
      wsUnsub = null;
      if (wasRunning) log('All outstanding Match contracts settled.');
    }
  }

  if (btn) btn.addEventListener('click', start);
})();


