(function() {
  const wsApi = window.AppWS;
  if (!wsApi) return;

  const toggleBtn = document.getElementById('matchesAnalysisToggle');
  const contentEl = document.getElementById('matchesAnalysisContent');
  const summaryEl = document.getElementById('matchesAnalysisSummary');
  const windows = [50, 200, 600, 1000];

  let expanded = false;

  function setExpanded(state) {
    expanded = state;
    if (!contentEl) return;
    contentEl.classList.toggle('hidden', !expanded);
    if (toggleBtn) toggleBtn.textContent = expanded ? 'Collapse' : 'Expand';
    if (expanded) render();
  }

  function formatPercentage(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value.toFixed(1)}%`;
  }

  function computeStatsForWindow(queue, size) {
    const slice = queue.slice(-Math.min(size, queue.length));
    const stats = Array.from({ length: 8 }, () => ({ wins: 0, losses: 0, total: 0 }));
    if (slice.length < 2) {
      return { stats, currentDigits: [], observations: 0 };
    }
    const counts = Array.from({ length: 10 }, () => 0);
    const rankingFromCounts = () => counts
      .map((count, digit) => ({ digit, count }))
      .sort((a, b) => b.count - a.count || a.digit - b.digit);

    for (let i = 0; i < slice.length - 1; i++) {
      const current = slice[i];
      if (!(current >= 0 && current <= 9)) continue;
      counts[current] += 1;
      const ordered = rankingFromCounts();
      const top8 = ordered.slice(0, 8);
      const nextDigit = slice[i + 1];
      for (let rank = 0; rank < top8.length; rank++) {
        const info = top8[rank];
        if (!info || info.count === 0) continue;
        const bucket = stats[rank];
        bucket.total += 1;
        if (nextDigit === info.digit) bucket.wins += 1;
        else bucket.losses += 1;
      }
    }

    const finalRanking = rankingFromCounts().slice(0, 8).map((item) => item.digit);
    return { stats, currentDigits: finalRanking, observations: slice.length };
  }

  function render() {
    if (!summaryEl) return;
    const symbol = wsApi.getCurrentSymbol();
    const queue = wsApi.getDigitQueue(symbol) || [];
    if (!symbol || queue.length < 10) {
      summaryEl.innerHTML = '<div class="text-navy/70">Not enough data yet. Waiting for more ticks…</div>';
      return;
    }

    const sections = [];
    sections.push(`<div class="text-navy/90">Current symbol: <span class="font-semibold">${symbol}</span></div>`);

    for (const size of windows) {
      const { stats, currentDigits, observations } = computeStatsForWindow(queue, size);
      const winRates = stats.map((stat) => (stat.total > 0 ? (stat.wins * 100) / stat.total : NaN));
      const bestWinRate = winRates.reduce((max, rate) => (Number.isFinite(rate) && rate > max ? rate : max), -Infinity);
      sections.push(`<div class="border border-mint/80 rounded-lg overflow-hidden">
        <div class="bg-mint/50 px-3 py-2 text-sm font-semibold text-navy">Look-back window: ${Math.min(size, queue.length)} ticks</div>
        <div class="px-3 py-2 text-xs text-navy/70">Historical samples: ${observations > 1 ? observations - 1 : 0}</div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr class="text-xs uppercase tracking-wide text-navy/60">
                <th class="px-2 py-1">Rank</th>
                <th class="px-2 py-1">Current Digit</th>
                <th class="px-2 py-1">Wins</th>
                <th class="px-2 py-1">Losses</th>
                <th class="px-2 py-1">Total</th>
                <th class="px-2 py-1">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              ${stats.map((stat, idx) => {
                const total = stat.total;
                const winRate = winRates[idx];
                const digit = currentDigits[idx] != null ? currentDigits[idx] : '—';
                const highlight = Number.isFinite(winRate) && winRate === bestWinRate;
                const rowClass = highlight ? 'bg-mint/70 font-semibold' : 'bg-mint/40';
                return `<tr class="${rowClass}">
                  <td class="px-2 py-1 rounded-l-md">${idx + 1}</td>
                  <td class="px-2 py-1">${digit}</td>
                  <td class="px-2 py-1 text-leaf">${stat.wins}</td>
                  <td class="px-2 py-1 text-red-600">${stat.losses}</td>
                  <td class="px-2 py-1">${total}</td>
                  <td class="px-2 py-1 rounded-r-md">${total > 0 ? formatPercentage(winRate) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`);
    }

    summaryEl.innerHTML = sections.join('');
  }

  function handleTickUpdate() {
    if (expanded) render();
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setExpanded(!expanded);
    });
  }

  document.addEventListener('ws:tick', handleTickUpdate);
  document.addEventListener('ws:market-subscribed', handleTickUpdate);
  document.addEventListener('ws:digit-stats', handleTickUpdate);

  setExpanded(false);
})();

