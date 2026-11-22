const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'shared', 'js', 'roomq-time.js'), 'utf8');

function createSelect() {
  const options = [];
  let value = '';
  return {
    options,
    get value() {
      return value;
    },
    set value(nextValue) {
      value = options.some((option) => option.value === nextValue) ? nextValue : '';
    },
    append(option) {
      options.push(option);
      if (!value && !option.disabled) {
        value = option.value;
      }
    }
  };
}

function createTimePicker() {
  const selects = {
    '[data-time-hour]': createSelect(),
    '[data-time-minute]': createSelect(),
    '[data-time-period]': createSelect()
  };
  return {
    selects,
    querySelector(selector) {
      return selects[selector];
    },
    addEventListener() {}
  };
}

function loadRoomQTime() {
  const context = {
    window: {},
    document: {
      createElement() {
        return { value: '', textContent: '', disabled: false };
      }
    },
    Event: class {}
  };
  vm.runInNewContext(source, context);
  return context.window.RoomQTime;
}

test('time pickers offer minute options in 10-minute intervals', () => {
  const picker = createTimePicker();
  loadRoomQTime().attach(picker, { value: '', dispatchEvent() {} });

  assert.deepEqual(
    picker.selects['[data-time-minute]'].options
      .filter((option) => !option.disabled)
      .map((option) => option.value),
    ['00', '10', '20', '30', '40', '50']
  );
});

test('time pickers preserve existing schedules with non-10-minute times', () => {
  const picker = createTimePicker();
  const valueField = { value: '', dispatchEvent() {} };
  loadRoomQTime().attach(picker, valueField, '13:25');

  assert.equal(picker.selects['[data-time-minute]'].value, '25');
  assert.equal(valueField.value, '13:25');
});
