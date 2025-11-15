// Momentum / "Hot-to-Cold" Switch Analyzer
(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  // DOM elements
  const cardEl = document.getElementById('momentumAnalysisCard');
  const titleBarEl = document.getElementById('momentumAnalysisTitleBar');
  const contentEl = document.getElementById('momentumAnalysisContent');
  const splitPointInput = document.getElementById('momentumSplitPoint');
  const splitPointValue = document.getElementById('momentumSplitPointValue');
  const recalculateBtn = document.getElementById('momentumRecalculate');
  const resultsContainer = document.getElementById('momentumResults');

  let expanded = false;

  // Default split point (500 recent, 500 prior)
  const DEFAULT_SPLIT = 500;
  const MAX_LOOKBACK = 1000;

  // Initialize split point input
  if (splitPointInput) {
    splitPointInput.min = 10;
    splitPointInput.max = MAX_LOOKBACK - 10;
    splitPointInput.step = 10;
    splitPointInput.value = DEFAULT_SPLIT;
    updateSplitPointDisplay();
  }

  function updateSplitPointDisplay() {
    if (!splitPointInput || !splitPointValue) return;
    const recent = Number(splitPointInput.value) || DEFAULT_SPLIT;
    const prior = MAX_LOOKBACK - recent;
    splitPointValue.textContent = `Last ${recent} vs Previous ${prior}`;
    // Update max to ensure we can always have a valid prior window
    if (splitPointInput.max !== MAX_LOOKBACK - 10) {
      splitPointInput.max = MAX_LOOKBACK - 10;
    }
  }

  function setExpanded(state) {
    expanded = state;
    if (!contentEl || !titleBarEl) return;
    contentEl.classList.toggle('hidden', !expanded);
    const icon = titleBarEl.querySelector('.expand-icon');
    if (icon) {
      icon.textContent = expanded ? '▼' : '▶';
    }
    if (expanded) {
      calculateAndRender();
    }
  }

  function formatPercentage(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  function getStatusIcon(delta) {
    if (delta > 1) return '🔥';
    if (delta < -1) return '❄️';
    return '➡️';
  }

  function getStatusText(delta) {
    if (delta > 1) return 'Heating Up';
    if (delta < -1) return 'Cooling Down';
    return 'Stable';
  }

  function getStrengthLabel(strength) {
    if (strength >= 50) return 'Very High';
    if (strength >= 20) return 'High';
    if (strength >= 10) return 'Medium';
    if (strength >= 5) return 'Low';
    return 'Very Low';
  }

  function calculateMomentum(queue, splitPoint) {
    if (!Array.isArray(queue) || queue.length < 20) {
      return null;
    }

    const totalAvailable = queue.length;
    // Recent window: last N ticks (where N = splitPoint, capped at available data)
    const recentSize = Math.min(splitPoint, totalAvailable);
    // Prior window: (MAX_LOOKBACK - splitPoint) ticks before recent, or as many as available
    // e.g., splitPoint=500 -> prior=500, splitPoint=200 -> prior=800
    const idealPriorSize = MAX_LOOKBACK - splitPoint;
    const priorSize = Math.min(idealPriorSize, totalAvailable - recentSize);

    if (priorSize < 10 || recentSize < 10) {
      return null; // Not enough data
    }

    // Split into Recent and Prior windows
    // Recent: last recentSize ticks
    // Prior: priorSize ticks immediately before recent window
    const recentWindow = queue.slice(-recentSize);
    const priorWindow = queue.slice(-(recentSize + priorSize), -recentSize);

    // Count frequencies for each digit (0-9)
    const recentCounts = Array.from({ length: 10 }, () => 0);
    const priorCounts = Array.from({ length: 10 }, () => 0);

    recentWindow.forEach(digit => {
      if (digit >= 0 && digit <= 9) recentCounts[digit]++;
    });

    priorWindow.forEach(digit => {
      if (digit >= 0 && digit <= 9) priorCounts[digit]++;
    });

    // Calculate momentum data for each digit
    const momentumData = [];
    for (let digit = 0; digit < 10; digit++) {
      const recentFreq = (recentCounts[digit] / recentSize) * 100;
      const priorFreq = (priorCounts[digit] / priorSize) * 100;
      const delta = recentFreq - priorFreq;
      const strength = Math.abs(delta) * (recentFreq + priorFreq) / 2;

      momentumData.push({
        digit,
        recentFreq,
        priorFreq,
        delta,
        strength
      });
    }

    return {
      momentumData,
      recentSize,
      priorSize,
      totalAvailable
    };
  }

  // Sorting removed - digits always displayed in fixed 0-9 order

  function renderResults(analysis) {
    if (!resultsContainer || !analysis) {
      return;
    }

    const { momentumData, recentSize, priorSize, totalAvailable } = analysis;
    // Always display digits in fixed 0-9 order
    const sorted = [...momentumData].sort((a, b) => a.digit - b.digit);

    // Find top gainers and losers
    const gainers = [...momentumData]
      .filter(d => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    
    const losers = [...momentumData]
      .filter(d => d.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3);

    let html = '';

    // Summary info
    html += `<div class="mb-4 p-3 bg-mint/40 rounded-lg text-sm text-navy/80">
      <div class="grid grid-cols-2 gap-2">
        <div><strong>Recent Window:</strong> ${recentSize} ticks</div>
        <div><strong>Prior Window:</strong> ${priorSize} ticks</div>
        <div class="col-span-2"><strong>Total Available:</strong> ${totalAvailable} ticks</div>
      </div>
    </div>`;

    // Top Gainers / Losers
    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div class="bg-mint/40 rounded-lg p-3">
        <h4 class="font-semibold text-navy mb-2 text-sm">🔥 Top Gainers</h4>
        <div class="space-y-1 text-xs">
          ${gainers.length > 0 ? gainers.map(d => 
            `<div class="flex justify-between">
              <span>Digit <strong>${d.digit}</strong></span>
              <span class="text-leaf font-semibold">+${d.delta.toFixed(1)}%</span>
            </div>`
          ).join('') : '<div class="text-navy/60">No gainers</div>'}
        </div>
      </div>
      <div class="bg-mint/40 rounded-lg p-3">
        <h4 class="font-semibold text-navy mb-2 text-sm">❄️ Top Losers</h4>
        <div class="space-y-1 text-xs">
          ${losers.length > 0 ? losers.map(d => 
            `<div class="flex justify-between">
              <span>Digit <strong>${d.digit}</strong></span>
              <span class="text-red-600 font-semibold">${d.delta.toFixed(1)}%</span>
            </div>`
          ).join('') : '<div class="text-navy/60">No losers</div>'}
        </div>
      </div>
    </div>`;

    // Main table
    html += `<div class="overflow-x-auto">
      <table class="min-w-full text-left border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wide text-navy/60 bg-mint/60">
            <th class="px-3 py-2 rounded-l-md">Digit</th>
            <th class="px-3 py-2">Recent Freq</th>
            <th class="px-3 py-2">Prior Freq</th>
            <th class="px-3 py-2">Δ Momentum</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2 rounded-r-md">Strength</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(d => {
            const deltaClass = d.delta > 1 ? 'text-leaf font-semibold' : 
                              d.delta < -1 ? 'text-red-600 font-semibold' : 
                              'text-navy/70';
            const rowBg = Math.abs(d.delta) > 2 ? 'bg-mint/60' : 'bg-mint/40';
            return `<tr class="${rowBg}">
              <td class="px-3 py-2 rounded-l-md font-semibold">${d.digit}</td>
              <td class="px-3 py-2">${d.recentFreq.toFixed(1)}%</td>
              <td class="px-3 py-2">${d.priorFreq.toFixed(1)}%</td>
              <td class="px-3 py-2 ${deltaClass}">${formatPercentage(d.delta)}</td>
              <td class="px-3 py-2">
                <span class="inline-flex items-center gap-1">
                  <span>${getStatusIcon(d.delta)}</span>
                  <span class="text-xs">${getStatusText(d.delta)}</span>
                </span>
              </td>
              <td class="px-3 py-2 rounded-r-md text-xs">${getStrengthLabel(d.strength)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

    resultsContainer.innerHTML = html;
  }

  function calculateAndRender() {
    if (!expanded) return;

    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) {
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="text-navy/70 p-4">No market selected. Please select a market from the Live Data section.</div>';
      }
      return;
    }

    const queue = wsApi.getDigitQueue(symbol) || [];
    if (queue.length < 20) {
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Not enough data yet. Waiting for more ticks…</div>';
      }
      return;
    }

    const splitPoint = Number(splitPointInput?.value || DEFAULT_SPLIT);
    const analysis = calculateMomentum(queue, splitPoint);

    if (!analysis) {
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Insufficient data for the selected split point. Try adjusting the split point.</div>';
      }
      return;
    }

    renderResults(analysis);
  }

  // Event listeners
  if (titleBarEl) {
    titleBarEl.addEventListener('click', (e) => {
      // Don't toggle if clicking on a button inside
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      setExpanded(!expanded);
    });
    titleBarEl.style.cursor = 'pointer';
  }

  if (splitPointInput) {
    splitPointInput.addEventListener('input', () => {
      updateSplitPointDisplay();
      if (expanded) {
        calculateAndRender();
      }
    });
  }

  if (recalculateBtn) {
    recalculateBtn.addEventListener('click', () => {
      calculateAndRender();
    });
  }

  // Listen for data updates
  function handleDataUpdate() {
    if (expanded) {
      calculateAndRender();
    }
  }

  document.addEventListener('ws:tick', handleDataUpdate);
  document.addEventListener('ws:market-subscribed', handleDataUpdate);
  document.addEventListener('ws:digit-stats', handleDataUpdate);

  // Initialize as collapsed
  setExpanded(false);
})();

