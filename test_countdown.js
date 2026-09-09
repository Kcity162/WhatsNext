// Test countdown formatting logic
const fs = $.NSFileManager.defaultManager;

// Countdown logic extract
function formatCountdown(diffMs, endDiffMs = null, mode = 'sensible', startedGraceMs = 10 * 60 * 1000) {
  if (diffMs <= 0) {
    const startedMs = -diffMs;
    if (endDiffMs !== null && endDiffMs > 0 && startedMs < startedGraceMs) {
      const remainingSec = Math.floor(endDiffMs / 1000);
      const mins = Math.ceil(remainingSec / 60);
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      let endLabel = hours > 0 ? (remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`) : `${mins}m`;
      return { status: 'in_progress', primary: 'NOW', secondary: `Ends in ${endLabel}`, badge: 'In Progress' };
    }
    return { status: 'ended', primary: '0m', secondary: 'Starting now or just ended', badge: 'Starting Now' };
  }

  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (mode === 'precise') {
    if (days > 0) return { primary: `${days}d ${hours}h ${mins}m`, secondary: `${secs}s` };
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
    return { primary: timeStr, secondary: hours > 0 ? 'hours : mins : secs' : 'mins : secs' };
  }

  // Sensible Mode
  if (days >= 1) {
    return { primary: hours > 0 ? `${days}d ${hours}h` : `${days}d` };
  }
  if (hours >= 1) {
    return { primary: mins > 0 ? `${hours}h ${mins}m` : `${hours}h` };
  }
  if (totalSec >= 300) {
    const displayMins = Math.ceil(totalSec / 60);
    return { primary: `${displayMins}m` };
  }
  if (totalSec >= 60) {
    const padSec = String(secs).padStart(2, '0');
    return { primary: `${mins}:${padSec}` };
  }
  return { primary: `${secs}s` };
}

// Assertions
const tests = [
  { name: 'Over 24h away (2 days 4 hours)', diff: (2 * 86400 + 4 * 3600) * 1000, expected: '2d 4h' },
  { name: 'Exactly 1 day away', diff: 86400 * 1000, expected: '1d' },
  { name: 'Between 1h and 24h (3 hours 15 mins)', diff: (3 * 3600 + 15 * 60) * 1000, expected: '3h 15m' },
  { name: 'Exactly 1 hour', diff: 3600 * 1000, expected: '1h' },
  { name: '35 minutes away', diff: 35 * 60 * 1000, expected: '35m' },
  { name: 'Under 5 minutes (4m 25s)', diff: (4 * 60 + 25) * 1000, expected: '4:25' },
  { name: 'Under 1 minute (45 seconds)', diff: 45 * 1000, expected: '45s' },
  { name: 'In progress (ends in 20m)', diff: -10000, endDiff: 20 * 60 * 1000, expected: 'NOW' },
  { name: 'In progress at 5m (< 10 mins, ends in 4h 55m)', diff: -5 * 60 * 1000, endDiff: (4 * 3600 + 55 * 60) * 1000, expected: 'NOW' },
  { name: 'In progress at 9m 59s (< 10 mins)', diff: -599 * 1000, endDiff: 3600 * 1000, expected: 'NOW' },
  { name: 'In progress at 10m (10-min cutoff reached)', diff: -10 * 60 * 1000, endDiff: (4 * 3600 + 50 * 60) * 1000, expected: '0m' },
  { name: 'In progress at 15m (1pm meeting at 1:15pm, ends in 4h 45m)', diff: -15 * 60 * 1000, endDiff: (4 * 3600 + 45 * 60) * 1000, expected: '0m' },
  { name: 'Just ended', diff: -1000, endDiff: -500, expected: '0m' }
];

let failed = 0;
tests.forEach(t => {
  const res = formatCountdown(t.diff, t.endDiff);
  if (res.primary === t.expected) {
    console.log(`✅ PASS: ${t.name} => ${res.primary}`);
  } else {
    console.log(`❌ FAIL: ${t.name} => expected ${t.expected}, got ${res.primary}`);
    failed++;
  }
});

// Chime Trigger Simulation Tests
console.log('\n--- Testing Chime Trigger Behavior ---');

class MockTimer {
  constructor(options = {}) {
    this.targetDate = null;
    this.endDate = null;
    this.startedGraceMs = 10 * 60 * 1000;
    this.onWarning5m = options.onWarning5m || (() => {});
    this.onStart = options.onStart || (() => {});
    this.onExpire = options.onExpire || (() => {});
    this.expiredTriggered = false;
    this.warning5mTriggered = false;
    this.startTriggered = false;
    this.mockNow = 1000000000;
  }

  setMockTime(t) {
    this.mockNow = t;
  }

  setTarget(targetStartTime, targetEndTime = null) {
    const newTargetDate = targetStartTime ? new Date(targetStartTime) : null;
    const newEndDate = targetEndTime ? new Date(targetEndTime) : null;

    const isSameTarget = (
      (!this.targetDate && !newTargetDate) ||
      (this.targetDate && newTargetDate && this.targetDate.getTime() === newTargetDate.getTime())
    ) && (
      (!this.endDate && !newEndDate) ||
      (this.endDate && newEndDate && this.endDate.getTime() === newEndDate.getTime())
    );

    if (isSameTarget) {
      return;
    }

    this.targetDate = newTargetDate;
    this.endDate = newEndDate;
    this.expiredTriggered = false;

    if (this.targetDate) {
      const initialDiffMs = this.targetDate.getTime() - this.mockNow;
      if (initialDiffMs <= 0) {
        this.warning5mTriggered = true;
        this.startTriggered = true;
      } else if (initialDiffMs < 60000) {
        this.warning5mTriggered = true;
        this.startTriggered = false;
      } else {
        this.warning5mTriggered = false;
        this.startTriggered = false;
      }
    } else {
      this.warning5mTriggered = false;
      this.startTriggered = false;
    }

    this.tick();
  }

  tick() {
    if (!this.targetDate) return;
    const now = this.mockNow;
    const diffMs = this.targetDate.getTime() - now;
    const endDiffMs = this.endDate ? this.endDate.getTime() - now : null;
    const startedMs = -diffMs;

    const isGraceExpired = diffMs <= 0 && startedMs >= this.startedGraceMs;
    const isEnded = diffMs <= 0 && (!endDiffMs || endDiffMs <= 0);

    if (isGraceExpired || isEnded) {
      if (!this.expiredTriggered) {
        this.expiredTriggered = true;
        this.onExpire();
      }
      return;
    }

    if (diffMs <= 300000 && diffMs > 0 && !this.warning5mTriggered) {
      this.warning5mTriggered = true;
      this.onWarning5m();
    }

    if (diffMs <= 0 && !this.startTriggered) {
      this.startTriggered = true;
      this.onStart();
    }
  }
}

// Test 1: Full lifecycle (10m -> 5m chime -> 0m chime -> auto-advance)
{
  let warningCount = 0;
  let startCount = 0;
  let expireCount = 0;
  const baseTime = 1000000000;
  const targetStart = baseTime + 10 * 60 * 1000; // 10 mins away
  const targetEnd = targetStart + 30 * 60 * 1000; // 30 min duration

  const timer = new MockTimer({
    onWarning5m: () => warningCount++,
    onStart: () => startCount++,
    onExpire: () => expireCount++
  });

  timer.setMockTime(baseTime);
  timer.setTarget(targetStart, targetEnd);

  // At 10m away
  if (warningCount === 0 && startCount === 0) {
    console.log('✅ PASS: At 10m away, no chimes fired');
  } else {
    console.log('❌ FAIL: Chimes fired prematurely at 10m');
    failed++;
  }

  // At 5m 1s away (301s)
  timer.setMockTime(targetStart - 301000);
  timer.tick();
  if (warningCount === 0) {
    console.log('✅ PASS: At 5m 1s away, 5m chime not yet fired');
  } else {
    console.log('❌ FAIL: 5m chime fired too early');
    failed++;
  }

  // Crosses 5m threshold: 5m 0s (300,000ms)
  timer.setMockTime(targetStart - 300000);
  timer.tick();
  if (warningCount === 1) {
    console.log('✅ PASS: At 5m 0s, 5m warning chime fired');
  } else {
    console.log(`❌ FAIL: Expected 1 warning chime, got ${warningCount}`);
    failed++;
  }

  // Next ticks and repeated setTarget during sync: NO duplicate 5m chimes
  timer.setMockTime(targetStart - 290000);
  timer.tick();
  timer.setTarget(targetStart, targetEnd); // background sync simulation
  timer.tick();
  if (warningCount === 1) {
    console.log('✅ PASS: Duplicate 5m chime prevented during ticks & calendar sync');
  } else {
    console.log(`❌ FAIL: Duplicate 5m chime detected: ${warningCount}`);
    failed++;
  }

  // At 0s: Event starts
  timer.setMockTime(targetStart);
  timer.tick();
  if (startCount === 1) {
    console.log('✅ PASS: At 0s, event start chime fired');
  } else {
    console.log(`❌ FAIL: Expected 1 start chime, got ${startCount}`);
    failed++;
  }

  // During in-progress: NO duplicate start chimes
  timer.setMockTime(targetStart + 60000);
  timer.tick();
  timer.setTarget(targetStart, targetEnd);
  timer.tick();
  if (startCount === 1) {
    console.log('✅ PASS: Duplicate start chime prevented during event');
  } else {
    console.log(`❌ FAIL: Duplicate start chime detected: ${startCount}`);
    failed++;
  }

  // 10 minutes after start: auto-advance triggers
  timer.setMockTime(targetStart + 10 * 60 * 1000);
  timer.tick();
  if (expireCount === 1) {
    console.log('✅ PASS: Auto-advance expired triggered at +10m mark');
  } else {
    console.log(`❌ FAIL: Expected 1 expire trigger, got ${expireCount}`);
    failed++;
  }
}

// Test 2: Event loaded within 1 minute of start suppresses 5m chime
{
  let warningCount = 0;
  let startCount = 0;
  const baseTime = 1000000000;
  const targetStart = baseTime + 30000; // 30s away
  const timer = new MockTimer({
    onWarning5m: () => warningCount++,
    onStart: () => startCount++
  });
  timer.setMockTime(baseTime);
  timer.setTarget(targetStart, targetStart + 3600000);

  if (warningCount === 0) {
    console.log('✅ PASS: 5m chime suppressed when loaded <1m to start');
  } else {
    console.log('❌ FAIL: 5m chime was not suppressed when loaded <1m to start');
    failed++;
  }

  timer.setMockTime(targetStart);
  timer.tick();
  if (startCount === 1) {
    console.log('✅ PASS: Start chime rings properly at 0m even if 5m was suppressed');
  } else {
    console.log('❌ FAIL: Start chime failed to ring');
    failed++;
  }
}

// Test 3: Event loaded already started suppresses both chimes
{
  let warningCount = 0;
  let startCount = 0;
  const baseTime = 1000000000;
  const targetStart = baseTime - 60000; // started 1 min ago
  const timer = new MockTimer({
    onWarning5m: () => warningCount++,
    onStart: () => startCount++
  });
  timer.setMockTime(baseTime);
  timer.setTarget(targetStart, targetStart + 3600000);

  if (warningCount === 0 && startCount === 0) {
    console.log('✅ PASS: Both chimes suppressed for already started event');
  } else {
    console.log('❌ FAIL: Chime triggered for already started event');
    failed++;
  }
}

if (failed === 0) {
  console.log('\n🎉 ALL TESTS (FORMATTING + CHIMES) PASSED!');
} else {
  console.log(`\n❌ ${failed} tests failed!`);
}
