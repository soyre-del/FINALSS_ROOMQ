document.addEventListener('DOMContentLoaded', () => {
  const buildingSelect = document.getElementById('conflictBuilding');
  const roomSelect = document.getElementById('conflictClassroom');
  const dateInput = document.getElementById('conflictDate');
  const statusSelect = document.getElementById('conflictStatus');
  const tableBody = document.getElementById('conflictTableBody');
  const emptyState = document.getElementById('conflictEmpty');
  const errorState = document.getElementById('conflictError');
  const dialog = document.getElementById('conflictDetailsDialog');
  let conflicts = [];
  let authenticated = false;

  window.RoomQ.buildings.forEach((building) => {
    buildingSelect.append(new Option(building.name, building.id));
  });

  function formatDate(date) {
    if (!date) {
      return '—';
    }
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(`${date}T00:00:00`));
  }

  function getScheduleName(schedule) {
    return schedule.course
      ? `${schedule.course}${schedule.section ? ` · ${schedule.section}` : ''}`
      : 'Room reservation';
  }

  function getRoomLabel(conflict) {
    const room = conflict.classroom;
    if (!room) {
      return 'Unassigned classroom';
    }
    return room.roomNumber === null
      ? room.name || 'Named room'
      : `Room ${room.roomNumber}${room.name ? ` · ${room.name}` : ''}`;
  }

  function renderDetails(conflict) {
    const content = document.getElementById('conflictDetailsContent');
    content.replaceChildren();
    const overlap = document.createElement('p');
    overlap.className = 'conflict-overlap-callout';
    overlap.textContent = `Overlap: ${formatDate(conflict.overlapPeriod.date)} · ${window.RoomQTime.format(conflict.overlapPeriod.startTime)}–${window.RoomQTime.format(conflict.overlapPeriod.endTime)}`;
    content.append(overlap);
    [conflict.existingSchedule, conflict.conflictingSchedule].forEach((schedule, index) => {
      const card = document.createElement('section');
      card.className = 'conflict-assignment-card';
      const heading = document.createElement('h3');
      heading.textContent = index === 0 ? 'Existing assignment' : 'Conflicting assignment';
      const details = [
        ['Course', getScheduleName(schedule)],
        ['Instructor', schedule.instructor || '—'],
        ['Classroom', getRoomLabel(conflict)],
        ['Building', conflict.classroom ? conflict.classroom.buildingName : '—'],
        ['Date / recurring day', schedule.recurrence === 'once'
          ? formatDate(schedule.date)
          : schedule.daysOfWeek.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')],
        ['Time', `${window.RoomQTime.format(schedule.startTime)}–${window.RoomQTime.format(schedule.endTime)}`]
      ];
      const list = document.createElement('dl');
      details.forEach(([label, value]) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        row.append(term, description);
        list.append(row);
      });
      card.append(heading, list);
      content.append(card);
    });
  }

  function renderRows() {
    tableBody.replaceChildren();
    const filtered = conflicts.filter((conflict) => {
      if (statusSelect.value !== 'all' && conflict.status !== statusSelect.value) {
        return false;
      }
      return true;
    });
    filtered.forEach((conflict) => {
      const row = document.createElement('tr');
      const cells = [
        getRoomLabel(conflict),
        conflict.classroom ? conflict.classroom.buildingName : '—',
        formatDate(conflict.overlapPeriod.date),
        getScheduleName(conflict.existingSchedule),
        getScheduleName(conflict.conflictingSchedule),
        `${window.RoomQTime.format(conflict.existingSchedule.startTime)}–${window.RoomQTime.format(conflict.existingSchedule.endTime)}`,
        `${window.RoomQTime.format(conflict.conflictingSchedule.startTime)}–${window.RoomQTime.format(conflict.conflictingSchedule.endTime)}`,
        `${window.RoomQTime.format(conflict.overlapPeriod.startTime)}–${window.RoomQTime.format(conflict.overlapPeriod.endTime)}`,
        'Unresolved'
      ];
      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      const actionCell = document.createElement('td');
      const detailsButton = document.createElement('button');
      detailsButton.type = 'button';
      detailsButton.className = 'table-action-button';
      detailsButton.textContent = 'View details';
      detailsButton.addEventListener('click', () => {
        renderDetails(conflict);
        dialog.showModal();
      });
      actionCell.append(detailsButton);
      row.append(actionCell);
      tableBody.append(row);
    });
    emptyState.hidden = filtered.length > 0;
    emptyState.textContent = authenticated
      ? 'No schedule conflicts are currently detected.'
      : 'Sign in as an administrator to view conflict details.';
    document.getElementById('conflictStatTotal').textContent = String(filtered.length);
    document.getElementById('conflictStatOpen').textContent =
      String(filtered.filter((conflict) => conflict.status === 'unresolved').length);
    document.getElementById('conflictStatResolved').textContent = '0';
    document.getElementById('conflictStatToday').textContent =
      String(filtered.filter((conflict) => conflict.overlapPeriod.date === localDate()).length);
  }

  function localDate() {
    return new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  async function loadConflicts() {
    if (!authenticated) {
      conflicts = [];
      renderRows();
      return;
    }
    const query = new URLSearchParams();
    if (buildingSelect.value) {
      query.set('buildingId', buildingSelect.value);
    }
    if (roomSelect.value) {
      query.set('classroomId', roomSelect.value);
    }
    if (dateInput.value) {
      query.set('date', dateInput.value);
    }
    errorState.textContent = '';
    try {
      conflicts = await window.RoomQApi.request(`/api/conflicts?${query}`);
      renderRows();
    } catch (error) {
      conflicts = [];
      errorState.textContent = error.message;
      renderRows();
    }
  }

  async function updateRooms() {
    roomSelect.replaceChildren(new Option('All classrooms', ''));
    try {
      const query = buildingSelect.value
        ? `?buildingId=${encodeURIComponent(buildingSelect.value)}`
        : '';
      const rooms = await window.RoomQApi.request(`/api/classrooms${query}`);
      rooms.forEach((room) => {
        roomSelect.append(new Option(
          `${room.buildingName} · ${room.roomNumber === null ? room.name : `Room ${room.roomNumber}`}`,
          room.id
        ));
      });
    } catch (error) {
      errorState.textContent = error.message;
    }
    loadConflicts();
  }

  buildingSelect.addEventListener('change', updateRooms);
  roomSelect.addEventListener('change', loadConflicts);
  dateInput.addEventListener('change', loadConflicts);
  statusSelect.addEventListener('change', renderRows);
  document.getElementById('refreshConflicts').addEventListener('click', loadConflicts);
  document.getElementById('closeConflictDetails').addEventListener('click', () => dialog.close());
  window.RoomQApi.mountAdminPanel(document.getElementById('adminSessionPanel'), (user) => {
    authenticated = Boolean(user);
    loadConflicts();
  });
  updateRooms();
});
