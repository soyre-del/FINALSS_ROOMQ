// "My reservations" panel: lists the signed-in user's reservations and lets
// them cancel upcoming ones. Hidden for guests.
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('myReservations');
  const list = document.getElementById('myReservationsList');
  const count = document.getElementById('myReservationsCount');
  const feedback = document.getElementById('myReservationsFeedback');
  if (!panel || !list || !count || !window.RoomQApi) return;

  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const formatTime = (time) => (window.RoomQTime ? window.RoomQTime.format(time) : time);

  function roomLabel(room) {
    if (!room) return 'Unassigned room';
    if (room.roomNumber === null) return room.name || 'Named room';
    return `Room ${room.roomNumber}${room.name ? ` · ${room.name}` : ''}`;
  }

  function render(reservations) {
    list.replaceChildren();
    const upcoming = reservations.filter((item) => item.date >= today);
    count.textContent = String(upcoming.length);
    if (!reservations.length) {
      const empty = document.createElement('p');
      empty.className = 'assignment-empty';
      empty.textContent = 'You have no reservations yet. Pick a room on the floor plan to book one.';
      list.append(empty);
      return;
    }
    const sorted = [...reservations].sort((a, b) =>
      b.date.localeCompare(a.date) || a.startTime.localeCompare(b.startTime));
    sorted.forEach((item) => {
      const record = document.createElement('article');
      record.className = 'assignment-record';
      const copy = document.createElement('div');
      copy.className = 'assignment-record-copy';
      const title = document.createElement('strong');
      title.textContent = roomLabel(item.classroom);
      const details = document.createElement('span');
      const place = item.classroom ? `${item.classroom.buildingName} · ${item.classroom.floorLabel} · ` : '';
      const past = item.date < today;
      details.textContent = `${place}${item.date} · ${formatTime(item.startTime)}–${formatTime(item.endTime)}${past ? ' · Past' : ''}`;
      copy.append(title, details);
      record.append(copy);

      if (!past) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'room-use-remove';
        cancel.textContent = 'Cancel';
        cancel.setAttribute('aria-label', `Cancel reservation for ${title.textContent} on ${item.date}`);
        cancel.addEventListener('click', async () => {
          if (!window.confirm(`Cancel your reservation for ${title.textContent} on ${item.date}?`)) return;
          cancel.disabled = true;
          try {
            await window.RoomQApi.request(`/api/schedules/${item.id}`, { method: 'DELETE' });
            feedback.textContent = 'Reservation cancelled.';
            document.dispatchEvent(new CustomEvent('roomq:reservations-changed'));
          } catch (error) {
            feedback.textContent = error.message;
            cancel.disabled = false;
          }
        });
        record.append(cancel);
      }
      list.append(record);
    });
  }

  async function load() {
    try {
      const me = await window.RoomQApi.request('/api/me');
      if (!me.authenticated) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      render(await window.RoomQApi.request('/api/my/reservations'));
    } catch (error) {
      panel.hidden = false;
      feedback.textContent = `Your reservations could not be loaded: ${error.message}`;
    }
  }

  document.addEventListener('roomq:reservations-changed', load);
  load();
});
