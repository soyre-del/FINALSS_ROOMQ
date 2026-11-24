// Classroom records (administrators). Capacity and facilities recorded here
// are what the availability search filters on, so keeping them current is what
// makes "find me a room that seats 40 with a projector" work.
document.addEventListener('DOMContentLoaded', () => {
  const api = window.RoomQApi;
  const byId = (id) => document.getElementById(id);
  const tableBody = byId('roomTableBody');
  const emptyState = byId('roomEmpty');
  const feedback = byId('roomFeedback');
  const filterForm = byId('roomFilterForm');
  const searchInput = byId('roomSearch');
  const buildingFilter = byId('roomBuildingFilter');
  const recordFilter = byId('roomRecordFilter');
  const dialog = byId('roomDialog');
  const form = byId('roomForm');
  const dialogFeedback = byId('roomDialogFeedback');
  const saveButton = byId('roomSave');
  const capacityInput = byId('roomCapacity');
  const facilitiesInput = byId('roomFacilities');
  const facilityOptions = byId('roomFacilityOptions');

  // Offered as one-click chips; any other facility can still be typed in.
  const COMMON_FACILITIES = [
    'Projector', 'Air conditioning', 'Whiteboard', 'Smart TV',
    'Computers', 'Laboratory equipment', 'Wheelchair accessible'
  ];

  let allowed = false;
  let rooms = [];
  let editing = null;

  function say(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('is-error', isError);
  }

  function roomLabel(room) {
    if (room.roomNumber === null || room.roomNumber === undefined) {
      return room.name || 'Named room';
    }
    return `Room ${room.roomNumber}${room.name ? ` · ${room.name}` : ''}`;
  }

  const parseFacilities = (text) => [...new Set(
    String(text || '').split(',').map((item) => item.trim()).filter(Boolean)
  )];

  function renderStats(list) {
    byId('roomStatTotal').textContent = String(list.length);
    byId('roomStatCapacity').textContent =
      String(list.filter((room) => room.capacity !== null && room.capacity !== undefined).length);
    byId('roomStatFacilities').textContent =
      String(list.filter((room) => Array.isArray(room.facilities) && room.facilities.length).length);
    byId('roomStatSeats').textContent =
      String(list.reduce((total, room) => total + (Number(room.capacity) || 0), 0));
  }

  function renderBuildingOptions(list) {
    if (buildingFilter.options.length > 1) return;
    const seen = new Map();
    list.forEach((room) => {
      if (!seen.has(room.buildingId)) seen.set(room.buildingId, room.buildingName);
    });
    [...seen.entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .forEach(([id, name]) => buildingFilter.append(new Option(name, id)));
  }

  function visibleRooms() {
    const query = searchInput.value.trim().toLowerCase();
    const building = buildingFilter.value;
    const record = recordFilter.value;
    return rooms.filter((room) => {
      if (building && room.buildingId !== building) return false;
      const hasCapacity = room.capacity !== null && room.capacity !== undefined;
      const hasFacilities = Array.isArray(room.facilities) && room.facilities.length > 0;
      if (record === 'incomplete' && hasCapacity && hasFacilities) return false;
      if (record === 'complete' && (!hasCapacity || !hasFacilities)) return false;
      if (query) {
        const haystack = [
          roomLabel(room), room.buildingName, room.floorLabel, ...(room.facilities || [])
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function render() {
    tableBody.replaceChildren();
    const list = visibleRooms();
    list.forEach((room) => {
      const row = document.createElement('tr');

      const name = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = roomLabel(room);
      name.append(strong);
      row.append(name);

      const building = document.createElement('td');
      building.textContent = room.buildingName;
      row.append(building);

      const floor = document.createElement('td');
      floor.textContent = room.floorLabel;
      row.append(floor);

      const capacity = document.createElement('td');
      if (room.capacity === null || room.capacity === undefined) {
        const pill = document.createElement('span');
        pill.className = 'status-pill status-pill-occupied';
        pill.textContent = 'Not recorded';
        capacity.append(pill);
      } else {
        capacity.textContent = `${room.capacity} seats`;
      }
      row.append(capacity);

      const facilities = document.createElement('td');
      facilities.textContent = Array.isArray(room.facilities) && room.facilities.length
        ? room.facilities.join(', ')
        : '—';
      row.append(facilities);

      const actions = document.createElement('td');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'table-action-button';
      edit.textContent = 'Edit';
      edit.disabled = !allowed;
      edit.addEventListener('click', () => openDialog(room));
      actions.append(edit);
      row.append(actions);

      tableBody.append(row);
    });
    emptyState.hidden = list.length > 0;
    emptyState.textContent = allowed
      ? 'No classrooms match the selected filters.'
      : 'Sign in as an administrator to edit classroom records.';
    renderStats(rooms);
  }

  function syncFacilityChips() {
    const chosen = new Set(parseFacilities(facilitiesInput.value).map((item) => item.toLowerCase()));
    [...facilityOptions.querySelectorAll('button')].forEach((button) => {
      button.classList.toggle('active', chosen.has(button.dataset.facility.toLowerCase()));
      button.setAttribute('aria-pressed', String(chosen.has(button.dataset.facility.toLowerCase())));
    });
  }

  function buildFacilityChips() {
    facilityOptions.replaceChildren();
    COMMON_FACILITIES.forEach((facility) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-primary btn-sm';
      button.dataset.facility = facility;
      button.textContent = facility;
      button.addEventListener('click', () => {
        const current = parseFacilities(facilitiesInput.value);
        const index = current.findIndex((item) => item.toLowerCase() === facility.toLowerCase());
        if (index >= 0) current.splice(index, 1);
        else current.push(facility);
        facilitiesInput.value = current.join(', ');
        syncFacilityChips();
      });
      facilityOptions.append(button);
    });
  }

  function openDialog(room) {
    editing = room;
    byId('roomDialogHeading').textContent = `Edit ${roomLabel(room)}`;
    byId('roomDialogKicker').textContent = `${room.buildingName} · ${room.floorLabel}`;
    capacityInput.value = room.capacity === null || room.capacity === undefined ? '' : String(room.capacity);
    facilitiesInput.value = Array.isArray(room.facilities) ? room.facilities.join(', ') : '';
    syncFacilityChips();
    say(dialogFeedback, '');
    dialog.showModal();
    capacityInput.focus();
  }

  const closeDialog = () => { if (dialog.open) dialog.close(); };

  async function loadRooms() {
    try {
      rooms = await api.request('/api/classrooms');
      renderBuildingOptions(rooms);
      if (feedback.classList.contains('is-error')) say(feedback, '');
      render();
    } catch (error) {
      say(feedback, `Classrooms could not be loaded: ${error.message}`, true);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editing) return;
    const raw = capacityInput.value.trim();
    const capacity = raw === '' ? null : Number(raw);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000)) {
      say(dialogFeedback, 'Capacity must be a whole number between 1 and 2000.', true);
      capacityInput.focus();
      return;
    }
    const facilities = parseFacilities(facilitiesInput.value);
    if (facilities.length > 20 || facilities.some((item) => item.length > 60)) {
      say(dialogFeedback, 'Use at most 20 facilities, each 60 characters or fewer.', true);
      return;
    }
    saveButton.disabled = true;
    say(dialogFeedback, 'Saving…');
    try {
      const saved = await api.request(`/api/classrooms/${encodeURIComponent(editing.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ capacity, facilities })
      });
      rooms = rooms.map((room) => (room.id === saved.id ? saved : room));
      closeDialog();
      say(feedback, `Saved ${roomLabel(saved)}.`);
      render();
    } catch (error) {
      say(dialogFeedback, error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  });

  buildFacilityChips();
  facilitiesInput.addEventListener('input', syncFacilityChips);
  byId('roomDialogClose').addEventListener('click', closeDialog);
  byId('roomDialogCancel').addEventListener('click', closeDialog);
  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    render();
  });
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 250);
  });
  [buildingFilter, recordFilter].forEach((select) => select.addEventListener('change', render));

  api.mountAdminPanel(byId('adminSessionPanel'), (user) => {
    allowed = api.can(user, 'classrooms.manage');
    loadRooms();
  });
});
