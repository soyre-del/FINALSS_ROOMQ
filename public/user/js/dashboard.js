document.addEventListener('DOMContentLoaded', async () => {
  const buildingsGridEl = document.getElementById('userBuildingsGrid');
  if (!buildingsGridEl) {
    return;
  }
  const roomCardsEl = document.getElementById('userDashboardRoomCards');

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
    if (startTime >= '23:59') {
      startTime = '22:59';
    }
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

  const emptyEl = document.getElementById('userDashboardRoomEmpty');
  const buildingFilter = document.getElementById('userBuildingFilter');
  const searchInput = document.getElementById('userDashboardSearch');
  const statusButtons = [...document.querySelectorAll('#userStatusFilters [data-status-filter]')];
  const quickStatusCards = [...document.querySelectorAll('[data-quick-status]')];

  let allRooms = [];
  let activeStatusFilter = 'all';

  function formatRoomLabel(room) {
    if (room.roomNumber === null || room.roomNumber === undefined) {
      return room.name || 'Named room';
    }
    return room.name ? `Room ${room.roomNumber} · ${room.name}` : `Room ${room.roomNumber}`;
  }

  function statusOrder(status) {
    if (status === 'available') return 0;
    if (status === 'reserved') return 1;
    if (status === 'occupied') return 2;
    return 3;
  }

  function setActiveStatus(status) {
    activeStatusFilter = status;
    statusButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.statusFilter === status);
    });
    renderRooms();
  }

  function renderRooms() {
    if (!roomCardsEl) return;
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const selectedBuilding = buildingFilter ? buildingFilter.value : '';

    const filtered = allRooms
      .filter((room) => {
        if (activeStatusFilter !== 'all' && room.status !== activeStatusFilter) {
          return false;
        }
        if (selectedBuilding && room.buildingId !== selectedBuilding) {
          return false;
        }
        if (query) {
          const haystack = [
            formatRoomLabel(room),
            room.buildingName,
            room.floorLabel,
            ...(Array.isArray(room.facilities) ? room.facilities : [])
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        }
        return true;
      })
      .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.buildingName.localeCompare(b.buildingName));

    roomCardsEl.replaceChildren();
    const userTabBadgeRooms = document.getElementById('userTabBadgeRooms');
    if (userTabBadgeRooms) {
      userTabBadgeRooms.textContent = String(allRooms.length);
    }
    const visible = filtered.slice(0, 8);
    visible.forEach((room) => {
      const card = document.createElement('a');
      card.className = `room-card room-${room.status}`;
      card.href = `classrooms.html?building=${encodeURIComponent(room.buildingId)}&floor=${encodeURIComponent(room.floorId)}&room=${encodeURIComponent(room.regionId)}`;

      const top = document.createElement('div');
      top.className = 'room-card-top';

      const symbol = document.createElement('span');
      symbol.className = 'room-symbol';
      symbol.textContent = room.roomNumber === null ? 'R' : String(room.roomNumber).slice(-2);

      const status = document.createElement('span');
      status.className = 'room-status';
      status.textContent = room.status[0].toUpperCase() + room.status.slice(1);
      top.append(symbol, status);

      const title = document.createElement('h3');
      title.textContent = formatRoomLabel(room);

      const location = document.createElement('p');
      location.textContent = `${room.buildingName} · ${room.floorLabel}`;

      const meta = document.createElement('div');
      meta.className = 'room-card-meta';
      if (room.capacity !== null && room.capacity !== undefined) {
        const capChip = document.createElement('span');
        capChip.className = 'room-meta-chip';
        capChip.textContent = `${room.capacity} seats`;
        meta.append(capChip);
      }
      if (Array.isArray(room.facilities) && room.facilities.length) {
        const facChip = document.createElement('span');
        facChip.className = 'room-meta-chip';
        facChip.textContent = room.facilities.slice(0, 2).join(', ');
        meta.append(facChip);
      }

      const details = document.createElement('small');
      details.textContent = room.schedules.length
        ? `${room.schedules[0].course || 'Room reservation'} · ${window.RoomQTime.format(room.schedules[0].startTime)}–${window.RoomQTime.format(room.schedules[0].endTime)}`
        : 'Open now · Click to inspect or reserve';

      const cta = document.createElement('span');
      cta.className = 'room-card-cta';
      cta.textContent = room.status === 'available' ? 'Reserve on floor plan →' : 'View schedule →';

      card.append(top, title, location);
      if (meta.childElementCount > 0) {
        card.append(meta);
      }
      card.append(details, cta);
      roomCardsEl.append(card);
    });

    emptyEl.hidden = visible.length > 0;
    if (!visible.length) {
      emptyEl.textContent = allRooms.length
        ? 'No classrooms match your current filter. Try clearing the search or selecting another building.'
        : 'No mapped classrooms are available yet.';
    }
  }

  function renderBuildings(buildings, rooms) {
    buildingsGridEl.replaceChildren();
    const userTabBadgeBuildings = document.getElementById('userTabBadgeBuildings');
    if (userTabBadgeBuildings) {
      userTabBadgeBuildings.textContent = String(buildings.length);
    }
    if (!buildings.length && !rooms.length) {
      const empty = document.createElement('div');
      empty.className = 'dashboard-empty-state';
      empty.textContent = 'No campus buildings found.';
      buildingsGridEl.append(empty);
      return;
    }

    const statsByBuilding = new Map();
    buildings.forEach((b) => {
      statsByBuilding.set(b.id, {
        id: b.id,
        name: b.name,
        floors: Array.isArray(b.floors) ? b.floors.length : 0,
        total: 0,
        available: 0
      });
    });

    rooms.forEach((room) => {
      if (!statsByBuilding.has(room.buildingId)) {
        statsByBuilding.set(room.buildingId, {
          id: room.buildingId,
          name: room.buildingName || room.buildingId,
          floors: 1,
          total: 0,
          available: 0
        });
      }
      const entry = statsByBuilding.get(room.buildingId);
      entry.total += 1;
      if (room.status === 'available') {
        entry.available += 1;
      }
    });

    const sorted = [...statsByBuilding.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    sorted.forEach((item) => {
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
      buildingsGridEl.append(card);
    });
  }

  // View switcher logic
  const userViewButtons = [...document.querySelectorAll('.dashboard-view-btn[data-view-target]')];
  const userViewPanes = {
    'user-buildings': document.getElementById('pane-user-buildings'),
    'user-guide': document.getElementById('pane-user-guide')
  };

  function switchUserView(targetKey, updateHash = false) {
    if (!userViewPanes[targetKey]) return;
    userViewButtons.forEach((btn) => {
      const match = btn.dataset.viewTarget === targetKey;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    Object.keys(userViewPanes).forEach((key) => {
      if (userViewPanes[key]) {
        userViewPanes[key].classList.toggle('active', key === targetKey);
      }
    });
    if (updateHash) {
      history.replaceState(null, '', targetKey === 'user-guide' ? '#guide' : '#buildings');
    }
  }

  function handleUserHash() {
    const hash = window.location.hash.toLowerCase();
    if (hash.includes('guide')) {
      switchUserView('user-guide', false);
    } else if (hash.includes('building')) {
      switchUserView('user-buildings', false);
    }
  }

  userViewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchUserView(btn.dataset.viewTarget, true);
    });
  });

  window.addEventListener('hashchange', handleUserHash);
  handleUserHash();

  statusButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveStatus(btn.dataset.statusFilter || 'all');
    });
  });

  if (buildingFilter) {
    buildingFilter.addEventListener('change', renderRooms);
  }
  if (searchInput) {
    searchInput.addEventListener('input', renderRooms);
  }

  try {
    const [rooms, buildings, session] = await Promise.all([
      window.RoomQApi.request(`/api/availability?date=${localDate}&startTime=${startTime}&endTime=${endTime}`),
      window.RoomQApi.request('/api/buildings'),
      window.RoomQApi.request('/api/me').catch(() => ({ authenticated: false, user: null }))
    ]);

    allRooms = Array.isArray(rooms) ? rooms : [];
    const safeBuildings = Array.isArray(buildings) ? buildings : [];

    if (buildingFilter) {
      safeBuildings.forEach((b) => {
        buildingFilter.append(new Option(b.name, b.id));
      });
    }

    const total = allRooms.length;
    const avail = allRooms.filter((r) => r.status === 'available').length;
    const occ = allRooms.filter((r) => r.status === 'occupied').length;
    const res = allRooms.filter((r) => r.status === 'reserved').length;

    const heroAvail = document.getElementById('userHeroAvailable');
    const heroTotal = document.getElementById('userHeroTotalRooms');
    const heroSummary = document.getElementById('userHeroSummaryText');
    if (heroAvail) heroAvail.textContent = String(avail);
    if (heroTotal) heroTotal.textContent = String(total);
    if (heroSummary) {
      const pct = total > 0 ? Math.round((avail / total) * 100) : 0;
      heroSummary.textContent = `${pct}% available across ${safeBuildings.length} buildings`;
    }

    if (total > 0) {
      const bAvail = document.getElementById('userHeroBarAvailable');
      const bOcc = document.getElementById('userHeroBarOccupied');
      const bRes = document.getElementById('userHeroBarReserved');
      if (bAvail) bAvail.style.width = `${(avail / total) * 100}%`;
      if (bOcc) bOcc.style.width = `${(occ / total) * 100}%`;
      if (bRes) bRes.style.width = `${(res / total) * 100}%`;
    }

    const statAvail = document.getElementById('userStatAvailable');
    const statOcc = document.getElementById('userStatOccupied');
    const statRes = document.getElementById('userStatReserved');
    if (statAvail) statAvail.textContent = String(avail);
    if (statOcc) statOcc.textContent = String(occ);
    if (statRes) statRes.textContent = String(res);

    // Update Account CTA Banner based on auth state
    const bannerIcon = document.getElementById('userAccountBannerIcon');
    const bannerTitle = document.getElementById('userAccountBannerTitle');
    const bannerText = document.getElementById('userAccountBannerText');
    const bannerBtn = document.getElementById('userAccountBannerBtn');
    if (session && session.authenticated && session.user && bannerText && bannerBtn) {
      if (bannerIcon) bannerIcon.innerHTML = '<i class="bi bi-patch-check-fill text-primary"></i>';
      if (bannerTitle) bannerTitle.textContent = `Signed in as ${session.user.username}`;
      bannerText.textContent = "Your account is verified. You're ready to reserve any open classroom directly from the interactive floor plan.";
      bannerBtn.innerHTML = '<i class="bi bi-door-open"></i> Reserve a Classroom';
      bannerBtn.href = 'classrooms.html';
    }

    renderRooms();
    renderBuildings(safeBuildings, allRooms);
  } catch (error) {
    roomCardsEl.replaceChildren();
    emptyEl.hidden = false;
    emptyEl.textContent = `Live availability could not be loaded: ${error.message}`;
  }
});
