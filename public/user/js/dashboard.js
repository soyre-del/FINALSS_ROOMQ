document.addEventListener('DOMContentLoaded', async () => {
  const localNow = new Date();
  const localDate = new Date(localNow.getTime() - localNow.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const toTime = (date) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  let startTime = toTime(localNow);
  const end = new Date(localNow.getTime() + 60 * 60000);
  let endTime = toTime(end);
  if (end.toDateString() !== localNow.toDateString()) {
    if (startTime >= '23:59') startTime = '22:59';
    endTime = '23:59';
  }

  const formattedWindow = `${window.RoomQTime.format(startTime)}–${window.RoomQTime.format(endTime)}`;
  const liveWindowEl = document.getElementById('userLiveWindow');
  if (liveWindowEl) {
    liveWindowEl.textContent = formattedWindow;
  }
  const windowLegendEl = document.getElementById('userWindowLegend');
  if (windowLegendEl) {
    windowLegendEl.replaceChildren();
    const dot = document.createElement('i');
    windowLegendEl.append(dot, document.createTextNode(` ${formattedWindow}`));
  }

  const tableBody = document.getElementById('userBuildingStatsTableBody');
  const heroAvail = document.getElementById('userHeroAvailable');
  const heroTotal = document.getElementById('userHeroTotalRooms');
  const heroSummary = document.getElementById('userHeroSummaryText');
  const bAvail = document.getElementById('userHeroBarAvailable');
  const bOcc = document.getElementById('userHeroBarOccupied');
  const bRes = document.getElementById('userHeroBarReserved');

  const statAvail = document.getElementById('userStatAvailable');
  const statAvailMeta = document.getElementById('userStatAvailableMeta');
  const statOcc = document.getElementById('userStatOccupied');
  const statRes = document.getElementById('userStatReserved');
  const statUtilization = document.getElementById('userStatUtilization');

  const insightTotalRooms = document.getElementById('insightTotalRooms');
  const insightTotalRoomsMeta = document.getElementById('insightTotalRoomsMeta');
  const insightTopBuilding = document.getElementById('insightTopBuilding');
  const insightTopBuildingMeta = document.getElementById('insightTopBuildingMeta');
  const insightUtilizationRate = document.getElementById('insightUtilizationRate');
  const insightUtilizationMeta = document.getElementById('insightUtilizationMeta');

  try {
    const [rooms, buildings] = await Promise.all([
      window.RoomQApi.request(`/api/availability?date=${localDate}&startTime=${startTime}&endTime=${endTime}`),
      window.RoomQApi.request('/api/buildings')
    ]);

    const allRooms = Array.isArray(rooms) ? rooms : [];
    const safeBuildings = Array.isArray(buildings) ? buildings : [];

    const statsByBuilding = new Map();
    safeBuildings.forEach((b) => {
      statsByBuilding.set(b.id, {
        id: b.id,
        name: b.name,
        floors: Array.isArray(b.floors) ? b.floors.length : 0,
        total: 0,
        available: 0,
        occupied: 0,
        reserved: 0
      });
    });

    allRooms.forEach((room) => {
      if (!statsByBuilding.has(room.buildingId)) {
        statsByBuilding.set(room.buildingId, {
          id: room.buildingId,
          name: room.buildingName || room.buildingId,
          floors: 1,
          total: 0,
          available: 0,
          occupied: 0,
          reserved: 0
        });
      }
      const entry = statsByBuilding.get(room.buildingId);
      entry.total += 1;
      if (room.status === 'available') entry.available += 1;
      else if (room.status === 'occupied') entry.occupied += 1;
      else if (room.status === 'reserved') entry.reserved += 1;
    });

    const buildingList = [...statsByBuilding.values()].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name)
    );

    const total = allRooms.length;
    const avail = allRooms.filter((r) => r.status === 'available').length;
    const occ = allRooms.filter((r) => r.status === 'occupied').length;
    const res = allRooms.filter((r) => r.status === 'reserved').length;
    const inUse = occ + res;
    const utilizationPct = total > 0 ? Math.round((inUse / total) * 100) : 0;
    const availPct = total > 0 ? Math.round((avail / total) * 100) : 0;

    // Populate Hero Pulse
    if (heroAvail) heroAvail.textContent = String(avail);
    if (heroTotal) heroTotal.textContent = String(total);
    if (heroSummary) {
      heroSummary.textContent = `${availPct}% available across ${buildingList.length} campus facilities`;
    }
    if (total > 0) {
      if (bAvail) bAvail.style.width = `${(avail / total) * 100}%`;
      if (bOcc) bOcc.style.width = `${(occ / total) * 100}%`;
      if (bRes) bRes.style.width = `${(res / total) * 100}%`;
    }

    // Populate KPI Cards
    if (statAvail) statAvail.textContent = String(avail);
    if (statAvailMeta) statAvailMeta.textContent = `${availPct}% of total classrooms`;
    if (statOcc) statOcc.textContent = String(occ);
    if (statRes) statRes.textContent = String(res);
    if (statUtilization) statUtilization.textContent = `${utilizationPct}%`;

    // Populate Statistical Breakdown Table
    if (tableBody) {
      tableBody.replaceChildren();
      buildingList.forEach((b) => {
        const tr = document.createElement('tr');

        const bInUse = b.occupied + b.reserved;
        const bPct = b.total > 0 ? Math.round((bInUse / b.total) * 100) : 0;
        const occPct = b.total > 0 ? (b.occupied / b.total) * 100 : 0;
        const resPct = b.total > 0 ? (b.reserved / b.total) * 100 : 0;

        tr.innerHTML = `
          <td><strong>${b.name}</strong></td>
          <td><span class="text-muted small">${b.floors} fl</span></td>
          <td><span class="fw-medium">${b.total}</span></td>
          <td><span class="badge bg-success-subtle text-success border border-success-subtle">${b.available} open</span></td>
          <td><span class="badge bg-primary-subtle text-primary border border-primary-subtle">${b.occupied} in class</span></td>
          <td><span class="badge bg-warning-subtle text-warning border border-warning-subtle">${b.reserved} reserved</span></td>
          <td>
            <div style="height: 6px; background-color: #e2e8f0; border-radius: 999px; overflow: hidden; display: flex; margin-bottom: 4px;">
              <div style="width: ${occPct}%; background-color: var(--rq-primary);"></div>
              <div style="width: ${resPct}%; background-color: var(--rq-warning);"></div>
            </div>
            <span class="small text-muted font-monospace">${bPct}% in use</span>
          </td>
          <td>
            <a href="classrooms.html?building=${encodeURIComponent(b.id)}" class="btn btn-outline-primary btn-sm py-0 px-2" style="font-size: 0.78rem" title="View floor plan for ${b.name}">
              <i class="bi bi-map"></i> Floor plan
            </a>
          </td>
        `;
        tableBody.append(tr);
      });
    }

    // Populate Insight Cards
    if (insightTotalRooms) {
      insightTotalRooms.textContent = `${total} Total Classrooms`;
    }
    if (insightTotalRoomsMeta) {
      const totalFloors = buildingList.reduce((acc, curr) => acc + curr.floors, 0);
      insightTotalRoomsMeta.textContent = `Across ${buildingList.length} buildings and ${totalFloors} mapped floors`;
    }

    // Find building with highest availability
    const bestBuilding = [...buildingList].sort((a, b) => b.available - a.available)[0];
    if (bestBuilding && insightTopBuilding) {
      insightTopBuilding.textContent = bestBuilding.name;
    }
    if (bestBuilding && insightTopBuildingMeta) {
      insightTopBuildingMeta.textContent = `${bestBuilding.available} of ${bestBuilding.total} classrooms currently free`;
    }

    if (insightUtilizationRate) {
      insightUtilizationRate.textContent = `${utilizationPct}% Active Occupancy`;
    }
    if (insightUtilizationMeta) {
      insightUtilizationMeta.textContent = `${inUse} of ${total} classrooms in session or reserved`;
    }
  } catch (error) {
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Failed to load live statistics: ${error.message}</td></tr>`;
    }
  }
});
