// Pattern-based trading for Over 1 and Under 8
(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  const btnOver1 = document.getElementById('btnActualOver1Pattern');
  const btnUnder8 = document.getElementById('btnActualUnder8Pattern');
  const stakeInput = document.getElementById('actualTradeStake');
  const tpInput = document.getElementById('actualTargetProfit');
  const slInput = document.getElementById('actualStopLoss');
  const resultsBody = document.getElementById('resultsBody');
  const overallPnLEl = document.getElementById('overallPnL');

  let running = false;
  let mode = null; // 'over1' | 'under8'
  let cumulativePnL = 0;
  let activeContractId = null;
  let wsUnsub = null;
  // Once a qualifying pattern is detected, keep trading continuously
  let patternActive = false;
  let currentContractType = null; // 'DIGITOVER' | 'DIGITUNDER'
  let currentBarrier = null; // 1 or 8

  // Pattern state
  let consecBelow2 = 0;   // for over1 pattern
  let consecAbove7 = 0;   // for under8 pattern
  const viewBelow2 = document.getElementById('streakBelow2');
  const viewAbove7 = document.getElementById('streakAbove7');

  function log(msg) { if (wsApi && wsApi.log) wsApi.log(msg); }

  function resetPatternState() {
    consecBelow2 = 0;
    consecAbove7 = 0;
    if (viewBelow2) viewBelow2.textContent = '0';
    if (viewAbove7) viewAbove7.textContent = '0';
  }

  function getDecimalsForSymbol(symbol) {
    try {
      const pip = wsApi.getPip(symbol);
      if (!pip) return 2;
      const parts = String(pip).split('.');
      return parts[1] ? parts[1].length : 0;
    } catch (_) { return 2; }
  }

  function getContractLabel(c) {
    const ct = c.contract_type;
    const barrier = c.barrier != null ? String(c.barrier) : '';
    if (ct === 'DIGITOVER') return `Over ${barrier}`;
    if (ct === 'DIGITUNDER') return `Under ${barrier}`;
    return ct || '-';
  }

  function addResultRow(type, entry, exit, pnl, decimals) {
    if (!resultsBody) return;
    const tr = document.createElement('tr');
    tr.className = 'bg-mint/40';
    const pnlNum = Number(pnl || 0);
    const d = Math.max(0, Number(decimals || 2));
    tr.innerHTML = `
      <td class="px-3 py-2 rounded-l-md">${type}</td>
      <td class="px-3 py-2">${entry != null ? Number(entry).toFixed(d) : '—'}</td>
      <td class="px-3 py-2">${exit != null ? Number(exit).toFixed(d) : '—'}</td>
      <td class="px-3 py-2 rounded-r-md ${pnlNum >= 0 ? 'text-leaf' : 'text-red-600'}">${pnlNum.toFixed(2)}</td>
    `;
    resultsBody.appendChild(tr);
    if (overallPnLEl) {
      overallPnLEl.textContent = cumulativePnL.toFixed(2);
      overallPnLEl.classList.toggle('text-leaf', cumulativePnL >= 0);
      overallPnLEl.classList.toggle('text-red-600', cumulativePnL < 0);
    }
  }

  function setButtonState(m, isRunning) {
    const map = { over1: btnOver1, under8: btnUnder8 };
    [btnOver1, btnUnder8].forEach(btn => {
      if (!btn) return;
      btn.textContent = btn === map[m] && isRunning ? 'Stop' : (btn === btnOver1 ? 'Over 1 Pattern' : 'Under 8 Pattern');
      btn.classList.toggle('bg-navy', btn === map[m] && isRunning);
      btn.classList.toggle('bg-teal', !(btn === map[m] && isRunning));
    });
  }

  function withinLimits() {
    const tp = Number(tpInput?.value || 0);
    const sl = Number(slInput?.value || 0);
    if (tp > 0 && cumulativePnL >= tp) return false;
    if (sl > 0 && cumulativePnL <= -Math.abs(sl)) return false;
    return true;
  }

  function buyDigit(type, barrier) {
    if (!running) return;
    if (!wsApi.isOpen()) { setTimeout(() => buyDigit(type, barrier), 500); return; }
    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) { log('No market selected'); return; }
    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) { log('Invalid stake', 'error'); return; }

    wsApi.send({
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: type,
      currency: wsApi.getCurrency() || 'USD',
      duration: 1,
      duration_unit: 't',
      symbol,
      barrier
    });
  }

  function maybeTriggerTrade(lastDigit) {
    if (!running || !withinLimits()) return;
    // If already in continuous trading phase for a detected pattern, ignore new pattern logic
    if (patternActive) return;
    if (mode === 'over1') {
      // Count consecutive digits < 2
      if (lastDigit < 2) {
        consecBelow2 += 1;
        if (viewBelow2) viewBelow2.textContent = String(consecBelow2);
      } else {
        // Pattern broken by digit >= 2
        if (consecBelow2 > 1) {
          log(`Pattern detected: ${consecBelow2} digits below 2, broken by ${lastDigit}. Buying Over 1.`);
          // Lock into continuous trading for this pattern
          patternActive = true;
          currentContractType = 'DIGITOVER';
          currentBarrier = 1;
          buyDigit(currentContractType, currentBarrier);
        }
        consecBelow2 = 0;
        if (viewBelow2) viewBelow2.textContent = '0';
      }
    } else if (mode === 'under8') {
      // Count consecutive digits > 7
      if (lastDigit > 7) {
        consecAbove7 += 1;
        if (viewAbove7) viewAbove7.textContent = String(consecAbove7);
      } else {
        // Pattern broken by digit <= 7
        if (consecAbove7 > 1) {
          log(`Pattern detected: ${consecAbove7} digits above 7, broken by ${lastDigit}. Buying Under 8.`);
          // Lock into continuous trading for this pattern
          patternActive = true;
          currentContractType = 'DIGITUNDER';
          currentBarrier = 8;
          buyDigit(currentContractType, currentBarrier);
        }
        consecAbove7 = 0;
        if (viewAbove7) viewAbove7.textContent = '0';
      }
    }
  }

  function onMessage(msg) {
    if (msg.error) return;

    if (msg.msg_type === 'tick') {
      const { tick } = msg;
      if (!tick) return;
      const price = Number(tick.quote);
      const pip = wsApi.getPip(tick.symbol) || 0.01;
      const decimals = Math.max(0, String(pip).split('.')[1]?.length || 2);
      const priceText = price.toFixed(decimals);
      const frac = priceText.split('.')[1] || '';
      const lastDigit = decimals > 0 ? Number(frac.slice(-1) || '0') : Number(String(Math.floor(price)).slice(-1));
      maybeTriggerTrade(lastDigit);
      return;
    }

    if (msg.msg_type === 'proposal') {
      const p = msg.proposal;
      if (!p || !running) return;
      wsApi.send({ buy: p.id, price: Number(p.ask_price) });
      return;
    }

    if (msg.msg_type === 'buy') {
      const b = msg.buy;
      if (!b || !running) return;
      activeContractId = b.contract_id;
      wsApi.send({ proposal_open_contract: 1, contract_id: activeContractId, subscribe: 1 });
      return;
    }

    if (msg.msg_type === 'proposal_open_contract') {
      const c = msg.proposal_open_contract;
      if (!c || c.contract_id !== activeContractId) return;
      if (c.status === 'sold' || c.is_sold) {
        const pnl = Number(c.profit);
        cumulativePnL += pnl;
        const typeLabel = getContractLabel(c);
        const entry = (c.entry_tick != null) ? c.entry_tick : c.buy_price;
        const exit = (c.exit_tick != null) ? c.exit_tick : c.sell_price;
        const decimals = getDecimalsForSymbol(c.underlying);
        addResultRow(typeLabel, entry, exit, pnl, decimals);
        log(`Pattern trade closed. P/L: ${pnl.toFixed(2)}. Cumulative: ${cumulativePnL.toFixed(2)}`);
        activeContractId = null;
        // If we are in continuous trading phase for this detected pattern, keep buying until limits
        if (running && patternActive && withinLimits()) {
          buyDigit(currentContractType, currentBarrier);
        } else {
          if (!withinLimits()) {
            log('Target reached. Stopping.');
          }
          // Exit the continuous trading phase and resume waiting for next pattern (if still running)
          patternActive = false;
          currentContractType = null;
          currentBarrier = null;
          if (!withinLimits()) stop();
        }
      }
      return;
    }
  }

  function start(m) {
    if (running) {
      if (m === mode) { stop(); return; }
      stop();
    }
    running = true;
    mode = m;
    cumulativePnL = 0;
    patternActive = false;
    currentContractType = null;
    currentBarrier = null;
    resetPatternState();
    setButtonState(mode, true);
    log(`Started pattern monitoring for ${mode === 'over1' ? 'Over 1' : 'Under 8'}`);
    if (wsUnsub) wsUnsub();
    wsUnsub = wsApi.onMessage(onMessage);
  }

  function stop() {
    running = false;
    setButtonState(null, false);
    if (wsUnsub) { wsUnsub(); wsUnsub = null; }
    resetPatternState();
    patternActive = false;
    currentContractType = null;
    currentBarrier = null;
  }

  if (btnOver1) btnOver1.addEventListener('click', () => start('over1'));
  if (btnUnder8) btnUnder8.addEventListener('click', () => start('under8'));
})();

