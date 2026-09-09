/**
 * countdown.js
 * Adaptive sensible-increment countdown calculator for upcoming calendar events.
 */

export class CountdownTimer {
  constructor(options = {}) {
    this.targetDate = null;
    this.endDate = null;
    this.startedGraceMs = options.startedGraceMs !== undefined ? options.startedGraceMs : 10 * 60 * 1000; // 10 minutes
    this.onTick = options.onTick || (() => {});
    this.onExpire = options.onExpire || (() => {});
    this.onWarning5m = options.onWarning5m || (() => {});
    this.onStart = options.onStart || (() => {});
    this.intervalId = null;
    this.currentIntervalMs = null;
    this.mode = options.mode || 'sensible'; // 'sensible' | 'precise'
    this.expiredTriggered = false;
    this.warning5mTriggered = false;
    this.startTriggered = false;
  }

  /**
   * Set or update target event times.
   * @param {Date|string|number} targetStartTime
   * @param {Date|string|number|null} targetEndTime
   */
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

    // Suppress chime if setting target already past threshold on load
    if (this.targetDate) {
      const initialDiffMs = this.targetDate.getTime() - Date.now();
      if (initialDiffMs <= 0) {
        this.warning5mTriggered = true;
        this.startTriggered = true;
      } else if (initialDiffMs < 60000) {
        // Less than 1 minute to start: suppress 5m warning, start chime will trigger shortly
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
    this.restartInterval();
  }

  setMode(mode) {
    this.mode = mode;
    this.tick();
    this.restartInterval();
  }

  start() {
    this.restartInterval();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Determine optimal refresh interval based on remaining time.
   */
  getOptimalInterval(diffMs) {
    if (this.mode === 'precise') return 1000;
    if (diffMs <= 0) return 1000; // In progress: tick every 1s so 10-minute cutoff triggers precisely
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec <= 300) return 1000; // Under 5 minutes: tick every 1s
    if (diffSec <= 3600) return 5000; // Under 1 hour: tick every 5s
    if (diffSec <= 86400) return 15000; // Under 1 day: tick every 15s
    return 30000; // Over 1 day: tick every 30s
  }

  restartInterval() {
    this.stop();
    if (!this.targetDate) return;

    const now = Date.now();
    const diffMs = this.targetDate.getTime() - now;
    const intervalMs = this.getOptimalInterval(diffMs);
    this.currentIntervalMs = intervalMs;

    this.intervalId = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  /**
   * Calculate sensible breakdown of time remaining.
   * @param {number} diffMs
   * @param {number|null} endDiffMs
   * @returns {Object} formatted countdown state
   */
  formatCountdown(diffMs, endDiffMs = null) {
    // 1. Event already started
    if (diffMs <= 0) {
      const startedMs = -diffMs;
      if (endDiffMs !== null && endDiffMs > 0 && startedMs < this.startedGraceMs) {
        // In progress (within 10-minute window after meeting start)
        const remainingSec = Math.floor(endDiffMs / 1000);
        const mins = Math.ceil(remainingSec / 60);
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;

        let endLabel = '';
        if (hours > 0) {
          endLabel = remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
        } else {
          endLabel = `${mins}m`;
        }

        return {
          status: 'in_progress',
          primary: 'NOW',
          secondary: `Ends in ${endLabel}`,
          badge: 'In Progress',
          urgency: 'now',
          rawSec: 0
        };
      }

      return {
        status: 'ended',
        primary: '0m',
        secondary: 'Advancing to next event...',
        badge: 'Starting Now',
        urgency: 'now',
        rawSec: 0
      };
    }

    // 2. Event is in the future
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    // Precise mode requested
    if (this.mode === 'precise') {
      if (days > 0) {
        return {
          status: 'upcoming',
          primary: `${days}d ${hours}h ${mins}m`,
          secondary: `${secs}s`,
          badge: `${days}d left`,
          urgency: 'calm',
          rawSec: totalSec
        };
      }
      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
      return {
        status: 'upcoming',
        primary: timeStr,
        secondary: hours > 0 ? 'hours : mins : secs' : 'mins : secs',
        badge: hours > 0 ? `${hours}h left` : `${mins}m left`,
        urgency: totalSec < 300 ? 'urgent' : totalSec < 900 ? 'soon' : 'calm',
        rawSec: totalSec
      };
    }

    // Sensible Adaptive Mode (Default)
    // A: Over 24 hours away -> Days and Hours (e.g., "2d 5h" or "1d 12h")
    if (days >= 1) {
      const primary = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
      return {
        status: 'upcoming',
        primary,
        secondary: `${days === 1 ? '1 day' : `${days} days`}${hours > 0 ? ` and ${hours} hrs` : ''}`,
        badge: `${days}d away`,
        urgency: 'calm',
        rawSec: totalSec
      };
    }

    // B: 1 hour to 24 hours away -> Hours and Minutes (e.g., "2h 15m" or "1h 5m")
    if (hours >= 1) {
      const primary = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
      return {
        status: 'upcoming',
        primary,
        secondary: `${hours} ${hours === 1 ? 'hour' : 'hours'}${mins > 0 ? ` ${mins} min` : ''}`,
        badge: `${hours}h left`,
        urgency: hours === 1 && mins < 30 ? 'soon' : 'calm',
        rawSec: totalSec
      };
    }

    // C: 5 minutes to 60 minutes away -> Minutes only (e.g., "35m" or "12 mins")
    if (totalSec >= 300) {
      const displayMins = Math.ceil(totalSec / 60);
      return {
        status: 'upcoming',
        primary: `${displayMins}m`,
        secondary: `${displayMins} minutes left`,
        badge: `${displayMins}m left`,
        urgency: displayMins <= 15 ? 'soon' : 'calm',
        rawSec: totalSec
      };
    }

    // D: 1 minute to 5 minutes away -> Min & Sec (e.g. "4:12" or "2m 45s")
    if (totalSec >= 60) {
      const padSec = String(secs).padStart(2, '0');
      return {
        status: 'upcoming',
        primary: `${mins}:${padSec}`,
        secondary: `${mins}m ${secs}s left`,
        badge: `${mins}m left`,
        urgency: 'urgent',
        rawSec: totalSec
      };
    }

    // E: Under 1 minute away -> Pure seconds (e.g., "45s")
    return {
      status: 'upcoming',
      primary: `${secs}s`,
      secondary: 'Less than a minute!',
      badge: 'Starting imminent',
      urgency: 'urgent',
      rawSec: totalSec
    };
  }

  tick() {
    if (!this.targetDate) {
      this.onTick({
        status: 'idle',
        primary: '--',
        secondary: 'No upcoming meetings',
        badge: 'Idle',
        urgency: 'idle',
        rawSec: 0
      });
      return;
    }

    const now = Date.now();
    const diffMs = this.targetDate.getTime() - now;
    const endDiffMs = this.endDate ? this.endDate.getTime() - now : null;
    const startedMs = -diffMs;

    const isGraceExpired = diffMs <= 0 && startedMs >= this.startedGraceMs;
    const isEnded = diffMs <= 0 && (!endDiffMs || endDiffMs <= 0);

    if (isGraceExpired || isEnded) {
      const state = this.formatCountdown(diffMs, endDiffMs);
      this.onTick(state);
      if (!this.expiredTriggered) {
        this.expiredTriggered = true;
        this.onExpire();
      }
      return;
    }

    // 5-minute warning chime: triggers when remaining time is at or below 5 minutes (300,000ms)
    if (diffMs <= 300000 && diffMs > 0 && !this.warning5mTriggered) {
      this.warning5mTriggered = true;
      this.onWarning5m();
    }

    // Meeting start chime: triggers when event starts (diffMs <= 0)
    if (diffMs <= 0 && !this.startTriggered) {
      this.startTriggered = true;
      this.onStart();
    }

    // Adapt tick frequency dynamically as thresholds are crossed
    const expectedInterval = this.getOptimalInterval(diffMs);
    if (this.currentIntervalMs && this.currentIntervalMs !== expectedInterval) {
      this.restartInterval();
    }

    const state = this.formatCountdown(diffMs, endDiffMs);
    this.onTick(state);
  }
}
