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

if (failed === 0) {
  console.log('\n🎉 ALL COUNTDOWN TESTS PASSED!');
} else {
  console.log(`\n❌ ${failed} tests failed!`);
}
