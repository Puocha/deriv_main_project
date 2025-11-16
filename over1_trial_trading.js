// Over 1 Trial Trading - Multi-market analysis and trading
(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  const btnOver1Trial = document.getElementById('btnOver1Trial');
  const stakeInput = document.getElementById('actualTradeStake');
  const tpInput = document.getElementById('actualTargetProfit');
  const slInput = document.getElementById('actualStopLoss');
  const resultsBody = document.getElementById('resultsBody');
  const overallPnLEl = document.getElementById('overallPnL');

  let running = false;
  let cumulativePnL = 0;
  let activeContracts = new Map(); // symbol -> contractId
  let pendingProposals = new Set(); // symbols with pending proposals
  let lockedMarkets = new Set(); // symbols that are in profit and locked
  let marketPnL = new Map(); // symbol -> cumulative P/L for that market
  let unsubscribe = null;
  let marketMonitorInterval = null;
  let monitoredMarkets = new Set();
  const CHECK_COOLDOWN = 2000; // Minimum 2 seconds between checks for same symbol
  const symbolLastCheck = new Map(); // symbol -> timestamp

  function log(msg) { 
    if (wsApi && wsApi.log) {
      wsApi.log(`[Over 1 Trial] ${msg}`);
    }
  }

  function addResultRow(type, entry, exit, pnl, decimals, symbol) {
    if (!resultsBody) return;
    const tr = document.createElement('tr');
    tr.className = 'bg-mint/40';
    const pnlNum = Number(pnl || 0);
    const d = Math.max(0, Number(decimals || 2));
    tr.innerHTML = `
      <td class="px-3 py-2 rounded-l-md">${type}${symbol ? ` (${symbol})` : ''}</td>
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
    // For Over 1 Trial: TP is per-market, not overall
    // No overall TP/SL limits for now (testing phase)
    // Each market is locked individually when it hits TP
    return true;
  }

  // Get all available markets from the market select dropdown
  function getAllMarkets() {
    const marketSelect = document.getElementById('market');
    if (!marketSelect) return [];
    const markets = [];
    for (let i = 0; i < marketSelect.options.length; i++) {
      markets.push(marketSelect.options[i].value);
    }
    return markets;
  }

  // Calculate digit frequencies and ranks for last 1000 ticks
  function calculateDigitRanks(queue) {
    if (!Array.isArray(queue) || queue.length < 10) {
      return null;
    }

    const last1000 = queue.slice(-1000);
    const digitCounts = Array.from({ length: 10 }, () => 0);
    
    last1000.forEach(d => {
      if (d >= 0 && d <= 9) {
        digitCounts[d]++;
      }
    });

    // Calculate ranks (1 = highest frequency, 10 = lowest)
    const sortedDigits = digitCounts.map((count, digit) => ({
      digit,
      count
    })).sort((a, b) => b.count - a.count);

    const ranks = Array.from({ length: 10 }, () => 0);
    sortedDigits.forEach((item, index) => {
      ranks[item.digit] = index + 1;
    });

    return { digitCounts, ranks, total: last1000.length };
  }

  // Check if conditions are met for a market
  function checkConditions(symbol) {
    const queue = wsApi.getDigitQueue(symbol);
    if (!queue || queue.length < 100) {
      return { met: false, reason: 'Insufficient data', percent01: null, percent29: null, rank0: null, rank1: null };
    }

    // Calculate cumulative percentages
    const last1000 = queue.slice(-1000);
    let count01 = 0; // digits 0 and 1
    let count29 = 0; // digits 2 through 9

    last1000.forEach(d => {
      if (d === 0 || d === 1) {
        count01++;
      } else if (d >= 2 && d <= 9) {
        count29++;
      }
    });

    const percent01 = (count01 / last1000.length) * 100;
    const percent29 = (count29 / last1000.length) * 100;

    // Calculate ranks (needed for all cases, including failures)
    const rankData = calculateDigitRanks(queue);
    const rank0 = rankData ? rankData.ranks[0] : null;
    const rank1 = rankData ? rankData.ranks[1] : null;

    // Condition 1: Cumulative of 0+1 should be below 20%
    if (percent01 >= 20) {
      return { 
        met: false, 
        reason: `0+1 cumulative is ${percent01.toFixed(2)}% (need < 20%)`,
        percent01,
        percent29,
        rank0,
        rank1
      };
    }

    // Condition 2: Cumulative of 2-9 should be over 80%
    if (percent29 <= 80) {
      return { 
        met: false, 
        reason: `2-9 cumulative is ${percent29.toFixed(2)}% (need > 80%)`,
        percent01,
        percent29,
        rank0,
        rank1
      };
    }

    // Condition 3: Entry digit (0 or 1) should rank 6 to 9 in frequency
    if (!rankData) {
      return { 
        met: false, 
        reason: 'Cannot calculate ranks',
        percent01,
        percent29,
        rank0: null,
        rank1: null
      };
    }

    // Check if either 0 or 1 ranks between 6 and 9
    let entryDigit = null;
    if (rank0 >= 6 && rank0 <= 9) {
      entryDigit = 0;
    } else if (rank1 >= 6 && rank1 <= 9) {
      entryDigit = 1;
    } else {
      return { 
        met: false, 
        reason: `Digit 0 rank: ${rank0}, Digit 1 rank: ${rank1} (need 6-9)`,
        percent01,
        percent29,
        rank0,
        rank1
      };
    }

    return { 
      met: true, 
      entryDigit,
      percent01,
      percent29,
      rank0,
      rank1
    };
  }

  // Buy Over 1 contract for a specific market
  function buyOver1(symbol, entryDigit) {
    if (!running || !withinLimits()) return;
    if (!wsApi.isOpen()) { 
      log(`WS not open, waiting to buy Over 1 for ${symbol}...`); 
      setTimeout(() => buyOver1(symbol, entryDigit), 500); 
      return; 
    }

    // Check if this symbol is locked
    if (lockedMarkets.has(symbol)) {
      log(`Market ${symbol} is locked, skipping`);
      return;
    }

    // Check if we already have an active contract for this symbol
    if (activeContracts.has(symbol)) {
      log(`Already have active contract for ${symbol}, skipping`);
      return;
    }

    // Check if we already have a pending proposal for this symbol
    if (pendingProposals.has(symbol)) {
      log(`Already have pending proposal for ${symbol}, skipping`);
      return;
    }

    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) { 
      log(`Invalid stake for ${symbol}`, 'error'); 
      return; 
    }

    // Mark as pending before sending
    pendingProposals.add(symbol);

    const req = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: 'DIGITOVER',
      currency: wsApi.getCurrency() || 'USD',
      duration: 1,
      duration_unit: 't',
      symbol,
      barrier: 1
    };

    log(`Sending proposal for Over 1 on ${symbol} (entry digit: ${entryDigit}, stake: ${stake})`);
    wsApi.send(req);
  }

  // Monitor all markets and check conditions
  function monitorMarkets() {
    if (!running) return;

    // If we already have an active contract, don't check for new trades
    if (activeContracts.size > 0 || pendingProposals.size > 0) {
      return;
    }

    const markets = getAllMarkets();
    if (markets.length === 0) {
      log('No markets available to monitor');
      return;
    }

    const now = Date.now();
    const qualifyingMarkets = [];
    const nonQualifyingMarkets = [];

    markets.forEach(symbol => {
      // Skip locked markets (hit TP)
      if (lockedMarkets.has(symbol)) {
        return;
      }

      // Skip if we already have an active contract for this symbol
      if (activeContracts.has(symbol)) {
        return;
      }

      // Skip if we have a pending proposal for this symbol
      if (pendingProposals.has(symbol)) {
        return;
      }

      // Skip if we checked this symbol recently (cooldown)
      const lastCheck = symbolLastCheck.get(symbol) || 0;
      if (now - lastCheck < CHECK_COOLDOWN) {
        return;
      }

      const queue = wsApi.getDigitQueue(symbol);
      // Only check markets that have sufficient data
      if (!queue || queue.length < 100) {
        return;
      }

      const conditions = checkConditions(symbol);
      
      if (conditions.met) {
        qualifyingMarkets.push({
          symbol,
          ...conditions,
          qualityScore: conditions.percent29 - conditions.percent01 // Higher 2-9% and lower 0+1% = better
        });
        symbolLastCheck.set(symbol, now);
      } else {
        // Track markets that don't meet criteria
        nonQualifyingMarkets.push({
          symbol,
          reason: conditions.reason || 'Unknown',
          percent01: conditions.percent01,
          percent29: conditions.percent29,
          rank0: conditions.rank0,
          rank1: conditions.rank1
        });
      }
    });

    // Log analysis results
    const totalChecked = qualifyingMarkets.length + nonQualifyingMarkets.length;
    log(`Market analysis complete: ${qualifyingMarkets.length} meet criteria, ${nonQualifyingMarkets.length} do not meet criteria (out of ${totalChecked} checked)`);
    
    // Log markets that meet criteria
    if (qualifyingMarkets.length > 0) {
      log(`Markets that MEET criteria (${qualifyingMarkets.length}):`);
      qualifyingMarkets.forEach(m => {
        log(`  ✓ ${m.symbol}: 0+1=${m.percent01.toFixed(2)}%, 2-9=${m.percent29.toFixed(2)}%, entry=${m.entryDigit}, rank0=${m.rank0}, rank1=${m.rank1}, score=${m.qualityScore.toFixed(2)}`);
      });
    } else {
      log(`No markets currently meet the criteria.`);
    }
    
    // Log markets that don't meet criteria
    if (nonQualifyingMarkets.length > 0) {
      log(`Markets that DO NOT meet criteria (${nonQualifyingMarkets.length}):`);
      nonQualifyingMarkets.forEach(m => {
        log(`  ✗ ${m.symbol}: ${m.reason} (0+1=${m.percent01?.toFixed(2) || 'N/A'}%, 2-9=${m.percent29?.toFixed(2) || 'N/A'}%, rank0=${m.rank0 || 'N/A'}, rank1=${m.rank1 || 'N/A'})`);
      });
    }

    // If we have qualifying markets, sort by quality and trade the best one
    if (qualifyingMarkets.length > 0) {
      // Sort by quality score (descending) - higher 2-9% and lower 0+1% is better
      qualifyingMarkets.sort((a, b) => b.qualityScore - a.qualityScore);
      
      const bestMarket = qualifyingMarkets[0];
      log(`Trading best market: ${bestMarket.symbol} (0+1=${bestMarket.percent01.toFixed(2)}%, 2-9=${bestMarket.percent29.toFixed(2)}%, entry digit=${bestMarket.entryDigit}, rank 0=${bestMarket.rank0}, rank 1=${bestMarket.rank1})`);
      
      if (qualifyingMarkets.length > 1) {
        log(`Other qualifying markets: ${qualifyingMarkets.slice(1).map(m => `${m.symbol} (score: ${m.qualityScore.toFixed(2)})`).join(', ')}`);
      }
      
      buyOver1(bestMarket.symbol, bestMarket.entryDigit);
    }
  }

  // Handle WebSocket messages
  function handleMessage(msg) {
    if (msg.error) {
      if (msg.error.code === 'InvalidSymbol') {
        const symbol = msg.echo_req?.symbol || wsApi.getCurrentSymbol();
        log(`Invalid symbol error for ${symbol}: ${msg.error.message}`);
        // Remove from pending if it was a proposal error
        if (symbol) {
          pendingProposals.delete(symbol);
        }
      } else {
        // For other errors, try to extract symbol from echo_req
        const symbol = msg.echo_req?.symbol || wsApi.getCurrentSymbol();
        if (symbol && msg.echo_req?.proposal === 1) {
          pendingProposals.delete(symbol);
          log(`Proposal error for ${symbol}: ${msg.error.message || 'Unknown error'}`);
        }
      }
      return;
    }

    // Handle proposal response
    if (msg.msg_type === 'proposal') {
      const proposal = msg.proposal;
      if (!proposal || !running) return;
      
      // Get symbol from echo_req (what we sent) since proposal response doesn't have contract details
      const symbol = msg.echo_req?.symbol || proposal.underlying || wsApi.getCurrentSymbol();
      
      // Check if this is for one of our pending proposals
      if (!pendingProposals.has(symbol)) {
        // Not our proposal, ignore it
        return;
      }
      
      // Remove from pending proposals
      pendingProposals.delete(symbol);
      
      // Immediately buy the contract from proposal id (matching trading.js pattern)
      const proposalId = proposal.id;
      if (proposalId) {
        log(`Buying Over 1 for ${symbol} @ ${proposal.display_value || proposal.ask_price}`);
        wsApi.send({
          buy: proposalId,
          price: Number(proposal.ask_price)
        });
      }
      return;
    }

    // Handle contract purchase response - use actual Deriv response
    if (msg.msg_type === 'buy') {
      const buy = msg.buy;
      if (buy && buy.contract_id) {
        // Use actual symbol from Deriv response (most reliable)
        const actualSymbol = buy.underlying || msg.echo_req?.symbol || wsApi.getCurrentSymbol();
        const contractId = buy.contract_id;
        
        // If we have a pending proposal for a different symbol, remove it
        // (Deriv might have traded a different symbol than we requested)
        const requestedSymbol = msg.echo_req?.symbol;
        if (requestedSymbol && requestedSymbol !== actualSymbol) {
          log(`Symbol mismatch: requested ${requestedSymbol}, but Deriv traded ${actualSymbol}`);
          pendingProposals.delete(requestedSymbol);
        }
        pendingProposals.delete(actualSymbol);
        
        // Store contract with actual symbol from Deriv
        activeContracts.set(actualSymbol, contractId);
        log(`Contract purchased for ${actualSymbol} (from Deriv), contract ID: ${contractId}`);
        
        // Subscribe to contract updates
        wsApi.send({ 
          proposal_open_contract: 1, 
          contract_id: contractId, 
          subscribe: 1 
        });
      }
      return;
    }

    // Handle contract updates - use actual Deriv response data
    if (msg.msg_type === 'proposal_open_contract') {
      const c = msg.proposal_open_contract;
      if (!c || !c.contract_id) return;

      // Use actual symbol from Deriv contract response (most reliable source)
      const contractSymbol = c.underlying || (() => {
        // Fallback: find from our tracking
        for (const [sym, contractId] of activeContracts.entries()) {
          if (contractId === c.contract_id) {
            return sym;
          }
        }
        return null;
      })();

      // Use actual symbol from Deriv contract response (most reliable)
      // Always prefer c.underlying from Deriv response
      const actualSymbol = c.underlying || contractSymbol || msg.echo_req?.symbol || wsApi.getCurrentSymbol();
      
      if (!actualSymbol) {
        log(`Warning: Cannot identify symbol for contract ${c.contract_id}, skipping`);
        return;
      }

      // Update our tracking with actual symbol from Deriv if it differs
      if (c.underlying && contractSymbol && c.underlying !== contractSymbol) {
        // Symbol from Deriv differs from our tracking - use Deriv's version
        activeContracts.delete(contractSymbol);
        activeContracts.set(c.underlying, c.contract_id);
        log(`Symbol corrected: ${contractSymbol} -> ${c.underlying} (from Deriv)`);
      }

      if (c.status === 'sold' || c.is_sold) {
        const pnl = Number(c.profit);
        cumulativePnL += pnl;
        const typeLabel = getContractLabel(c);
        const entry = (c.entry_tick != null) ? c.entry_tick : c.buy_price;
        const exit = (c.exit_tick != null) ? c.exit_tick : c.sell_price;
        const decimals = getDecimalsForSymbol(actualSymbol);
        addResultRow(typeLabel, entry, exit, pnl, decimals, actualSymbol);
        
        // Update per-market P/L
        const currentMarketPnL = marketPnL.get(actualSymbol) || 0;
        const newMarketPnL = currentMarketPnL + pnl;
        marketPnL.set(actualSymbol, newMarketPnL);
        
        log(`Contract ${c.contract_id} closed for ${actualSymbol} (from Deriv). Trade P/L: ${pnl.toFixed(2)}, Market P/L: ${newMarketPnL.toFixed(2)}, Overall Cumulative: ${cumulativePnL.toFixed(2)}`);
        
        // Remove from active contracts by contract_id (most reliable)
        // Also remove by symbol in case there's a mismatch
        let removed = false;
        for (const [sym, contractId] of activeContracts.entries()) {
          if (contractId === c.contract_id) {
            activeContracts.delete(sym);
            removed = true;
            if (sym !== actualSymbol) {
              log(`Removed contract from tracking: ${sym} (was stored as ${sym}, but actual symbol is ${actualSymbol})`);
            }
            break;
          }
        }
        // Also try deleting by actualSymbol as backup
        if (!removed) {
          activeContracts.delete(actualSymbol);
          log(`Removed contract by symbol: ${actualSymbol}`);
        }

        // Lock market only when it's in profit (positive cumulative P/L for that market)
        if (newMarketPnL > 0) {
          // Market is now in profit - lock it
          if (!lockedMarkets.has(actualSymbol)) {
            lockedMarkets.add(actualSymbol);
            log(`Market ${actualSymbol} locked (now in profit: +${newMarketPnL.toFixed(2)}). Will skip in future checks.`);
          }
        } else {
          // Market is still in loss or break-even - keep trading it
          if (lockedMarkets.has(actualSymbol)) {
            // Shouldn't happen, but remove from locked if somehow it was locked while negative
            lockedMarkets.delete(actualSymbol);
            log(`Market ${actualSymbol} removed from locked (P/L: ${newMarketPnL.toFixed(2)}). Will continue trading.`);
          }
          log(`Market ${actualSymbol} still in loss/break-even (P/L: ${newMarketPnL.toFixed(2)}). Will continue trading until profitable.`);
        }

        // Continue monitoring other markets (TP is per-market, not overall)
        if (running) {
          const totalMarkets = getAllMarkets().length;
          const availableMarkets = totalMarkets - lockedMarkets.size;
          log(`Continuing to monitor other markets. Locked: ${lockedMarkets.size}/${totalMarkets}, Available: ${availableMarkets}, Active: ${activeContracts.size}`);
          
          // If all markets are locked, stop
          if (availableMarkets === 0) {
            log(`All markets are locked. Stopping.`);
            running = false;
            stop();
            return;
          }
          
          // Immediately re-analyze and trade the next best market
          // Clear any stale tracking to ensure we can trade immediately
          log(`Re-analyzing all markets to find next best trade opportunity...`);
          
          // Use a small delay to ensure contract cleanup is complete
          setTimeout(() => {
            if (!running) return;
            
            // Double-check that we're clear to trade
            if (activeContracts.size > 0) {
              // Log what contracts are still active for debugging
              const activeList = Array.from(activeContracts.entries()).map(([sym, id]) => `${sym}:${id}`).join(', ');
              log(`Still have ${activeContracts.size} active contract(s): ${activeList}. Waiting...`);
              
              // Force cleanup: remove any contracts that might be stale
              // (This shouldn't be necessary, but helps with edge cases)
              const contractIdsToCheck = Array.from(activeContracts.values());
              log(`Checking if any of these contracts are actually closed: ${contractIdsToCheck.join(', ')}`);
              
              // Try again after a bit more time
              setTimeout(() => {
                if (!running) return;
                
                // Final check - if still have active contracts, log and proceed anyway
                // (might be a tracking issue, but we should still try to trade)
                if (activeContracts.size > 0) {
                  log(`Warning: Still showing ${activeContracts.size} active contract(s) after cleanup. Proceeding with trade check anyway.`);
                }
                
                if (pendingProposals.size === 0) {
                  monitorMarkets();
                }
              }, 500);
              return;
            }
            
            // Re-analyze and trade immediately
            if (pendingProposals.size === 0) {
              monitorMarkets();
            }
          }, 300);
        }
      }
      return;
    }
  }

  function start() {
    if (running) {
      stop();
      return;
    }

    const stake = Number(stakeInput?.value || 0);
    if (!(stake > 0)) {
      log('Please enter a valid stake amount', 'error');
      return;
    }

    if (!wsApi.isOpen()) {
      log('WebSocket not connected. Please connect first.', 'error');
      return;
    }

    running = true;
    log('Over 1 Trial trading started - monitoring all markets');

    // Subscribe to WebSocket messages
    unsubscribe = wsApi.onMessage(handleMessage);

    // Start monitoring markets every 10 seconds (reduced frequency to prevent duplicates)
    marketMonitorInterval = setInterval(() => {
      monitorMarkets();
    }, 10000);

    // Initial check
    monitorMarkets();

    // Also monitor on tick updates, but with throttling
    let tickCheckThrottle = null;
    document.addEventListener('ws:tick', () => {
      if (running && !tickCheckThrottle) {
        tickCheckThrottle = setTimeout(() => {
          monitorMarkets();
          tickCheckThrottle = null;
        }, 3000); // Throttle tick-based checks to every 3 seconds
      }
    });

    if (btnOver1Trial) {
      btnOver1Trial.textContent = 'Stop Over 1 Trial';
      btnOver1Trial.classList.remove('bg-navy');
      btnOver1Trial.classList.add('bg-red-600');
    }
  }

  function stop() {
    running = false;
    
    if (marketMonitorInterval) {
      clearInterval(marketMonitorInterval);
      marketMonitorInterval = null;
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    // Clear pending proposals tracking
    pendingProposals.clear();
    symbolLastCheck.clear();
    // Note: lockedMarkets and marketPnL are NOT cleared on stop, so markets that are in profit remain locked

    if (btnOver1Trial) {
      btnOver1Trial.textContent = 'Over 1 Trial';
      btnOver1Trial.classList.remove('bg-red-600');
      btnOver1Trial.classList.add('bg-navy');
    }

    log('Over 1 Trial trading stopped');
  }

  // Event listeners
  if (btnOver1Trial) {
    btnOver1Trial.addEventListener('click', () => {
      if (running) {
        stop();
      } else {
        start();
      }
    });
  }

  // Initialize button state
  if (btnOver1Trial) {
    btnOver1Trial.classList.add('bg-navy');
  }
})();

