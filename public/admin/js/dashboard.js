document.addEventListener('DOMContentLoaded', async () => {
  const totalClassesEl = document.getElementById('dashboardTotalClasses');
  if (!totalClassesEl) {
    return;
  }

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
  const liveWindowEl = document.getElementById('dashboardLiveWindow');
  if (liveWindowEl) {
    liveWindowEl.textContent = formattedWindow;
  }
  const legendWindowEl = document.getElementById('dashboardAvailabilityWindowLegend');
  if (legendWindowEl) {
    legendWindowEl.replaceChildren();
    const dot = document.createElement('i');
    legendWindowEl.append(dot, document.createTextNode(` ${formattedWindow}`));
  }

  const cardsContainer = document.getElementById('dashboardAvailabilityCards');
  const emptyEl = document.getElementById('dashboardAvailabilityEmpty');
  const utilizationList = document.getElementById('buildingUtilizationList');
  const todayScheduleList = document.getElementById('dashboardTodayScheduleList');
  const activityList = document.getElementById('dashboardActivityList');
  const buildingFilter = document.getElementById('dashboardBuildingFilter');
  const searchInput = document.getElementById('dashboardSearchInput');
  const statusButtons = [...document.querySelectorAll('#dashboardStatusFilters [data-status-filter]')];

  let allRooms = [];
  let activeStatusFilter = 'all';

  function appliesOnDate(schedule, date) {
    if (schedule.recurrence === 'once') {
      return schedule.date === date;
    }
    if (schedule.startDate && date < schedule.startDate) {
      return false;
    }
    if (schedule.endDate && date > schedule.endDate) {
      return false;
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.includes(weekday);
  }

  function formatRoomLabel(room) {
    if (room.roomNumber === null || room.roomNumber === undefined) {
      return room.name || 'Named room';
    }
    return room.name ? `Room ${room.roomNumber} · ${room.name}` : `Room ${room.roomNumber}`;
  }

  function renderRooms() {
    if (!cardsContainer) return;
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const selectedBuilding = buildingFilter ? buildingFilter.value : '';

    const filtered = allRooms.filter((room) => {
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
    });

    cardsContainer.replaceChildren();
    const tabBadgeRooms = document.getElementById('tabBadgeRooms');
    if (tabBadgeRooms) {
      tabBadgeRooms.textContent = String(allRooms.length);
    }
    const displayRooms = filtered.slice(0, 8);
    displayRooms.forEach((room) => {
      const card = document.createElement('a');
      card.className = `room-card room-${room.status}`;
      card.href = `/admin/classrooms.html?building=${encodeURIComponent(room.buildingId)}&floor=${encodeURIComponent(room.floorId)}&room=${encodeURIComponent(room.regionId)}`;

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
        : 'Open during this time range';

      card.append(top, title, location);
      if (meta.childElementCount > 0) {
        card.append(meta);
      }
      card.append(details);
      cardsContainer.append(card);
    });

    emptyEl.hidden = displayRooms.length > 0;
    if (!displayRooms.length) {
      emptyEl.textContent = allRooms.length
        ? 'No classrooms match the current filter criteria.'
        : 'No classroom records are available.';
    }
  }

  function renderBuildingUtilization(buildings, rooms) {
    const tabBadgeBuildings = document.getElementById('tabBadgeBuildings');
    if (tabBadgeBuildings) {
      tabBadgeBuildings.textContent = String(buildings.length);
    }
    utilizationList.replaceChildren();
    if (!buildings.length && !rooms.length) {
      const empty = document.createElement('div');
      empty.className = 'dashboard-empty-state';
      empty.textContent = 'No buildings or classroom records found.';
      utilizationList.append(empty);
      return;
    }

    const grouped = new Map();
    buildings.forEach((b) => {
      grouped.set(b.id, {
        id: b.id,
        name: b.name,
        total: 0,
        occupied: 0,
        reserved: 0,
        available: 0
      });
    });

    rooms.forEach((room) => {
      if (!grouped.has(room.buildingId)) {
        grouped.set(room.buildingId, {
          id: room.buildingId,
          name: room.buildingName || room.buildingId,
          total: 0,
          occupied: 0,
          reserved: 0,
          available: 0
        });
      }
      const entry = grouped.get(room.buildingId);
      entry.total += 1;
      if (room.status === 'occupied') entry.occupied += 1;
      else if (room.status === 'reserved') entry.reserved += 1;
      else entry.available += 1;
    });

    const sorted = [...grouped.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    sorted.forEach((item) => {
      const row = document.createElement('a');
      row.className = 'utilization-row';
      row.href = `classrooms.html?building=${encodeURIComponent(item.id)}`;

      const inUse = item.occupied + item.reserved;
      const pct = item.total > 0 ? Math.round((inUse / item.total) * 100) : 0;
      const occPct = item.total > 0 ? (item.occupied / item.total) * 100 : 0;
      const resPct = item.total > 0 ? (item.reserved / item.total) * 100 : 0;

      const top = document.createElement('div');
      top.className = 'utilization-row-top';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'utilization-building-name';
      nameSpan.textContent = item.name;
      const pctSpan = document.createElement('span');
      pctSpan.className = 'utilization-pct';
      pctSpan.textContent = item.total > 0 ? `${pct}% in use` : 'No rooms mapped';
      top.append(nameSpan, pctSpan);

      const track = document.createElement('div');
      track.className = 'utilization-bar-track';
      const occBar = document.createElement('div');
      occBar.className = 'utilization-bar-occupied';
      occBar.style.width = `${occPct}%`;
      const resBar = document.createElement('div');
      resBar.className = 'utilization-bar-reserved';
      resBar.style.width = `${resPct}%`;
      track.append(occBar, resBar);

      const meta = document.createElement('div');
      meta.className = 'utilization-meta';
      const leftMeta = document.createElement('span');
      leftMeta.textContent = `${item.available} available · ${item.occupied} occupied · ${item.reserved} reserved`;
      const rightMeta = document.createElement('span');
      rightMeta.textContent = `${item.total} total`;
      meta.append(leftMeta, rightMeta);

      row.append(top, track, meta);
      utilizationList.append(row);
    });
  }

  function renderTodaySchedules(schedules, roomsById) {
    todayScheduleList.replaceChildren();
    const todayItems = schedules
      .filter((item) => appliesOnDate(item, localDate))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const tabBadgeSchedules = document.getElementById('tabBadgeSchedules');
    if (tabBadgeSchedules) {
      tabBadgeSchedules.textContent = String(todayItems.length);
    }

    if (!todayItems.length) {
      const empty = document.createElement('div');
      empty.className = 'dashboard-empty-state';
      empty.textContent = 'No classes or room reservations scheduled for today.';
      todayScheduleList.append(empty);
      return;
    }

    todayItems.slice(0, 6).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'today-schedule-item';

      const timePill = document.createElement('div');
      timePill.className = `schedule-time-pill${item.kind === 'reservation' ? ' is-reservation' : ''}`;
      timePill.textContent = `${window.RoomQTime.format(item.startTime)}\n${window.RoomQTime.format(item.endTime)}`;

      const info = document.createElement('div');
      info.className = 'today-schedule-info';

      const title = document.createElement('p');
      title.className = 'today-schedule-title';
      title.textContent = item.kind === 'reservation'
        ? 'Room Reservation'
        : `${item.course} · ${item.section}`;

      const sub = document.createElement('p');
      sub.className = 'today-schedule-sub';
      sub.textContent = item.kind === 'reservation'
        ? 'One-time space reservation'
        : `Instructor: ${item.instructor || 'Unassigned'}`;

      const roomTag = document.createElement('span');
      const matchedRoom = item.classroomId ? roomsById.get(item.classroomId) : null;
      if (matchedRoom) {
        roomTag.className = 'schedule-room-tag';
        roomTag.textContent = `${matchedRoom.buildingName} · ${formatRoomLabel(matchedRoom)}`;
      } else if (item.classroomId) {
        roomTag.className = 'schedule-room-tag';
        roomTag.textContent = item.classroomId;
      } else {
        roomTag.className = 'schedule-room-tag is-unassigned';
        roomTag.textContent = 'Unassigned room';
      }

      info.append(title, sub, roomTag);
      row.append(timePill, info);
      todayScheduleList.append(row);
    });
  }

  function formatActivitySummary(item) {
    const actionMap = {
      created: 'created',
      updated: 'updated',
      deleted: 'deleted',
      registered: 'registered',
      signed_in: 'signed in',
      signed_out: 'signed out'
    };
    const verb = actionMap[item.action] || item.action;
    if (item.entityType === 'session') {
      return `${verb} to the portal`;
    }
    const target = item.entityId ? `${item.entityType} #${item.entityId}` : item.entityType;
    return `${verb} ${target}`;
  }

  function getActivityIcon(action) {
    if (action === 'created') return 'bi-plus-circle';
    if (action === 'updated') return 'bi-pencil-square';
    if (action === 'deleted') return 'bi-trash';
    if (action === 'signed_in') return 'bi-box-arrow-in-right';
    if (action === 'signed_out') return 'bi-box-arrow-right';
    return 'bi-activity';
  }

  async function loadRecentActivity() {
    if (!activityList) return;
    try {
      const data = await window.RoomQApi.request('/api/activity-logs?limit=5');
      const items = Array.isArray(data.items) ? data.items : [];
      const tabBadgeActivity = document.getElementById('tabBadgeActivity');
      if (tabBadgeActivity) {
        tabBadgeActivity.textContent = String(items.length);
      }
      activityList.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'dashboard-empty-state';
        empty.textContent = 'No recent system activities recorded yet.';
        activityList.append(empty);
        return;
      }

      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'activity-feed-item';

        const iconWrap = document.createElement('span');
        iconWrap.className = `activity-badge-icon action-${item.action}`;
        const icon = document.createElement('i');
        icon.className = `bi ${getActivityIcon(item.action)}`;
        iconWrap.append(icon);

        const body = document.createElement('div');
        body.className = 'activity-feed-body';

        const text = document.createElement('p');
        text.className = 'activity-feed-text';
        const actor = document.createElement('strong');
        actor.textContent = item.actorUsername || 'System';
        text.append(actor, document.createTextNode(` ${formatActivitySummary(item)}`));

        const time = document.createElement('span');
        time.className = 'activity-feed-time';
        const dateObj = item.createdAt ? new Date(item.createdAt.replace(' ', 'T') + 'Z') : null;
        time.textContent = dateObj && Number.isFinite(dateObj.getTime())
          ? dateObj.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : item.createdAt || '';

        body.append(text, time);
        row.append(iconWrap, body);
        activityList.append(row);
      });
    } catch (error) {
      activityList.replaceChildren();
      const box = document.createElement('div');
      box.className = 'dashboard-empty-state';
      if (error.status === 401 || error.status === 403) {
        const msg = document.createElement('p');
        msg.className = 'mb-2';
        msg.textContent = 'Sign in with an administrator account to inspect the live audit log.';
        const btn = document.createElement('a');
        btn.className = 'btn btn-sm btn-outline-primary';
        btn.href = '../user/login.html?returnTo=%2Fadmin%2Fdashboard.html';
        btn.textContent = 'Sign in as Administrator';
        box.append(msg, btn);
      } else {
        box.textContent = `Recent activity unavailable: ${error.message}`;
      }
      activityList.append(box);
    }
  }

  // View switcher logic
  const viewButtons = [...document.querySelectorAll('.dashboard-view-btn[data-view-target]')];
  const viewPanes = {
    schedules: document.getElementById('pane-schedules'),
    utilization: document.getElementById('pane-utilization'),
    activity: document.getElementById('pane-activity')
  };

  function switchDashboardView(targetKey) {
    if (!viewPanes[targetKey]) return;
    viewButtons.forEach((btn) => {
      const match = btn.dataset.viewTarget === targetKey;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });
    Object.keys(viewPanes).forEach((key) => {
      if (viewPanes[key]) {
        viewPanes[key].classList.toggle('active', key === targetKey);
      }
    });
  }

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchDashboardView(btn.dataset.viewTarget);
    });
  });

  const kpiToday = document.getElementById('dashboardKpiToday');
  if (kpiToday) {
    kpiToday.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      switchDashboardView('schedules');
      document.querySelector('.dashboard-views-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Filter event bindings
  statusButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeStatusFilter = btn.dataset.statusFilter || 'all';
      statusButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderRooms();
    });
  });

  if (buildingFilter) {
    buildingFilter.addEventListener('change', renderRooms);
  }
  if (searchInput) {
    searchInput.addEventListener('input', renderRooms);
  }

  try {
    const [stats, rooms, schedules, buildings] = await Promise.all([
      window.RoomQApi.request(`/api/dashboard?date=${encodeURIComponent(localDate)}`),
      window.RoomQApi.request(`/api/availability?date=${localDate}&startTime=${startTime}&endTime=${endTime}`),
      window.RoomQApi.request('/api/schedules'),
      window.RoomQApi.request('/api/buildings')
    ]);

    allRooms = Array.isArray(rooms) ? rooms : [];
    const safeBuildings = Array.isArray(buildings) ? buildings : [];
    const safeSchedules = Array.isArray(schedules) ? schedules : [];

    // Populate building dropdown
    if (buildingFilter) {
      safeBuildings.forEach((b) => {
        buildingFilter.append(new Option(b.name, b.id));
      });
    }

    // Availability counts
    const totalRooms = allRooms.length || stats.totalClassrooms || 0;
    const availCount = allRooms.filter((r) => r.status === 'available').length;
    const occCount = allRooms.filter((r) => r.status === 'occupied').length;
    const resCount = allRooms.filter((r) => r.status === 'reserved').length;

    // Faculty count from active class schedules
    const uniqueFaculty = new Set(
      safeSchedules
        .filter((s) => s.kind === 'class' && s.instructor && s.instructor.trim())
        .map((s) => s.instructor.trim().toLowerCase())
    );

    // Update Hero Pulse
    const heroBuildings = document.getElementById('dashboardHeroBuildings');
    const heroRooms = document.getElementById('dashboardHeroRooms');
    const heroUtilText = document.getElementById('dashboardHeroUtilizationText');
    if (heroBuildings) heroBuildings.textContent = String(safeBuildings.length);
    if (heroRooms) heroRooms.textContent = String(totalRooms);
    if (heroUtilText) {
      const availPct = totalRooms > 0 ? Math.round((availCount / totalRooms) * 100) : 0;
      heroUtilText.textContent = `${availCount}/${totalRooms} open (${availPct}%)`;
    }
    if (totalRooms > 0) {
      const barAvail = document.getElementById('heroBarAvailable');
      const barOcc = document.getElementById('heroBarOccupied');
      const barRes = document.getElementById('heroBarReserved');
      if (barAvail) barAvail.style.width = `${(availCount / totalRooms) * 100}%`;
      if (barOcc) barOcc.style.width = `${(occCount / totalRooms) * 100}%`;
      if (barRes) barRes.style.width = `${(resCount / totalRooms) * 100}%`;
    }

    // Update KPI Cards
    const totalClassroomsEl = document.getElementById('dashboardTotalClassrooms');
    const totalBuildingsMetaEl = document.getElementById('dashboardTotalBuildingsMeta');
    const availableNowEl = document.getElementById('dashboardAvailableNow');
    const occupancyMetaEl = document.getElementById('dashboardOccupancyMeta');
    const totalFacultyEl = document.getElementById('dashboardTotalFaculty');
    const totalConflictsEl = document.getElementById('dashboardTotalConflicts');
    const conflictsCardEl = document.getElementById('dashboardConflictsCard');
    const topbarConflictPill = document.getElementById('topbarConflictPill');
    const topbarConflictLabel = document.getElementById('topbarConflictLabel');

    if (totalClassroomsEl) totalClassroomsEl.textContent = String(totalRooms);
    if (totalBuildingsMetaEl) {
      totalBuildingsMetaEl.textContent = `${safeBuildings.length} campus building${safeBuildings.length === 1 ? '' : 's'} mapped`;
    }
    if (availableNowEl) availableNowEl.textContent = String(availCount);
    if (occupancyMetaEl) occupancyMetaEl.textContent = `${occCount} occupied · ${resCount} reserved`;

    totalClassesEl.textContent = String(stats.totalScheduledClasses);
    document.getElementById('dashboardAssignedRooms').textContent = String(stats.totalAssignedClassrooms);
    document.getElementById('dashboardTodayClasses').textContent = String(stats.todaysClasses);
    document.getElementById('dashboardUnassignedClasses').textContent = String(stats.unassignedClasses);

    if (totalFacultyEl) totalFacultyEl.textContent = String(uniqueFaculty.size);
    const conflictCount = Number(stats.totalConflicts) || 0;
    if (totalConflictsEl) totalConflictsEl.textContent = String(conflictCount);
    if (conflictsCardEl) {
      conflictsCardEl.classList.toggle('kpi-danger', conflictCount > 0);
      conflictsCardEl.classList.toggle('kpi-success', conflictCount === 0);
    }
    if (topbarConflictPill && topbarConflictLabel) {
      topbarConflictPill.classList.toggle('has-conflicts', conflictCount > 0);
      topbarConflictPill.classList.toggle('is-clear', conflictCount === 0);
      topbarConflictLabel.textContent = conflictCount > 0
        ? `${conflictCount} Conflict${conflictCount === 1 ? '' : 's'}`
        : 'No Conflicts';
    }

    const roomsById = new Map(allRooms.map((r) => [r.id, r]));
    renderBuildingUtilization(safeBuildings, allRooms);
    renderTodaySchedules(safeSchedules, roomsById);
    renderRooms();
    loadRecentActivity();
  } catch (error) {
    totalClassesEl.textContent = '—';
    document.getElementById('dashboardAssignedRooms').textContent = '—';
    document.getElementById('dashboardTodayClasses').textContent = '—';
    document.getElementById('dashboardUnassignedClasses').textContent = '—';
    cardsContainer.replaceChildren();
    emptyEl.hidden = false;
    emptyEl.textContent = `Dashboard data could not be loaded: ${error.message}`;
  }
});
