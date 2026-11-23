document.addEventListener('DOMContentLoaded', async () => {
  const pad2 = (n) => String(n).padStart(2, '0');
  const toTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };

  function getLocalDateStr(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  function computeWindowFromOffset(offsetHours = 0) {
    const base = new Date(Date.now() + offsetHours * 60 * 60000);
    const localDate = getLocalDateStr(base);
    let startTime = offsetHours === 0 ? toTime(base) : `${pad2(base.getHours())}:00`;
    const end = new Date(base.getTime() + 60 * 60000);
    let endTime = offsetHours === 0 ? toTime(end) : `${pad2(end.getHours())}:00`;

    if (end.toDateString() !== base.toDateString()) {
      if (startTime >= '23:59') startTime = '22:59';
      endTime = '23:59';
    }
    return { localDate, startTime, endTime, isLive: offsetHours === 0, hourSlot: null };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDurationMinutes(mins) {
    if (mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  // DOM References
  const liveWindowEl = document.getElementById('userLiveWindow');
  const lastSyncedEl = document.getElementById('userLastSynced');
  const windowLegendEl = document.getElementById('userWindowLegend');
  const previewWindowBanner = document.getElementById('previewWindowBanner');
  const previewWindowText = document.getElementById('previewWindowText');
  const resetToLiveNowBtn = document.getElementById('resetToLiveNowBtn');
  const refreshDashboardBtns = [
    ...document.querySelectorAll('#refreshDashboardBtn, #topbarRefreshDashboardBtn, [data-refresh-dashboard]')
  ];

  const tableBody = document.getElementById('userBuildingStatsTableBody');
  const liveRoomsBody = document.getElementById('userLiveRoomsTableBody');
  const liveDirectoryCountBadge = document.getElementById('liveDirectoryCountBadge');
  const liveDirectoryFooter = document.getElementById('liveDirectoryFooter');
  const liveDirectoryPaginationText = document.getElementById('liveDirectoryPaginationText');
  const toggleShowAllRoomsBtn = document.getElementById('toggleShowAllRoomsBtn');

  const buildingFilter = document.getElementById('userDashboardBuildingFilter');
  const searchInput = document.getElementById('userDashboardSearch');
  const capacityFilter = document.getElementById('quickCapacityFilter');
  const filterOpenAllDayBtn = document.getElementById('filterOpenAllDayBtn');
  const statusChips = [...document.querySelectorAll('#quickStatusChips .filter-chip-btn')];
  const facilityChips = [...document.querySelectorAll('#quickFacilityChips .filter-chip-btn')];
  const resetFiltersBtn = document.getElementById('resetQuickFiltersBtn');
  const kpiButtons = [...document.querySelectorAll('.kpi-interactive[data-kpi-status]')];
  const windowPresetButtons = [...document.querySelectorAll('.time-window-pill[data-window-preset]')];
  const sortButtons = [...document.querySelectorAll('.table-sort-btn[data-sort-key]')];
  const headerNotifSummary = document.getElementById('headerNotifSummary');

  const heroTotal = document.getElementById('userHeroTotalRooms');
  const statAvail = document.getElementById('userStatAvailable');
  const statAvailMeta = document.getElementById('userStatAvailableMeta');
  const statOcc = document.getElementById('userStatOccupied');
  const statRes = document.getElementById('userStatReserved');
  const statUtilization = document.getElementById('userStatUtilization');

  const trendFloors = document.getElementById('userTrendFloors');
  const trendAvailPct = document.getElementById('userTrendAvailPct');
  const trendOccPct = document.getElementById('userTrendOccPct');
  const trendResCount = document.getElementById('userTrendResCount');
  const miniBarAvail = document.getElementById('userMiniBarAvail');
  const miniBarOcc = document.getElementById('userMiniBarOcc');
  const miniBarRes = document.getElementById('userMiniBarRes');

  const quickFinderTitle = document.getElementById('userQuickFinderTitle');
  const quickFinderMeta = document.getElementById('userQuickFinderMeta');
  const quickFinderMapLink = document.getElementById('userQuickFinderMapLink');
  const instantReserveBtn = document.getElementById('userInstantReserveBtn');
  const recommendedList = document.getElementById('userRecommendedRoomsList');
  const recommendedLiveBadge = document.getElementById('recommendedLiveBadge');

  const hourlyGrid = document.getElementById('userHourlyChartGrid');
  const peakHourStat = document.getElementById('userPeakHourStat');
  const quietHourStat = document.getElementById('userQuietHourStat');
  const sessionsTodayStat = document.getElementById('userSessionsTodayStat');

  const donutAvail = document.getElementById('userDonutAvail');
  const donutOcc = document.getElementById('userDonutOcc');
  const donutRes = document.getElementById('userDonutRes');
  const donutPct = document.getElementById('userDonutPct');
  const donutOpenCount = document.getElementById('userDonutOpenCount');
  const donutOccCount = document.getElementById('userDonutOccCount');
  const donutResCount = document.getElementById('userDonutResCount');
  const spaceDistributionSub = document.getElementById('spaceDistributionSub');

  const insightTotalRoomsMeta = document.getElementById('insightTotalRoomsMeta');
  const insightTopBuilding = document.getElementById('insightTopBuilding');
  const insightTopBuildingMeta = document.getElementById('insightTopBuildingMeta');
  const insightUtilizationRate = document.getElementById('insightUtilizationRate');
  const insightUtilizationMeta = document.getElementById('insightUtilizationMeta');

  // State
  let activeWindow = computeWindowFromOffset(0);
  let allRooms = [];
  let allBuildings = [];
  let allSchedules = [];
  let activeStatus = 'all';
  let requireLongWindow = false;
  let showAllRooms = false;
  let sortKey = 'status';
  let sortDir = 1;
  let buildingOptionsPopulated = false;
  let latestFetchToken = 0;
  const activeFacilities = new Set();

  function appliesOnDate(schedule, date) {
    if (schedule.recurrence === 'once') {
      return schedule.date === date;
    }
    if (schedule.startDate && date < schedule.startDate) return false;
    if (schedule.endDate && date > schedule.endDate) return false;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.includes(weekday);
  }

  function formatRoomLabel(room) {
    if (room.roomNumber === null || room.roomNumber === undefined) {
      return room.name || 'Named room';
    }
    return room.name ? `Room ${room.roomNumber} · ${room.name}` : `Room ${room.roomNumber}`;
  }

  function formatHourLabel(hour24) {
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${h}${suffix}`;
  }

  function formatHourRange(hour24) {
    return `${formatHourLabel(hour24)}–${formatHourLabel(hour24 + 1)}`;
  }

  /**
   * Computes schedule-aware timeline context for each classroom on the active date:
   * - If available: remaining open minutes until the next scheduled block (or open all day)
   * - If occupied/reserved: when the current block ends and what session is active
   */
  function enrichRoomsWithTimeline(rooms, schedules, date, startTime, endTime) {
    const todaySchedules = schedules.filter((s) => appliesOnDate(s, date) && s.classroomId);
    const byRoom = new Map();
    todaySchedules.forEach((s) => {
      if (!byRoom.has(s.classroomId)) byRoom.set(s.classroomId, []);
      byRoom.get(s.classroomId).push(s);
    });
    byRoom.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));

    const startMins = toMinutes(startTime);
    const endOfDayMins = 21 * 60; // 9:00 PM campus closing reference

    return rooms.map((room) => {
      const candidates = [room.regionId, room.id, room.classroomId].filter(Boolean);
      let roomScheds = [];
      for (const id of candidates) {
        if (byRoom.has(id)) {
          roomScheds = byRoom.get(id);
          break;
        }
      }

      if (room.status === 'available') {
        const nextBlock = roomScheds.find((s) => toMinutes(s.startTime) >= startMins);
        if (nextBlock) {
          const freeUntil = window.RoomQTime.format(nextBlock.startTime);
          const freeMins = Math.max(0, toMinutes(nextBlock.startTime) - startMins);
          return {
            ...room,
            freeMinutes: freeMins,
            isOpenAllDay: false,
            closingSoon: freeMins > 0 && freeMins < 35,
            timelineHint: `Free until ${freeUntil} (${formatDurationMinutes(freeMins)})`
          };
        }
        return {
          ...room,
          freeMinutes: Math.max(60, endOfDayMins - startMins),
          isOpenAllDay: true,
          closingSoon: false,
          timelineHint: 'Open rest of day'
        };
      }

      const activeBlock = roomScheds.find(
        (s) => s.startTime < endTime && s.endTime > startTime
      );
      if (activeBlock) {
        const freeAt = window.RoomQTime.format(activeBlock.endTime);
        const sessionLabel = activeBlock.subject || activeBlock.title || activeBlock.purpose || '';
        return {
          ...room,
          freeMinutes: 0,
          isOpenAllDay: false,
          closingSoon: false,
          timelineHint: sessionLabel
            ? `${sessionLabel} · Free at ${freeAt}`
            : `Free at ${freeAt}`
        };
      }

      return {
        ...room,
        freeMinutes: 0,
        isOpenAllDay: false,
        closingSoon: false,
        timelineHint: room.status === 'reserved' ? 'Reserved for this slot' : 'Class in session'
      };
    });
  }

  function updateWindowChrome() {
    const formattedWindow = `${window.RoomQTime.format(activeWindow.startTime)}–${window.RoomQTime.format(activeWindow.endTime)}`;
    if (liveWindowEl) liveWindowEl.textContent = formattedWindow;

    if (windowLegendEl) {
      windowLegendEl.replaceChildren();
      const dot = document.createElement('i');
      windowLegendEl.append(dot, document.createTextNode(` ${formattedWindow}`));
    }

    if (previewWindowBanner && previewWindowText) {
      previewWindowBanner.hidden = activeWindow.isLive;
      previewWindowText.textContent = formattedWindow;
    }

    if (recommendedLiveBadge) {
      recommendedLiveBadge.textContent = activeWindow.isLive ? 'Live' : 'Preview';
      recommendedLiveBadge.className = `status-pill ${activeWindow.isLive ? 'status-pill-available' : 'status-pill-reserved'}`;
    }

    windowPresetButtons.forEach((btn) => {
      const preset = btn.dataset.windowPreset;
      const isMatch =
        (preset === 'now' && activeWindow.isLive) ||
        (preset === 'plus1' && activeWindow.preset === 'plus1') ||
        (preset === 'plus2' && activeWindow.preset === 'plus2');
      btn.classList.toggle('active', isMatch);
    });
  }

  function syncStatusFilterUI() {
    statusChips.forEach((btn) => {
      const isMatch = (btn.dataset.status || 'all') === activeStatus;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });

    kpiButtons.forEach((btn) => {
      const isMatch = (btn.dataset.kpiStatus || 'all') === activeStatus;
      btn.classList.toggle('is-kpi-active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  function renderHourlyChart(scopedRooms) {
    if (!hourlyGrid) return;
    const hours = [];
    for (let h = 7; h <= 19; h += 1) {
      hours.push(h);
    }

    const scopedRoomIds = new Set(
      scopedRooms.flatMap((r) => [r.regionId, r.id, r.classroomId].filter(Boolean))
    );
    const hasBuildingScope = Boolean(buildingFilter && buildingFilter.value);

    const todaySchedules = allSchedules.filter((s) => {
      if (!appliesOnDate(s, activeWindow.localDate) || !s.classroomId) return false;
      if (hasBuildingScope && !scopedRoomIds.has(s.classroomId)) return false;
      return true;
    });

    if (sessionsTodayStat) {
      sessionsTodayStat.textContent = String(todaySchedules.length);
    }

    const totalRoomsCount = scopedRooms.length;
    const slots = hours.map((h) => {
      const slotStart = `${pad2(h)}:00`;
      const slotEnd = `${pad2(h + 1)}:00`;
      const occRooms = new Set();
      const resRooms = new Set();
      todaySchedules.forEach((s) => {
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

    const maxScale = Math.max(totalRoomsCount || 1, ...slots.map((s) => s.totalBusy), 1);
    const currentHour = new Date().getHours();

    const peakSlot = [...slots].sort((a, b) => b.totalBusy - a.totalBusy)[0];
    const quietSlot = [...slots].sort((a, b) => a.totalBusy - b.totalBusy)[0];

    if (peakHourStat) {
      peakHourStat.textContent =
        peakSlot && peakSlot.totalBusy > 0
          ? `${formatHourRange(peakSlot.hour)} (${peakSlot.totalBusy} busy)`
          : 'Low demand today';
    }
    if (quietHourStat && quietSlot) {
      quietHourStat.textContent = `${formatHourRange(quietSlot.hour)} (${Math.max(0, totalRoomsCount - quietSlot.totalBusy)} open)`;
    }

    hourlyGrid.replaceChildren();
    slots.forEach((slot) => {
      const isSelectedSlot = activeWindow.hourSlot === slot.hour;
      const isCurrent = slot.hour === currentHour;
      const col = document.createElement('div');
      col.className = `hourly-bar-col${isCurrent ? ' is-current-hour' : ''}${isSelectedSlot ? ' is-selected-hour' : ''}`;
      col.setAttribute('role', 'button');
      col.setAttribute('tabindex', '0');
      col.setAttribute('aria-pressed', String(isSelectedSlot));
      col.title = `${formatHourRange(slot.hour)}: ${slot.occ} classes, ${slot.res} reservations (${Math.max(0, totalRoomsCount - slot.totalBusy)} open) — Click to preview`;

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

      const activateHourPreview = () => {
        if (activeWindow.hourSlot === slot.hour) {
          switchWindow(computeWindowFromOffset(0));
          return;
        }
        const sTime = `${pad2(slot.hour)}:00`;
        const eTime = `${pad2(slot.hour + 1)}:00`;
        switchWindow({
          localDate: activeWindow.localDate,
          startTime: sTime,
          endTime: eTime,
          isLive: false,
          hourSlot: slot.hour,
          preset: null
        });
      };

      col.addEventListener('click', activateHourPreview);
      col.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateHourPreview();
        }
      });

      hourlyGrid.append(col);
    });
  }

  function renderDonutChart(avail, occ, res, total) {
    if (!total) {
      if (donutPct) donutPct.textContent = '0%';
      if (donutOpenCount) donutOpenCount.textContent = '0';
      if (donutOccCount) donutOccCount.textContent = '0';
      if (donutResCount) donutResCount.textContent = '0';
      return;
    }
    const availPct = (avail / total) * 100;
    const occPct = (occ / total) * 100;
    const resPct = (res / total) * 100;

    if (donutAvail) {
      donutAvail.setAttribute('stroke-dasharray', `${availPct.toFixed(2)} ${(100 - availPct).toFixed(2)}`);
      donutAvail.setAttribute('stroke-dashoffset', '0');
    }
    if (donutOcc) {
      donutOcc.setAttribute('stroke-dasharray', `${occPct.toFixed(2)} ${(100 - occPct).toFixed(2)}`);
      donutOcc.setAttribute('stroke-dashoffset', `${(-availPct).toFixed(2)}`);
    }
    if (donutRes) {
      donutRes.setAttribute('stroke-dasharray', `${resPct.toFixed(2)} ${(100 - resPct).toFixed(2)}`);
      donutRes.setAttribute('stroke-dashoffset', `${(-(availPct + occPct)).toFixed(2)}`);
    }
    if (donutPct) donutPct.textContent = `${Math.round(availPct)}%`;
    if (donutOpenCount) donutOpenCount.textContent = String(avail);
    if (donutOccCount) donutOccCount.textContent = String(occ);
    if (donutResCount) donutResCount.textContent = String(res);
  }

  function buildBookingQueryParams(room, autoBook = false) {
    const params = new URLSearchParams({
      building: room.buildingId,
      floor: room.floorId,
      room: room.regionId,
      date: activeWindow.localDate,
      startTime: activeWindow.startTime,
      endTime: activeWindow.endTime
    });
    if (autoBook) params.set('book', 'true');
    return `classrooms.html?${params.toString()}`;
  }

  function renderRecommendedRooms(scopedRooms) {
    const formattedWindow = `${window.RoomQTime.format(activeWindow.startTime)}–${window.RoomQTime.format(activeWindow.endTime)}`;
    // Prioritize rooms that are open longest (not closing in <35m), then larger capacity
    const openRooms = scopedRooms
      .filter((r) => r.status === 'available')
      .sort((a, b) => {
        if (a.closingSoon !== b.closingSoon) return a.closingSoon ? 1 : -1;
        if (b.freeMinutes !== a.freeMinutes) return b.freeMinutes - a.freeMinutes;
        return (b.capacity || 0) - (a.capacity || 0);
      });

    if (openRooms.length > 0) {
      const topRoom = openRooms[0];
      const bookUrl = buildBookingQueryParams(topRoom, true);
      const mapUrl = buildBookingQueryParams(topRoom, false);

      if (quickFinderTitle) {
        quickFinderTitle.textContent = `Best match: ${formatRoomLabel(topRoom)} (${topRoom.buildingName})`;
      }
      if (quickFinderMeta) {
        const capInfo = topRoom.capacity ? `${topRoom.capacity} seats` : 'Standard classroom';
        const facInfo =
          Array.isArray(topRoom.facilities) && topRoom.facilities.length
            ? ` · ${topRoom.facilities.slice(0, 2).join(', ')}`
            : '';
        quickFinderMeta.textContent = `${topRoom.floorLabel} · ${capInfo}${facInfo} · ${topRoom.timelineHint}`;
      }
      if (quickFinderMapLink) quickFinderMapLink.href = mapUrl;
      if (instantReserveBtn) {
        instantReserveBtn.href = bookUrl;
        instantReserveBtn.classList.remove('disabled');
      }
    } else {
      if (quickFinderTitle) {
        quickFinderTitle.textContent = `No open classrooms during ${formattedWindow}`;
      }
      if (quickFinderMeta) {
        quickFinderMeta.textContent = 'Select a quieter bar in the hourly forecast above or inspect floor plans for upcoming openings.';
      }
      if (quickFinderMapLink) quickFinderMapLink.href = 'classrooms.html';
      if (instantReserveBtn) instantReserveBtn.href = 'classrooms.html';
    }

    if (!recommendedList) return;
    recommendedList.replaceChildren();
    if (!openRooms.length) {
      const empty = document.createElement('div');
      empty.className = 'text-muted small text-center py-3';
      empty.textContent = 'No classrooms are open in the selected building/window.';
      recommendedList.append(empty);
      return;
    }

    openRooms.slice(0, 3).forEach((room) => {
      const item = document.createElement('div');
      item.className = 'recommended-room-item';

      const info = document.createElement('div');
      info.className = 'recommended-room-info';
      const title = document.createElement('strong');
      title.textContent = formatRoomLabel(room);
      const sub = document.createElement('span');
      const cap = room.capacity ? `${room.capacity} seats` : 'Open';
      sub.textContent = `${room.buildingName} · ${cap} · ${room.timelineHint}`;
      info.append(title, sub);

      const btn = document.createElement('a');
      btn.className = 'btn btn-primary btn-sm py-1 px-2';
      btn.style.fontSize = '0.75rem';
      btn.href = buildBookingQueryParams(room, true);
      btn.textContent = 'Reserve';

      item.append(info, btn);
      recommendedList.append(item);
    });
  }

  function renderLiveRooms() {
    if (!liveRoomsBody) return;
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const selectedBuilding = buildingFilter ? buildingFilter.value : '';
    const minCap = capacityFilter ? Number(capacityFilter.value || 0) : 0;

    const filtered = allRooms.filter((room) => {
      if (activeStatus !== 'all' && room.status !== activeStatus) return false;
      if (selectedBuilding && room.buildingId !== selectedBuilding) return false;
      if (minCap > 0 && (room.capacity === null || room.capacity === undefined || room.capacity < minCap)) {
        return false;
      }
      if (requireLongWindow && (room.status !== 'available' || room.freeMinutes < 120)) {
        return false;
      }
      if (activeFacilities.size > 0) {
        const roomFacs = Array.isArray(room.facilities)
          ? room.facilities.map((f) => f.toLowerCase()).join(' ')
          : '';
        for (const req of activeFacilities) {
          if (!roomFacs.includes(req)) return false;
        }
      }
      if (query) {
        const haystack = [
          formatRoomLabel(room),
          room.buildingName || '',
          room.floorLabel || '',
          room.timelineHint || '',
          ...(Array.isArray(room.facilities) ? room.facilities : [])
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    const statusRank = { available: 0, reserved: 1, occupied: 2 };
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'room') {
        cmp = formatRoomLabel(a).localeCompare(formatRoomLabel(b), undefined, { numeric: true });
      } else if (sortKey === 'building') {
        cmp = (a.buildingName || '').localeCompare(b.buildingName || '');
      } else if (sortKey === 'capacity') {
        cmp = (a.capacity || 0) - (b.capacity || 0);
      } else {
        cmp = (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
        if (cmp === 0 && a.status === 'available') {
          cmp = (b.freeMinutes || 0) - (a.freeMinutes || 0);
        }
      }
      if (cmp === 0) {
        cmp = (a.buildingName || '').localeCompare(b.buildingName || '');
      }
      return cmp * sortDir;
    });

    if (liveDirectoryCountBadge) {
      liveDirectoryCountBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'room' : 'rooms'}`;
    }

    const defaultLimit = Number(liveRoomsBody.dataset.defaultLimit) || 10;
    const limit = showAllRooms ? filtered.length : defaultLimit;
    const visibleRooms = filtered.slice(0, limit);

    if (liveDirectoryFooter && liveDirectoryPaginationText && toggleShowAllRoomsBtn) {
      if (filtered.length > defaultLimit) {
        liveDirectoryFooter.hidden = false;
        liveDirectoryPaginationText.textContent = `Showing ${visibleRooms.length} of ${filtered.length} matching classrooms`;
        toggleShowAllRoomsBtn.textContent = showAllRooms
          ? `Show top ${defaultLimit} rooms`
          : `Show all ${filtered.length} rooms`;
      } else {
        liveDirectoryFooter.hidden = true;
      }
    }

    liveRoomsBody.replaceChildren();
    if (!visibleRooms.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="text-center py-4 text-muted">No classrooms match your current filter criteria.</td>`;
      liveRoomsBody.append(tr);
      return;
    }

    visibleRooms.forEach((room) => {
      const tr = document.createElement('tr');
      const statusClass =
        room.status === 'available'
          ? 'status-pill-available'
          : room.status === 'reserved'
            ? 'status-pill-reserved'
            : 'status-pill-occupied';
      const statusLabel = room.status[0].toUpperCase() + room.status.slice(1);
      const capText =
        room.capacity !== null && room.capacity !== undefined ? `${room.capacity} seats` : 'Standard';
      const facText =
        Array.isArray(room.facilities) && room.facilities.length
          ? room.facilities.slice(0, 2).join(', ')
          : 'Basic room';

      const bookUrl = buildBookingQueryParams(room, true);
      const inspectUrl = buildBookingQueryParams(room, false);
      const timelineBadgeClass = room.closingSoon ? 'room-timeline-note is-closing' : 'room-timeline-note';

      tr.innerHTML = `
        <td><strong>${escapeHtml(formatRoomLabel(room))}</strong></td>
        <td><span class="text-muted small">${escapeHtml(room.buildingName || room.buildingId)} · ${escapeHtml(room.floorLabel || '')}</span></td>
        <td><span class="small text-muted">${escapeHtml(capText)} · ${escapeHtml(facText)}</span></td>
        <td>
          <div class="d-flex flex-column align-items-start gap-1">
            <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
            <span class="${timelineBadgeClass}">${escapeHtml(room.timelineHint)}</span>
          </div>
        </td>
        <td class="text-end">
          <a href="${room.status === 'available' ? bookUrl : inspectUrl}" class="btn ${room.status === 'available' ? 'btn-primary' : 'btn-outline-primary'} btn-sm py-0 px-2" style="font-size: 0.78rem;">
            ${room.status === 'available' ? 'Reserve' : 'Inspect'}
          </a>
        </td>
      `;
      liveRoomsBody.append(tr);
    });
  }

  function renderDashboardView() {
    const selectedBuilding = buildingFilter ? buildingFilter.value : '';
    const scopedRooms = selectedBuilding
      ? allRooms.filter((r) => r.buildingId === selectedBuilding)
      : allRooms;

    const statsByBuilding = new Map();
    allBuildings.forEach((b) => {
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

    const total = scopedRooms.length;
    const avail = scopedRooms.filter((r) => r.status === 'available').length;
    const occ = scopedRooms.filter((r) => r.status === 'occupied').length;
    const res = scopedRooms.filter((r) => r.status === 'reserved').length;
    const inUse = occ + res;
    const utilizationPct = total > 0 ? Math.round((inUse / total) * 100) : 0;
    const availPct = total > 0 ? Math.round((avail / total) * 100) : 0;
    const occPct = total > 0 ? Math.round((occ / total) * 100) : 0;
    const resPct = total > 0 ? Math.round((res / total) * 100) : 0;
    const formattedWindow = `${window.RoomQTime.format(activeWindow.startTime)}–${window.RoomQTime.format(activeWindow.endTime)}`;

    if (heroTotal) heroTotal.textContent = String(total);
    if (trendFloors) {
      trendFloors.textContent = selectedBuilding
        ? (statsByBuilding.get(selectedBuilding)?.name || '1 building')
        : `${buildingList.length} buildings`;
    }
    if (headerNotifSummary) {
      headerNotifSummary.textContent = `${avail} of ${total} classrooms are open (${formattedWindow}).`;
    }

    if (statAvail) statAvail.textContent = String(avail);
    if (statAvailMeta) statAvailMeta.textContent = `${availPct}% of scoped classrooms`;
    if (trendAvailPct) trendAvailPct.textContent = `${activeWindow.isLive ? 'Live' : 'Slot'} · ${availPct}% open`;
    if (miniBarAvail) miniBarAvail.style.width = `${availPct}%`;

    if (statOcc) statOcc.textContent = String(occ);
    if (trendOccPct) trendOccPct.textContent = `${occPct}% in class`;
    if (miniBarOcc) miniBarOcc.style.width = `${occPct}%`;

    if (statRes) statRes.textContent = String(res);
    if (trendResCount) trendResCount.textContent = `${resPct}% booked`;
    if (miniBarRes) miniBarRes.style.width = `${resPct}%`;

    if (statUtilization) statUtilization.textContent = `${utilizationPct}% utilized`;
    if (spaceDistributionSub) {
      spaceDistributionSub.textContent = selectedBuilding
        ? `Breakdown for ${statsByBuilding.get(selectedBuilding)?.name || 'selected building'}`
        : 'Real-time campus availability breakdown';
    }

    renderHourlyChart(scopedRooms);
    renderDonutChart(avail, occ, res, total);
    renderRecommendedRooms(scopedRooms);
    renderLiveRooms();

    if (tableBody) {
      tableBody.replaceChildren();
      buildingList.forEach((b) => {
        const tr = document.createElement('tr');
        if (selectedBuilding && b.id === selectedBuilding) {
          tr.className = 'table-active';
        }
        const bInUse = b.occupied + b.reserved;
        const bPct = b.total > 0 ? Math.round((bInUse / b.total) * 100) : 0;
        const bOccPct = b.total > 0 ? (b.occupied / b.total) * 100 : 0;
        const bResPct = b.total > 0 ? (b.reserved / b.total) * 100 : 0;

        tr.innerHTML = `
          <td><strong>${escapeHtml(b.name)}</strong></td>
          <td><span class="text-muted small">${b.floors} fl</span></td>
          <td><span class="fw-medium">${b.total}</span></td>
          <td><span class="status-pill status-pill-available">${b.available} open</span></td>
          <td><span class="status-pill status-pill-occupied">${b.occupied} in class</span></td>
          <td><span class="status-pill status-pill-reserved">${b.reserved} reserved</span></td>
          <td>
            <div style="height: 6px; background-color: #e2e8f0; border-radius: 999px; overflow: hidden; display: flex; margin-bottom: 4px;">
              <div style="width: ${bOccPct}%; background-color: var(--rq-primary);"></div>
              <div style="width: ${bResPct}%; background-color: var(--rq-warning);"></div>
            </div>
            <span class="small text-muted font-monospace">${bPct}% in use</span>
          </td>
          <td class="text-end">
            <a href="classrooms.html?building=${encodeURIComponent(b.id)}" class="btn btn-outline-primary btn-sm py-0 px-2" style="font-size: 0.78rem" title="View floor plan for ${escapeHtml(b.name)}">
              Floor plan
            </a>
          </td>
        `;
        tableBody.append(tr);
      });
    }

    if (insightTotalRoomsMeta) {
      if (selectedBuilding) {
        const b = statsByBuilding.get(selectedBuilding);
        insightTotalRoomsMeta.textContent = b ? `Across ${b.floors} floor${b.floors === 1 ? '' : 's'} in this building` : 'Selected building';
      } else {
        const totalFloors = buildingList.reduce((acc, curr) => acc + curr.floors, 0);
        insightTotalRoomsMeta.textContent = `Across ${buildingList.length} buildings & ${totalFloors} floors`;
      }
    }

    const bestBuilding = [...buildingList].sort((a, b) => b.available - a.available)[0];
    if (bestBuilding && insightTopBuilding) insightTopBuilding.textContent = bestBuilding.name;
    if (bestBuilding && insightTopBuildingMeta) {
      insightTopBuildingMeta.textContent = `${bestBuilding.available} of ${bestBuilding.total} classrooms currently free`;
    }

    if (insightUtilizationRate) insightUtilizationRate.textContent = `${utilizationPct}% Active Occupancy`;
    if (insightUtilizationMeta) {
      insightUtilizationMeta.textContent = `${inUse} of ${total} classrooms in session or reserved`;
    }
  }

  async function loadDashboardData({ refreshStatic = false } = {}) {
    const token = ++latestFetchToken;
    updateWindowChrome();

    refreshDashboardBtns.forEach((btn) => {
      btn.disabled = true;
      btn.querySelector('i')?.classList.add('spin-icon');
    });

    try {
      const availUrl = `/api/availability?date=${activeWindow.localDate}&startTime=${activeWindow.startTime}&endTime=${activeWindow.endTime}`;
      const requests = [window.RoomQApi.request(availUrl)];
      if (refreshStatic || !allBuildings.length) {
        requests.push(window.RoomQApi.request('/api/buildings'));
        requests.push(window.RoomQApi.request('/api/schedules'));
      }

      const [roomsRes, buildingsRes, schedulesRes] = await Promise.all(requests);
      if (token !== latestFetchToken) return;

      if (buildingsRes) allBuildings = Array.isArray(buildingsRes) ? buildingsRes : [];
      if (schedulesRes) allSchedules = Array.isArray(schedulesRes) ? schedulesRes : [];

      if (buildingFilter && !buildingOptionsPopulated && allBuildings.length) {
        allBuildings.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.name;
          buildingFilter.append(opt);
        });
        buildingOptionsPopulated = true;
      }

      const rawRooms = Array.isArray(roomsRes) ? roomsRes : [];
      allRooms = enrichRoomsWithTimeline(
        rawRooms,
        allSchedules,
        activeWindow.localDate,
        activeWindow.startTime,
        activeWindow.endTime
      );

      if (lastSyncedEl) {
        lastSyncedEl.textContent = `· Synced ${window.RoomQTime.format(toTime(new Date()))}`;
      }

      renderDashboardView();
    } catch (error) {
      if (token !== latestFetchToken) return;
      const safeErr = escapeHtml(error.message || 'Unknown error');
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Failed to load live statistics: ${safeErr}</td></tr>`;
      }
      if (liveRoomsBody) {
        liveRoomsBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">Failed to load live classrooms: ${safeErr}</td></tr>`;
      }
    } finally {
      if (token === latestFetchToken) {
        refreshDashboardBtns.forEach((btn) => {
          btn.disabled = false;
          btn.querySelector('i')?.classList.remove('spin-icon');
        });
      }
    }
  }

  function switchWindow(nextWindow) {
    activeWindow = nextWindow;
    loadDashboardData({ refreshStatic: false });
  }

  // Event Listeners
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      showAllRooms = false;
      renderLiveRooms();
    });
  }

  // Keyboard shortcut: press "/" outside inputs to focus search
  document.addEventListener('keydown', (e) => {
    if (
      e.key === '/' &&
      searchInput &&
      document.activeElement !== searchInput &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    ) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  if (buildingFilter) {
    buildingFilter.addEventListener('change', () => {
      showAllRooms = false;
      renderDashboardView();
    });
  }

  if (capacityFilter) {
    capacityFilter.addEventListener('change', () => {
      showAllRooms = false;
      renderLiveRooms();
    });
  }

  if (filterOpenAllDayBtn) {
    filterOpenAllDayBtn.addEventListener('click', () => {
      requireLongWindow = !requireLongWindow;
      filterOpenAllDayBtn.classList.toggle('active', requireLongWindow);
      filterOpenAllDayBtn.setAttribute('aria-pressed', String(requireLongWindow));
      showAllRooms = false;
      renderLiveRooms();
    });
  }

  statusChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeStatus = btn.dataset.status || 'all';
      showAllRooms = false;
      syncStatusFilterUI();
      renderLiveRooms();
    });
  });

  kpiButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.kpiStatus || 'all';
      activeStatus = activeStatus === target && target !== 'all' ? 'all' : target;
      showAllRooms = false;
      syncStatusFilterUI();
      renderLiveRooms();
      document.getElementById('liveDirectorySection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  windowPresetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.windowPreset;
      if (preset === 'now') {
        switchWindow(computeWindowFromOffset(0));
      } else if (preset === 'plus1') {
        switchWindow({ ...computeWindowFromOffset(1), preset: 'plus1' });
      } else if (preset === 'plus2') {
        switchWindow({ ...computeWindowFromOffset(2), preset: 'plus2' });
      }
    });
  });

  if (resetToLiveNowBtn) {
    resetToLiveNowBtn.addEventListener('click', () => {
      switchWindow(computeWindowFromOffset(0));
    });
  }

  refreshDashboardBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (activeWindow.isLive) {
        activeWindow = computeWindowFromOffset(0);
      }
      loadDashboardData({ refreshStatic: true });
    });
  });

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sortKey;
      if (!key) return;
      if (sortKey === key) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = key === 'capacity' ? -1 : 1;
      }
      sortButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      renderLiveRooms();
    });
  });

  if (toggleShowAllRoomsBtn) {
    toggleShowAllRoomsBtn.addEventListener('click', () => {
      showAllRooms = !showAllRooms;
      renderLiveRooms();
    });
  }

  facilityChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      const fac = btn.dataset.facility;
      if (activeFacilities.has(fac)) {
        activeFacilities.delete(fac);
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      } else {
        activeFacilities.add(fac);
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
      showAllRooms = false;
      renderLiveRooms();
    });
  });

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      activeStatus = 'all';
      requireLongWindow = false;
      showAllRooms = false;
      activeFacilities.clear();
      if (searchInput) searchInput.value = '';
      if (buildingFilter) buildingFilter.value = '';
      if (capacityFilter) capacityFilter.value = '0';
      if (filterOpenAllDayBtn) {
        filterOpenAllDayBtn.classList.remove('active');
        filterOpenAllDayBtn.setAttribute('aria-pressed', 'false');
      }
      facilityChips.forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      syncStatusFilterUI();
      renderDashboardView();
    });
  }

  // Initial Load
  await loadDashboardData({ refreshStatic: true });
});