document.addEventListener('DOMContentLoaded', () => {
  const buildings = window.RoomQ.buildings;
  const form = document.getElementById('scheduleForm');
  const authPanel = document.getElementById('adminSessionPanel');
  const formControls = [...form.querySelectorAll('input, select, button')];
  const buildingInput = document.getElementById('scheduleBuilding');
  const floorInput = document.getElementById('scheduleFloor');
  const roomInput = document.getElementById('scheduleClassroom');
  const recurrenceInput = document.getElementById('scheduleRecurrence');
  const dateField = document.getElementById('scheduleDateField');
  const weekdaysField = document.getElementById('scheduleWeekdays');
  const startDateField = document.getElementById('scheduleStartDateField');
  const endDateField = document.getElementById('scheduleEndDateField');
  const feedback = document.getElementById('scheduleFormFeedback');
  const tableBody = document.getElementById('scheduleTableBody');
  const calendar = document.getElementById('scheduleCalendar');
  const search = document.getElementById('scheduleSearch');
  const referenceDate = document.getElementById('scheduleReferenceDate');
  const filterBuilding = document.getElementById('scheduleFilterBuilding');
  const filterFloor = document.getElementById('scheduleFilterFloor');
  const filterRoom = document.getElementById('scheduleFilterClassroom');
  const filterInstructor = document.getElementById('scheduleFilterInstructor');
  const filterCourse = document.getElementById('scheduleFilterCourse');
  let facultyAssignmentMode = false;
  const formHeading = document.getElementById('scheduleFormHeading');
  const formKicker = document.getElementById('scheduleFormKicker');
  const courseField = document.getElementById('scheduleCourseField');
  const sectionField = document.getElementById('scheduleSectionField');
  const courseInput = document.getElementById('scheduleCourse');
  const sectionInput = document.getElementById('scheduleSection');
  const instructorLabel = document.getElementById('scheduleInstructorLabel');
  const scheduleNavItem = document.querySelector('[data-nav-item="schedules"]');
  const facultyAssignmentNavItem = document.querySelector('[data-nav-item="faculty-assignment"]');
  const defaultFormHeading = 'Add schedule';
  const defaultSubmitLabel = 'Save schedule';
  const dateNow = new Date();
  const localDate = new Date(dateNow.getTime() - dateNow.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  let schedules = [];
  let rooms = [];
  let view = 'week';
  let authenticated = false;

  const startTimePicker = window.RoomQTime.attach(
    document.getElementById('scheduleStartPicker'),
    document.getElementById('scheduleStartTime')
  );
  const endTimePicker = window.RoomQTime.attach(
    document.getElementById('scheduleEndPicker'),
    document.getElementById('scheduleEndTime')
  );
  referenceDate.value = localDate;
  document.getElementById('scheduleDate').value = localDate;
  document.getElementById('scheduleStartDate').value = localDate;

  function makeOption(label, value) {
    return new Option(label, value);
  }

  function populateBuildings() {
    buildings.forEach((building) => {
      buildingInput.append(makeOption(building.name, building.id));
      filterBuilding.append(makeOption(building.name, building.id));
    });
  }

  function getBuilding(id) {
    return buildings.find((building) => building.id === id);
  }

  function updateFormFloors(selectedFloor = '') {
    const building = getBuilding(buildingInput.value);
    floorInput.replaceChildren(makeOption('Select a floor', ''));
    floorInput.disabled = !building || !building.floors.length;
    if (building) {
      building.floors.forEach((floor) => {
        floorInput.append(makeOption(floor.label, floor.id));
      });
    }
    if (selectedFloor) {
      floorInput.value = selectedFloor;
    }
    updateFormRooms();
  }

  function updateFormRooms(selectedRoom = '') {
    const building = getBuilding(buildingInput.value);
    const floorId = floorInput.value;
    roomInput.replaceChildren(makeOption('Unassigned class', ''));
    rooms
      .filter((room) => room.buildingId === (building && building.id) && room.floorId === floorId)
      .forEach((room) => {
        const label = room.roomNumber === null
          ? room.name || 'Named room'
          : `Room ${room.roomNumber}${room.name ? ` · ${room.name}` : ''}`;
        roomInput.append(makeOption(label, room.id));
      });
    roomInput.disabled = !floorId;
    if (selectedRoom) {
      roomInput.value = selectedRoom;
    }
  }

  function updateFilterFloors(selectedFloor = '') {
    const building = getBuilding(filterBuilding.value);
    filterFloor.replaceChildren(makeOption('All floors', ''));
    filterRoom.replaceChildren(makeOption('All classrooms', ''));
    if (building) {
      building.floors.forEach((floor) => {
        filterFloor.append(makeOption(floor.label, floor.id));
      });
    }
    filterFloor.value = selectedFloor;
    updateFilterRooms();
  }

  function updateFilterRooms(selectedRoom = '') {
    filterRoom.replaceChildren(makeOption('All classrooms', ''));
    rooms
      .filter((room) =>
        (!filterBuilding.value || room.buildingId === filterBuilding.value) &&
        (!filterFloor.value || room.floorId === filterFloor.value)
      )
      .forEach((room) => {
        const label = `${room.buildingName} · ${room.roomNumber === null ? room.name : `Room ${room.roomNumber}`}`;
        filterRoom.append(makeOption(label, room.id));
      });
    filterRoom.value = selectedRoom;
  }

  function scheduleMatchesFilters(schedule) {
    if (filterBuilding.value &&
        (!schedule.classroom || schedule.classroom.buildingId !== filterBuilding.value)) {
      return false;
    }
    if (filterFloor.value &&
        (!schedule.classroom || schedule.classroom.floorId !== filterFloor.value)) {
      return false;
    }
    if (filterRoom.value && schedule.classroomId !== filterRoom.value) {
      return false;
    }
    const instructorFilter = filterInstructor.value.trim().toLowerCase();
    if (instructorFilter && !schedule.instructor.toLowerCase().includes(instructorFilter)) {
      return false;
    }
    const courseFilter = filterCourse.value.trim().toLowerCase();
    if (courseFilter && !`${schedule.course} ${schedule.section}`.toLowerCase().includes(courseFilter)) {
      return false;
    }
    const searchTerm = search.value.trim().toLowerCase();
    return !searchTerm || [
      schedule.course,
      schedule.section,
      schedule.instructor,
      schedule.classroom && schedule.classroom.buildingName,
      schedule.classroom && schedule.classroom.floorLabel,
      schedule.classroom && schedule.classroom.roomNumber,
      schedule.classroom && schedule.classroom.name
    ].some((value) => String(value || '').toLowerCase().includes(searchTerm));
  }

  function dateLabel(date) {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${date}T00:00:00Z`));
  }

  function addDays(date, count) {
    const result = new Date(`${date}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + count);
    return result.toISOString().slice(0, 10);
  }

  function appliesOn(schedule, date) {
    if (schedule.recurrence === 'once') {
      return schedule.date === date;
    }
    if (date < schedule.startDate || (schedule.endDate && date > schedule.endDate)) {
      return false;
    }
    return schedule.daysOfWeek.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  }

  function currentRange() {
    const anchor = referenceDate.value || localDate;
    if (view === 'day') {
      return { start: anchor, end: anchor, dates: [anchor] };
    }
    if (view === 'month') {
      const monthStart = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
      const firstDay = new Date(monthStart);
      firstDay.setUTCDate(1 - firstDay.getUTCDay());
      const dates = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(firstDay);
        date.setUTCDate(firstDay.getUTCDate() + index);
        return date.toISOString().slice(0, 10);
      });
      return { start: dates[0], end: dates[dates.length - 1], dates };
    }
    const anchorDate = new Date(`${anchor}T00:00:00Z`);
    const mondayOffset = (anchorDate.getUTCDay() + 6) % 7;
    const start = addDays(anchor, -mondayOffset);
    const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return { start, end: dates[6], dates };
  }

  function scheduleRoomLabel(schedule) {
    if (!schedule.classroom) {
      return 'Unassigned classroom';
    }
    const { roomNumber, name, buildingName, floorLabel } = schedule.classroom;
    const room = roomNumber === null ? name || 'Named room' : `Room ${roomNumber}${name ? ` · ${name}` : ''}`;
    return `${buildingName} · ${floorLabel} · ${room}`;
  }

  function renderCalendar() {
    const range = currentRange();
    const filtered = schedules.filter(scheduleMatchesFilters);
    const monthTitle = new Intl.DateTimeFormat('en', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    })
      .format(new Date(`${(referenceDate.value || localDate).slice(0, 7)}-01T00:00:00Z`));
    document.getElementById('schedulePeriodLabel').textContent = view === 'month'
      ? monthTitle
      : range.start === range.end
        ? dateLabel(range.start)
        : `${dateLabel(range.start)} – ${dateLabel(range.end)}`;
    document.getElementById('scheduleCalendarHeading').textContent =
      `${view[0].toUpperCase()}${view.slice(1)} schedule`;
    calendar.replaceChildren();
    let occurrenceCount = 0;
    if (view === 'month') {
      calendar.classList.add('is-month-view');
      calendar.classList.remove('is-week-view', 'is-day-view');
      for (const date of range.dates) {
        const cell = document.createElement('section');
        cell.className = 'schedule-calendar-cell';
        if (date.slice(0, 7) !== (referenceDate.value || localDate).slice(0, 7)) {
          cell.classList.add('is-outside-month');
        }
        const heading = document.createElement('h3');
        heading.textContent = String(new Date(`${date}T00:00:00Z`).getUTCDate());
        cell.append(heading);
        filtered.filter((schedule) => appliesOn(schedule, date)).forEach((schedule) => {
          occurrenceCount += 1;
          cell.append(createEventCard(schedule, date));
        });
        calendar.append(cell);
      }
    } else {
      calendar.classList.toggle('is-week-view', view === 'week');
      calendar.classList.toggle('is-day-view', view === 'day');
      calendar.classList.remove('is-month-view');
      for (const date of range.dates) {
        const cell = document.createElement('section');
        cell.className = 'schedule-calendar-cell';
        const heading = document.createElement('h3');
        heading.textContent = dateLabel(date);
        cell.append(heading);
        filtered.filter((schedule) => appliesOn(schedule, date)).forEach((schedule) => {
          occurrenceCount += 1;
          cell.append(createEventCard(schedule, date));
        });
        calendar.append(cell);
      }
    }
    document.getElementById('scheduleCalendarEmpty').hidden = occurrenceCount > 0;
  }

  function createEventCard(schedule, date) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `schedule-event-card${schedule.kind === 'reservation' ? ' is-reservation' : ''}`;
    card.disabled = !authenticated || schedule.kind === 'reservation';
    const title = document.createElement('strong');
    title.textContent = schedule.kind === 'reservation'
      ? 'Room reservation'
      : `${schedule.course} · ${schedule.section}`;
    const detail = document.createElement('span');
    detail.textContent = `${window.RoomQTime.format(schedule.startTime)}–${window.RoomQTime.format(schedule.endTime)} · ${scheduleRoomLabel(schedule)}`;
    card.append(title, detail);
    card.addEventListener('click', () => editSchedule(schedule));
    return card;
  }

  function scheduleDayText(schedule) {
    if (schedule.recurrence === 'once') {
      return dateLabel(schedule.date);
    }
    const days = schedule.daysOfWeek
      .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
      .join(', ');
    return `${days} · from ${schedule.startDate}${schedule.endDate ? ` to ${schedule.endDate}` : ''}`;
  }

  function addTableCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
    return cell;
  }

  function renderTable() {
    tableBody.replaceChildren();
    const filtered = schedules.filter(scheduleMatchesFilters);
    filtered.forEach((schedule) => {
      const row = document.createElement('tr');
      addTableCell(row, schedule.kind === 'reservation' ? 'Room reservation' : schedule.course);
      addTableCell(row, schedule.section || '—');
      addTableCell(row, schedule.instructor || '—');
      addTableCell(row, scheduleRoomLabel(schedule));
      addTableCell(row, scheduleDayText(schedule));
      addTableCell(row, `${window.RoomQTime.format(schedule.startTime)}–${window.RoomQTime.format(schedule.endTime)}`);
      const actions = document.createElement('td');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'table-action-button';
      edit.textContent = 'Edit';
      edit.disabled = !authenticated || schedule.kind === 'reservation';
      edit.addEventListener('click', () => editSchedule(schedule));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'table-action-button is-danger';
      remove.textContent = 'Delete';
      remove.disabled = !authenticated;
      remove.addEventListener('click', () => deleteSchedule(schedule));
      actions.append(edit, remove);
      row.append(actions);
      tableBody.append(row);
    });
    document.getElementById('scheduleTableEmpty').hidden = filtered.length > 0;
  }

  function render() {
    renderCalendar();
    renderTable();
  }

  function renderStats(stats) {
    document.getElementById('scheduleStatTotal').textContent = String(stats.totalScheduledClasses);
    document.getElementById('scheduleStatAssigned').textContent = String(stats.totalAssignedClassrooms);
    document.getElementById('scheduleStatToday').textContent = String(stats.todaysClasses);
    document.getElementById('scheduleStatUnassigned').textContent = String(stats.unassignedClasses);
  }

  async function loadSchedules() {
    try {
      const [nextSchedules, stats] = await Promise.all([
        window.RoomQApi.request('/api/schedules'),
        window.RoomQApi.request(`/api/dashboard?date=${encodeURIComponent(localDate)}`)
      ]);
      schedules = nextSchedules;
      renderStats(stats);
      render();
    } catch (error) {
      feedback.textContent = error.message;
      document.getElementById('scheduleCalendarEmpty').hidden = false;
      document.getElementById('scheduleCalendarEmpty').textContent = 'Schedule data could not be loaded.';
    }
  }

  function updateRecurrenceFields() {
    const weekly = recurrenceInput.value === 'weekly';
    dateField.hidden = weekly;
    weekdaysField.hidden = !weekly;
    startDateField.hidden = !weekly;
    endDateField.hidden = !weekly;
    document.getElementById('scheduleDate').required = !weekly;
    document.getElementById('scheduleStartDate').required = weekly;
  }

  function updateFacultyAssignmentMode() {
    facultyAssignmentMode = window.location.hash === '#facultyAssignment';
    roomInput.required = facultyAssignmentMode;
    if (!document.getElementById('scheduleId').value) {
      formHeading.textContent = facultyAssignmentMode ? 'Assign faculty to a room' : defaultFormHeading;
      formKicker.textContent = facultyAssignmentMode ? 'Faculty room assignment' : 'Authorized users';
      courseField.hidden = facultyAssignmentMode;
      sectionField.hidden = facultyAssignmentMode;
      if (facultyAssignmentMode) {
        courseInput.value = 'Faculty assignment';
        sectionInput.value = 'Faculty';
      } else {
        if (courseInput.value === 'Faculty assignment') {
          courseInput.value = '';
        }
        if (sectionInput.value === 'Faculty') {
          sectionInput.value = '';
        }
      }
      document.getElementById('scheduleSaveButton').textContent = facultyAssignmentMode
        ? 'Assign faculty'
        : defaultSubmitLabel;
    } else {
      courseField.hidden = false;
      sectionField.hidden = false;
    }
    instructorLabel.textContent = facultyAssignmentMode ? 'Faculty member' : 'Instructor';

    if (facultyAssignmentMode) {
      scheduleNavItem.classList.remove('active');
      scheduleNavItem.removeAttribute('aria-current');
      facultyAssignmentNavItem.classList.add('active');
      facultyAssignmentNavItem.setAttribute('aria-current', 'page');
      requestAnimationFrame(() => {
        document.getElementById('facultyAssignment').scrollIntoView({ block: 'start' });
      });
    } else {
      scheduleNavItem.classList.add('active');
      scheduleNavItem.setAttribute('aria-current', 'page');
      facultyAssignmentNavItem.classList.remove('active');
      facultyAssignmentNavItem.removeAttribute('aria-current');
    }
  }

  function resetForm() {
    form.reset();
    document.getElementById('scheduleId').value = '';
    document.getElementById('scheduleDate').value = localDate;
    document.getElementById('scheduleStartDate').value = localDate;
    updateFacultyAssignmentMode();
    document.getElementById('scheduleCancelEdit').hidden = true;
    startTimePicker.setValue('');
    endTimePicker.setValue('');
    updateFormFloors();
    updateRecurrenceFields();
    feedback.textContent = '';
  }

  function editSchedule(schedule) {
    if (!authenticated || schedule.kind === 'reservation') {
      return;
    }
    document.getElementById('scheduleId').value = String(schedule.id);
    courseField.hidden = false;
    sectionField.hidden = false;
    document.getElementById('scheduleCourse').value = schedule.course;
    document.getElementById('scheduleSection').value = schedule.section;
    document.getElementById('scheduleInstructor').value = schedule.instructor;
    buildingInput.value = schedule.classroom ? schedule.classroom.buildingId : '';
    updateFormFloors(schedule.classroom ? schedule.classroom.floorId : '');
    updateFormRooms(schedule.classroomId || '');
    recurrenceInput.value = schedule.recurrence;
    document.getElementById('scheduleDate').value = schedule.date || '';
    document.getElementById('scheduleStartDate').value = schedule.startDate || localDate;
    document.getElementById('scheduleEndDate').value = schedule.endDate || '';
    weekdaysField.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = schedule.daysOfWeek.includes(Number(checkbox.value));
    });
    startTimePicker.setValue(schedule.startTime);
    endTimePicker.setValue(schedule.endTime);
    updateRecurrenceFields();
    formHeading.textContent = 'Edit schedule';
    document.getElementById('scheduleSaveButton').textContent = 'Update schedule';
    document.getElementById('scheduleCancelEdit').hidden = false;
    feedback.textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function formPayload() {
    const recurrence = recurrenceInput.value;
    const payload = {
      kind: 'class',
      course: document.getElementById('scheduleCourse').value,
      section: document.getElementById('scheduleSection').value,
      instructor: document.getElementById('scheduleInstructor').value,
      classroomId: roomInput.value || null,
      recurrence,
      startTime: document.getElementById('scheduleStartTime').value,
      endTime: document.getElementById('scheduleEndTime').value
    };
    if (recurrence === 'once') {
      payload.date = document.getElementById('scheduleDate').value;
    } else {
      payload.daysOfWeek = [...weekdaysField.querySelectorAll('input:checked')]
        .map((checkbox) => Number(checkbox.value));
      payload.startDate = document.getElementById('scheduleStartDate').value;
      payload.endDate = document.getElementById('scheduleEndDate').value || null;
    }
    return payload;
  }

  async function saveSchedule(event) {
    event.preventDefault();
    if (!authenticated) {
      feedback.textContent = 'Sign in as an administrator before saving schedules.';
      return;
    }
    if (facultyAssignmentMode && !roomInput.value) {
      feedback.textContent = 'Select a building, floor, and classroom to assign the faculty member.';
      return;
    }
    const scheduleId = document.getElementById('scheduleId').value;
    const path = scheduleId ? `/api/schedules/${scheduleId}` : '/api/schedules';
    const method = scheduleId ? 'PUT' : 'POST';
    const saveButton = document.getElementById('scheduleSaveButton');
    saveButton.disabled = true;
    feedback.textContent = '';
    try {
      await window.RoomQApi.request(path, {
        method,
        body: JSON.stringify(formPayload())
      });
      resetForm();
      feedback.textContent = scheduleId
        ? 'Schedule updated.'
        : facultyAssignmentMode
          ? 'Faculty assigned and the room is occupied during the selected time.'
          : 'Schedule saved.';
      await loadSchedules();
    } catch (error) {
      if (error.code === 'schedule_conflict' && error.conflict) {
        const existing = error.conflict.existingSchedule;
        const overlap = error.conflict.overlapPeriod;
        feedback.textContent = `Conflict with ${existing.course} (${existing.section}) in ${scheduleRoomLabel(existing)} from ${window.RoomQTime.format(overlap.startTime)} to ${window.RoomQTime.format(overlap.endTime)}. Change the room or time; no schedule was saved.`;
      } else {
        feedback.textContent = error.message;
      }
    } finally {
      saveButton.disabled = !authenticated;
    }
  }

  async function deleteSchedule(schedule) {
    if (!authenticated || !window.confirm(`Delete ${schedule.course} · ${schedule.section}?`)) {
      return;
    }
    try {
      await window.RoomQApi.request(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
      await loadSchedules();
    } catch (error) {
      feedback.textContent = error.message;
    }
  }

  function setAuthenticated(user) {
    authenticated = Boolean(user);
    formControls.forEach((control) => {
      control.disabled = !authenticated;
    });
    if (authenticated) {
      formControls.forEach((control) => {
        if (control !== document.getElementById('scheduleSaveButton')) {
          control.disabled = false;
        }
      });
      updateFormFloors();
    }
    render();
  }

  function moveCalendar(direction) {
    const date = new Date(`${referenceDate.value || localDate}T00:00:00Z`);
    if (view === 'month') {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + direction);
    } else if (view === 'week') {
      date.setUTCDate(date.getUTCDate() + direction * 7);
    } else {
      date.setUTCDate(date.getUTCDate() + direction);
    }
    referenceDate.value = date.toISOString().slice(0, 10);
    renderCalendar();
  }

  populateBuildings();
  updateFormFloors();
  updateFilterFloors();
  recurrenceInput.addEventListener('change', updateRecurrenceFields);
  buildingInput.addEventListener('change', () => updateFormFloors());
  floorInput.addEventListener('change', () => updateFormRooms());
  filterBuilding.addEventListener('change', () => updateFilterFloors());
  filterFloor.addEventListener('change', () => updateFilterRooms());
  form.addEventListener('submit', saveSchedule);
  document.getElementById('scheduleCancelEdit').addEventListener('click', resetForm);
  document.getElementById('schedulePrevious').addEventListener('click', () => moveCalendar(-1));
  document.getElementById('scheduleNext').addEventListener('click', () => moveCalendar(1));
  document.getElementById('scheduleToday').addEventListener('click', () => {
    referenceDate.value = localDate;
    renderCalendar();
  });
  referenceDate.addEventListener('change', renderCalendar);
  document.querySelectorAll('[data-calendar-view]').forEach((button) => {
    button.addEventListener('click', () => {
      view = button.dataset.calendarView;
      document.querySelectorAll('[data-calendar-view]').forEach((other) => {
        other.classList.toggle('is-active', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      });
      renderCalendar();
    });
  });
  [search, filterInstructor, filterCourse].forEach((input) => {
    input.addEventListener('input', render);
  });
  [filterBuilding, filterFloor, filterRoom].forEach((select) => {
    select.addEventListener('change', render);
  });
  document.getElementById('scheduleCancelEdit').hidden = true;
  window.RoomQApi.mountAdminPanel(authPanel, setAuthenticated);
  window.addEventListener('hashchange', updateFacultyAssignmentMode);
  updateFacultyAssignmentMode();

  window.RoomQApi.request('/api/classrooms')
    .then((result) => {
      rooms = result;
      updateFormRooms();
      const query = new URLSearchParams(window.location.search);
      const buildingId = query.get('building');
      if (buildingId && getBuilding(buildingId)) {
        filterBuilding.value = buildingId;
      }
      updateFilterFloors(query.get('floor') || '');
      updateFilterRooms(query.get('room') || '');
      loadSchedules();
    })
    .catch((error) => {
      feedback.textContent = `Classroom data could not be loaded: ${error.message}`;
      loadSchedules();
    });
});
