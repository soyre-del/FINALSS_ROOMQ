// Staff dashboard: campus summary and today's classes, from the live API.
document.addEventListener('DOMContentLoaded', () => {
  const api = window.RoomQApi;
  const error = document.getElementById('staffError');
  const body = document.getElementById('staffTodayBody');
  const empty = document.getElementById('staffTodayEmpty');

  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function appliesToday(schedule) {
    if (schedule.recurrence === 'once') {
      return schedule.date === today;
    }
    if (today < schedule.startDate || (schedule.endDate && today > schedule.endDate)) {
      return false;
    }
    return schedule.daysOfWeek.includes(new Date(`${today}T00:00:00Z`).getUTCDay());
  }

  function roomLabel(classroom) {
    if (!classroom) return 'Unassigned';
    const room = classroom.roomNumber === null || classroom.roomNumber === undefined
      ? classroom.name || 'Named room'
      : `Room ${classroom.roomNumber}${classroom.name ? ` · ${classroom.name}` : ''}`;
    return [classroom.buildingName, classroom.floorLabel, room].filter(Boolean).join(' · ');
  }

  function renderToday(schedules) {
    body.replaceChildren();
    const todays = schedules.filter(appliesToday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id);
    todays.forEach((schedule) => {
      const row = document.createElement('tr');
      [
        `${window.RoomQTime.format(schedule.startTime)}–${window.RoomQTime.format(schedule.endTime)}`,
        schedule.course,
        schedule.section || '—',
        schedule.instructor || '—',
        roomLabel(schedule.classroom)
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    });
    empty.hidden = todays.length > 0;
  }

  document.getElementById('staffTodayDate').textContent = new Intl.DateTimeFormat('en', {
    dateStyle: 'full'
  }).format(now);

  Promise.all([
    api.request('/api/me'),
    api.request(`/api/dashboard?date=${encodeURIComponent(today)}`),
    api.request('/api/schedules?kind=class')
  ]).then(([me, summary, schedules]) => {
    if (me.authenticated) {
      const name = me.user.fullName || me.user.email;
      document.getElementById('staffGreeting').textContent =
        `Welcome back, ${name}. Here is what is happening on campus today.`;
    }
    document.getElementById('staffStatRooms').textContent = String(summary.totalClassrooms);
    document.getElementById('staffStatToday').textContent = String(summary.todaysClasses);
    document.getElementById('staffStatUnassigned').textContent = String(summary.unassignedClasses);
    document.getElementById('staffStatConflicts').textContent = String(summary.totalConflicts);
    renderToday(schedules);
  }).catch((failure) => {
    error.textContent = `The dashboard could not be loaded: ${failure.message}`;
    empty.hidden = false;
  });
});
