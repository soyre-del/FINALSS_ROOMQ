document.addEventListener('DOMContentLoaded', async () => {
  const totalClasses = document.getElementById('dashboardTotalClasses');
  if (!totalClasses) {
    return;
  }
  const localNow = new Date();
  const localDate = new Date(localNow.getTime() - localNow.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const toTime = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  let startTime = toTime(localNow);
  let end = new Date(localNow.getTime() + 60 * 60000);
  let endTime = toTime(end);
  if (end.toDateString() !== localNow.toDateString()) {
    if (startTime >= '23:59') {
      startTime = '22:59';
    }
    endTime = '23:59';
  }

  const cards = document.getElementById('dashboardAvailabilityCards');
  const empty = document.getElementById('dashboardAvailabilityEmpty');
  try {
    const [stats, rooms] = await Promise.all([
      window.RoomQApi.request(`/api/dashboard?date=${encodeURIComponent(localDate)}`),
      window.RoomQApi.request(`/api/availability?date=${localDate}&startTime=${startTime}&endTime=${endTime}`)
    ]);
    totalClasses.textContent = String(stats.totalScheduledClasses);
    document.getElementById('dashboardAssignedRooms').textContent = String(stats.totalAssignedClassrooms);
    document.getElementById('dashboardTodayClasses').textContent = String(stats.todaysClasses);
    document.getElementById('dashboardUnassignedClasses').textContent = String(stats.unassignedClasses);
    cards.replaceChildren();
    rooms.slice(0, 4).forEach((room) => {
      const card = document.createElement('a');
      card.className = `room-card room-${room.status}`;
      card.href = `/users/classrooms.html?building=${encodeURIComponent(room.buildingId)}&floor=${encodeURIComponent(room.floorId)}&room=${encodeURIComponent(room.regionId)}`;
      const top = document.createElement('div');
      top.className = 'room-card-top';
      const symbol = document.createElement('span');
      symbol.className = 'room-symbol';
      symbol.textContent = room.roomNumber === null ? 'R' : String(room.roomNumber).slice(-1);
      const status = document.createElement('span');
      status.className = 'room-status';
      status.textContent = room.status[0].toUpperCase() + room.status.slice(1);
      top.append(symbol, status);
      const title = document.createElement('h3');
      title.textContent = room.roomNumber === null ? room.name || 'Named room' : `Room ${room.roomNumber}`;
      const location = document.createElement('p');
      location.textContent = `${room.buildingName} · ${room.floorLabel}`;
      const details = document.createElement('small');
      details.textContent = room.schedules.length
        ? `${room.schedules[0].course || 'Room reservation'} · ${window.RoomQTime.format(room.schedules[0].startTime)}–${window.RoomQTime.format(room.schedules[0].endTime)}`
        : 'No schedule during this time range';
      card.append(top, title, location, details);
      cards.append(card);
    });
    empty.hidden = rooms.length > 0;
    empty.textContent = rooms.length ? '' : 'No classroom records are available.';
  } catch (error) {
    totalClasses.textContent = '—';
    document.getElementById('dashboardAssignedRooms').textContent = '—';
    document.getElementById('dashboardTodayClasses').textContent = '—';
    document.getElementById('dashboardUnassignedClasses').textContent = '—';
    cards.replaceChildren();
    empty.hidden = false;
    empty.textContent = `Dashboard data could not be loaded: ${error.message}`;
  }
});
