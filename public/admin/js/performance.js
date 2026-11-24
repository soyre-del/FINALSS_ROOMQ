// Response-time figures on the Reports page, measured by the server against
// the project's two-second target for core database operations.
document.addEventListener('DOMContentLoaded', () => {
  const api = window.RoomQApi;
  const byId = (id) => document.getElementById(id);
  const tableBody = byId('perfTableBody');
  const emptyState = byId('perfEmpty');
  const verdict = byId('perfVerdict');
  const refresh = byId('performanceRefresh');
  if (!tableBody) return;

  const ms = (value) => `${Number(value).toFixed(value < 10 ? 1 : 0)} ms`;

  function render(metrics) {
    byId('perfAverage').textContent = ms(metrics.averageMs);
    byId('perfP95').textContent = ms(metrics.p95Ms);
    byId('perfMax').textContent = ms(metrics.maxMs);
    byId('perfWithin').textContent = `${metrics.withinTargetPercent}%`;

    verdict.classList.toggle('is-error', !metrics.meetsTarget);
    verdict.textContent = metrics.totalRequests === 0
      ? 'No requests measured yet.'
      : metrics.meetsTarget
        ? `All ${metrics.totalRequests} measured requests answered within the ${metrics.targetMs / 1000}-second target.`
        : `${metrics.slowRequests} of ${metrics.totalRequests} requests took longer than the ${metrics.targetMs / 1000}-second target.`;

    tableBody.replaceChildren();
    metrics.routes.forEach((route) => {
      const row = document.createElement('tr');
      [
        route.route,
        String(route.count),
        ms(route.averageMs),
        ms(route.maxMs),
        String(route.slow)
      ].forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 0) {
          // Monospace so endpoints line up, but at the table's own text size:
          // this is functional content, not fine print.
          const code = document.createElement('span');
          code.className = 'font-monospace';
          code.textContent = value;
          cell.append(code);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      tableBody.append(row);
    });
    emptyState.hidden = metrics.routes.length > 0;
  }

  async function load() {
    try {
      render(await api.request('/api/performance'));
    } catch (error) {
      tableBody.replaceChildren();
      emptyState.hidden = false;
      emptyState.textContent = error.status === 401 || error.status === 403
        ? 'Sign in as an administrator to see response times.'
        : `Response times could not be loaded: ${error.message}`;
    }
  }

  if (refresh) refresh.addEventListener('click', load);
  load();
});
