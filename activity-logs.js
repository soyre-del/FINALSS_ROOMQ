document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('activityFilterForm');
  const startDateInput = document.getElementById('activityStartDate');
  const endDateInput = document.getElementById('activityEndDate');
  const actionSelect = document.getElementById('activityAction');
  const errorMessage = document.getElementById('activityError');
  const tableBody = document.getElementById('activityTableBody');
  const emptyState = document.getElementById('activityEmpty');
  const loadMoreButton = document.getElementById('activityLoadMore');
  const controls = [...form.querySelectorAll('input, select, button')];
  const pageSize = 100;
  let authenticated = false;
  let loading = false;
  let offset = 0;
  let hasMore = false;
  let logs = [];

  function localDate(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  function addDays(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function activityName(action) {
    return {
      created: 'Created',
      updated: 'Updated',
      deleted: 'Deleted',
      registered: 'Account created',
      signed_in: 'Signed in',
      signed_out: 'Signed out'
    }[action] || action;
  }

  function recordName(log) {
    const entityName = {
      schedule: 'Class schedule',
      reservation: 'Room reservation',
      user: 'User account',
      session: 'Session'
    }[log.entityType] || log.entityType;
    return log.entityId ? `${entityName} #${log.entityId}` : entityName;
  }

  function roomName(log) {
    const classroom = log.classroom ||
      (log.previous && log.previous.classroom) ||
      (log.updated && log.updated.classroom);
    if (!classroom) {
      return '—';
    }
    const room = classroom.roomNumber === null || classroom.roomNumber === undefined
      ? classroom.name || 'Named room'
      : `Room ${classroom.roomNumber}${classroom.name ? ` · ${classroom.name}` : ''}`;
    return [classroom.buildingName, classroom.floorLabel, room].filter(Boolean).join(' · ');
  }

  function appendSnapshot(details, label, snapshot) {
    if (!snapshot) {
      return;
    }
    const heading = document.createElement('strong');
    heading.textContent = label;
    const value = document.createElement('pre');
    value.textContent = JSON.stringify(snapshot, null, 2);
    details.append(heading, value);
  }

  function render() {
    tableBody.replaceChildren();
    logs.forEach((log) => {
      const row = document.createElement('tr');
      const timestamp = new Date(`${log.createdAt.replace(' ', 'T')}Z`);
      const cells = [
        Number.isNaN(timestamp.getTime())
          ? log.createdAt
          : new Intl.DateTimeFormat('en', {
            dateStyle: 'medium',
            timeStyle: 'short'
          }).format(timestamp),
        log.actorUsername,
        activityName(log.action),
        recordName(log),
        roomName(log)
      ];
      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });

      const detailsCell = document.createElement('td');
      if (log.previous || log.updated) {
        const details = document.createElement('details');
        details.className = 'activity-change-details';
        const summary = document.createElement('summary');
        summary.textContent = 'View details';
        details.append(summary);
        appendSnapshot(details, 'Before', log.previous);
        appendSnapshot(details, 'After', log.updated);
        detailsCell.append(details);
      } else {
        detailsCell.textContent = '—';
      }
      row.append(detailsCell);
      tableBody.append(row);
    });

    emptyState.hidden = logs.length > 0;
    emptyState.textContent = authenticated
      ? 'No activities match the selected filters.'
      : 'Sign in as an administrator to view activity logs.';
    loadMoreButton.hidden = !hasMore;
    document.getElementById('activityStatTotal').textContent = String(logs.length);
    document.getElementById('activityStatSchedules').textContent = String(
      logs.filter((log) => ['schedule', 'reservation'].includes(log.entityType)).length
    );
    document.getElementById('activityStatUsers').textContent = String(
      new Set(logs.map((log) => log.actorUsername)).size
    );
    document.getElementById('activityStatRooms').textContent = String(
      logs.filter((log) => log.classroomId).length
    );
  }

  async function loadLogs(reset = false) {
    if (!authenticated || loading) {
      return;
    }
    if (startDateInput.value && endDateInput.value &&
        startDateInput.value > endDateInput.value) {
      errorMessage.textContent = 'Choose an end date on or after the start date.';
      return;
    }
    if (reset) {
      logs = [];
      offset = 0;
      hasMore = false;
      render();
    }

    loading = true;
    loadMoreButton.disabled = true;
    errorMessage.textContent = '';
    const query = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
      timezoneOffset: String(new Date().getTimezoneOffset())
    });
    if (startDateInput.value) {
      query.set('startDate', startDateInput.value);
    }
    if (endDateInput.value) {
      query.set('endDate', endDateInput.value);
    }
    if (actionSelect.value) {
      query.set('action', actionSelect.value);
    }

    try {
      const result = await window.RoomQApi.request(`/api/activity-logs?${query}`);
      logs = reset ? result.items : logs.concat(result.items);
      offset += result.items.length;
      hasMore = result.hasMore;
      render();
    } catch (error) {
      errorMessage.textContent = error.message;
    } finally {
      loading = false;
      loadMoreButton.disabled = false;
    }
  }

  function setAuthenticated(user) {
    authenticated = Boolean(user && user.role === 'admin');
    controls.forEach((control) => {
      control.disabled = !authenticated;
    });
    if (authenticated) {
      loadLogs(true);
    } else {
      logs = [];
      offset = 0;
      hasMore = false;
      render();
    }
  }

  const today = localDate();
  startDateInput.value = addDays(today, -29);
  endDateInput.value = today;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadLogs(true);
  });
  loadMoreButton.addEventListener('click', () => loadLogs());
  window.RoomQApi.mountAdminPanel(document.getElementById('adminSessionPanel'), setAuthenticated);
});
