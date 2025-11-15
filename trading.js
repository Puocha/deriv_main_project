// Continuous trading for Over 1 Normal, Under 8 Normal, and Over 5 / Under 4 Combo
(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  const btnOver1 = document.getElementById('btnActualOver1Normal');
  const btnUnder8 = document.getElementById('btnActualUnder8Normal');
  const btnCombo = document.getElementById('btnActualOver5Under4');
  const stakeInput = document.getElementById('actualTradeStake');
  const tpInput = document.getElementById('actualTargetProfit');
  const slInput = document.getElementById('actualStopLoss');
  const resultsBody = document.getElementById('resultsBody');
  const overallPnLEl = document.getElementById('overallPnL');

  let running = false;
  let currentMode = null; // 'over1' | 'under8' | 'combo'
  let cumulativePnL = 0;
  let activeContractId = null;
  let unsubscribe = null;
  const comboState = {
    pendingProposals: new Map(),
    activeContracts: new Map(),
    currentPair: null
  };

  function log(msg) { if (wsApi && wsApi.log) wsApi.log(msg); }

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

  function withinLimits() {
    const tp = Number(tpInput?.value || 0);
    const sl = Number(slInput?.value || 0);
    if (tp > 0 && cumulativePnL >= tp) return false;
    if (sl > 0 && cumulativePnL <= -Math.abs(sl)) return false;
    return true;
  }

  function buyNext(contractType) {
    if (!running) return;
    if (!wsApi.isOpen()) { log('WS not open, waiting to buy...'); setTimeout(() => buyNext(contractType), 500); return; }
    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) { log('No market selected'); return; }
    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) { log('Invalid stake', 'error'); return; }

    // Proposal: buy digit match contract over/under
    // Over 1 => DIGITOVER with barrier 1; Under 8 => DIGITUNDER with barrier 8
    const req = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency: wsApi.getCurrency() || 'USD',
      duration: 1,
      duration_unit: 't',
      symbol,
      barrier: contractType === 'DIGITOVER' ? 1 : 8
    };
    wsApi.send(req);
  }

  function resetComboState() {
    comboState.pendingProposals.clear();
    comboState.activeContracts.clear();
    comboState.currentPair = null;
  }

  function getComboMetaFromMessage(msg) {
    if (!msg) return null;
    const source = msg.passthrough || msg.echo_req?.passthrough;
    if (!source) return null;
    const pairId = source.combo_pair;
    const side = source.combo_side;
    if (!pairId || (side !== 'over' && side !== 'under')) return null;
    return { pairId, side };
  }

  function startComboCycle() {
    if (!running || currentMode !== 'combo') return;
    if (!wsApi.isOpen()) { log('WS not open, waiting to buy combo...'); setTimeout(() => startComboCycle(), 500); return; }
    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) { log('No market selected'); running = false; setButtonState(null, false); return; }
    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) { log('Invalid stake', 'error'); running = false; setButtonState(null, false); return; }
    const currency = wsApi.getCurrency() || 'USD';
    const pairId = `combo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    comboState.currentPair = {
      id: pairId,
      legs: {
        over: { status: 'pending', contractId: null, profit: 0 },
        under: { status: 'pending', contractId: null, profit: 0 }
      },
      settled: false
    };

    const base = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      currency,
      duration: 1,
      duration_unit: 't',
      symbol
    };

    wsApi.send({
      ...base,
      contract_type: 'DIGITOVER',
      barrier: 5,
      passthrough: { combo_pair: pairId, combo_side: 'over' }
    });

    wsApi.send({
      ...base,
      contract_type: 'DIGITUNDER',
      barrier: 4,
      passthrough: { combo_pair: pairId, combo_side: 'under' }
    });

    log('Submitted proposals for Over 5 / Under 4 combo trade');
  }

  function finalizeComboPair(pair, symbol) {
    if (!pair || pair.settled) return;
    const overProfit = pair.legs.over?.profit || 0;
    const underProfit = pair.legs.under?.profit || 0;
    const net = overProfit + underProfit;
    cumulativePnL += net;
    const decimals = getDecimalsForSymbol(symbol);
    addResultRow('Over5/Under4 Combo', null, null, net, decimals);
    log(`Combo trade settled. Net P/L: ${net.toFixed(2)}. Cumulative: ${cumulativePnL.toFixed(2)}`);
    pair.settled = true;
    comboState.currentPair = null;

    if (running && currentMode === 'combo' && withinLimits()) {
      startComboCycle();
    } else {
      if (running) {
        log('Target reached. Stopping.');
      } else {
        log('Stopped.');
      }
      running = false;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      setButtonState(null, false);
    }
  }

  function handleComboMessage(msg) {
    if (msg.error) return;
    if (msg.msg_type === 'proposal') {
      const meta = getComboMetaFromMessage(msg);
      if (!meta || currentMode !== 'combo') return;
      const p = msg.proposal;
      if (!p) return;
      comboState.pendingProposals.set(p.id, meta);
      log(`Buying combo leg (${meta.side === 'over' ? 'Over 5' : 'Under 4'}) @ ${p.display_value || p.ask_price}`);
      wsApi.send({
        buy: p.id,
        price: Number(p.ask_price),
        passthrough: { combo_pair: meta.pairId, combo_side: meta.side }
      });
      return;
    }

    if (msg.msg_type === 'buy') {
      const b = msg.buy;
      if (!b) return;
      let meta = getComboMetaFromMessage(msg);
      if (!meta) {
        meta = comboState.pendingProposals.get(b.proposal_id || b.id);
      }
      if (!meta) return;
      comboState.pendingProposals.delete(b.proposal_id || b.id);
      comboState.activeContracts.set(b.contract_id, meta);
      if (comboState.currentPair && comboState.currentPair.id === meta.pairId) {
        const leg = comboState.currentPair.legs[meta.side];
        if (leg) {
          leg.status = 'open';
          leg.contractId = b.contract_id;
        }
      }
      wsApi.send({ proposal_open_contract: 1, contract_id: b.contract_id, subscribe: 1 });
      return;
    }

    if (msg.msg_type === 'proposal_open_contract') {
      const c = msg.proposal_open_contract;
      if (!c) return;
      const meta = comboState.activeContracts.get(c.contract_id);
      if (!meta) return;
      if (!(c.status === 'sold' || c.is_sold || c.status === 'expired' || c.is_expired)) return;
      comboState.activeContracts.delete(c.contract_id);
      if (comboState.currentPair && comboState.currentPair.id === meta.pairId) {
        const leg = comboState.currentPair.legs[meta.side];
        if (leg) {
          leg.status = 'done';
          leg.profit = Number(c.profit);
        }
        log(`Combo leg ${meta.side === 'over' ? 'Over 5' : 'Under 4'} closed. P/L: ${Number(c.profit).toFixed(2)}`);
        if (comboState.currentPair.legs.over.status === 'done' && comboState.currentPair.legs.under.status === 'done') {
          const symbol = c.underlying || wsApi.getCurrentSymbol();
          finalizeComboPair(comboState.currentPair, symbol);
        }
      }
      return;
    }
  }

  function handle(msg, handlerMode) {
    if (msg.error) return;
    if (handlerMode === 'combo') {
      handleComboMessage(msg);
      return;
    }

    if (msg.msg_type === 'proposal') {
      const p = msg.proposal;
      if (!p || !running || handlerMode !== currentMode) return;
      // Immediately buy the contract from proposal id
      activeContractId = null;
      log(`Buying ${handlerMode === 'over1' ? 'Over 1' : 'Under 8'} @ ${p.display_value || p.ask_price}`);
      wsApi.send({
        buy: p.id,
        price: Number(p.ask_price)
      });
      return;
    }

    if (msg.msg_type === 'buy') {
      const b = msg.buy;
      if (!b || !running || handlerMode !== currentMode) return;
      activeContractId = b.contract_id;
      log(`Bought contract ${activeContractId}`);
      // Subscribe to contract updates
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
        const decimals = getDecimalsForSymbol(c.underlying || wsApi.getCurrentSymbol());
        addResultRow(typeLabel, entry, exit, pnl, decimals);
        log(`Contract ${activeContractId} closed. P/L: ${pnl.toFixed(2)}. Cumulative: ${cumulativePnL.toFixed(2)}`);
        activeContractId = null;
        if (running && withinLimits()) {
          // Continue trading
          const nextType = currentMode === 'over1' ? 'DIGITOVER' : 'DIGITUNDER';
          buyNext(nextType);
        } else {
          if (running) {
            log('Target reached. Stopping.');
          } else {
            log('Stopped.');
          }
          running = false;
          // stop listening when idle
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
          setButtonState(null, false);
        }
      }
      return;
    }
  }

  function setButtonState(mode, isRunning) {
    const configs = [
      { key: 'over1', btn: btnOver1, label: 'Over 1 Normal', defaultClass: 'bg-leaf' },
      { key: 'under8', btn: btnUnder8, label: 'Under 8 Normal', defaultClass: 'bg-leaf' },
      { key: 'combo', btn: btnCombo, label: 'Over 5 / Under 4', defaultClass: 'bg-teal' }
    ];
    configs.forEach(({ key, btn, label, defaultClass }) => {
      if (!btn) return;
      const active = key === mode && isRunning;
      btn.textContent = active ? 'Stop' : label;
      btn.classList.remove('bg-navy', 'bg-leaf', 'bg-teal');
      btn.classList.add(active ? 'bg-navy' : defaultClass);
    });
  }

  function stop() {
    running = false;
    // Do not place new contracts; allow current to finish and log
    setButtonState(null, false);
  }

  function start(mode) {
    if (running) {
      // toggle off if same button pressed
      if (mode === currentMode) { stop(); return; }
      // if different mode pressed, stop first then start new
      stop();
    }
    cumulativePnL = 0;
    running = true;
    currentMode = mode;
    setButtonState(mode, true);
    const type = mode === 'over1' ? 'DIGITOVER' : mode === 'under8' ? 'DIGITUNDER' : null;
    if (mode === 'combo') {
      resetComboState();
    } else {
      activeContractId = null;
    }
    // Listen to WS messages
    if (unsubscribe) unsubscribe();
    unsubscribe = wsApi.onMessage((m) => handle(m, mode));
    if (type) {
      buyNext(type);
    } else if (mode === 'combo') {
      startComboCycle();
    }
  }

  if (btnOver1) btnOver1.addEventListener('click', () => start('over1'));
  if (btnUnder8) btnUnder8.addEventListener('click', () => start('under8'));
  if (btnCombo) btnCombo.addEventListener('click', () => start('combo'));
})();

