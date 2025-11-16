// Strategies Analysis Card
// Default class: StrategiesAnalysisCard
class StrategiesAnalysisCard {
  constructor(containerElement) {
    this.containerElement = containerElement;
    this.expanded = false;
    this.currentStrategy = 'over1';
    this.lookbackWindow = 100;
    
    // New settings for over1 analysis
    this.totalLookback = 1000;
    this.splitPoint = 500;
    
    // DOM elements
    this.cardEl = document.getElementById('strategiesAnalysisCard');
    this.titleBarEl = document.getElementById('strategiesAnalysisTitleBar');
    this.contentEl = document.getElementById('strategiesAnalysisContent');
    this.strategySelect = document.getElementById('strategiesAnalysisSelect');
    this.resultsContainer = document.getElementById('strategiesAnalysisResults');
    
    // Data buffer (max 1000 ticks)
    this.dataBuffer = [];
    this.maxBufferSize = 1000;
    
    // Persistent storage for identified droughts (historical snapshot)
    // Each drought is stored with its absolute queue position and never recalculated
    this.identifiedDroughts = [];
    this.lastProcessedQueueLength = 0;
  }

  init() {
    if (!this.cardEl || !this.titleBarEl || !this.contentEl) {
      console.error('Strategies Analysis Card: Required DOM elements not found');
      return;
    }

    // Initialize title bar click handler
    if (this.titleBarEl) {
      this.titleBarEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        this.setExpanded(!this.expanded);
      });
      this.titleBarEl.style.cursor = 'pointer';
    }

    // Initialize strategy selector
    if (this.strategySelect) {
      this.strategySelect.addEventListener('change', (e) => {
        this.currentStrategy = e.target.value;
        if (this.expanded) {
          this.update();
        }
      });
    }

    // Initialize as collapsed
    this.setExpanded(false);

    // Listen for data updates
    this.handleDataUpdate = () => {
      if (this.expanded) {
        this.update();
      }
    };

    document.addEventListener('ws:tick', this.handleDataUpdate);
    document.addEventListener('ws:market-subscribed', this.handleDataUpdate);
    document.addEventListener('ws:digit-stats', this.handleDataUpdate);
  }

  setExpanded(state) {
    this.expanded = state;
    if (!this.contentEl || !this.titleBarEl) return;
    this.contentEl.classList.toggle('hidden', !this.expanded);
    const icon = this.titleBarEl.querySelector('.expand-icon');
    if (icon) {
      icon.textContent = this.expanded ? '▼' : '▶';
    }
    if (this.expanded) {
      this.update();
    }
  }

  update(data) {
    if (!this.expanded) return;

    const wsApi = window.AppWS;
    if (!wsApi) {
      if (this.resultsContainer) {
        this.resultsContainer.innerHTML = '<div class="text-navy/70 p-4">WebSocket API not available.</div>';
      }
      return;
    }

    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) {
      if (this.resultsContainer) {
        this.resultsContainer.innerHTML = '<div class="text-navy/70 p-4">No market selected. Please select a market from the Live Data section.</div>';
      }
      return;
    }

    const queue = wsApi.getDigitQueue(symbol) || [];
    if (queue.length < 10) {
      if (this.resultsContainer) {
        this.resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Not enough data yet. Waiting for more ticks…</div>';
      }
      return;
    }

    // Update data buffer
    this.dataBuffer = queue.slice(-this.maxBufferSize);

    // Render based on selected strategy
    if (this.currentStrategy === 'over1') {
      this.renderOver1Analysis();
    } else {
      this.resultsContainer.innerHTML = `<div class="text-navy/70 p-4">Strategy "${this.currentStrategy}" is not yet implemented.</div>`;
    }
  }

  renderOver1Analysis() {
    if (!this.resultsContainer) return;

    const queue = this.dataBuffer;
    if (queue.length < 20) {
      this.resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Not enough data yet. Waiting for more ticks…</div>';
      return;
    }

    // Calculate momentum analysis
    const analysis = this.calculateOver1Momentum(queue, this.splitPoint, this.totalLookback);
    if (!analysis) {
      this.resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Insufficient data for the selected settings. Try adjusting the split point or total lookback.</div>';
      return;
    }

    let html = '';

    // Controls: Total Lookback and Split Point
    html += `<div class="mb-4 space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="flex flex-col">
          <span class="text-sm font-medium text-navy/80 mb-1">Total Lookback (Ticks)</span>
          <input id="over1TotalLookback" type="range" min="20" max="1000" step="10" value="${this.totalLookback}" class="w-full" />
          <div id="over1TotalLookbackValue" class="text-xs text-navy/60 mt-1">${this.totalLookback} ticks</div>
        </label>
        <label class="flex flex-col">
          <span class="text-sm font-medium text-navy/80 mb-1">Split Point</span>
          <input id="over1SplitPoint" type="range" min="10" max="${this.totalLookback - 10}" step="10" value="${this.splitPoint}" class="w-full" />
          <div id="over1SplitPointValue" class="text-xs text-navy/60 mt-1">Last ${this.splitPoint} vs Previous ${this.totalLookback - this.splitPoint}</div>
        </label>
      </div>
    </div>`;

    // Summary info
    html += `<div class="mb-4 p-3 bg-mint/40 rounded-lg text-sm text-navy/80">
      <div class="grid grid-cols-2 gap-2">
        <div><strong>Recent Window:</strong> ${analysis.recentSize} ticks</div>
        <div><strong>Prior Window:</strong> ${analysis.priorSize} ticks</div>
        <div class="col-span-2"><strong>Total Available:</strong> ${analysis.totalAvailable} ticks</div>
      </div>
    </div>`;

    // Main analysis table
    html += `<div class="overflow-x-auto mb-4">
      <table class="min-w-full text-left border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wide text-navy/60 bg-mint/60">
            <th class="px-3 py-2 rounded-l-md">Target</th>
            <th class="px-3 py-2">Prior Freq</th>
            <th class="px-3 py-2">Recent Freq</th>
            <th class="px-3 py-2">Momentum</th>
            <th class="px-3 py-2">Last Seen</th>
            <th class="px-3 py-2 rounded-r-md">% of Window</th>
          </tr>
        </thead>
        <tbody>
          ${analysis.targets.map(target => {
            const momentumClass = target.delta > 1 ? 'text-leaf font-semibold' : 
                                 target.delta < -1 ? 'text-red-600 font-semibold' : 
                                 'text-navy/70';
            const rowBg = Math.abs(target.delta) > 2 ? 'bg-mint/60' : 'bg-mint/40';
            const momentumIcon = target.delta > 1 ? '🔥' : target.delta < -1 ? '❄️' : '➡️';
            
            return `<tr class="${rowBg}">
              <td class="px-3 py-2 rounded-l-md font-semibold">${target.label}</td>
              <td class="px-3 py-2">${target.priorFreq.toFixed(1)}%</td>
              <td class="px-3 py-2">${target.recentFreq.toFixed(1)}%</td>
              <td class="px-3 py-2 ${momentumClass}">
                <span class="inline-flex items-center gap-1">
                  <span>${momentumIcon}</span>
                  <span>${target.delta >= 0 ? '+' : ''}${target.delta.toFixed(1)}%</span>
                </span>
              </td>
              <td class="px-3 py-2">${this.formatLastSeen(target.lastSeenAgo, analysis.recentSize + analysis.priorSize)}</td>
              <td class="px-3 py-2 rounded-r-md">${target.percentageOfWindow.toFixed(1)}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

    // Drought Analysis Section - use persistent stored droughts
    const droughtAnalysis = this.getDroughtAnalysisForLookback(queue, this.totalLookback);
    if (droughtAnalysis && droughtAnalysis.droughts.length > 0) {
    html += `<div class="mb-4">
        <h3 class="text-sm font-semibold text-navy mb-2">Drought Analysis (10+ consecutive ticks without 0 or 1)</h3>
        <div class="mb-2 p-2 bg-mint/40 rounded-lg text-sm text-navy/80">
          <strong>Total Drought Instances:</strong> ${droughtAnalysis.droughts.length}
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr class="text-xs uppercase tracking-wide text-navy/60 bg-mint/60">
                <th class="px-3 py-2 rounded-l-md">#</th>
                <th class="px-3 py-2">Drought Length</th>
                <th class="px-3 py-2">Digit Before</th>
                <th class="px-3 py-2">Before % (1000)</th>
                <th class="px-3 py-2">Before Rank</th>
                <th class="px-3 py-2">Digit Before Initiating</th>
                <th class="px-3 py-2">First Digit of Drought</th>
                <th class="px-3 py-2">% of 0 (pre)</th>
                <th class="px-3 py-2">% of 1 (pre)</th>
                <th class="px-3 py-2">% of 0+1 (pre)</th>
                <th class="px-3 py-2 rounded-r-md">% of 2-9 (pre)</th>
              </tr>
            </thead>
            <tbody>
              ${droughtAnalysis.droughts.map((drought, index) => {
                const rowBg = index % 2 === 0 ? 'bg-mint/40' : 'bg-mint/60';
                return `<tr class="${rowBg}">
                  <td class="px-3 py-2 rounded-l-md font-semibold">${index + 1}</td>
                  <td class="px-3 py-2">${drought.length} ticks</td>
                  <td class="px-3 py-2 font-semibold">${drought.digitBefore !== null ? drought.digitBefore : 'N/A'}</td>
                  <td class="px-3 py-2">${drought.digitBeforePercent !== null ? drought.digitBeforePercent.toFixed(2) : 'N/A'}%</td>
                  <td class="px-3 py-2">${drought.digitBeforeRank !== null ? `#${drought.digitBeforeRank}` : 'N/A'}</td>
                  <td class="px-3 py-2 font-semibold">${drought.digitBeforeInitiating !== null ? drought.digitBeforeInitiating : 'N/A'}</td>
                  <td class="px-3 py-2 font-semibold">${drought.firstDigitOfDrought !== null ? drought.firstDigitOfDrought : 'N/A'}</td>
                  <td class="px-3 py-2">${drought.percent0.toFixed(2)}%</td>
                  <td class="px-3 py-2">${drought.percent1.toFixed(2)}%</td>
                  <td class="px-3 py-2">${drought.percent01.toFixed(2)}%</td>
                  <td class="px-3 py-2 rounded-r-md">${drought.percent29.toFixed(2)}%</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    } else {
      html += `<div class="mb-4 p-3 bg-mint/40 rounded-lg text-sm text-navy/80">
        <strong>Drought Analysis:</strong> No droughts found (10+ consecutive ticks without 0 or 1) in the selected lookback window.
    </div>`;
    }

    this.resultsContainer.innerHTML = html;

    // Add event listeners
    this.setupOver1EventListeners();
  }

  calculateOver1Momentum(queue, splitPoint, totalLookback) {
    if (!Array.isArray(queue) || queue.length < 20) {
      return null;
    }

    const totalAvailable = queue.length;
    const recentSize = Math.min(splitPoint, totalAvailable);
    const idealPriorSize = totalLookback - splitPoint;
    const priorSize = Math.min(idealPriorSize, totalAvailable - recentSize);

    if (priorSize < 10 || recentSize < 10) {
      return null;
    }

    // Split into Recent and Prior windows
    const recentWindow = queue.slice(-recentSize);
    const priorWindow = queue.slice(-(recentSize + priorSize), -recentSize);

    // Helper function to check if digit matches target
    const matchesTarget = (digit, target) => {
      if (target === 'digit0') return digit === 0;
      if (target === 'digit1') return digit === 1;
      if (target === 'cumulative01') return digit === 0 || digit === 1;
      if (target === 'cumulative29') return digit >= 2 && digit <= 9;
      return false;
    };

    // Calculate data for each target
    const targets = [
      { key: 'digit0', label: 'Digit 0' },
      { key: 'digit1', label: 'Digit 1' },
      { key: 'cumulative01', label: 'Cumulative 0+1' },
      { key: 'cumulative29', label: 'Cumulative 2-9' }
    ];

    const results = targets.map(target => {
      // Count in recent and prior windows
      let recentCount = 0;
      let priorCount = 0;
      let lastSeenAgo = recentSize + priorSize; // Default: never seen in lookback period
      let lastSeenPosition = -1;

      // Count in recent window and find last seen
      for (let i = recentWindow.length - 1; i >= 0; i--) {
        if (matchesTarget(recentWindow[i], target.key)) {
          recentCount++;
          if (lastSeenPosition === -1) {
            lastSeenPosition = recentWindow.length - 1 - i;
          }
        }
      }

      // Count in prior window
      for (let i = 0; i < priorWindow.length; i++) {
        if (matchesTarget(priorWindow[i], target.key)) {
          priorCount++;
        }
      }

      // Calculate frequencies
      const recentFreq = (recentCount / recentSize) * 100;
      const priorFreq = (priorCount / priorSize) * 100;
      const delta = recentFreq - priorFreq;

      // Last seen: if found in recent window, use position; otherwise check prior window
      if (lastSeenPosition !== -1) {
        lastSeenAgo = lastSeenPosition;
      } else {
        // Check prior window
        for (let i = priorWindow.length - 1; i >= 0; i--) {
          if (matchesTarget(priorWindow[i], target.key)) {
            lastSeenAgo = recentSize + (priorWindow.length - 1 - i);
            break;
          }
        }
      }

      // Percentage of window (overall frequency in recent window)
      const percentageOfWindow = recentFreq;

      return {
        ...target,
        recentCount,
        priorCount,
        recentFreq,
        priorFreq,
        delta,
        lastSeenAgo,
        percentageOfWindow
      };
    });

    return {
      targets: results,
      recentSize,
      priorSize,
      totalAvailable
    };
  }

  formatLastSeen(lastSeenAgo, totalLookbackSize) {
    if (lastSeenAgo === 0) return 'Now';
    // If lastSeenAgo is >= total lookback window, consider it "Never"
    if (lastSeenAgo >= totalLookbackSize) return 'Never';
    return `${lastSeenAgo} ago`;
  }

  // Identify and store NEW droughts only (persistent historical snapshots)
  identifyNewDroughts(queue, lookbackWindow) {
    if (!Array.isArray(queue) || queue.length < 20) {
      return;
    }

    // Only process new data since last check
    const startIndex = Math.max(0, this.lastProcessedQueueLength - 20); // Need some overlap for ongoing droughts
    const newData = queue.slice(startIndex);
    
    if (newData.length === 0) {
      return;
    }

    // Find droughts in the new data section
    // We need to scan with enough context to catch droughts that span the boundary
    const scanStart = Math.max(0, this.lastProcessedQueueLength - 20);
    // Use the lookback window for pre-drought calculations, but scan from scanStart
    const scanWindow = queue.slice(scanStart);
    
    let currentDroughtStart = -1;
    let currentDroughtLength = 0;
    const processedPositions = new Set(this.identifiedDroughts.map(d => d.absoluteQueuePos));

    for (let i = 0; i < scanWindow.length; i++) {
      const digit = scanWindow[i];
      const is01 = digit === 0 || digit === 1;
      const absolutePos = scanStart + i;

      if (!is01) {
        // Not 0 or 1, continue/start drought
        if (currentDroughtStart === -1) {
          currentDroughtStart = i;
          currentDroughtLength = 1;
        } else {
          currentDroughtLength++;
        }
      } else {
        // Found 0 or 1, check if we just ended a drought
        if (currentDroughtLength >= 10) {
          const droughtStart = currentDroughtStart;
          const droughtLength = currentDroughtLength;
          const absoluteQueuePos = scanStart + droughtStart - 1; // Position of digit before drought
          
          // Check if we've already identified this drought
          if (!processedPositions.has(absoluteQueuePos)) {
            // This is a NEW drought - calculate and store it
            const droughtData = this.calculateDroughtData(queue, scanStart, droughtStart, droughtLength, scanWindow, lookbackWindow);
            if (droughtData) {
              droughtData.absoluteQueuePos = absoluteQueuePos;
              this.identifiedDroughts.push(droughtData);
              processedPositions.add(absoluteQueuePos);
            }
          }
        }
        
        // Reset drought tracking
        currentDroughtStart = -1;
        currentDroughtLength = 0;
      }
    }

    // Check ongoing drought at the end
    if (currentDroughtLength >= 10) {
      const droughtStart = currentDroughtStart;
      const droughtLength = currentDroughtLength;
      const absoluteQueuePos = scanStart + droughtStart - 1;
      
      if (!processedPositions.has(absoluteQueuePos)) {
        const droughtData = this.calculateDroughtData(queue, scanStart, droughtStart, droughtLength, scanWindow, lookbackWindow);
        if (droughtData) {
          droughtData.absoluteQueuePos = absoluteQueuePos;
          this.identifiedDroughts.push(droughtData);
        }
      }
    }

    // Update last processed position
    this.lastProcessedQueueLength = queue.length;
  }

  // Calculate drought data for a specific drought (historical snapshot)
  calculateDroughtData(queue, scanStart, droughtStart, droughtLength, scanWindow, lookbackWindow) {
    // For pre-drought calculations, use the lookback window ending at the digit before the drought
    // We need to get the lookback window that would have been active at the time of the drought
    const queuePosBeforeDrought = scanStart + droughtStart - 1;
    const lookbackStart = Math.max(0, queuePosBeforeDrought - lookbackWindow + 1);
    const lookbackEnd = queuePosBeforeDrought + 1; // Include the digit before the drought
    const lookbackWindowData = queue.slice(lookbackStart, lookbackEnd);
    
    // Calculate PRE-DROUGHT percentages from ticks BEFORE the drought
    // The lookback window ends at the digit before the drought (inclusive)
    // So pre-drought window is everything except the last tick (the digit before)
    const preDroughtWindow = lookbackWindowData.slice(0, lookbackWindowData.length - 1);
    let preCount0 = 0;
    let preCount1 = 0;
    let preCount29 = 0;
    
    preDroughtWindow.forEach(d => {
      if (d === 0) preCount0++;
      else if (d === 1) preCount1++;
      else if (d >= 2 && d <= 9) preCount29++;
    });
    
    const preWindowSize = preDroughtWindow.length;
    const prePercent0 = preWindowSize > 0 ? (preCount0 / preWindowSize) * 100 : 0;
    const prePercent1 = preWindowSize > 0 ? (preCount1 / preWindowSize) * 100 : 0;
    const prePercent01 = preWindowSize > 0 ? ((preCount0 + preCount1) / preWindowSize) * 100 : 0;
    const prePercent29 = preWindowSize > 0 ? (preCount29 / preWindowSize) * 100 : 0;

    // Find digit before the drought (the last tick in the lookback window - the initiating digit)
    let digitBefore = null;
    if (lookbackWindowData.length > 0) {
      digitBefore = lookbackWindowData[lookbackWindowData.length - 1];
    }

    // Find digit before the initiating digit (the digit before the digit before the drought)
    let digitBeforeInitiating = null;
    if (lookbackWindowData.length > 1) {
      digitBeforeInitiating = lookbackWindowData[lookbackWindowData.length - 2];
    }

    // Find first digit of the drought (the first non-0/1 digit that starts the drought)
    let firstDigitOfDrought = null;
    const queuePosDroughtStart = scanStart + droughtStart;
    if (queuePosDroughtStart < queue.length) {
      firstDigitOfDrought = queue[queuePosDroughtStart];
    }

    // Calculate digit before percentage and rank from HISTORICAL 1000-tick window
    let digitBeforePercent = null;
    let digitBeforeRank = null;
    
    if (digitBefore !== null && droughtStart > 0) {
      const queuePosBeforeDrought = scanStart + droughtStart - 1;
      
      // Build historical 1000-tick window ending at queuePosBeforeDrought (inclusive)
      const historicalStart = Math.max(0, queuePosBeforeDrought - 999);
      const historicalEnd = queuePosBeforeDrought + 1;
      const historicalWindow = queue.slice(historicalStart, historicalEnd);
      
      const digitCounts = Array.from({ length: 10 }, () => 0);
      
      historicalWindow.forEach(d => {
        if (d >= 0 && d <= 9) {
          digitCounts[d]++;
        }
      });
      
      const historicalWindowSize = historicalWindow.length;
      digitBeforePercent = historicalWindowSize > 0 ? (digitCounts[digitBefore] / historicalWindowSize) * 100 : 0;
      
      // Calculate rank (1 = highest frequency, 10 = lowest)
      const sortedDigits = digitCounts.map((count, digit) => ({
        digit,
        count
      })).sort((a, b) => b.count - a.count);
      
      digitBeforeRank = sortedDigits.findIndex(d => d.digit === digitBefore) + 1;
    }

    return {
      length: droughtLength,
      percent0: prePercent0,
      percent1: prePercent1,
      percent01: prePercent01,
      percent29: prePercent29,
      digitBefore,
      digitBeforePercent,
      digitBeforeRank,
      digitBeforeInitiating,
      firstDigitOfDrought
    };
  }

  // Get droughts filtered by current lookback window (from stored persistent droughts)
  getDroughtAnalysisForLookback(queue, lookbackWindow) {
    // First, identify any new droughts (using current totalLookback for pre-drought calculations)
    this.identifyNewDroughts(queue, lookbackWindow);
    
    // Filter stored droughts that fall within the current lookback window
    const queueEnd = queue.length;
    const lookbackStart = queueEnd - lookbackWindow;
    
    const filteredDroughts = this.identifiedDroughts.filter(drought => {
      // Drought is in lookback window if its position is >= lookbackStart
      return drought.absoluteQueuePos >= lookbackStart;
    });

    // Sort by position (most recent first)
    filteredDroughts.sort((a, b) => b.absoluteQueuePos - a.absoluteQueuePos);

    return { droughts: filteredDroughts };
  }

  setupOver1EventListeners() {
    // Get elements after HTML is inserted
    const totalLookbackInput = document.getElementById('over1TotalLookback');
    const totalLookbackValue = document.getElementById('over1TotalLookbackValue');
    const splitPointInput = document.getElementById('over1SplitPoint');
    const splitPointValue = document.getElementById('over1SplitPointValue');

    if (totalLookbackInput) {
      totalLookbackInput.addEventListener('input', (e) => {
        this.totalLookback = Number(e.target.value) || 1000;
        if (totalLookbackValue) {
          totalLookbackValue.textContent = `${this.totalLookback} ticks`;
        }
        // Update split point max
        if (splitPointInput) {
          splitPointInput.max = this.totalLookback - 10;
          // Adjust split point if it exceeds new total
          if (this.splitPoint > this.totalLookback - 10) {
            this.splitPoint = this.totalLookback - 10;
            splitPointInput.value = this.splitPoint;
            if (splitPointValue) {
              const prior = this.totalLookback - this.splitPoint;
              splitPointValue.textContent = `Last ${this.splitPoint} vs Previous ${prior}`;
            }
          }
        }
        this.update();
      });
    }

    if (splitPointInput) {
      splitPointInput.addEventListener('input', (e) => {
        this.splitPoint = Number(e.target.value) || 500;
        if (splitPointValue) {
          const prior = this.totalLookback - this.splitPoint;
          splitPointValue.textContent = `Last ${this.splitPoint} vs Previous ${prior}`;
        }
        this.update();
      });
    }
  }

  renderDigitCard(digit, percentage, momentum, streak, lookback, count) {
    const momentumIcon = momentum.status === 'Hot' ? '🟢' : momentum.status === 'Cold' ? '🔴' : '⚪';
    const momentumColor = momentum.status === 'Hot' ? 'text-green-600' : momentum.status === 'Cold' ? 'text-red-600' : 'text-gray-600';

    return `
      <div class="bg-mint/40 rounded-lg p-4">
        <div class="flex justify-between items-center mb-3">
          <span class="text-base font-semibold text-navy">Digit ${digit}</span>
          <span class="text-lg font-bold text-teal">${percentage}%</span>
        </div>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-navy/70">Occurrences:</span>
            <span class="font-medium">${count} / ${lookback}</span>
          </div>
          <div class="pt-2 border-t border-teal/20">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-navy/80">Momentum Switch:</span>
              <span class="${momentumColor} font-semibold">${momentumIcon} ${momentum.status}</span>
            </div>
            <div class="text-xs text-navy/60">${momentum.description}</div>
          </div>
        </div>
      </div>
    `;
  }

  calculateMomentumSwitch(window, digit) {
    if (window.length < 20) {
      return {
        status: 'Neutral',
        description: 'Insufficient data for momentum analysis'
      };
    }

    const recent20 = window.slice(-20);
    const recent3 = window.slice(-3);
    const recent5 = window.slice(-5);

    // Count occurrences in recent windows
    const recent20Count = recent20.filter(d => d === digit).length;
    const prior20Count = window.length >= 40 ? window.slice(-40, -20).filter(d => d === digit).length : 0;

    const recent20Percent = (recent20Count / 20) * 100;
    const prior20Percent = window.length >= 40 ? (prior20Count / 20) * 100 : 10; // default to 10% if no prior data
    const percentChange = recent20Percent - prior20Percent;

    // Check if digit appeared in last 3 ticks
    const inLast3 = recent3.includes(digit);
    const inLast5 = recent5.includes(digit);

    // Hot: last 3 ticks include digit AND % rising > 5% in last 20 ticks
    if (inLast3 && percentChange > 5) {
      return {
        status: 'Hot',
        description: `Digit ${digit} appeared in last 3 ticks, percentage rising (+${percentChange.toFixed(1)}%)`
      };
    }

    // Cold: no digit in last 5 ticks AND % falling
    if (!inLast5 && percentChange < -5) {
      return {
        status: 'Cold',
        description: `Digit ${digit} not in last 5 ticks, percentage falling (${percentChange.toFixed(1)}%)`
      };
    }

    // Neutral: everything else
    return {
      status: 'Neutral',
      description: `Stable: ${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}% change, ${inLast5 ? 'appeared' : 'not appeared'} in last 5 ticks`
    };
  }

  calculateStreak(window, digit) {
    if (window.length === 0) return 0;

    let streak = 0;
    // Count consecutive occurrences from the end (most recent first)
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i] === digit) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  destroy() {
    // Remove event listeners
    if (this.handleDataUpdate) {
      document.removeEventListener('ws:tick', this.handleDataUpdate);
      document.removeEventListener('ws:market-subscribed', this.handleDataUpdate);
      document.removeEventListener('ws:digit-stats', this.handleDataUpdate);
    }

    // Clear data buffer
    this.dataBuffer = [];
  }
}

// Initialize the card
(function() {
  const card = new StrategiesAnalysisCard();
  card.init();
})();

