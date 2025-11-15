// Streak Filter Analyzer - Real-Time Digit Streak Tracker
(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  // DOM elements
  const cardEl = document.getElementById('streakFilterCard');
  const titleBarEl = document.getElementById('streakFilterTitleBar');
  const contentEl = document.getElementById('streakFilterContent');
  const lookbackInput = document.getElementById('streakLookback');
  const lookbackValue = document.getElementById('streakLookbackValue');
  const minStreakSelect = document.getElementById('streakMinStreak');
  const autoRefreshToggle = document.getElementById('streakAutoRefresh');
  const refreshBtn = document.getElementById('streakRefresh');
  const resultsContainer = document.getElementById('streakResults');
  const timelineContainer = document.getElementById('streakTimeline');
  const exportBtn = document.getElementById('streakExport');

  let expanded = false;
  let autoRefresh = false; // Disabled by default
  let currentMinStreak = 0; // 0 = show all digits

  // Default values
  const DEFAULT_LOOKBACK = 50;
  const MIN_LOOKBACK = 20;
  const MAX_LOOKBACK = 1000;

  // Initialize inputs
  if (lookbackInput) {
    lookbackInput.min = MIN_LOOKBACK;
    lookbackInput.max = MAX_LOOKBACK;
    lookbackInput.step = 10;
    lookbackInput.value = DEFAULT_LOOKBACK;
    updateLookbackDisplay();
  }

  function updateLookbackDisplay() {
    if (!lookbackInput || !lookbackValue) return;
    const value = Number(lookbackInput.value) || DEFAULT_LOOKBACK;
    lookbackValue.textContent = `${value} ticks`;
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

  function getStatusInfo(appearances, windowSize) {
    if (windowSize === 0) return { icon: '➡️', text: 'Normal', class: 'text-navy/70' };

    // Z-score based classification using binomial distribution
    const expected = 0.1 * windowSize;
    const stdDev = Math.sqrt(windowSize * 0.1 * 0.9);
    
    // Handle appearances === 0 case
    if (appearances === 0) {
      return { icon: '⭕', text: 'Missing', class: 'text-gray-500' };
    }
    
    // Calculate Z-score
    const z = (appearances - expected) / stdDev;
    
    // Classify using adaptive Z-score thresholds
    if (z >= 2.8) {
      return { icon: '🔥', text: 'Hot', class: 'text-red-600 font-bold' };
    }
    if (z >= 1.8) {
      return { icon: '🔥', text: 'Warm', class: 'text-orange-500' };
    }
    if (z <= -2.0) {
      return { icon: '❄️', text: 'Cold', class: 'text-blue-500' };
    }
    return { icon: '➡️', text: 'Normal', class: 'text-navy/70' };
  }

  function formatLastSeen(lastSeenAgo, lookback) {
    if (lastSeenAgo === 0) return 'Now';
    if (lastSeenAgo === lookback) return 'Never';
    return `${lastSeenAgo} ago`;
  }

  function calculateStreaks(queue, lookback) {
    if (!Array.isArray(queue) || queue.length < MIN_LOOKBACK) {
      return null;
    }

    const windowSize = Math.min(lookback, queue.length);
    const window = queue.slice(-windowSize);
    
    const digitData = Array.from({ length: 10 }, () => ({
      digit: null,
      appearances: 0,
      currentStreak: 0,
      lastSeenAgo: windowSize,
      positions: []
    }));

    // First pass: count appearances and track positions
    for (let i = 0; i < window.length; i++) {
      const digit = window[i];
      if (digit >= 0 && digit <= 9) {
        const data = digitData[digit];
        data.digit = digit;
        data.appearances++;
        data.positions.push(window.length - 1 - i); // Position from end (0 = most recent)
      }
    }

    // Second pass: calculate current streak and last seen
    for (let digit = 0; digit < 10; digit++) {
      const data = digitData[digit];
      data.digit = digit;
      
      if (data.appearances > 0) {
        // Current streak: count consecutive from the end (most recent first)
        // window[window.length - 1] is the most recent draw
        let streak = 0;
        for (let i = window.length - 1; i >= 0; i--) {
          if (window[i] === digit) {
            streak++;
          } else {
            break;
          }
        }
        data.currentStreak = streak;
        
        // Last seen: position of most recent appearance (0 = now, 1 = 1 ago, etc.)
        // positions array is built oldest-first, so the most recent is at the end
        data.lastSeenAgo = data.positions.length > 0 ? data.positions[data.positions.length - 1] : windowSize;
      } else {
        data.currentStreak = 0;
        data.lastSeenAgo = windowSize; // Never appeared
      }
    }

    return {
      digitData,
      windowSize,
      totalAvailable: queue.length
    };
  }

  // Sorting removed - digits always displayed in fixed 0-9 order

  function filterByMinStreak(data, minStreak) {
    // Always return all digits - filter is for highlighting, not hiding
    return data;
  }
  
  function shouldHighlightByFilter(digitData, minStreak) {
    if (minStreak === -1) {
      // "Never Appeared" option - highlight digits that never appeared
      return digitData.appearances === 0;
    }
    if (minStreak === 0) {
      // "Show All" - don't highlight anything
      return false;
    }
    // Highlight digits that meet the minimum streak requirement
    return digitData.currentStreak >= minStreak;
  }

  function renderResults(analysis) {
    if (!resultsContainer || !analysis) {
      return;
    }

    const { digitData, windowSize, totalAvailable } = analysis;
    
    // Always show all digits in fixed 0-9 order - filter is for highlighting, not hiding
    let allDigits = filterByMinStreak(digitData, currentMinStreak);
    
    // Ensure digits are in fixed 0-9 order (they should already be, but enforce it)
    allDigits.sort((a, b) => a.digit - b.digit);
    
    // Add windowSize to each item for percentage calculation
    allDigits.forEach(d => d.windowSize = windowSize);

    let html = '';

    // Summary info
    let filterText = 'Showing all digits';
    if (currentMinStreak === -1) {
      filterText = 'Showing all digits (highlighting: Never Appeared)';
    } else if (currentMinStreak > 0) {
      filterText = `Showing all digits (highlighting: streak ≥ ${currentMinStreak})`;
    }
    html += `<div class="mb-4 p-3 bg-mint/40 rounded-lg text-sm text-navy/80">
      <div class="grid grid-cols-2 gap-2">
        <div><strong>Look-Back Window:</strong> ${windowSize} ticks</div>
        <div><strong>Total Available:</strong> ${totalAvailable} ticks</div>
        <div class="col-span-2"><strong>Display:</strong> ${filterText}</div>
      </div>
    </div>`;

    // Main table - fixed order, no sorting
    html += `<div class="overflow-x-auto mb-4">
      <table class="min-w-full text-left border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wide text-navy/60 bg-mint/60">
            <th class="px-3 py-2 rounded-l-md">Digit</th>
            <th class="px-3 py-2">Appearances</th>
            <th class="px-3 py-2">Current Streak</th>
            <th class="px-3 py-2">Last Seen</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2 rounded-r-md">% of Window</th>
          </tr>
        </thead>
        <tbody>
          ${allDigits.map(d => {
            const status = getStatusInfo(d.appearances, windowSize);
            const percentage = windowSize > 0 ? ((d.appearances / windowSize) * 100).toFixed(1) : '0.0';
            const streakText = d.currentStreak > 0 ? `${d.currentStreak} in a row` : '0';
            
            // Determine row background - highlight if matches filter
            const matchesFilter = shouldHighlightByFilter(d, currentMinStreak);
            let rowBg = 'bg-mint/40';
            if (matchesFilter && currentMinStreak > 0) {
              rowBg = 'bg-leaf/20 border-2 border-leaf/40'; // Highlight matching streak filter
            } else if (matchesFilter && currentMinStreak === -1) {
              rowBg = 'bg-gray-200 border-2 border-gray-400'; // Highlight never appeared
            } else if (d.currentStreak >= 3) {
              rowBg = 'bg-red-100'; // High streak visual indicator
            } else if (d.currentStreak === 2) {
              rowBg = 'bg-orange-100'; // Medium streak visual indicator
            }
            
            return `<tr class="${rowBg}" data-digit="${d.digit}">
              <td class="px-3 py-2 rounded-l-md font-semibold">${d.digit}</td>
              <td class="px-3 py-2">${d.appearances}</td>
              <td class="px-3 py-2 ${d.currentStreak >= 2 ? 'font-semibold text-leaf' : ''}">${streakText}</td>
              <td class="px-3 py-2">${formatLastSeen(d.lastSeenAgo, windowSize)}</td>
              <td class="px-3 py-2">
                <span class="inline-flex items-center gap-1 ${status.class}">
                  <span>${status.icon}</span>
                  <span class="text-xs">${status.text}</span>
                </span>
              </td>
              <td class="px-3 py-2 rounded-r-md">${percentage}%</td>
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
      if (timelineContainer) timelineContainer.innerHTML = '';
      return;
    }

    const queue = wsApi.getDigitQueue(symbol) || [];
    const lookback = Number(lookbackInput?.value || DEFAULT_LOOKBACK);

    if (queue.length < MIN_LOOKBACK) {
      if (resultsContainer) {
        resultsContainer.innerHTML = `<div class="text-navy/70 p-4">Need at least ${MIN_LOOKBACK} draws. Currently have ${queue.length}.</div>`;
      }
      if (timelineContainer) timelineContainer.innerHTML = '';
      return;
    }

    const analysis = calculateStreaks(queue, lookback);
    if (!analysis) {
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="text-navy/70 p-4">Insufficient data for analysis.</div>';
      }
      if (timelineContainer) timelineContainer.innerHTML = '';
      return;
    }

    renderResults(analysis);
  }

  function exportToCSV() {
    const symbol = wsApi.getCurrentSymbol();
    if (!symbol) return;

    const queue = wsApi.getDigitQueue(symbol) || [];
    const lookback = Number(lookbackInput?.value || DEFAULT_LOOKBACK);
    const analysis = calculateStreaks(queue, lookback);
    
    if (!analysis) return;

    const { digitData, windowSize } = analysis;
    let allDigits = filterByMinStreak(digitData, currentMinStreak);
    // Ensure fixed 0-9 order for export
    allDigits.sort((a, b) => a.digit - b.digit);
    allDigits.forEach(d => d.windowSize = windowSize);

    // CSV header
    let csv = 'Digit,Appearances,Current Streak,Last Seen,Status,% of Window\n';

    // CSV rows - export all digits
    allDigits.forEach(d => {
      const status = getStatusInfo(d.appearances, windowSize);
      const percentage = windowSize > 0 ? ((d.appearances / windowSize) * 100).toFixed(1) : '0.0';
      const streakText = d.currentStreak > 0 ? `${d.currentStreak} in a row` : '0';
      const lastSeen = formatLastSeen(d.lastSeenAgo, windowSize);
      
      csv += `${d.digit},${d.appearances},"${streakText}","${lastSeen}","${status.text}",${percentage}\n`;
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streak_filter_${symbol}_${lookback}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // Sorting removed - no global sort function needed

  // Event listeners
  if (titleBarEl) {
    titleBarEl.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      setExpanded(!expanded);
    });
    titleBarEl.style.cursor = 'pointer';
  }

  if (lookbackInput) {
    lookbackInput.addEventListener('input', () => {
      updateLookbackDisplay();
      if (expanded) {
        calculateAndRender();
      }
    });
  }

  if (minStreakSelect) {
    minStreakSelect.addEventListener('change', (e) => {
      currentMinStreak = Number(e.target.value) || 1;
      if (expanded) {
        calculateAndRender();
      }
    });
  }

  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', (e) => {
      autoRefresh = e.target.checked;
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      calculateAndRender();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportToCSV();
    });
  }

  // Listen for data updates
  function handleDataUpdate() {
    if (expanded && autoRefresh) {
      calculateAndRender();
    }
  }

  document.addEventListener('ws:tick', handleDataUpdate);
  document.addEventListener('ws:market-subscribed', handleDataUpdate);
  document.addEventListener('ws:digit-stats', handleDataUpdate);

  // Initialize as collapsed
  setExpanded(false);
})();

