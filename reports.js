document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('reportForm');
  const reportType = document.getElementById('reportType');
  const buildingSelect = document.getElementById('reportBuilding');
  const classroomSelect = document.getElementById('reportClassroom');
  const startDateInput = document.getElementById('reportStartDate');
  const endDateInput = document.getElementById('reportEndDate');
  const endDateField = document.getElementById('reportEndDateField');
  const startDateLabel = document.getElementById('reportStartDateLabel');
  const startTimeInput = document.getElementById('reportStartTime');
  const endTimeInput = document.getElementById('reportEndTime');
  const startTimeField = document.getElementById('reportStartTimeField');
  const endTimeField = document.getElementById('reportEndTimeField');
  const errorMessage = document.getElementById('reportError');
  const reportTitle = document.getElementById('reportTitle');
  const reportDescription = document.getElementById('reportDescription');
  const reportHead = document.getElementById('reportTableHead');
  const reportBody = document.getElementById('reportTableBody');
  const emptyState = document.getElementById('reportEmpty');
  const exportButton = document.getElementById('reportExportButton');
  const controls = [...form.querySelectorAll('select, input, button')];
  const startTimePicker = window.RoomQTime.attach(
    document.getElementById('reportStartPicker'),
    startTimeInput,
    '09:00'
  );
  const endTimePicker = window.RoomQTime.attach(
    document.getElementById('reportEndPicker'),
    endTimeInput,
    '17:00'
  );
  let authenticated = false;
  let reportData = null;
  let reportColumns = [];
  let reportRows = [];
  let currentReportType = reportType.value;

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

  function formatDate(value) {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function getDateRange() {
    const selectedStart = startDateInput.value;
    if (!selectedStart) {
      throw new Error('Choose a report date.');
    }

    if (currentReportType === 'daily-schedule' ||
        currentReportType === 'classroom-availability') {
      return { start: selectedStart, end: selectedStart };
    }
    if (currentReportType === 'weekly-schedule') {
      const selectedDate = new Date(`${selectedStart}T00:00:00Z`);
      const mondayOffset = (selectedDate.getUTCDay() + 6) % 7;
      const start = addDays(selectedStart, -mondayOffset);
      return { start, end: addDays(start, 6) };
    }

    const end = endDateInput.value;
    if (!end || end < selectedStart) {
      throw new Error('Choose an end date on or after the start date.');
    }
    const dayCount = (Date.parse(`${end}T00:00:00Z`) -
      Date.parse(`${selectedStart}T00:00:00Z`)) / 86400000 + 1;
    if (dayCount > 3660) {
      throw new Error('Choose a date range of 10 years or less.');
    }
    return { start: selectedStart, end };
  }

  function updateReportTypeFields() {
    currentReportType = reportType.value;
    const availability = currentReportType === 'classroom-availability';
    const singleDate = availability || currentReportType === 'daily-schedule';
    const weekly = currentReportType === 'weekly-schedule';
    startDateLabel.textContent = weekly ? 'Week containing' : singleDate ? 'Date' : 'From';
    endDateField.hidden = singleDate || weekly;
    endDateInput.required = !singleDate && !weekly;
    startTimeField.hidden = !availability;
    endTimeField.hidden = !availability;
  }

  function updateClassrooms() {
    const previousValue = classroomSelect.value;
    classroomSelect.replaceChildren(new Option('All classrooms', ''));
    if (!reportData) {
      return;
    }
    reportData.classrooms
      .filter((classroom) => !buildingSelect.value || classroom.buildingId === buildingSelect.value)
      .forEach((classroom) => {
        const label = classroom.roomNumber === null
          ? classroom.name
          : `Room ${classroom.roomNumber}${classroom.name ? ` · ${classroom.name}` : ''}`;
        classroomSelect.append(new Option(`${classroom.buildingName} · ${label}`, classroom.id));
      });
    classroomSelect.value = previousValue;
  }

  function selectedClassrooms() {
    if (!reportData) {
      return [];
    }
    return reportData.classrooms.filter((classroom) =>
      (!buildingSelect.value || classroom.buildingId === buildingSelect.value) &&
      (!classroomSelect.value || classroom.id === classroomSelect.value)
    );
  }

  function scheduleOccursOn(schedule, date) {
    if (schedule.recurrence === 'once') {
      return schedule.date === date;
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return date >= schedule.startDate &&
      (!schedule.endDate || date <= schedule.endDate) &&
      schedule.daysOfWeek.includes(weekday);
  }

  function getOccurrences(schedules, start, end) {
    const occurrences = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      schedules.forEach((schedule) => {
        if (schedule.classroom && scheduleOccursOn(schedule, date)) {
          occurrences.push({ schedule, date });
        }
      });
    }
    return occurrences;
  }

  function roomLabel(classroom) {
    if (!classroom) {
      return 'Unassigned';
    }
    return classroom.roomNumber === null
      ? classroom.name || 'Named room'
      : `Room ${classroom.roomNumber}${classroom.name ? ` · ${classroom.name}` : ''}`;
  }

  function scheduleLabel(schedule) {
    if (schedule.kind === 'reservation') {
      return 'Room reservation';
    }
    return `${schedule.course || 'Class'}${schedule.section ? ` · ${schedule.section}` : ''}`;
  }

  function timeInMinutes(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  function durationHours(schedule) {
    return (timeInMinutes(schedule.endTime) - timeInMinutes(schedule.startTime)) / 60;
  }

  function scheduleFilters(schedule) {
    return schedule.classroom &&
      (!buildingSelect.value || schedule.classroom.buildingId === buildingSelect.value) &&
      (!classroomSelect.value || schedule.classroomId === classroomSelect.value);
  }

  function reportForAvailability(date) {
    const startTime = startTimeInput.value;
    const endTime = endTimeInput.value;
    if (!startTime || !endTime || startTime >= endTime) {
      throw new Error('Choose a valid availability time range with the end later than the start.');
    }

    const rooms = selectedClassrooms();
    const rows = rooms.map((classroom) => {
      const matching = reportData.schedules.filter((schedule) =>
        schedule.classroomId === classroom.id &&
        scheduleOccursOn(schedule, date) &&
        schedule.startTime < endTime &&
        schedule.endTime > startTime
      );
      const status = matching.length > 1
        ? 'Conflict'
        : !matching.length
          ? 'Available'
          : matching[0].kind === 'reservation'
            ? 'Reserved'
            : 'Occupied';
      const assignments = matching.map((schedule) =>
        `${scheduleLabel(schedule)}${schedule.instructor ? ` — ${schedule.instructor}` : ''} (${window.RoomQTime.format(schedule.startTime)}–${window.RoomQTime.format(schedule.endTime)})`
      ).join('; ');
      return {
        building: classroom.buildingName,
        floor: classroom.floorLabel,
        room: roomLabel(classroom),
        capacity: classroom.capacity || '—',
        status,
        scheduledDuringRange: assignments || '—',
        classroomId: classroom.id
      };
    });

    return {
      title: 'Classroom Availability Report',
      description: `${formatDate(date)} · ${window.RoomQTime.format(startTime)}–${window.RoomQTime.format(endTime)}.`,
      rangeLabel: formatDate(date),
      columns: [
        { key: 'building', label: 'Building' },
        { key: 'floor', label: 'Floor' },
        { key: 'room', label: 'Classroom' },
        { key: 'capacity', label: 'Capacity' },
        { key: 'status', label: 'Status' },
        { key: 'scheduledDuringRange', label: 'Schedule during selected time' }
      ],
      rows
    };
  }

  function reportForSchedule(start, end) {
    const occurrences = getOccurrences(
      reportData.schedules.filter(scheduleFilters),
      start,
      end
    ).sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.schedule.startTime.localeCompare(right.schedule.startTime)
    );
    const rows = occurrences.map(({ schedule, date }) => ({
      date,
      day: formatDate(date),
      course: scheduleLabel(schedule),
      faculty: schedule.instructor || '—',
      building: schedule.classroom.buildingName,
      floor: schedule.classroom.floorLabel,
      room: roomLabel(schedule.classroom),
      type: schedule.kind === 'reservation' ? 'Reservation' : 'Class',
      startTime: window.RoomQTime.format(schedule.startTime),
      endTime: window.RoomQTime.format(schedule.endTime),
      scheduledHours: durationHours(schedule),
      classroomId: schedule.classroomId
    }));
    const weekly = currentReportType === 'weekly-schedule';
    return {
      title: weekly ? 'Weekly Classroom Schedule' : 'Daily Classroom Schedule',
      description: `${formatDate(start)} – ${formatDate(end)}. Reservations and class schedules are included.`,
      rangeLabel: `${formatDate(start)} – ${formatDate(end)}`,
      columns: [
        { key: 'day', label: 'Date' },
        { key: 'course', label: 'Course / activity' },
        { key: 'faculty', label: 'Faculty' },
        { key: 'building', label: 'Building' },
        { key: 'floor', label: 'Floor' },
        { key: 'room', label: 'Classroom' },
        { key: 'type', label: 'Type' },
        { key: 'startTime', label: 'Start' },
        { key: 'endTime', label: 'End' }
      ],
      rows
    };
  }

  function reportForClassroomUtilization(start, end) {
    const rooms = selectedClassrooms();
    const utilization = new Map(rooms.map((classroom) => [classroom.id, {
      classroom,
      scheduledOccurrences: 0,
      scheduledHours: 0
    }]));
    getOccurrences(reportData.schedules.filter(scheduleFilters), start, end)
      .forEach(({ schedule }) => {
        const totals = utilization.get(schedule.classroomId);
        if (totals) {
          totals.scheduledOccurrences += 1;
          totals.scheduledHours += durationHours(schedule);
        }
      });
    const rows = [...utilization.values()].map(({ classroom, scheduledOccurrences, scheduledHours }) => ({
      building: classroom.buildingName,
      floor: classroom.floorLabel,
      room: roomLabel(classroom),
      capacity: classroom.capacity || '—',
      scheduledOccurrences,
      scheduledHours: Number(scheduledHours.toFixed(2)),
      classroomId: classroom.id
    }));
    return {
      title: 'Classroom Utilization Report',
      description: `${formatDate(start)} – ${formatDate(end)} · scheduled hours are the sum of class and reservation time. Utilization percentages are not estimated because operating hours are not configured.`,
      rangeLabel: `${formatDate(start)} – ${formatDate(end)}`,
      columns: [
        { key: 'building', label: 'Building' },
        { key: 'floor', label: 'Floor' },
        { key: 'room', label: 'Classroom' },
        { key: 'capacity', label: 'Capacity' },
        { key: 'scheduledOccurrences', label: 'Scheduled occurrences' },
        { key: 'scheduledHours', label: 'Scheduled room-hours' }
      ],
      rows
    };
  }

  function reportForBuildingUtilization(start, end) {
    const rooms = selectedClassrooms();
    const totals = new Map();
    rooms.forEach((classroom) => {
      if (!totals.has(classroom.buildingId)) {
        totals.set(classroom.buildingId, {
          building: classroom.buildingName,
          classrooms: 0,
          scheduledOccurrences: 0,
          scheduledHours: 0
        });
      }
      totals.get(classroom.buildingId).classrooms += 1;
    });
    getOccurrences(reportData.schedules.filter(scheduleFilters), start, end)
      .forEach(({ schedule }) => {
        const buildingTotals = totals.get(schedule.classroom.buildingId);
        if (buildingTotals) {
          buildingTotals.scheduledOccurrences += 1;
          buildingTotals.scheduledHours += durationHours(schedule);
        }
      });
    const rows = [...totals.values()].map((building) => ({
      ...building,
      scheduledHours: Number(building.scheduledHours.toFixed(2))
    }));
    return {
      title: 'Building Utilization Report',
      description: `${formatDate(start)} – ${formatDate(end)} · totals include both class schedules and room reservations.`,
      rangeLabel: `${formatDate(start)} – ${formatDate(end)}`,
      columns: [
        { key: 'building', label: 'Building' },
        { key: 'classrooms', label: 'Classrooms' },
        { key: 'scheduledOccurrences', label: 'Scheduled occurrences' },
        { key: 'scheduledHours', label: 'Scheduled room-hours' }
      ],
      rows
    };
  }

  function reportForConflicts(start, end) {
    const rows = reportData.conflicts
      .filter((conflict) =>
        conflict.overlapPeriod.date >= start &&
        conflict.overlapPeriod.date <= end &&
        (!buildingSelect.value || conflict.classroom.buildingId === buildingSelect.value) &&
        (!classroomSelect.value || conflict.classroom.id === classroomSelect.value)
      )
      .map((conflict) => ({
        date: formatDate(conflict.overlapPeriod.date),
        building: conflict.classroom.buildingName,
        room: roomLabel(conflict.classroom),
        existing: `${scheduleLabel(conflict.existingSchedule)}${conflict.existingSchedule.instructor ? ` — ${conflict.existingSchedule.instructor}` : ''}`,
        conflicting: `${scheduleLabel(conflict.conflictingSchedule)}${conflict.conflictingSchedule.instructor ? ` — ${conflict.conflictingSchedule.instructor}` : ''}`,
        overlap: `${window.RoomQTime.format(conflict.overlapPeriod.startTime)}–${window.RoomQTime.format(conflict.overlapPeriod.endTime)}`,
        classroomId: conflict.classroom.id
      }));
    return {
      title: 'Scheduling Conflict Report',
      description: `${formatDate(start)} – ${formatDate(end)} · detected overlaps in the selected date range.`,
      rangeLabel: `${formatDate(start)} – ${formatDate(end)}`,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'building', label: 'Building' },
        { key: 'room', label: 'Classroom' },
        { key: 'existing', label: 'Existing schedule' },
        { key: 'conflicting', label: 'Conflicting schedule' },
        { key: 'overlap', label: 'Overlap' }
      ],
      rows
    };
  }

  function renderTable(report) {
    reportHead.replaceChildren();
    reportBody.replaceChildren();
    const headerRow = document.createElement('tr');
    report.columns.forEach((column) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = column.label;
      headerRow.append(cell);
    });
    reportHead.append(headerRow);
    reportRows = report.rows;
    reportColumns = report.columns;

    reportRows.forEach((rowData) => {
      const row = document.createElement('tr');
      reportColumns.forEach((column) => {
        const cell = document.createElement('td');
        cell.textContent = String(rowData[column.key] ?? '—');
        row.append(cell);
      });
      reportBody.append(row);
    });
    emptyState.hidden = reportRows.length > 0;
    exportButton.disabled = false;
    reportTitle.textContent = report.title;
    reportDescription.textContent = report.description;
    renderSummary(report);
  }

  function renderSummary(report) {
    const labels = [
      document.getElementById('reportStatOneLabel'),
      document.getElementById('reportStatTwoLabel'),
      document.getElementById('reportStatThreeLabel'),
      document.getElementById('reportStatFourLabel')
    ];
    const values = [
      document.getElementById('reportStatOne'),
      document.getElementById('reportStatTwo'),
      document.getElementById('reportStatThree'),
      document.getElementById('reportStatFour')
    ];
    const uniqueClassrooms = new Set(report.rows.map((row) => row.classroomId).filter(Boolean)).size;
    let stats;
    if (currentReportType === 'classroom-availability') {
      stats = [
        ['Classrooms', report.rows.length],
        ['Available', report.rows.filter((row) => row.status === 'Available').length],
        ['Occupied', report.rows.filter((row) => row.status === 'Occupied').length],
        ['Reserved / conflicts', report.rows.filter((row) => ['Reserved', 'Conflict'].includes(row.status)).length]
      ];
    } else if (currentReportType === 'building-utilization') {
      stats = [
        ['Buildings', report.rows.length],
        ['Classrooms', report.rows.reduce((sum, row) => sum + row.classrooms, 0)],
        ['Scheduled occurrences', report.rows.reduce((sum, row) => sum + row.scheduledOccurrences, 0)],
        ['Scheduled room-hours', report.rows.reduce((sum, row) => sum + row.scheduledHours, 0).toFixed(2)]
      ];
    } else if (currentReportType === 'conflict-report') {
      stats = [
        ['Detected conflicts', report.rows.length],
        ['Affected classrooms', uniqueClassrooms],
        ['Date range', report.rangeLabel],
        ['Report status', 'Current conflicts']
      ];
    } else {
      const scheduledHours = report.rows.reduce((sum, row) =>
        sum + Number(row.scheduledHours || 0), 0);
      stats = [
        ['Report rows', report.rows.length],
        ['Classrooms', currentReportType === 'classroom-availability'
          ? report.rows.length
          : uniqueClassrooms || (currentReportType === 'classroom-utilization' ? report.rows.length : 0)],
        ['Scheduled room-hours', scheduledHours.toFixed(2)],
        ['Date range', report.rangeLabel]
      ];
    }
    stats.forEach(([label, value], index) => {
      labels[index].textContent = label;
      values[index].textContent = String(value);
    });
  }

  function generateReport() {
    if (!authenticated || !reportData) {
      errorMessage.textContent = 'Sign in as an administrator to generate reports.';
      return;
    }
    errorMessage.textContent = '';
    try {
      const { start, end } = getDateRange();
      let report;
      if (currentReportType === 'classroom-availability') {
        report = reportForAvailability(start);
      } else if (currentReportType === 'daily-schedule' ||
                 currentReportType === 'weekly-schedule') {
        report = reportForSchedule(start, end);
      } else if (currentReportType === 'building-utilization') {
        report = reportForBuildingUtilization(start, end);
      } else if (currentReportType === 'conflict-report') {
        report = reportForConflicts(start, end);
      } else {
        report = reportForClassroomUtilization(start, end);
      }
      renderTable(report);
    } catch (error) {
      errorMessage.textContent = error.message;
    }
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\t\r\n ]*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!reportColumns.length) {
      return;
    }
    const lines = [
      reportColumns.map((column) => csvCell(column.label)).join(','),
      ...reportRows.map((row) => reportColumns
        .map((column) => csvCell(row[column.key]))
        .join(','))
    ];
    const file = new Blob([`\uFEFF${lines.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `roomq-${currentReportType}-${startDateInput.value}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadReportData() {
    errorMessage.textContent = '';
    try {
      reportData = await window.RoomQApi.request('/api/reports');
      buildingSelect.replaceChildren(new Option('All buildings', ''));
      [...new Map(reportData.classrooms.map((room) => [
        room.buildingId,
        room.buildingName
      ])).entries()]
        .sort((left, right) => left[1].localeCompare(right[1]))
        .forEach(([id, name]) => buildingSelect.append(new Option(name, id)));
      updateClassrooms();
      generateReport();
    } catch (error) {
      reportData = null;
      errorMessage.textContent = error.message;
    }
  }

  function setAuthenticated(user) {
    authenticated = Boolean(user && user.role === 'admin');
    controls.forEach((control) => {
      control.disabled = !authenticated;
    });
    exportButton.disabled = true;
    if (authenticated) {
      loadReportData();
    } else {
      reportData = null;
      reportRows = [];
      reportColumns = [];
      reportHead.replaceChildren();
      reportBody.replaceChildren();
      reportDescription.textContent = 'Sign in as an administrator to generate a report.';
      emptyState.hidden = false;
    }
  }

  const today = localDate();
  startDateInput.value = today;
  endDateInput.value = today;
  updateReportTypeFields();
  form.addEventListener('input', () => {
    exportButton.disabled = true;
  });
  form.addEventListener('change', () => {
    exportButton.disabled = true;
  });
  reportType.addEventListener('change', updateReportTypeFields);
  buildingSelect.addEventListener('change', updateClassrooms);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    generateReport();
  });
  exportButton.addEventListener('click', exportCsv);
  window.RoomQApi.mountAdminPanel(document.getElementById('adminSessionPanel'), setAuthenticated);
});
