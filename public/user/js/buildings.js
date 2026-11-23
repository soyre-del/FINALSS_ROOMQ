document.addEventListener('DOMContentLoaded', async () => {
  const directoryGrid = document.getElementById('buildingsDirectoryGrid');
  const searchInput = document.getElementById('buildingSearchInput');
  const totalCountEl = document.getElementById('buildingsTotalCount');
  const totalClassroomsEl = document.getElementById('buildingsTotalClassrooms');
  const summaryEl = document.getElementById('buildingsUtilizationSummary');
  const barAvail = document.getElementById('buildingsBarAvailable');
  const barOcc = document.getElementById('buildingsBarOccupied');
  const barRes = document.getElementById('buildingsBarReserved');
  const liveWindowEl = document.getElementById('buildingsLiveWindow');
  const windowLegendEl = document.getElementById('buildingsWindowLegend');

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
  if (liveWindowEl) liveWindowEl.textContent = formattedWindow;
  if (windowLegendEl) {
    windowLegendEl.replaceChildren();
    const dot = document.createElement('i');
    windowLegendEl.append(dot, document.createTextNode(` ${formattedWindow}`));
  }

  let allBuildings = [];
  let allRooms = [];

  function render(buildingsToRender) {
    if (!directoryGrid) return;
    directoryGrid.replaceChildren();

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filtered = buildingsToRender.filter((b) => {
      if (!query) return true;
      return b.name.toLowerCase().includes(query) || b.id.toLowerCase().includes(query);
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'dashboard-empty-state';
      empty.textContent = query
        ? `No buildings match "${searchInput.value}".`
        : 'No campus buildings found.';
      directoryGrid.append(empty);
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement('a');
      card.className = 'building-card';
      card.href = `classrooms.html?building=${encodeURIComponent(item.id)}`;

      const head = document.createElement('div');
      head.className = 'building-card-head';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'building-card-icon';
      const icon = document.createElement('i');
      icon.className = 'bi bi-building';
      iconWrap.append(icon);

      const badge = document.createElement('span');
      badge.className = 'building-open-badge';
      badge.textContent = item.total > 0 ? `${item.available} open` : 'Unmapped';
      head.append(iconWrap, badge);

      const title = document.createElement('h3');
      title.textContent = item.name;

      const sub = document.createElement('p');
      sub.className = 'building-card-sub';
      sub.textContent = item.total > 0
        ? `${item.floors} floor${item.floors === 1 ? '' : 's'} · ${item.total} mapped room${item.total === 1 ? '' : 's'}`
        : 'Floor plan not yet mapped';

      const bar = document.createElement('div');
      bar.className = 'building-availability-bar';
      const fill = document.createElement('div');
      fill.className = 'building-availability-fill';
      const pct = item.total > 0 ? Math.round((item.available / item.total) * 100) : 0;
      fill.style.width = `${pct}%`;
      bar.append(fill);

      card.append(head, title, sub, bar);
      directoryGrid.append(card);
    });
  }

  try {
    const [rooms, buildings] = await Promise.all([
      window.RoomQApi.request(`/api/availability?date=${localDate}&startTime=${startTime}&endTime=${endTime}`),
      window.RoomQApi.request('/api/buildings')
    ]);

    allRooms = Array.isArray(rooms) ? rooms : [];
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

    allBuildings = [...statsByBuilding.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const total = allRooms.length;
    const avail = allRooms.filter((r) => r.status === 'available').length;
    const occ = allRooms.filter((r) => r.status === 'occupied').length;
    const res = allRooms.filter((r) => r.status === 'reserved').length;

    if (totalCountEl) totalCountEl.textContent = String(allBuildings.length);
    if (totalClassroomsEl) totalClassroomsEl.textContent = String(total);
    if (summaryEl) {
      const pct = total > 0 ? Math.round((avail / total) * 100) : 0;
      summaryEl.textContent = `${pct}% available across ${allBuildings.length} buildings`;
    }

    if (total > 0) {
      if (barAvail) barAvail.style.width = `${(avail / total) * 100}%`;
      if (barOcc) barOcc.style.width = `${(occ / total) * 100}%`;
      if (barRes) barRes.style.width = `${(res / total) * 100}%`;
    }

    render(allBuildings);

    if (searchInput) {
      searchInput.addEventListener('input', () => render(allBuildings));
    }
  } catch (error) {
    if (directoryGrid) {
      directoryGrid.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'dashboard-empty-state';
      empty.textContent = `Buildings could not be loaded: ${error.message}`;
      directoryGrid.append(empty);
    }
  }
});
