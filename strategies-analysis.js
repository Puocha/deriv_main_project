// Strategies Analysis Card
// Default class: StrategiesAnalysisCard
class StrategiesAnalysisCard {
  constructor(containerElement) {
    this.containerElement = containerElement;
    this.expanded = false;
    this.currentStrategy = 'over1';
    this.lookbackWindow = 100;
    
    // DOM elements
    this.cardEl = document.getElementById('strategiesAnalysisCard');
    this.titleBarEl = document.getElementById('strategiesAnalysisTitleBar');
    this.contentEl = document.getElementById('strategiesAnalysisContent');
    this.strategySelect = document.getElementById('strategiesAnalysisSelect');
    this.resultsContainer = document.getElementById('strategiesAnalysisResults');
    
    // Data buffer (max 1000 ticks)
    this.dataBuffer = [];
    this.maxBufferSize = 1000;
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

    const lookback = Math.min(this.lookbackWindow, this.dataBuffer.length);
    const window = this.dataBuffer.slice(-lookback);

    // Calculate cumulative percentages
    let under1Count = 0; // digits 0-1
    let over1Count = 0;  // digits 2-9
    let digit0Count = 0;
    let digit1Count = 0;

    window.forEach(digit => {
      if (digit === 0 || digit === 1) {
        under1Count++;
        if (digit === 0) digit0Count++;
        if (digit === 1) digit1Count++;
      } else if (digit >= 2 && digit <= 9) {
        over1Count++;
      }
    });

    const under1Percent = lookback > 0 ? ((under1Count / lookback) * 100).toFixed(2) : '0.00';
    const over1Percent = lookback > 0 ? ((over1Count / lookback) * 100).toFixed(2) : '0.00';
    const digit0Percent = lookback > 0 ? ((digit0Count / lookback) * 100).toFixed(2) : '0.00';
    const digit1Percent = lookback > 0 ? ((digit1Count / lookback) * 100).toFixed(2) : '0.00';

    // Calculate Momentum Switch for digits 0 and 1
    const digit0Momentum = this.calculateMomentumSwitch(window, 0);
    const digit1Momentum = this.calculateMomentumSwitch(window, 1);

    // Calculate streaks for digits 0 and 1
    const digit0Streak = this.calculateStreak(window, 0);
    const digit1Streak = this.calculateStreak(window, 1);

    let html = '';

    // Lookback Window Control
    html += `<div class="mb-4 p-3 bg-mint/40 rounded-lg">
      <label class="flex flex-col">
        <span class="text-sm font-medium text-navy/80 mb-1">Lookback Window (1-1000 ticks)</span>
        <div class="flex items-center gap-3">
          <input id="over1Lookback" type="range" min="1" max="1000" step="1" value="${this.lookbackWindow}" class="flex-1" />
          <input id="over1LookbackInput" type="number" min="1" max="1000" value="${this.lookbackWindow}" class="w-24 rounded-lg border border-teal/20 bg-white px-2 py-1 text-sm text-navy" />
        </div>
        <div class="text-xs text-navy/60 mt-1">Current window: ${lookback} ticks</div>
      </label>
    </div>`;

    // Cumulative Percentages
    html += `<div class="mb-4">
      <h3 class="text-sm font-semibold text-navy mb-2">Cumulative Percentages</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-mint/40 rounded-lg p-4">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-navy/80">Under 1 (0-1)</span>
            <span class="text-lg font-bold text-teal">${under1Percent}%</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-4">
            <div class="bg-teal h-4 rounded-full transition-all duration-300" style="width: ${under1Percent}%"></div>
          </div>
          <div class="text-xs text-navy/60 mt-1">${under1Count} / ${lookback} ticks</div>
        </div>
        <div class="bg-mint/40 rounded-lg p-4">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-navy/80">Over 1 (2-9)</span>
            <span class="text-lg font-bold text-leaf">${over1Percent}%</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-4">
            <div class="bg-leaf h-4 rounded-full transition-all duration-300" style="width: ${over1Percent}%"></div>
          </div>
          <div class="text-xs text-navy/60 mt-1">${over1Count} / ${lookback} ticks</div>
        </div>
      </div>
    </div>`;

    // Digit Breakdown (0 and 1)
    html += `<div class="mb-4">
      <h3 class="text-sm font-semibold text-navy mb-2">Digit Breakdown</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${this.renderDigitCard(0, digit0Percent, digit0Momentum, digit0Streak, lookback, digit0Count)}
        ${this.renderDigitCard(1, digit1Percent, digit1Momentum, digit1Streak, lookback, digit1Count)}
      </div>
    </div>`;

    // Streak Filter: Live Digit Runs
    html += `<div class="mb-4">
      <h3 class="text-sm font-semibold text-navy mb-2">Streak Filter: Live Digit Runs</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-mint/40 rounded-lg p-4">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-navy/80">Digit 0 Streak</span>
            <span class="text-lg font-bold ${digit0Streak >= 3 ? 'text-red-600' : 'text-navy'}">${digit0Streak > 0 ? `0 x ${digit0Streak}` : '0'}</span>
          </div>
          <div class="text-xs text-navy/60">Current consecutive occurrences</div>
        </div>
        <div class="bg-mint/40 rounded-lg p-4">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-navy/80">Digit 1 Streak</span>
            <span class="text-lg font-bold ${digit1Streak >= 3 ? 'text-red-600' : 'text-navy'}">${digit1Streak > 0 ? `1 x ${digit1Streak}` : '0'}</span>
          </div>
          <div class="text-xs text-navy/60">Current consecutive occurrences</div>
        </div>
      </div>
    </div>`;

    this.resultsContainer.innerHTML = html;

    // Add event listeners for lookback controls
    const lookbackSlider = document.getElementById('over1Lookback');
    const lookbackInput = document.getElementById('over1LookbackInput');

    if (lookbackSlider) {
      lookbackSlider.addEventListener('input', (e) => {
        this.lookbackWindow = Number(e.target.value) || 100;
        if (lookbackInput) {
          lookbackInput.value = this.lookbackWindow;
        }
        this.update();
      });
    }

    if (lookbackInput) {
      lookbackInput.addEventListener('change', (e) => {
        let value = Number(e.target.value) || 100;
        value = Math.max(1, Math.min(1000, value));
        this.lookbackWindow = value;
        e.target.value = value;
        if (lookbackSlider) {
          lookbackSlider.value = value;
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

