document.addEventListener('DOMContentLoaded', () => {
  const buildings = window.RoomQ && window.RoomQ.buildings;
  const form = document.getElementById('assignmentForm');
  const buildingSelect = document.getElementById('assignmentBuilding');
  const floorSelect = document.getElementById('assignmentFloor');
  const roomSelect = document.getElementById('assignmentRoom');
  const dateInput = document.getElementById('assignmentDate');
  const startInput = document.getElementById('assignmentStart');
  const endInput = document.getElementById('assignmentEnd');
  const feedback = document.getElementById('assignmentFeedback');
  const list = document.getElementById('assignmentList');
  const count = document.getElementById('assignmentCount');
  const floorPlanCanvas = document.getElementById('assignmentFloorPlanCanvas');
  const floorPlanStage = document.getElementById('assignmentPlanStage');
  const floorPlanSourceLayer = document.getElementById('assignmentPlanSourceLayer');
  const floorPlanImage = document.querySelector('.assignment-floorplan-image');
  const floorPlanOverlayLayer = document.getElementById('assignmentPlanOverlayLayer');
  const floorPlanLabel = document.getElementById('assignmentFloorPlanLabel');
  const floorPlanEmpty = document.getElementById('assignmentFloorPlanEmpty');
  const submitButton = form.querySelector('button[type="submit"]');
  const authPanel = document.getElementById('adminSessionPanel');
  let records = [];
  let authenticated = false;

  const startTimePicker = window.RoomQTime.attach(
    document.getElementById('assignmentStartPicker'),
    startInput
  );
  const endTimePicker = window.RoomQTime.attach(
    document.getElementById('assignmentEndPicker'),
    endInput
  );

  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  dateInput.value = localDate;

  function getBuilding(id) {
    return buildings.find((building) => building.id === id);
  }

  function getFloor(building, id) {
    return building && building.floors.find((floor) => floor.id === id);
  }

  function getRoomNumber(floor, index, region) {
    return region.roomNumber !== undefined
      ? region.roomNumber
      : Number(floor.id) * 100 + index + 1;
  }

  function getRoomLabel(floor, index, region) {
    const roomNumber = getRoomNumber(floor, index, region);
    if (region.name) {
      return roomNumber === null ? region.name : `Room ${roomNumber} · ${region.name}`;
    }
    return `Room ${roomNumber}`;
  }

  function renderFloorPlan() {
    const building = getBuilding(buildingSelect.value);
    const floor = getFloor(building, floorSelect.value);
    floorPlanOverlayLayer.replaceChildren();

    if (!building || !floor) {
      floorPlanStage.hidden = true;
      floorPlanEmpty.hidden = false;
      floorPlanLabel.textContent = building
        ? `${building.name} · Select a floor`
        : 'Choose a building and floor';
      floorPlanEmpty.textContent = building && !building.floors.length
        ? 'No mapped floor layout is available for this building.'
        : 'Select a building and floor to preview its layout.';
      return;
    }

    const source = window.RoomQ.floorPlanSource;
    const crop = floor.crop;
    const scale = Math.min(
      Math.max(100, floorPlanCanvas.clientWidth - 24) / crop.width,
      Math.max(120, floorPlanCanvas.clientHeight - 24) / crop.height
    );
    floorPlanLabel.textContent = `${building.name} · ${floor.label}`;
    floorPlanStage.hidden = false;
    floorPlanEmpty.hidden = true;
    floorPlanStage.style.width = `${crop.width * scale}px`;
    floorPlanStage.style.height = `${crop.height * scale}px`;
    floorPlanSourceLayer.style.left = `${-crop.x * scale}px`;
    floorPlanSourceLayer.style.top = `${-crop.y * scale}px`;
    floorPlanSourceLayer.style.width = `${source.width * scale}px`;
    floorPlanSourceLayer.style.height = `${source.height * scale}px`;
    floorPlanImage.style.width = `${source.width * scale}px`;
    floorPlanImage.style.height = `${source.height * scale}px`;
    floorPlanOverlayLayer.style.width = `${source.width * scale}px`;
    floorPlanOverlayLayer.style.height = `${source.height * scale}px`;

    floor.staffRooms.forEach((staffRoom) => {
      const marker = document.createElement('span');
      marker.className = 'staff-room-region';
      marker.style.left = `${staffRoom.x * scale}px`;
      marker.style.top = `${staffRoom.y * scale}px`;
      marker.style.width = `${staffRoom.width * scale}px`;
      marker.style.height = `${staffRoom.height * scale}px`;
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', 'Office or staff room');
      floorPlanOverlayLayer.append(marker);
    });

    floor.regions.forEach((region, index) => {
      const roomNumber = getRoomNumber(floor, index, region);
      const roomLabel = getRoomLabel(floor, index, region);
      const overlay = document.createElement('button');
      overlay.type = 'button';
      overlay.className = 'classroom-region-overlay is-available';
      overlay.classList.toggle('is-selected', roomSelect.value === region.id);
      overlay.style.left = `${region.x * scale}px`;
      overlay.style.top = `${region.y * scale}px`;
      overlay.style.width = `${region.width * scale}px`;
      overlay.style.height = `${region.height * scale}px`;
      overlay.dataset.regionId = region.id;
      overlay.textContent = region.name || (roomNumber === null ? 'Room' : String(roomNumber));
      overlay.title = `${roomLabel} · ${building.name} · ${floor.label}`;
      overlay.setAttribute('aria-label', `${roomLabel}, ${building.name}, ${floor.label}. Select this room.`);
      overlay.addEventListener('click', () => {
        roomSelect.value = region.id;
        roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      floorPlanOverlayLayer.append(overlay);
    });
  }

  async function loadRecords() {
    try {
      records = await window.RoomQApi.request('/api/schedules?kind=reservation');
      renderRecords();
    } catch (error) {
      feedback.textContent = `Reservations could not be loaded: ${error.message}`;
    }
  }

  function updateFloors() {
    const building = getBuilding(buildingSelect.value);
    floorSelect.replaceChildren(new Option('Select a floor', ''));
    roomSelect.replaceChildren(new Option('Select a room', ''));
    floorSelect.disabled = !building || !building.floors.length;
    roomSelect.disabled = true;

    if (!building) {
      renderFloorPlan();
      return;
    }

    building.floors.forEach((floor) => {
      floorSelect.append(new Option(floor.label, floor.id));
    });
    renderFloorPlan();
  }

  function updateRooms() {
    const building = getBuilding(buildingSelect.value);
    const floor = getFloor(building, floorSelect.value);
    roomSelect.replaceChildren(new Option('Select a room', ''));
    roomSelect.disabled = !floor;
    if (!floor) {
      renderFloorPlan();
      return;
    }

    floor.regions.forEach((region, index) => {
      roomSelect.append(new Option(getRoomLabel(floor, index, region), region.id));
    });
    renderFloorPlan();
  }

  function renderRecords() {
    list.replaceChildren();
    count.textContent = String(records.length);
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'assignment-empty';
      empty.textContent = 'No room-use assignments have been saved yet.';
      list.append(empty);
      return;
    }

    const sortedRecords = [...records].sort((left, right) =>
      left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)
    );
    sortedRecords.forEach((record) => {
      const item = document.createElement('article');
      item.className = 'assignment-record';

      const copy = document.createElement('div');
      copy.className = 'assignment-record-copy';
      const title = document.createElement('strong');
      const room = record.classroom;
      title.textContent = room
        ? room.roomNumber === null
          ? room.name || 'Named room'
          : `Room ${room.roomNumber}${room.name ? ` · ${room.name}` : ''}`
        : 'Unassigned room';
      const description = document.createElement('span');
      description.textContent = `${room ? `${room.buildingName} · ${room.floorLabel} · ` : ''}${record.date} · ${window.RoomQTime.format(record.startTime)}–${window.RoomQTime.format(record.endTime)}`;
      copy.append(title, description);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'room-use-remove';
      removeButton.textContent = 'Remove';
      removeButton.disabled = !authenticated;
      removeButton.setAttribute('aria-label', `Remove room reservation on ${record.date}`);
      removeButton.addEventListener('click', async () => {
        removeButton.disabled = true;
        try {
          await window.RoomQApi.request(`/api/schedules/${record.id}`, { method: 'DELETE' });
          feedback.textContent = 'Removed the room reservation.';
          await loadRecords();
        } catch (error) {
          feedback.textContent = error.message;
          removeButton.disabled = !authenticated;
        }
      });

      item.append(copy, removeButton);
      list.append(item);
    });
  }

  async function saveAssignment(event) {
    event.preventDefault();
    if (!authenticated) {
      feedback.textContent = 'Sign in as an administrator before saving reservations.';
      return;
    }

    const building = getBuilding(buildingSelect.value);
    const floor = getFloor(building, floorSelect.value);
    const regionIndex = floor
      ? floor.regions.findIndex((region) => region.id === roomSelect.value)
      : -1;
    const region = floor && floor.regions[regionIndex];
    if (!building || !floor || !region) {
      feedback.textContent = 'Select a building, floor, and room before saving.';
      return;
    }

    const date = dateInput.value;
    const startTime = startInput.value;
    const endTime = endInput.value;
    if (!date || !startTime || !endTime) {
      feedback.textContent = 'Enter a date and choose both start and end times.';
      return;
    }
    if (startTime >= endTime) {
      feedback.textContent = 'The end time must be later than the start time.';
      return;
    }

    const roomLabel = getRoomLabel(floor, regionIndex, region);
    submitButton.disabled = true;
    try {
      await window.RoomQApi.request('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'reservation',
          classroomId: `${building.id}-${floor.id}-${region.id}`,
          recurrence: 'once',
          date,
          startTime,
          endTime
        })
      });
      feedback.textContent = `Saved ${roomLabel} for ${date}, ${window.RoomQTime.format(startTime)}–${window.RoomQTime.format(endTime)}.`;
      await loadRecords();
      form.reset();
      dateInput.value = localDate;
      updateFloors();
      startTimePicker.setValue('');
      endTimePicker.setValue('');
    } catch (error) {
      const overlap = error.conflict && error.conflict.overlapPeriod;
      feedback.textContent = overlap
        ? `Room conflict from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}. No reservation was saved.`
        : error.message;
    } finally {
      submitButton.disabled = !authenticated;
    }
  }

  if (!Array.isArray(buildings) || !buildings.length) {
    feedback.textContent = 'Classroom layout data is unavailable; assignments cannot be created.';
    submitButton.disabled = true;
    return;
  }

  buildings.forEach((building) => {
    buildingSelect.append(new Option(building.name, building.id));
  });
  buildingSelect.addEventListener('change', updateFloors);
  floorSelect.addEventListener('change', updateRooms);
  roomSelect.addEventListener('change', renderFloorPlan);
  form.addEventListener('submit', saveAssignment);
  window.addEventListener('resize', renderFloorPlan);

  window.RoomQApi.mountAdminPanel(authPanel, (user) => {
    authenticated = Boolean(user && user.role === 'admin');
    submitButton.disabled = !authenticated;
    renderRecords();
  });
  loadRecords();
});
