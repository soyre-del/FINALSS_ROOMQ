document.addEventListener('DOMContentLoaded', () => {
  const { buildings, floorPlanSource } = window.RoomQ;
  const sourceWidth = floorPlanSource.width;
  const sourceHeight = floorPlanSource.height;
  if (!document.getElementById('buildingSelector')) {
    return;
  }

  const buildingSelector = document.getElementById('buildingSelector');
  const floorSelector = document.getElementById('floorSelector');
  const floorPlanHeading = document.getElementById('floorPlanHeading');
  const floorPlanEmpty = document.getElementById('floorPlanEmpty');
  const layoutEmptyTitle = document.getElementById('layoutEmptyTitle');
  const layoutEmptyCopy = document.getElementById('layoutEmptyCopy');
  const detailsBuilding = document.getElementById('detailsBuilding');
  const detailsFloor = document.getElementById('detailsFloor');
  const detailsCategory = document.getElementById('detailsCategory');
  const detailsCapacity = document.getElementById('detailsCapacity');
  const detailsFacilities = document.getElementById('detailsFacilities');
  const detailsStatus = document.getElementById('detailsStatus');
  const detailsStatusDot = document.getElementById('detailsStatusDot');
  const selectedRoomName = document.getElementById('selectedRoomName');
  const roomSelectionDescription = document.getElementById('roomSelectionDescription');
  const scheduleEmpty = document.getElementById('scheduleEmpty');
  const availabilityDate = document.getElementById('availabilityDate');
  const availabilityStart = document.getElementById('availabilityStart');
  const availabilityEnd = document.getElementById('availabilityEnd');
  const availabilityStartPicker = window.RoomQTime.attach(
    document.getElementById('availabilityStartPicker'),
    availabilityStart
  );
  const availabilityEndPicker = window.RoomQTime.attach(
    document.getElementById('availabilityEndPicker'),
    availabilityEnd
  );
  const availabilityNote = document.getElementById('availabilityNote');
  const availabilitySearch = document.getElementById('availabilitySearch');
  const viewFullScheduleLink = document.getElementById('viewFullScheduleLink');
  const roomBookingDialog = document.getElementById('roomBookingDialog');
  const roomBookingCancel = document.getElementById('roomBookingCancel');
  const roomBookingRoom = document.getElementById('roomBookingRoom');
  const roomBookingForm = document.getElementById('roomBookingForm');
  const roomBookingDate = document.getElementById('roomBookingDate');
  const roomBookingStart = document.getElementById('roomBookingStart');
  const roomBookingEnd = document.getElementById('roomBookingEnd');
  const roomBookingFeedback = document.getElementById('roomBookingFeedback');
  const roomBookingSubmit = document.getElementById('roomBookingSubmit');
  const roomBookingAuthPanel = document.getElementById('roomBookingAuthPanel');
  const roomBookingAuthNote = document.getElementById('roomBookingAuthNote');
  const roomBookingLoginLink = document.getElementById('roomBookingLoginLink');
  const roomBookingStartPicker = window.RoomQTime.attach(
    document.getElementById('roomBookingStartPicker'),
    roomBookingStart
  );
  const roomBookingEndPicker = window.RoomQTime.attach(
    document.getElementById('roomBookingEndPicker'),
    roomBookingEnd
  );
  const openBookingDialogBtn = document.getElementById('openBookingDialogBtn');
  const openBookingBtnText = document.getElementById('openBookingBtnText');
  const topbarBookBtn = document.getElementById('topbarBookBtn');
  const guideReserveBtn = document.getElementById('guideReserveBtn');
  const floorPlanCanvas = document.getElementById('floorPlanCanvas');
  const planStage = document.getElementById('planStage');
  const planSourceLayer = document.getElementById('planSourceLayer');
  const roomOverlayLayer = document.getElementById('roomOverlayLayer');
  const canvasCaption = document.getElementById('canvasCaption');
  const zoomLevel = document.getElementById('zoomLevel');
  const zoomOutButton = document.getElementById('zoomOutButton');
  const zoomInButton = document.getElementById('zoomInButton');
  const fitPlanButton = document.getElementById('fitPlanButton');

  let currentBuilding = null;
  let currentFloor = null;
  let selectedRegionId = null;
  let availabilityRecords = [];
  let scheduleRecords = [];
  let availabilityError = '';
  let availabilityRequestId = 0;
  let bookingAuthenticated = false;
  let fitScale = 1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dragState = null;

  buildingSelector.append(new Option('All buildings', 'all'));
  for (const building of buildings) {
    const option = document.createElement('option');
    option.value = building.id;
    option.textContent = building.name;
    buildingSelector.append(option);
  }
  buildingSelector.value = buildings[0].id;

  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const now = new Date();
  availabilityDate.value = localDate;
  let startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const endDate = new Date(now.getTime() + 60 * 60000);
  let endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  if (endDate.toDateString() !== now.toDateString()) {
    endTime = '23:59';
    if (startTime >= endTime) {
      startTime = '22:59';
    }
  }
  availabilityStartPicker.setValue(startTime);
  availabilityEndPicker.setValue(endTime);

  function getBuilding(id) {
    return buildings.find((building) => building.id === id);
  }

  function getSelectedBuilding() {
    return getBuilding(buildingSelector.value);
  }

  function getRoomAvailability(regionId) {
    return availabilityRecords.find((record) =>
      record.buildingId === currentBuilding?.id &&
      record.floorId === currentFloor?.id &&
      record.regionId === regionId
    ) || null;
  }

  function setStatusClasses(element, status) {
    element.classList.toggle('is-available', status === 'available');
    element.classList.toggle('is-unavailable', status === 'occupied' || status === 'reserved');
    element.classList.toggle('is-unknown', status === 'unknown');
    element.classList.toggle('is-reserved', status === 'reserved');
    element.dataset.status = status;
  }

  function updateSelectedRoomStatus() {
    if (!currentFloor || !selectedRegionId) {
      return;
    }

    const region = currentFloor.regions.find((item) => item.id === selectedRegionId);
    if (!region) {
      return;
    }

    const room = getRoomAvailability(region.id);
    const status = availabilityError || !room ? 'unknown' : room.status;
    detailsStatus.textContent = status === 'available'
      ? 'Available during the selected period'
      : status === 'occupied'
        ? 'Occupied during the selected period'
        : status === 'reserved'
          ? 'Reserved during the selected period'
          : 'Availability could not be checked';
    setStatusClasses(detailsStatus, status);
    setStatusClasses(detailsStatusDot, status);
  }

  function updateAvailabilityNote() {
    roomOverlayLayer.querySelectorAll('.classroom-region-overlay').forEach((overlay) => {
      const room = getRoomAvailability(overlay.dataset.regionId);
      const status = availabilityError || !room ? 'unknown' : room.status;
      setStatusClasses(overlay, status);
      const statusLabel = status === 'available'
        ? 'Available'
        : status === 'occupied'
          ? 'Occupied'
          : status === 'reserved'
            ? 'Reserved'
            : 'Availability unknown';
      overlay.title = `${overlay.dataset.roomTitle} · ${statusLabel}`;
      overlay.setAttribute('aria-label', `${overlay.dataset.roomTitle}; ${statusLabel}`);
    });
    if (availabilityError) {
      availabilityNote.textContent = availabilityError;
    } else if (!availabilityRecords.length) {
      availabilityNote.textContent = 'No mapped classrooms match the selected building and floor.';
    } else {
      availabilityNote.textContent = `${availabilityRecords.length} classrooms checked for ${availabilityDate.value}, ${window.RoomQTime.format(availabilityStart.value)}–${window.RoomQTime.format(availabilityEnd.value)}.`;
    }
    updateSelectedRoomStatus();
    renderClassroomDirectory();
  }

  const directoryCards = document.getElementById('classroomsDirectoryCards');
  const directoryEmpty = document.getElementById('classroomsDirectoryEmpty');
  const statusFilterButtons = [...document.querySelectorAll('#classroomsStatusFilters [data-status-filter]')];
  let activeDirectoryStatus = 'all';

  function statusOrder(status) {
    if (status === 'available') return 0;
    if (status === 'reserved') return 1;
    if (status === 'occupied') return 2;
    return 3;
  }

  function formatRoomTitle(room) {
    if (room.roomNumber === null || room.roomNumber === undefined) {
      return room.name || 'Named room';
    }
    return room.name ? `Room ${room.roomNumber} · ${room.name}` : `Room ${room.roomNumber}`;
  }

  function renderClassroomDirectory() {
    if (!directoryCards) return;

    const filtered = availabilityRecords
      .filter((room) => {
        if (activeDirectoryStatus !== 'all' && room.status !== activeDirectoryStatus) {
          return false;
        }
        return true;
      })
      .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || (a.buildingName || '').localeCompare(b.buildingName || ''));

    directoryCards.replaceChildren();

    filtered.forEach((room) => {
      const card = document.createElement('article');
      card.className = `room-card room-${room.status}`;
      card.style.cursor = 'pointer';

      const top = document.createElement('div');
      top.className = 'room-card-top';

      const symbol = document.createElement('span');
      symbol.className = 'room-symbol';
      symbol.textContent = room.roomNumber === null || room.roomNumber === undefined ? 'R' : String(room.roomNumber).slice(-2);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'room-status';
      statusBadge.textContent = room.status[0].toUpperCase() + room.status.slice(1);
      top.append(symbol, statusBadge);

      const title = document.createElement('h3');
      title.textContent = formatRoomTitle(room);

      const location = document.createElement('p');
      location.textContent = `${room.buildingName || ''} · ${room.floorLabel || ''}`;

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
      details.textContent = Array.isArray(room.schedules) && room.schedules.length
        ? `${room.schedules[0].course || 'Classroom schedule'} · ${window.RoomQTime.format(room.schedules[0].startTime)}–${window.RoomQTime.format(room.schedules[0].endTime)}`
        : 'Open during this selected time';

      const cta = document.createElement('span');
      cta.className = 'room-card-cta';
      cta.textContent = 'Locate on floor plan →';

      card.append(top, title, location);
      if (meta.childElementCount > 0) {
        card.append(meta);
      }
      card.append(details, cta);

      card.addEventListener('click', () => {
        if (room.buildingId && (!currentBuilding || currentBuilding.id !== room.buildingId)) {
          buildingSelector.value = room.buildingId;
          updateBuilding(room.floorId);
        } else if (room.floorId && (!currentFloor || currentFloor.id !== room.floorId)) {
          floorSelector.value = room.floorId;
          updateFloor();
        }
        if (currentFloor && room.regionId) {
          const idx = currentFloor.regions.findIndex((r) => r.id === room.regionId);
          if (idx >= 0) {
            selectRegion(currentFloor.regions[idx], idx);
          }
        }
        floorPlanCanvas?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      directoryCards.append(card);
    });

    if (directoryEmpty) {
      directoryEmpty.hidden = filtered.length > 0;
      if (!filtered.length) {
        directoryEmpty.textContent = availabilityRecords.length
          ? 'No classrooms match the selected status filter.'
          : 'No classroom availability records loaded for this search range.';
      }
    }
  }

  statusFilterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDirectoryStatus = btn.dataset.statusFilter || 'all';
      statusFilterButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderClassroomDirectory();
    });
  });

  async function searchAvailability() {
    const requestId = ++availabilityRequestId;
    if (!availabilityDate.value || !availabilityStart.value || !availabilityEnd.value ||
        availabilityStart.value >= availabilityEnd.value) {
      availabilityError = 'Choose a valid date and ensure the end time is later than the start time.';
      availabilityRecords = [];
      scheduleRecords = [];
      availabilitySearch.disabled = false;
      updateAvailabilityNote();
      return;
    }
    availabilitySearch.disabled = true;
    availabilityNote.textContent = 'Checking classroom schedules…';
    const params = new URLSearchParams({
      date: availabilityDate.value,
      startTime: availabilityStart.value,
      endTime: availabilityEnd.value
    });
    if (buildingSelector.value !== 'all') {
      params.set('buildingId', buildingSelector.value);
    }
    if (floorSelector.value && !floorSelector.disabled) {
      params.set('floorId', floorSelector.value);
    }
    try {
      const [nextAvailability, nextSchedules] = await Promise.all([
        window.RoomQApi.request(`/api/availability?${params}`),
        window.RoomQApi.request('/api/schedules')
      ]);
      if (requestId !== availabilityRequestId) {
        return;
      }
      availabilityRecords = nextAvailability;
      scheduleRecords = nextSchedules;
      availabilityError = '';
    } catch (error) {
      if (requestId !== availabilityRequestId) {
        return;
      }
      availabilityRecords = [];
      scheduleRecords = [];
      availabilityError = `Availability could not be checked: ${error.message}`;
    } finally {
      if (requestId === availabilityRequestId) {
        availabilitySearch.disabled = false;
        updateAvailabilityNote();
      }
    }
  }

  function updateTransform() {
    planStage.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOutButton.disabled = !currentFloor || zoom <= 1;
    zoomInButton.disabled = !currentFloor || zoom >= 3;
    fitPlanButton.disabled = !currentFloor;
  }

  function showNoLayout(building) {
    currentFloor = null;
    selectedRegionId = null;
    roomOverlayLayer.replaceChildren();
    planStage.hidden = true;
    floorPlanEmpty.hidden = false;
    floorPlanHeading.textContent = building.name;
    layoutEmptyTitle.textContent = `${building.name} layout is not in the supplied image`;
    layoutEmptyCopy.textContent = 'Add this building’s actual floor plan to enable floor navigation and room selection. No layout or room positions will be generated.';
    canvasCaption.lastChild.textContent = 'No source layout is available for this building';
    floorSelector.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No floor layout available';
    floorSelector.append(option);
    floorSelector.disabled = true;
    zoom = 1;
    panX = 0;
    panY = 0;
    updateTransform();
    resetRoomDetails(building);
  }

  function setFloorOptions(building) {
    floorSelector.replaceChildren();
    floorSelector.disabled = building.floors.length === 0;

    for (const item of building.floors) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      floorSelector.append(option);
    }

    if (building.floors.length) {
      floorSelector.value = building.floors[0].id;
      return building.floors[0];
    }

    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No floor layout available';
    floorSelector.append(option);
    return null;
  }

  function resetRoomDetails(building) {
    selectedRegionId = null;
    selectedRoomName.textContent = 'No classroom selected';
    roomSelectionDescription.textContent = 'Select a room region to inspect its availability.';
    detailsBuilding.textContent = building.name;
    detailsFloor.textContent = currentFloor ? currentFloor.label : 'Not available';
    detailsCategory.textContent = '—';
    detailsCapacity.textContent = 'Not recorded';
    detailsFacilities.textContent = 'Not recorded';
    detailsStatus.textContent = 'Select a room to check availability';
    setStatusClasses(detailsStatus, 'unknown');
    setStatusClasses(detailsStatusDot, 'unknown');
    scheduleEmpty.textContent = 'Select a room to view its schedule.';
    if (openBookingDialogBtn) {
      openBookingDialogBtn.disabled = true;
    }
    if (openBookingBtnText) {
      openBookingBtnText.textContent = 'Book this Classroom';
    }
    if (roomBookingDialog.open) {
      roomBookingDialog.close();
    }
    roomBookingFeedback.textContent = '';
  }

  function getRoomNumber(index, region) {
    const mappedRegion = region || currentFloor.regions[index];
    if (mappedRegion.roomNumber !== undefined) {
      return mappedRegion.roomNumber;
    }
    return Number(currentFloor.id) * 100 + index + 1;
  }

  function renderSelectedRoomSchedule(region) {
    scheduleEmpty.replaceChildren();
    const room = getRoomAvailability(region.id);
    const records = scheduleRecords
      .filter((record) => room && record.classroomId === room.id)
      .sort((left, right) =>
        (left.date || left.startDate).localeCompare(right.date || right.startDate) ||
        left.startTime.localeCompare(right.startTime)
      );

    if (!records.length) {
      scheduleEmpty.textContent = 'No schedules are recorded for this classroom.';
      return;
    }

    records.forEach((record) => {
      const entry = document.createElement('p');
      entry.className = 'room-use-schedule-entry';
      const days = record.recurrence === 'weekly'
        ? record.daysOfWeek.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')
        : record.date;
      const title = record.kind === 'reservation'
        ? 'Room reservation'
        : `${record.course} · ${record.section}`;
      entry.textContent = `${days} · ${title} · ${window.RoomQTime.format(record.startTime)}–${window.RoomQTime.format(record.endTime)}`;
      scheduleEmpty.append(entry);
    });
  }

  function openBookingDialogForRoom(region = null, index = null) {
    let targetRegion = region;
    let targetIndex = index;

    if (!targetRegion && selectedRegionId && currentFloor) {
      targetIndex = currentFloor.regions.findIndex((r) => r.id === selectedRegionId);
      if (targetIndex >= 0) {
        targetRegion = currentFloor.regions[targetIndex];
      }
    }

    if (!targetRegion && currentFloor && Array.isArray(currentFloor.regions) && currentFloor.regions.length > 0) {
      const availableRoom = currentFloor.regions.find((r) => {
        const rec = getRoomAvailability(r.id);
        return rec && rec.status === 'available';
      });
      targetRegion = availableRoom || currentFloor.regions[0];
      targetIndex = currentFloor.regions.indexOf(targetRegion);
      selectRegion(targetRegion, targetIndex);
    }

    if (!targetRegion || !currentBuilding || !currentFloor) {
      const bSelector = document.getElementById('buildingSelector');
      if (bSelector) {
        bSelector.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bSelector.focus();
      }
      return;
    }

    const roomNumber = getRoomNumber(targetIndex, targetRegion);
    const roomName = targetRegion.name
      ? (roomNumber === null ? targetRegion.name : `Room ${roomNumber} · ${targetRegion.name}`)
      : `Room ${roomNumber}`;

    roomBookingRoom.textContent = `${currentBuilding.name} · ${currentFloor.label} · ${roomName}`;
    const returnParams = new URLSearchParams({
      building: currentBuilding.id,
      floor: currentFloor.id,
      room: targetRegion.id
    });
    const currentPath = window.location.pathname.startsWith('/admin/')
      ? '/admin/classrooms.html'
      : '/user/classrooms.html';
    roomBookingLoginLink.href = `/user/login.html?returnTo=${encodeURIComponent(`${currentPath}?${returnParams}`)}`;
    roomBookingDate.value = availabilityDate.value || localDate;
    roomBookingStartPicker.setValue(availabilityStart.value);
    roomBookingEndPicker.setValue(availabilityEnd.value);
    roomBookingFeedback.textContent = '';
    roomBookingFeedback.classList.remove('is-error');

    if (!roomBookingDialog.open) {
      roomBookingDialog.showModal();
    }
  }

  function selectRegion(region, index) {
    selectedRegionId = region.id;
    roomOverlayLayer.querySelectorAll('.classroom-region-overlay').forEach((overlay) => {
      overlay.classList.toggle('is-selected', overlay.dataset.regionId === region.id);
    });

    const roomNumber = getRoomNumber(index, region);
    const roomName = region.name
      ? (roomNumber === null ? region.name : `Room ${roomNumber} · ${region.name}`)
      : `Room ${roomNumber}`;
    selectedRoomName.textContent = roomName;

    if (openBookingDialogBtn) {
      openBookingDialogBtn.disabled = false;
    }
    if (openBookingBtnText) {
      openBookingBtnText.textContent = `Book ${roomName}`;
    }

    roomBookingRoom.textContent = `${currentBuilding.name} · ${currentFloor.label} · ${roomName}`;
    const returnParams = new URLSearchParams({
      building: currentBuilding.id,
      floor: currentFloor.id,
      room: region.id
    });
    const currentPath = window.location.pathname.startsWith('/admin/')
      ? '/admin/classrooms.html'
      : '/user/classrooms.html';
    roomBookingLoginLink.href = `/user/login.html?returnTo=${encodeURIComponent(`${currentPath}?${returnParams}`)}`;
    roomBookingDate.value = availabilityDate.value || localDate;
    roomBookingStartPicker.setValue(availabilityStart.value);
    roomBookingEndPicker.setValue(availabilityEnd.value);
    roomBookingFeedback.textContent = '';
    roomBookingFeedback.classList.remove('is-error');
    roomSelectionDescription.textContent = region.name
      ? 'Named room on the selected floor plan.'
      : "Numbered by the selected floor's convention.";
    detailsBuilding.textContent = currentBuilding.name;
    detailsFloor.textContent = currentFloor.label;
    const scheduleQuery = new URLSearchParams({
      building: currentBuilding.id,
      floor: currentFloor.id,
      room: `${currentBuilding.id}-${currentFloor.id}-${region.id}`
    });
    const isAdmin = window.location.pathname.startsWith('/admin/');
    viewFullScheduleLink.href = isAdmin ? `schedules.html?${scheduleQuery}` : `/admin/schedules.html?${scheduleQuery}`;
    const room = getRoomAvailability(region.id);
    detailsCategory.textContent = region.name ? 'Named classroom' : 'Classroom';
    detailsCapacity.textContent = room && room.capacity !== null
      ? String(room.capacity)
      : 'Not recorded';
    detailsFacilities.textContent = room && room.facilities.length
      ? room.facilities.join(', ')
      : 'Not recorded';
    renderSelectedRoomSchedule(region);
    updateSelectedRoomStatus();
  }

  async function saveRoomBooking(event) {
    event.preventDefault();
    if (!bookingAuthenticated) {
      roomBookingFeedback.textContent = 'Sign in before booking a room.';
      roomBookingFeedback.classList.add('is-error');
      return;
    }

    const building = currentBuilding;
    const floor = currentFloor;
    const region = floor && floor.regions.find((item) => item.id === selectedRegionId);
    if (!building || !floor || !region) {
      roomBookingFeedback.textContent = 'Select a classroom before booking.';
      roomBookingFeedback.classList.add('is-error');
      return;
    }
    if (!roomBookingDate.value || !roomBookingStart.value || !roomBookingEnd.value) {
      roomBookingFeedback.textContent = 'Choose a date and both booking times.';
      roomBookingFeedback.classList.add('is-error');
      return;
    }
    if (roomBookingStart.value >= roomBookingEnd.value) {
      roomBookingFeedback.textContent = 'The end time must be later than the start time.';
      roomBookingFeedback.classList.add('is-error');
      return;
    }

    const regionIndex = floor.regions.indexOf(region);
    const roomNumber = getRoomNumber(regionIndex, region);
    const roomName = region.name
      ? (roomNumber === null ? region.name : `Room ${roomNumber} · ${region.name}`)
      : `Room ${roomNumber}`;
    const buildingId = building.id;
    const floorId = floor.id;
    roomBookingSubmit.disabled = true;
    roomBookingFeedback.textContent = 'Saving reservation…';
    roomBookingFeedback.classList.remove('is-error');
    try {
      await window.RoomQApi.request('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'reservation',
          classroomId: `${buildingId}-${floorId}-${region.id}`,
          recurrence: 'once',
          date: roomBookingDate.value,
          startTime: roomBookingStart.value,
          endTime: roomBookingEnd.value
        })
      });
      roomBookingFeedback.textContent = `Booked ${roomName} for ${roomBookingDate.value}, ${window.RoomQTime.format(roomBookingStart.value)}–${window.RoomQTime.format(roomBookingEnd.value)}.`;
      await searchAvailability();
      if (currentBuilding?.id === buildingId &&
          currentFloor?.id === floorId &&
          selectedRegionId === region.id) {
        renderSelectedRoomSchedule(region);
      }
    } catch (error) {
      const overlap = error.conflict && error.conflict.overlapPeriod;
      roomBookingFeedback.textContent = overlap
        ? `Room conflict from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}. No reservation was saved.`
        : error.message;
      roomBookingFeedback.classList.add('is-error');
    } finally {
      roomBookingSubmit.disabled = !bookingAuthenticated;
    }
  }

  function renderFloor(resetView) {
    if (!currentBuilding || !currentFloor) {
      return;
    }

    if (resetView) {
      zoom = 1;
      panX = 0;
      panY = 0;
      resetRoomDetails(currentBuilding);
    }

    const crop = currentFloor.crop;
    const availableWidth = Math.max(100, floorPlanCanvas.clientWidth - 44);
    const availableHeight = Math.max(100, floorPlanCanvas.clientHeight - 52);
    fitScale = Math.min(
      availableWidth * 0.95 / crop.width,
      availableHeight * 0.95 / crop.height
    );

    planStage.hidden = false;
    floorPlanEmpty.hidden = true;
    planStage.style.width = `${crop.width * fitScale}px`;
    planStage.style.height = `${crop.height * fitScale}px`;
    planSourceLayer.style.left = `${-crop.x * fitScale}px`;
    planSourceLayer.style.top = `${-crop.y * fitScale}px`;
    planSourceLayer.style.width = `${sourceWidth * fitScale}px`;
    planSourceLayer.style.height = `${sourceHeight * fitScale}px`;
    roomOverlayLayer.style.width = `${sourceWidth * fitScale}px`;
    roomOverlayLayer.style.height = `${sourceHeight * fitScale}px`;
    floorPlanHeading.textContent = `${currentBuilding.name} · ${currentFloor.label}`;
    canvasCaption.lastChild.textContent = 'Drag to pan · Use the controls to zoom';

    roomOverlayLayer.replaceChildren();
    currentFloor.staffRooms.forEach((staffRoom) => {
      const marker = document.createElement('span');
      marker.className = 'staff-room-region';
      marker.style.left = `${staffRoom.x * fitScale}px`;
      marker.style.top = `${staffRoom.y * fitScale}px`;
      marker.style.width = `${staffRoom.width * fitScale}px`;
      marker.style.height = `${staffRoom.height * fitScale}px`;
      marker.title = staffRoom.name || 'Office / staff room (source plan)';
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', staffRoom.name || 'Office or staff room');
      if (staffRoom.name) {
        marker.textContent = staffRoom.name;
      }
      roomOverlayLayer.append(marker);
    });

    currentFloor.regions.forEach((region, index) => {
      const overlay = document.createElement('button');
      overlay.type = 'button';
      overlay.className = 'classroom-region-overlay';
      const roomNumber = getRoomNumber(index, region);
      const roomName = region.name
        ? (roomNumber === null ? region.name : `Room ${roomNumber} · ${region.name}`)
        : `Room ${roomNumber}`;
      overlay.style.left = `${region.x * fitScale}px`;
      overlay.style.top = `${region.y * fitScale}px`;
      overlay.style.width = `${region.width * fitScale}px`;
      overlay.style.height = `${region.height * fitScale}px`;
      overlay.dataset.regionId = region.id;
      overlay.dataset.roomTitle = `${roomName} · ${currentBuilding.name} · ${currentFloor.label}`;
      overlay.textContent = region.name || (roomNumber === null ? 'Room' : String(roomNumber));
      overlay.setAttribute(
        'aria-label',
        `${currentBuilding.name}, ${currentFloor.label}, ${roomName}; capacity and schedule data unavailable`
      );
      overlay.title = `${roomName} · ${currentBuilding.name} · ${currentFloor.label}`;
      const room = getRoomAvailability(region.id);
      setStatusClasses(overlay, room ? room.status : 'unknown');
      overlay.classList.toggle('is-selected', selectedRegionId === region.id);
      overlay.addEventListener('click', () => selectRegion(region, index));
      roomOverlayLayer.append(overlay);
    });

    detailsBuilding.textContent = currentBuilding.name;
    detailsFloor.textContent = currentFloor.label;
    updateTransform();
    updateAvailabilityNote();
  }

  function updateBuilding(preferredFloorId) {
    if (buildingSelector.value === 'all') {
      currentBuilding = null;
      currentFloor = null;
      selectedRegionId = null;
      roomOverlayLayer.replaceChildren();
      planStage.hidden = true;
      floorPlanEmpty.hidden = false;
      floorPlanHeading.textContent = 'All buildings';
      layoutEmptyTitle.textContent = 'Select a building to view its floor plan';
      layoutEmptyCopy.textContent = 'Availability results can include all mapped buildings. Choose one building to view its actual mapped floor plan.';
      canvasCaption.lastChild.textContent = 'Choose a building to display its floor plan';
      floorSelector.replaceChildren(new Option('Select a building first', ''));
      floorSelector.disabled = true;
      resetRoomDetails({ name: 'All buildings' });
      searchAvailability();
      return;
    }
    const building = getSelectedBuilding();
    if (!building) {
      return;
    }

    currentBuilding = building;
    selectedRegionId = null;
    currentFloor = setFloorOptions(building);

    if (!currentFloor) {
      showNoLayout(building);
      searchAvailability();
      return;
    }
    if (preferredFloorId && building.floors.some((floor) => floor.id === preferredFloorId)) {
      currentFloor = building.floors.find((floor) => floor.id === preferredFloorId);
      floorSelector.value = currentFloor.id;
    }

    resetRoomDetails(building);
    renderFloor(true);
    searchAvailability();
  }

  function updateFloor() {
    currentFloor = currentBuilding.floors.find((item) => item.id === floorSelector.value) || null;
    if (!currentFloor) {
      return;
    }
    renderFloor(true);
    searchAvailability();
  }

  function setZoom(value) {
    zoom = Math.max(1, Math.min(3, value));
    updateTransform();
  }

  buildingSelector.addEventListener('change', updateBuilding);
  floorSelector.addEventListener('change', updateFloor);
  availabilityDate.addEventListener('change', searchAvailability);
  availabilityStart.addEventListener('change', searchAvailability);
  availabilityEnd.addEventListener('change', searchAvailability);
  availabilitySearch.addEventListener('click', searchAvailability);

  // Quick availability presets
  const presetNow = document.getElementById('presetNow');
  const presetMorning = document.getElementById('presetMorning');
  const presetAfternoon = document.getElementById('presetAfternoon');

  function applyPreset(start, end) {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    availabilityDate.value = localIso;
    availabilityStartPicker.setValue(start);
    availabilityEndPicker.setValue(end);
    searchAvailability();
  }

  if (presetNow) {
    presetNow.addEventListener('click', () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const startH = now.getHours();
      const startM = Math.floor(now.getMinutes() / 10) * 10;
      const startStr = `${pad(startH)}:${pad(startM)}`;
      let endH = startH + 1;
      let endM = startM;
      if (endH >= 24) {
        endH = 23;
        endM = 59;
      }
      const endStr = `${pad(endH)}:${pad(endM)}`;
      applyPreset(startStr, endStr);
    });
  }
  if (presetMorning) {
    presetMorning.addEventListener('click', () => {
      applyPreset('08:00', '12:00');
    });
  }
  if (presetAfternoon) {
    presetAfternoon.addEventListener('click', () => {
      applyPreset('13:00', '17:00');
    });
  }
  roomBookingForm.addEventListener('submit', saveRoomBooking);
  roomBookingCancel.addEventListener('click', () => roomBookingDialog.close());
  roomBookingDialog.addEventListener('click', (event) => {
    if (event.target === roomBookingDialog) {
      roomBookingDialog.close();
    }
  });
  zoomOutButton.addEventListener('click', () => setZoom(zoom - 0.25));
  zoomInButton.addEventListener('click', () => setZoom(zoom + 0.25));
  fitPlanButton.addEventListener('click', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    updateTransform();
  });

  floorPlanCanvas.addEventListener('pointerdown', (event) => {
    if (!currentFloor || event.target.closest('.classroom-region-overlay')) {
      return;
    }
    dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
    floorPlanCanvas.setPointerCapture(event.pointerId);
    floorPlanCanvas.classList.add('is-panning');
  });

  floorPlanCanvas.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    panX = dragState.panX + event.clientX - dragState.x;
    panY = dragState.panY + event.clientY - dragState.y;
    updateTransform();
  });

  function stopPanning(event) {
    if (dragState && dragState.pointerId === event.pointerId) {
      dragState = null;
      floorPlanCanvas.classList.remove('is-panning');
    }
  }

  floorPlanCanvas.addEventListener('pointerup', stopPanning);
  floorPlanCanvas.addEventListener('pointercancel', stopPanning);
  floorPlanCanvas.addEventListener('wheel', (event) => {
    if (!currentFloor) {
      return;
    }
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.15 : -0.15));
  }, { passive: false });

  window.addEventListener('resize', () => {
    if (currentFloor) {
      renderFloor(false);
    }
  });

  const query = new URLSearchParams(window.location.search);
  const requestedBuilding = query.get('building');
  if (requestedBuilding && (requestedBuilding === 'all' || getBuilding(requestedBuilding))) {
    buildingSelector.value = requestedBuilding;
  }
  updateBuilding(query.get('floor') || undefined);
  window.RoomQApi.mountAdminPanel(roomBookingAuthPanel, (user) => {
    bookingAuthenticated = Boolean(user && ['admin', 'user'].includes(user.role));
    roomBookingSubmit.disabled = !bookingAuthenticated;
    roomBookingAuthNote.textContent = bookingAuthenticated
      ? 'You are signed in and can confirm this reservation.'
      : 'Sign in or create a user account to reserve this classroom.';
    roomBookingLoginLink.hidden = Boolean(user);
  });
  if (openBookingDialogBtn) {
    openBookingDialogBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openBookingDialogForRoom();
    });
  }

  if (topbarBookBtn) {
    topbarBookBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openBookingDialogForRoom();
    });
  }

  if (guideReserveBtn) {
    guideReserveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openBookingDialogForRoom();
    });
  }

  const navCheckAvailability = document.getElementById('navCheckAvailability');
  if (navCheckAvailability) {
    navCheckAvailability.addEventListener('click', (e) => {
      e.preventDefault();
      const dateInput = document.getElementById('availabilityDate');
      if (dateInput) {
        dateInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dateInput.focus();
      }
    });
  }

  const requestedRegion = query.get('room');
  if (requestedRegion && currentFloor) {
    const regionIndex = currentFloor.regions.findIndex((region) => region.id === requestedRegion);
    if (regionIndex >= 0) {
      selectRegion(currentFloor.regions[regionIndex], regionIndex);
    }
  }

  const shouldOpenBooking = query.get('book') === 'true';
  if (shouldOpenBooking) {
    openBookingDialogForRoom();
  }

  const statusParam = query.get('status');
  if (statusParam && ['all', 'available', 'occupied', 'reserved'].includes(statusParam)) {
    activeDirectoryStatus = statusParam;
    statusFilterButtons.forEach((b) => b.classList.toggle('active', b.dataset.statusFilter === statusParam));
    renderClassroomDirectory();
  }
});
