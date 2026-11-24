document.addEventListener('DOMContentLoaded', async () => {
  const totalClassesEl = document.getElementById('dashboardTotalClasses');
  const hasAdminDashboardRoot = Boolean(
    totalClassesEl ||
    document.getElementById('dashboardTotalClassrooms') ||
    document.getElementById('adminHourlyChartGrid') ||
    document.getElementById('dashboardTodayScheduleList')
  );
  if (!hasAdminDashboardRoot) {
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
  const searchInput = document.getElementById('dashboardSearchInput') || document.getElementById('globalWorkspaceSearch');
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
    if (!utilizationList) return;
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
    if (!todayScheduleList) return;
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
        actor.textContent = item.actorEmail || 'System';
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
        btn.href = `../user/login.html?returnTo=${encodeURIComponent(window.location.pathname)}`;
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
    actions: document.getElementById('pane-actions'),
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
      const targetPanel =
        document.getElementById('todayScheduleHeading')?.closest('section') ||
        document.querySelector('.dashboard-views-card');
      if (targetPanel) {
        e.preventDefault();
        switchDashboardView('schedules');
        targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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

  const adminRefreshBtn = document.getElementById('adminRefreshBtn');
  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener('click', async () => {
      adminRefreshBtn.disabled = true;
      adminRefreshBtn.querySelector('i')?.classList.add('spin-icon');
      try {
        await loadDashboard();
      } finally {
        adminRefreshBtn.disabled = false;
        adminRefreshBtn.querySelector('i')?.classList.remove('spin-icon');
      }
    });
  }

  async function loadDashboard() {
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
      if (buildingFilter && buildingFilter.options.length <= 1) {
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

    function formatHourLabel(hour24) {
      const suffix = hour24 >= 12 ? 'PM' : 'AM';
      const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
      return `${h}${suffix}`;
    }

    function formatHourRange(hour24) {
      return `${formatHourLabel(hour24)}–${formatHourLabel(hour24 + 1)}`;
    }

    function timeToMinutes(t) {
      const [hh, mm] = t.split(':').map(Number);
      return hh * 60 + mm;
    }

    function renderAdminHourlyChart(allScheds, totalRoomCount) {
      const hourlyGrid = document.getElementById('adminHourlyChartGrid');
      const peakHourStat = document.getElementById('adminPeakHourStat');
      const roomHoursStat = document.getElementById('adminRoomHoursStat');
      if (!hourlyGrid) return;

      const hours = [];
      for (let h = 7; h <= 19; h += 1) hours.push(h);

      const todayScheds = allScheds.filter((s) => appliesOnDate(s, localDate) && s.classroomId);
      const totalRoomMinutes = todayScheds.reduce((sum, s) => {
        return sum + Math.max(0, timeToMinutes(s.endTime) - timeToMinutes(s.startTime));
      }, 0);
      if (roomHoursStat) {
        roomHoursStat.textContent = `${(totalRoomMinutes / 60).toFixed(1)} hrs`;
      }

      const slots = hours.map((h) => {
        const slotStart = `${String(h).padStart(2, '0')}:00`;
        const slotEnd = `${String(h + 1).padStart(2, '0')}:00`;
        const occRooms = new Set();
        const resRooms = new Set();
        todayScheds.forEach((s) => {
          if (s.startTime < slotEnd && s.endTime > slotStart) {
            if (s.kind === 'reservation') resRooms.add(s.classroomId);
            else occRooms.add(s.classroomId);
          }
        });
        return {
          hour: h,
          occ: occRooms.size,
          res: resRooms.size,
          totalBusy: new Set([...occRooms, ...resRooms]).size
        };
      });

      const maxScale = Math.max(totalRoomCount || 1, ...slots.map((s) => s.totalBusy), 1);
      const currentHour = localNow.getHours();
      const peakSlot = [...slots].sort((a, b) => b.totalBusy - a.totalBusy)[0];

      if (peakHourStat) {
        peakHourStat.textContent = peakSlot && peakSlot.totalBusy > 0
          ? `${formatHourRange(peakSlot.hour)} (${peakSlot.totalBusy} rooms)`
          : 'No peak today';
      }

      hourlyGrid.replaceChildren();
      slots.forEach((slot) => {
        const col = document.createElement('div');
        col.className = `hourly-bar-col${slot.hour === currentHour ? ' is-current-hour' : ''}`;
        col.title = `${formatHourRange(slot.hour)}: ${slot.occ} classes, ${slot.res} reservations`;

        const count = document.createElement('span');
        count.className = 'hourly-bar-count';
        count.textContent = String(slot.totalBusy);

        const track = document.createElement('div');
        track.className = 'hourly-bar-track';

        const resBar = document.createElement('div');
        resBar.className = 'hourly-bar-fill-res';
        resBar.style.height = `${Math.round((slot.res / maxScale) * 100)}%`;

        const occBar = document.createElement('div');
        occBar.className = 'hourly-bar-fill-occ';
        occBar.style.height = `${Math.round((slot.occ / maxScale) * 100)}%`;

        track.append(resBar, occBar);

        const label = document.createElement('span');
        label.className = 'hourly-bar-label';
        label.textContent = formatHourLabel(slot.hour);

        col.append(count, track, label);
        col.addEventListener('click', () => {
          const sTime = `${String(slot.hour).padStart(2, '0')}:00`;
          const eTime = `${String(slot.hour + 1).padStart(2, '0')}:00`;
          window.location.assign(`classrooms.html?date=${localDate}&startTime=${sTime}&endTime=${eTime}`);
        });

        hourlyGrid.append(col);
      });
    }

    function renderAdminDonut(avail, occ, res, total) {
      if (!total) return;
      const availPct = (avail / total) * 100;
      const occPct = (occ / total) * 100;
      const resPct = (res / total) * 100;

      const dAvail = document.getElementById('adminDonutAvail');
      const dOcc = document.getElementById('adminDonutOcc');
      const dRes = document.getElementById('adminDonutRes');
      const dPct = document.getElementById('adminDonutPct');
      const dOpenCount = document.getElementById('adminDonutOpenCount');
      const dOccCount = document.getElementById('adminDonutOccCount');
      const dResCount = document.getElementById('adminDonutResCount');

      if (dAvail) {
        dAvail.setAttribute('stroke-dasharray', `${availPct.toFixed(2)} ${(100 - availPct).toFixed(2)}`);
        dAvail.setAttribute('stroke-dashoffset', '0');
      }
      if (dOcc) {
        dOcc.setAttribute('stroke-dasharray', `${occPct.toFixed(2)} ${(100 - occPct).toFixed(2)}`);
        dOcc.setAttribute('stroke-dashoffset', `${(-availPct).toFixed(2)}`);
      }
      if (dRes) {
        dRes.setAttribute('stroke-dasharray', `${resPct.toFixed(2)} ${(100 - resPct).toFixed(2)}`);
        dRes.setAttribute('stroke-dashoffset', `${(-(availPct + occPct)).toFixed(2)}`);
      }
      if (dPct) dPct.textContent = `${Math.round(availPct)}%`;
      if (dOpenCount) dOpenCount.textContent = String(avail);
      if (dOccCount) dOccCount.textContent = String(occ);
      if (dResCount) dResCount.textContent = String(res);
    }

    // Update Hero Pulse & KPI Trends
    const heroBuildings = document.getElementById('dashboardHeroBuildings');
    const heroRooms = document.getElementById('dashboardHeroRooms');
    const heroUtilText = document.getElementById('dashboardHeroUtilizationText');
    const availPct = totalRooms > 0 ? Math.round((availCount / totalRooms) * 100) : 0;

    if (heroBuildings) heroBuildings.textContent = String(safeBuildings.length);
    if (heroRooms) heroRooms.textContent = String(totalRooms);
    if (heroUtilText) {
      heroUtilText.textContent = `${availCount}/${totalRooms} open (${availPct}%)`;
    }

    const trendBuildings = document.getElementById('adminTrendBuildings');
    const trendAvailPct = document.getElementById('adminTrendAvailPct');
    const miniBarAvail = document.getElementById('adminMiniBarAvail');
    const facultyChipStat = document.getElementById('adminFacultyChipStat');

    if (trendBuildings) trendBuildings.textContent = `${safeBuildings.length} buildings`;
    if (trendAvailPct) trendAvailPct.textContent = `Live · ${availPct}% open`;
    if (miniBarAvail) miniBarAvail.style.width = `${availPct}%`;
    if (facultyChipStat) facultyChipStat.textContent = `${uniqueFaculty.size} instructors`;

    renderAdminDonut(availCount, occCount, resCount, totalRooms);

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
    const trendConflictStatus = document.getElementById('adminTrendConflictStatus');
    const miniBarConflicts = document.getElementById('adminMiniBarConflicts');
    const trendSessions = document.getElementById('adminTrendSessions');

    if (totalClassroomsEl) totalClassroomsEl.textContent = String(totalRooms);
    if (totalBuildingsMetaEl) {
      totalBuildingsMetaEl.textContent = `${safeBuildings.length} campus building${safeBuildings.length === 1 ? '' : 's'} mapped`;
    }
    if (availableNowEl) availableNowEl.textContent = String(availCount);
    if (occupancyMetaEl) occupancyMetaEl.textContent = `${occCount} occupied · ${resCount} reserved`;

    if (totalClassesEl) totalClassesEl.textContent = String(stats.totalScheduledClasses);
    const assignedRoomsEl = document.getElementById('dashboardAssignedRooms');
    if (assignedRoomsEl) assignedRoomsEl.textContent = String(stats.totalAssignedClassrooms);
    const todayClassesEl = document.getElementById('dashboardTodayClasses');
    if (todayClassesEl) todayClassesEl.textContent = String(stats.todaysClasses);
    const unassignedClassesEl = document.getElementById('dashboardUnassignedClasses');
    if (unassignedClassesEl) unassignedClassesEl.textContent = String(stats.unassignedClasses);

    if (trendSessions) {
      trendSessions.textContent = `${stats.totalScheduledClasses} total`;
    }

    if (totalFacultyEl) totalFacultyEl.textContent = String(uniqueFaculty.size);
    const conflictCount = Number(stats.totalConflicts) || 0;
    const unassignedCount = Number(stats.unassignedClasses) || 0;

    if (totalConflictsEl) totalConflictsEl.textContent = String(conflictCount);
    if (conflictsCardEl) {
      conflictsCardEl.classList.toggle('kpi-danger', conflictCount > 0);
      conflictsCardEl.classList.toggle('kpi-success', conflictCount === 0);
    }
    if (trendConflictStatus) {
      trendConflictStatus.className = `kpi-trend-pill ${conflictCount > 0 ? 'kpi-trend-danger' : 'kpi-trend-success'}`;
      trendConflictStatus.textContent = conflictCount > 0 ? 'Action Needed' : 'All Clear';
    }
    if (miniBarConflicts) {
      miniBarConflicts.style.width = conflictCount > 0 ? '100%' : '15%';
      miniBarConflicts.style.backgroundColor = conflictCount > 0 ? 'var(--rq-danger)' : 'var(--rq-success)';
    }

    const healthStrip = document.getElementById('adminHealthStrip');
    const healthTitle = document.getElementById('adminHealthTitle');
    const healthMeta = document.getElementById('adminHealthMeta');
    const healthIcon = document.getElementById('adminHealthIcon');
    if (healthStrip && healthTitle && healthMeta) {
      if (conflictCount > 0) {
        healthStrip.style.borderLeftColor = 'var(--rq-danger)';
        if (healthIcon) {
          healthIcon.style.backgroundColor = 'var(--rq-danger-tint)';
          healthIcon.style.color = 'var(--rq-danger)';
          healthIcon.innerHTML = '<i class="bi bi-exclamation-octagon"></i>';
        }
        healthTitle.textContent = `${conflictCount} schedule overlap${conflictCount === 1 ? '' : 's'} detected`;
        healthMeta.textContent = 'Review overlapping class assignments immediately to keep campus rooms conflict-free.';
      } else if (unassignedCount > 0) {
        healthStrip.style.borderLeftColor = 'var(--rq-warning)';
        if (healthIcon) {
          healthIcon.style.backgroundColor = 'var(--rq-warning-tint)';
          healthIcon.style.color = 'var(--rq-warning)';
          healthIcon.innerHTML = '<i class="bi bi-inbox"></i>';
        }
        healthTitle.textContent = `Zero conflicts · ${unassignedCount} unassigned class${unassignedCount === 1 ? '' : 'es'}`;
        healthMeta.textContent = 'Assign available rooms to pending classes in the Assignments hub.';
      } else {
        healthStrip.style.borderLeftColor = 'var(--rq-primary)';
        healthTitle.textContent = 'Timetable Health: All scheduled sessions are conflict-free';
        healthMeta.textContent = `${availCount} open rooms available right now across ${safeBuildings.length} campus buildings.`;
      }
    }

    if (topbarConflictPill && topbarConflictLabel) {
      topbarConflictPill.classList.toggle('has-conflicts', conflictCount > 0);
      topbarConflictPill.classList.toggle('is-clear', conflictCount === 0);
      topbarConflictLabel.textContent = conflictCount > 0
        ? `${conflictCount} Conflict${conflictCount === 1 ? '' : 's'}`
        : 'No Conflicts';
    }

    const roomsById = new Map(allRooms.map((r) => [r.id, r]));
    renderAdminHourlyChart(safeSchedules, totalRooms);
    renderBuildingUtilization(safeBuildings, allRooms);
    renderTodaySchedules(safeSchedules, roomsById);
    renderRooms();
    loadRecentActivity();
  } catch (error) {
    if (totalClassesEl) totalClassesEl.textContent = '—';
    const assignedRoomsEl = document.getElementById('dashboardAssignedRooms');
    if (assignedRoomsEl) assignedRoomsEl.textContent = '—';
    const todayClassesEl = document.getElementById('dashboardTodayClasses');
    if (todayClassesEl) todayClassesEl.textContent = '—';
    const unassignedClassesEl = document.getElementById('dashboardUnassignedClasses');
    if (unassignedClassesEl) unassignedClassesEl.textContent = '—';
    if (cardsContainer) cardsContainer.replaceChildren();
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = `Dashboard data could not be loaded: ${error.message}`;
    }
  }
}

  // Initial load
  await loadDashboard();
});
