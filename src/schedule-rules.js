const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  return typeof value === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateScheduleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('Provide schedule details.');
  }
  if (input.kind !== undefined && !['class', 'reservation'].includes(input.kind)) {
    invalid('Choose a valid schedule type.');
  }
  if (input.recurrence !== undefined && !['once', 'weekly'].includes(input.recurrence)) {
    invalid('Choose a valid schedule recurrence.');
  }

  const kind = input.kind === 'reservation' ? 'reservation' : 'class';
  const recurrence = input.recurrence === 'weekly' ? 'weekly' : 'once';
  const classroomId = typeof input.classroomId === 'string' && input.classroomId.trim()
    ? input.classroomId.trim()
    : null;
  const startTime = input.startTime;
  const endTime = input.endTime;
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    invalid('End time must be later than a valid start time.');
  }
  if (kind === 'reservation' && !classroomId) {
    invalid('Select a classroom for the room reservation.');
  }

  const course = typeof input.course === 'string' ? input.course.trim() : '';
  const section = typeof input.section === 'string' ? input.section.trim() : '';
  const instructor = typeof input.instructor === 'string' ? input.instructor.trim() : '';
  if (kind === 'class' && (!course || !section || !instructor)) {
    invalid('Course, section, and instructor are required for a class schedule.');
  }

  if (recurrence === 'once') {
    if (!isValidDate(input.date)) {
      invalid('Choose a valid schedule date.');
    }
    return {
      kind,
      recurrence,
      classroomId,
      course,
      section,
      instructor,
      date: input.date,
      daysOfWeek: [],
      startDate: null,
      endDate: null,
      startTime,
      endTime
    };
  }

  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? [...new Set(input.daysOfWeek)]
    : [];
  if (!daysOfWeek.length || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    invalid('Choose at least one valid recurring day.');
  }
  const startDate = input.startDate;
  const endDate = input.endDate || null;
  if (!isValidDate(startDate) || (endDate && !isValidDate(endDate)) ||
      (endDate && endDate < startDate)) {
    invalid('Choose a valid recurring schedule date range.');
  }
  return {
    kind,
    recurrence,
    classroomId,
    course,
    section,
    instructor,
    date: null,
    daysOfWeek: daysOfWeek.sort((left, right) => left - right),
    startDate,
    endDate,
    startTime,
    endTime
  };
}

function appliesOnDate(schedule, date) {
  if (!isValidDate(date)) {
    return false;
  }
  if (schedule.recurrence === 'once') {
    return schedule.date === date;
  }
  if (date < schedule.startDate || (schedule.endDate && date > schedule.endDate)) {
    return false;
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return schedule.daysOfWeek.includes(weekday);
}

function intersectingDate(left, right) {
  if (left.recurrence === 'once') {
    return appliesOnDate(right, left.date) ? left.date : null;
  }
  if (right.recurrence === 'once') {
    return appliesOnDate(left, right.date) ? right.date : null;
  }

  const commonDays = left.daysOfWeek.filter((day) => right.daysOfWeek.includes(day));
  if (!commonDays.length) {
    return null;
  }
  const startDate = left.startDate > right.startDate ? left.startDate : right.startDate;
  let endDate = left.endDate;
  if (!endDate || (right.endDate && right.endDate < endDate)) {
    endDate = right.endDate;
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 86400000);
    if (candidate < start) {
      continue;
    }
    const candidateDate = candidate.toISOString().slice(0, 10);
    if (endDate && candidateDate > endDate) {
      return null;
    }
    if (commonDays.includes(candidate.getUTCDay())) {
      return candidateDate;
    }
  }
  return null;
}

function findScheduleOverlap(left, right) {
  if (!left.classroomId || left.classroomId !== right.classroomId ||
      left.startTime >= right.endTime || left.endTime <= right.startTime) {
    return null;
  }
  const date = intersectingDate(left, right);
  if (!date) {
    return null;
  }
  return {
    date,
    startTime: left.startTime > right.startTime ? left.startTime : right.startTime,
    endTime: left.endTime < right.endTime ? left.endTime : right.endTime
  };
}

function weekdayLabel(daysOfWeek) {
  return daysOfWeek.map((day) => WEEKDAY_NAMES[day]).join(', ');
}

module.exports = {
  WEEKDAY_NAMES,
  appliesOnDate,
  findScheduleOverlap,
  isValidDate,
  isValidTime,
  validateScheduleInput,
  weekdayLabel
};
