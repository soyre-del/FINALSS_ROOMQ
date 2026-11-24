document.addEventListener('DOMContentLoaded', () => {
  const buildings = window.RoomQ && window.RoomQ.buildings;

  // View tabs
  const tabBtnRooms = document.getElementById('tabBtnRooms');
  const tabBtnFaculty = document.getElementById('tabBtnFaculty');
  const paneRoom = document.getElementById('paneRoomAssignments');
  const paneFaculty = document.getElementById('paneFacultyAssignments');
  const pageTitle = document.getElementById('assignmentPageTitle');

  // Room Assignment elements
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
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const authPanel = document.getElementById('adminSessionPanel');

  // Faculty Assignment elements
  const facultyForm = document.getElementById('facultyAssignmentForm');
  const facultyInstructorInput = document.getElementById('facultyInstructor');
  const facultyCourseInput = document.getElementById('facultyCourse');
  const facultySectionInput = document.getElementById('facultySection');
  const facultyBuildingSelect = document.getElementById('facultyBuilding');
  const facultyFloorSelect = document.getElementById('facultyFloor');
  const facultyClassroomSelect = document.getElementById('facultyClassroom');
  const facultyRecurrenceSelect = document.getElementById('facultyRecurrence');
  const facultyWeekdaysField = document.getElementById('facultyWeekdaysField');
  const facultyDateField = document.getElementById('facultyDateField');
  const facultyDateInput = document.getElementById('facultyDate');
  const facultyStartInput = document.getElementById('facultyStartTime');
  const facultyEndInput = document.getElementById('facultyEndTime');
  const facultySubmitBtn = document.getElementById('facultySubmitButton');
  const facultyFeedback = document.getElementById('facultyFeedback');
  const facultyCount = document.getElementById('facultyCount');
  const facultyFilterInput = document.getElementById('facultyFilterInput');
  const facultyList = document.getElementById('facultyAssignmentsList');

  let records = [];
  let facultyRecords = [];
  let authenticated = false;

  // Time Pickers
  const startTimePicker = window.RoomQTime.attach(
    document.getElementById('assignmentStartPicker'),
    startInput
  );
  const endTimePicker = window.RoomQTime.attach(
    document.getElementById('assignmentEndPicker'),
    endInput
  );

  const facultyStartPicker = window.RoomQTime.attach(
    document.getElementById('facultyStartPicker'),
    facultyStartInput
  );
  const facultyEndPicker = window.RoomQTime.attach(
    document.getElementById('facultyEndPicker'),
    facultyEndInput
  );

  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  if (dateInput) dateInput.value = localDate;
  if (facultyDateInput) facultyDateInput.value = localDate;

  // Tab switching logic
  function switchTab(targetTab, updateHash = true) {
    const isFaculty = targetTab === 'faculty';
    if (tabBtnRooms && tabBtnFaculty && paneRoom && paneFaculty) {
      tabBtnRooms.classList.toggle('active', !isFaculty);
      tabBtnRooms.setAttribute('aria-selected', String(!isFaculty));
      tabBtnFaculty.classList.toggle('active', isFaculty);
      tabBtnFaculty.setAttribute('aria-selected', String(isFaculty));

      paneRoom.classList.toggle('active', !isFaculty);
      paneFaculty.classList.toggle('active', isFaculty);
    }
    if (pageTitle) {
      pageTitle.textContent = isFaculty ? 'Faculty Assignments' : 'Room Assignments';
    }
    if (updateHash) {
      history.replaceState(null, '', isFaculty ? '#faculty' : '#rooms');
    }
    if (!isFaculty) {
      setTimeout(renderFloorPlan, 50);
    }
  }

  if (tabBtnRooms) {
    tabBtnRooms.addEventListener('click', () => switchTab('rooms'));
  }
  if (tabBtnFaculty) {
    tabBtnFaculty.addEventListener('click', () => switchTab('faculty'));
  }

  function handleInitialHash() {
    const hash = window.location.hash.toLowerCase();
    if (hash.includes('faculty')) {
      switchTab('faculty', false);
    } else {
      switchTab('rooms', false);
    }
  }

  window.addEventListener('hashchange', handleInitialHash);

  // Common helpers
  function getBuilding(id) {
    return buildings && buildings.find((building) => building.id === id);
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

  /* -------------------------------------------------------------
   * Room Assignment & Floorplan preview logic
   * ------------------------------------------------------------- */
  function renderFloorPlan() {
    if (!floorPlanOverlayLayer || !floorPlanStage || !floorPlanEmpty || !floorPlanLabel) return;
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
      marker.title = staffRoom.name || 'Office / staff room (source plan)';
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', staffRoom.name || 'Office or staff room');
      if (staffRoom.name) {
        marker.textContent = staffRoom.name;
      }
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
      if (feedback) feedback.textContent = `Reservations could not be loaded: ${error.message}`;
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
    if (!list || !count) return;
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
      description.textContent = `${room ? `${room.buildingName} · ${room.floorLabel} · ` : ''}${record.date} · ${window.RoomQTime.format(record.startTime)}–${window.RoomQTime.format(record.endTime)}${record.createdByEmail ? ` · Reserved by ${record.createdByEmail}` : ''}`;
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
          if (feedback) feedback.textContent = 'Removed the room reservation.';
          await loadRecords();
        } catch (error) {
          if (feedback) feedback.textContent = error.message;
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
      if (feedback) feedback.textContent = 'Sign in as an administrator before saving reservations.';
      return;
    }

    const building = getBuilding(buildingSelect.value);
    const floor = getFloor(building, floorSelect.value);
    const regionIndex = floor
      ? floor.regions.findIndex((region) => region.id === roomSelect.value)
      : -1;
    const region = floor && floor.regions[regionIndex];
    if (!building || !floor || !region) {
      if (feedback) feedback.textContent = 'Select a building, floor, and room before saving.';
      return;
    }

    const date = dateInput.value;
    const startTime = startInput.value;
    const endTime = endInput.value;
    if (!date || !startTime || !endTime) {
      if (feedback) feedback.textContent = 'Enter a date and choose both start and end times.';
      return;
    }
    if (startTime >= endTime) {
      if (feedback) feedback.textContent = 'The end time must be later than the start time.';
      return;
    }

    const roomLabel = getRoomLabel(floor, regionIndex, region);
    if (submitButton) submitButton.disabled = true;
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
      if (feedback) feedback.textContent = `Saved ${roomLabel} for ${date}, ${window.RoomQTime.format(startTime)}–${window.RoomQTime.format(endTime)}.`;
      await loadRecords();
      form.reset();
      dateInput.value = localDate;
      updateFloors();
      startTimePicker.setValue('');
      endTimePicker.setValue('');
    } catch (error) {
      const overlap = error.conflict && error.conflict.overlapPeriod;
      if (feedback) {
        feedback.textContent = overlap
          ? `Room conflict from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}. No reservation was saved.`
          : error.message;
      }
    } finally {
      if (submitButton) submitButton.disabled = !authenticated;
    }
  }

  /* -------------------------------------------------------------
   * Faculty Assignment logic
   * ------------------------------------------------------------- */
  function updateFacultyFloors() {
    if (!facultyBuildingSelect || !facultyFloorSelect || !facultyClassroomSelect) return;
    const building = getBuilding(facultyBuildingSelect.value);
    facultyFloorSelect.replaceChildren(new Option('Select a floor', ''));
    facultyClassroomSelect.replaceChildren(new Option('Unassigned class', ''));
    facultyFloorSelect.disabled = !building || !building.floors.length;
    facultyClassroomSelect.disabled = true;

    if (!building) return;

    building.floors.forEach((floor) => {
      facultyFloorSelect.append(new Option(floor.label, floor.id));
    });
  }

  function updateFacultyRooms() {
    if (!facultyBuildingSelect || !facultyFloorSelect || !facultyClassroomSelect) return;
    const building = getBuilding(facultyBuildingSelect.value);
    const floor = getFloor(building, facultyFloorSelect.value);
    facultyClassroomSelect.replaceChildren(new Option('Unassigned class', ''));
    facultyClassroomSelect.disabled = !floor;
    if (!floor) return;

    floor.regions.forEach((region, index) => {
      const roomNumber = getRoomNumber(floor, index, region);
      const label = roomNumber === null
        ? region.name || 'Named room'
        : `Room ${roomNumber}${region.name ? ` · ${region.name}` : ''}`;
      facultyClassroomSelect.append(new Option(label, `${building.id}-${floor.id}-${region.id}`));
    });
  }

  function updateFacultyRecurrenceFields() {
    if (!facultyRecurrenceSelect || !facultyWeekdaysField || !facultyDateField) return;
    const isWeekly = facultyRecurrenceSelect.value === 'weekly';
    facultyWeekdaysField.hidden = !isWeekly;
    facultyDateField.hidden = isWeekly;
    if (facultyDateInput) facultyDateInput.required = !isWeekly;
  }

  async function loadFacultyAssignments() {
    try {
      const all = await window.RoomQApi.request('/api/schedules?kind=class');
      facultyRecords = Array.isArray(all) ? all : [];
      renderFacultyAssignments();
    } catch (error) {
      if (facultyFeedback) facultyFeedback.textContent = `Faculty assignments could not be loaded: ${error.message}`;
    }
  }

  const dayAbbreviations = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderFacultyAssignments() {
    if (!facultyList || !facultyCount) return;
    facultyList.replaceChildren();

    const searchTerm = facultyFilterInput ? facultyFilterInput.value.trim().toLowerCase() : '';
    const filtered = facultyRecords.filter((rec) => {
      if (!searchTerm) return true;
      const room = rec.classroom;
      const roomText = room ? `${room.buildingName} ${room.floorLabel} ${room.roomNumber} ${room.name}` : 'Unassigned';
      return [
        rec.instructor,
        rec.course,
        rec.section,
        roomText
      ].some((v) => String(v || '').toLowerCase().includes(searchTerm));
    });

    facultyCount.textContent = String(filtered.length);

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'assignment-empty';
      empty.textContent = facultyRecords.length
        ? 'No faculty assignments match your search filter.'
        : 'No faculty assignments have been recorded yet.';
      facultyList.append(empty);
      return;
    }

    const sorted = [...filtered].sort((a, b) =>
      a.instructor.localeCompare(b.instructor) || a.course.localeCompare(b.course)
    );

    sorted.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'assignment-record';

      const copy = document.createElement('div');
      copy.className = 'assignment-record-copy';

      const headerLine = document.createElement('div');
      headerLine.className = 'd-flex align-items-center gap-2 mb-1';

      const instructorEl = document.createElement('strong');
      instructorEl.textContent = item.instructor;

      const badge = document.createElement('span');
      badge.className = 'faculty-card-badge';
      const badgeIcon = document.createElement('i');
      badgeIcon.className = 'bi bi-person-fill';
      badge.append(badgeIcon, ` ${item.section}`);

      headerLine.append(instructorEl, badge);

      const courseLine = document.createElement('div');
      courseLine.className = 'text-dark fw-medium small mb-1';
      courseLine.textContent = item.course;

      const details = document.createElement('span');
      let scheduleText = '';
      if (item.recurrence === 'weekly') {
        const days = Array.isArray(item.daysOfWeek)
          ? item.daysOfWeek.map((d) => dayAbbreviations[d] || d).join(', ')
          : 'Weekly';
        scheduleText = `${days} · ${window.RoomQTime.format(item.startTime)}–${window.RoomQTime.format(item.endTime)}`;
      } else {
        scheduleText = `${item.date || 'Single day'} · ${window.RoomQTime.format(item.startTime)}–${window.RoomQTime.format(item.endTime)}`;
      }

      const room = item.classroom;
      const roomLabel = room
        ? `${room.buildingName} · ${room.floorLabel} · ${room.roomNumber === null ? room.name : `Room ${room.roomNumber}`}`
        : 'Unassigned classroom';

      details.textContent = `${scheduleText} · ${roomLabel}`;

      copy.append(headerLine, courseLine, details);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'room-use-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.disabled = !authenticated;
      removeBtn.setAttribute('aria-label', `Remove assignment for ${item.instructor}`);
      removeBtn.addEventListener('click', async () => {
        if (!window.confirm(`Remove assignment of ${item.instructor} for ${item.course} (${item.section})?`)) {
          return;
        }
        removeBtn.disabled = true;
        try {
          await window.RoomQApi.request(`/api/schedules/${item.id}`, { method: 'DELETE' });
          if (facultyFeedback) facultyFeedback.textContent = `Removed assignment for ${item.instructor}.`;
          await loadFacultyAssignments();
        } catch (error) {
          if (facultyFeedback) facultyFeedback.textContent = error.message;
          removeBtn.disabled = !authenticated;
        }
      });

      card.append(copy, removeBtn);
      facultyList.append(card);
    });
  }

  async function saveFacultyAssignment(event) {
    event.preventDefault();
    if (!authenticated) {
      if (facultyFeedback) facultyFeedback.textContent = 'Sign in as an administrator before saving faculty assignments.';
      return;
    }

    const instructor = facultyInstructorInput.value.trim();
    const course = facultyCourseInput.value.trim();
    const section = facultySectionInput.value.trim();
    const recurrence = facultyRecurrenceSelect.value;
    const startTime = facultyStartInput.value;
    const endTime = facultyEndInput.value;
    const classroomId = facultyClassroomSelect.value || null;

    if (!instructor || !course || !section || !startTime || !endTime) {
      if (facultyFeedback) facultyFeedback.textContent = 'Please fill out all required instructor, course, section, and time fields.';
      return;
    }

    if (startTime >= endTime) {
      if (facultyFeedback) facultyFeedback.textContent = 'The end time must be later than the start time.';
      return;
    }

    let payload = {
      kind: 'class',
      instructor,
      course,
      section,
      recurrence,
      startTime,
      endTime,
      classroomId: classroomId || null
    };

    if (recurrence === 'weekly') {
      const checkedDays = Array.from(facultyForm.querySelectorAll('input[name="facultyDay"]:checked'))
        .map((cb) => Number(cb.value));
      if (!checkedDays.length) {
        if (facultyFeedback) facultyFeedback.textContent = 'Please select at least one recurring weekday.';
        return;
      }
      payload.daysOfWeek = checkedDays;
      payload.startDate = localDate;
    } else {
      const date = facultyDateInput.value;
      if (!date) {
        if (facultyFeedback) facultyFeedback.textContent = 'Please select a date for the one-time assignment.';
        return;
      }
      payload.date = date;
    }

    if (facultySubmitBtn) facultySubmitBtn.disabled = true;
    try {
      await window.RoomQApi.request('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (facultyFeedback) facultyFeedback.textContent = `Assigned ${instructor} to ${course} (${section}).`;
      await loadFacultyAssignments();
      facultyForm.reset();
      if (facultyDateInput) facultyDateInput.value = localDate;
      facultyRecurrenceSelect.value = 'weekly';
      updateFacultyRecurrenceFields();
      updateFacultyFloors();
      facultyStartPicker.setValue('');
      facultyEndPicker.setValue('');
    } catch (error) {
      const conflict = error.conflict;
      if (conflict && conflict.overlapPeriod) {
        const overlap = conflict.overlapPeriod;
        const existing = conflict.existingSchedule;
        const msg = existing
          ? `Conflict with ${existing.course || 'Schedule'} (${existing.section || ''}) by ${existing.instructor || 'another user'} from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}.`
          : `Schedule conflict from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}.`;
        if (facultyFeedback) facultyFeedback.textContent = msg;
      } else {
        if (facultyFeedback) facultyFeedback.textContent = error.message;
      }
    } finally {
      if (facultySubmitBtn) facultySubmitBtn.disabled = !authenticated;
    }
  }

  // Initialization
  if (!Array.isArray(buildings) || !buildings.length) {
    if (feedback) feedback.textContent = 'Classroom layout data is unavailable; assignments cannot be created.';
    if (submitButton) submitButton.disabled = true;
    if (facultySubmitBtn) facultySubmitBtn.disabled = true;
    return;
  }

  buildings.forEach((building) => {
    if (buildingSelect) buildingSelect.append(new Option(building.name, building.id));
    if (facultyBuildingSelect) facultyBuildingSelect.append(new Option(building.name, building.id));
  });

  if (buildingSelect) buildingSelect.addEventListener('change', updateFloors);
  if (floorSelect) floorSelect.addEventListener('change', updateRooms);
  if (roomSelect) roomSelect.addEventListener('change', renderFloorPlan);
  if (form) form.addEventListener('submit', saveAssignment);
  window.addEventListener('resize', renderFloorPlan);

  // Faculty listeners
  if (facultyBuildingSelect) facultyBuildingSelect.addEventListener('change', updateFacultyFloors);
  if (facultyFloorSelect) facultyFloorSelect.addEventListener('change', updateFacultyRooms);
  if (facultyRecurrenceSelect) facultyRecurrenceSelect.addEventListener('change', updateFacultyRecurrenceFields);
  if (facultyForm) facultyForm.addEventListener('submit', saveFacultyAssignment);
  if (facultyFilterInput) facultyFilterInput.addEventListener('input', renderFacultyAssignments);

  // Mount Admin Panel
  window.RoomQApi.mountAdminPanel(authPanel, (user) => {
    authenticated = Boolean(user && user.role === 'admin');
    if (submitButton) submitButton.disabled = !authenticated;
    if (facultySubmitBtn) facultySubmitBtn.disabled = !authenticated;
    renderRecords();
    renderFacultyAssignments();
  });

  // Initial loads
  handleInitialHash();
  loadRecords();
  loadFacultyAssignments();
});
