/**
 * app.js
 * Main application logic for WhatsNext:
 * - Google Identity Services (GIS) OAuth 2.0
 * - Google Calendar REST API v3 fetcher
 * - Conference link detection (Meet, Zoom, Teams, Webex)
 * - State management and countdown UI coordination
 * - Demo mode support
 */

import { CountdownTimer } from './countdown.js';

class WhatsNextApp {
  constructor() {
    this.clientId = this.loadClientId();
    this.accessToken = localStorage.getItem('whatsnext_access_token') || sessionStorage.getItem('whatsnext_access_token') || null;
    this.tokenExpiresAt = parseInt(localStorage.getItem('whatsnext_token_expires_at') || sessionStorage.getItem('whatsnext_token_expires_at') || '0', 10);
    this.userProfile = JSON.parse(localStorage.getItem('whatsnext_user_profile') || sessionStorage.getItem('whatsnext_user_profile') || 'null');
    this.tokenRefreshTimeout = null;
    this.isRefreshingToken = false;

    this.isDemoMode = false;
    this.events = [];
    this.currentEvent = null;
    this.refreshInterval = null;
    this.refreshIntervalMs = parseInt(localStorage.getItem('whatsnext_refresh_interval') || '60000', 10);
    this.tokenClient = null;

    this.countdown = new CountdownTimer({
      mode: localStorage.getItem('whatsnext_time_mode') || 'sensible',
      onTick: (state) => this.renderCountdown(state),
      onExpire: () => this.handleEventExpired()
    });

    this.dom = {};
    this.initDOMElements();
    this.initEventListeners();
    this.initGoogleClient();
  }

  loadClientId() {
    if (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) {
      return window.APP_CONFIG.GOOGLE_CLIENT_ID;
    }
    return localStorage.getItem('whatsnext_client_id') || '';
  }

  saveClientId(clientId) {
    this.clientId = clientId.trim();
    localStorage.setItem('whatsnext_client_id', this.clientId);
    this.initGoogleClient();
  }

  initDOMElements() {
    this.dom = {
      // Countdown Hero
      heroCard: document.getElementById('hero-card'),
      countdownValue: document.getElementById('countdown-value'),
      countdownSub: document.getElementById('countdown-sub'),
      countdownBadge: document.getElementById('countdown-badge'),
      meetingTitle: document.getElementById('meeting-title'),
      meetingTime: document.getElementById('meeting-time'),
      meetingLocation: document.getElementById('meeting-location'),
      joinBtn: document.getElementById('join-btn'),
      joinBtnText: document.getElementById('join-btn-text'),
      
      // States
      stateEmpty: document.getElementById('state-empty'),
      stateAuth: document.getElementById('state-auth'),
      stateLoading: document.getElementById('state-loading'),
      heroContent: document.getElementById('hero-content'),
      
      // Agenda List
      agendaSection: document.getElementById('agenda-section'),
      agendaList: document.getElementById('agenda-list'),
      
      // Auth / Header buttons
      authBtn: document.getElementById('auth-btn'),
      userBadge: document.getElementById('user-badge'),
      userEmail: document.getElementById('user-email'),
      settingsBtn: document.getElementById('settings-btn'),
      refreshBtn: document.getElementById('refresh-btn'),
      demoToggleBtn: document.getElementById('demo-toggle-btn'),
      
      // Modals
      settingsModal: document.getElementById('settings-modal'),
      closeSettingsBtn: document.getElementById('close-settings-btn'),
      clientIdInput: document.getElementById('client-id-input'),
      refreshIntervalSelect: document.getElementById('refresh-interval-select'),
      saveSettingsBtn: document.getElementById('save-settings-btn'),
      signoutBtn: document.getElementById('signout-btn'),
      modeSensibleRadio: document.getElementById('mode-sensible'),
      modePreciseRadio: document.getElementById('mode-precise'),
      
      // Notification
      toast: document.getElementById('toast')
    };

    // Reflect current mode
    if (this.countdown.mode === 'precise') {
      if (this.dom.modePreciseRadio) this.dom.modePreciseRadio.checked = true;
    } else {
      if (this.dom.modeSensibleRadio) this.dom.modeSensibleRadio.checked = true;
    }

    if (this.dom.refreshIntervalSelect) {
      this.dom.refreshIntervalSelect.value = String(this.refreshIntervalMs);
    }
  }

  initEventListeners() {
    // Auth button click
    this.dom.authBtn?.addEventListener('click', () => {
      if (!this.clientId) {
        this.openSettings();
        this.showToast('Please configure your Google Client ID first');
        return;
      }
      this.requestGoogleAccessToken();
    });

    // Refresh button
    this.dom.refreshBtn?.addEventListener('click', () => {
      this.refreshEvents(true);
    });

    // Demo Mode toggle
    this.dom.demoToggleBtn?.addEventListener('click', () => {
      this.toggleDemoMode();
    });

    // Settings Modal
    this.dom.settingsBtn?.addEventListener('click', () => this.openSettings());
    this.dom.closeSettingsBtn?.addEventListener('click', () => this.closeSettings());
    this.dom.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.settingsModal) this.closeSettings();
    });

    this.dom.saveSettingsBtn?.addEventListener('click', () => {
      const newClientId = this.dom.clientIdInput.value.trim();
      this.saveClientId(newClientId);

      const mode = this.dom.modePreciseRadio.checked ? 'precise' : 'sensible';
      this.countdown.setMode(mode);
      localStorage.setItem('whatsnext_time_mode', mode);

      if (this.dom.refreshIntervalSelect) {
        const newInterval = parseInt(this.dom.refreshIntervalSelect.value, 10) || 60000;
        this.refreshIntervalMs = newInterval;
        localStorage.setItem('whatsnext_refresh_interval', String(newInterval));
        this.startAutoRefresh();
      }

      this.closeSettings();
      this.showToast('Settings saved');
      if (!this.isDemoMode && this.isAuthenticated()) {
        this.refreshEvents();
      }
    });

    // Sign out
    this.dom.signoutBtn?.addEventListener('click', () => {
      this.signOut();
      this.closeSettings();
    });

    // Keyboard escape to close modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.dom.settingsModal.classList.contains('hidden')) {
        this.closeSettings();
      }
    });

    // Auto refresh on tab visibility / focus with silent token restoration
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || this.isDemoMode) return;
      if (this.isAuthenticated()) {
        this.refreshEvents(false);
      } else if (this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
    });

    window.addEventListener('focus', () => {
      if (this.isDemoMode) return;
      if (this.isAuthenticated()) {
        this.refreshEvents(false);
      } else if (this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
    });
  }

  /* ---------------- Google Identity Services (GIS) ---------------- */

  initGoogleClient() {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      // Retry in 200ms if GIS script hasn't loaded yet
      setTimeout(() => this.initGoogleClient(), 200);
      return;
    }

    if (!this.clientId) {
      this.updateAuthUI();
      return;
    }

    try {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email',
        callback: (tokenResponse) => this.handleTokenResponse(tokenResponse)
      });
      this.updateAuthUI();

      // Check if we already have an active valid token or returning user
      if (this.isAuthenticated()) {
        this.fetchUserProfile();
        this.refreshEvents();
        this.startAutoRefresh();
        const remainingSec = Math.floor((this.tokenExpiresAt - Date.now()) / 1000);
        this.scheduleTokenRefresh(remainingSec);
      } else if (this.hasSignedInBefore()) {
        console.log('[WhatsNext] Returning user detected. Restoring session silently...');
        this.refreshTokenSilently();
      }
    } catch (err) {
      console.error('Failed to init Google Token Client:', err);
      this.showToast('Error initializing Google Auth. Check Client ID.');
    }
  }

  hasSignedInBefore() {
    return localStorage.getItem('whatsnext_has_signed_in') === 'true';
  }

  scheduleTokenRefresh(expiresInSeconds) {
    if (this.tokenRefreshTimeout) {
      clearTimeout(this.tokenRefreshTimeout);
      this.tokenRefreshTimeout = null;
    }

    // Refresh 5 minutes before expiry (or after 50 minutes for a standard 60-min token)
    const refreshInSeconds = Math.max(expiresInSeconds - 300, 60);
    console.log(`[WhatsNext] Scheduling silent token refresh in ~${Math.round(refreshInSeconds / 60)} minutes`);

    this.tokenRefreshTimeout = setTimeout(() => {
      console.log('[WhatsNext] Auto-refreshing access token silently...');
      this.refreshTokenSilently();
    }, refreshInSeconds * 1000);
  }

  refreshTokenSilently() {
    if (!this.tokenClient || !this.clientId || this.isRefreshingToken) return;
    this.isRefreshingToken = true;

    const email = this.userProfile?.email || localStorage.getItem('whatsnext_user_email') || '';
    const opts = { prompt: '' };
    if (email) {
      opts.hint = email;
    }

    try {
      this.tokenClient.requestAccessToken(opts);
    } catch (err) {
      console.error('[WhatsNext] Silent token refresh failed:', err);
      this.isRefreshingToken = false;
    }
  }

  requestGoogleAccessToken(forceConsent = true) {
    if (!this.tokenClient) {
      this.initGoogleClient();
      if (!this.tokenClient) {
        this.openSettings();
        return;
      }
    }
    // Prompts user for consent so Google always shows permission checkboxes
    this.tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
  }

  handleTokenResponse(response) {
    this.isRefreshingToken = false;

    if (response.error) {
      console.warn('[WhatsNext] OAuth Token response error:', response);
      if (response.error === 'user_logged_out' || response.error === 'consent_required' || response.error === 'interaction_required') {
        this.signOut(false);
        this.showToast('Google session expired. Please sign in again.');
      } else {
        this.showToast(`Sign in notice: ${response.error}`);
      }
      return;
    }

    // Verify calendar scope was granted
    const hasCalendarScope = window.google?.accounts?.oauth2?.hasGrantedAnyScope(
      response,
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly'
    ) || (response.scope && response.scope.includes('calendar'));

    if (!hasCalendarScope) {
      console.warn('[WhatsNext] User did not grant calendar permission. Scope was:', response.scope);
      this.showToast('⚠️ Calendar permission missing. Please check the Calendar box on Google sign-in.');
      this.signOut(false);
      return;
    }

    this.accessToken = response.access_token;
    const expiresIn = parseInt(response.expires_in, 10) || 3599;
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;

    localStorage.setItem('whatsnext_access_token', this.accessToken);
    localStorage.setItem('whatsnext_token_expires_at', String(this.tokenExpiresAt));
    localStorage.setItem('whatsnext_has_signed_in', 'true');

    this.updateAuthUI();
    this.fetchUserProfile();
    this.refreshEvents(false);
    this.startAutoRefresh();
    this.scheduleTokenRefresh(expiresIn);
  }

  isAuthenticated() {
    return !!this.accessToken && Date.now() < this.tokenExpiresAt - 60000;
  }

  signOut(revoke = true) {
    if (revoke && this.accessToken && window.google?.accounts?.oauth2) {
      try {
        google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch (e) {
        // ignore revoke error
      }
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userProfile = null;
    this.events = [];
    this.currentEvent = null;

    if (this.tokenRefreshTimeout) {
      clearTimeout(this.tokenRefreshTimeout);
      this.tokenRefreshTimeout = null;
    }

    localStorage.removeItem('whatsnext_access_token');
    localStorage.removeItem('whatsnext_token_expires_at');
    localStorage.removeItem('whatsnext_user_profile');
    localStorage.removeItem('whatsnext_has_signed_in');
    localStorage.removeItem('whatsnext_user_email');
    sessionStorage.clear();

    this.countdown.setTarget(null);
    this.stopAutoRefresh();
    this.updateAuthUI();
    if (revoke) {
      this.showToast('Signed out');
    }
  }

  async fetchUserProfile() {
    if (!this.accessToken) return;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });
      if (res.ok) {
        this.userProfile = await res.json();
        localStorage.setItem('whatsnext_user_profile', JSON.stringify(this.userProfile));
        if (this.userProfile.email) {
          localStorage.setItem('whatsnext_user_email', this.userProfile.email);
        }
        this.updateAuthUI();
      }
    } catch (e) {
      // Non-critical
    }
  }

  /* ---------------- Google Calendar Events Fetching ---------------- */

  async fetchCalendarEvents() {
    if (!this.isAuthenticated()) {
      if (this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
      return [];
    }

    // Look back 15 minutes to include meetings currently in progress
    const timeMin = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '15');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });

    if (response.status === 401) {
      // Token expired: attempt automatic silent refresh instead of logging out
      console.warn('[WhatsNext] Access token expired (401). Performing automatic silent renewal...');
      this.accessToken = null;
      if (this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      } else {
        this.updateAuthUI();
        this.showToast('Session expired. Please sign in again.');
      }
      return [];
    }

    if (response.status === 403) {
      // Missing scope or permissions
      const err = await response.json().catch(() => ({}));
      console.error('Google Calendar 403 Forbidden:', err);
      this.signOut();
      this.showToast('⚠️ Insufficient permissions. Please sign in again and check the Calendar permission box.');
      return [];
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch calendar (${response.status})`);
    }

    const data = await response.json();
    return this.processGoogleEvents(data.items || []);
  }

  processGoogleEvents(items) {
    const now = Date.now();
    const processed = [];

    for (const item of items) {
      if (item.status === 'cancelled') continue;

      // Filter out events the user declined
      if (item.attendees) {
        const selfAttendee = item.attendees.find((a) => a.self);
        if (selfAttendee && selfAttendee.responseStatus === 'declined') {
          continue;
        }
      }

      // Start / End parsing
      let start = null;
      let end = null;
      let isAllDay = false;

      if (item.start?.dateTime) {
        start = new Date(item.start.dateTime);
        end = item.end?.dateTime ? new Date(item.end.dateTime) : new Date(start.getTime() + 30 * 60 * 1000);
      } else if (item.start?.date) {
        // All-day event
        isAllDay = true;
        start = new Date(`${item.start.date}T00:00:00`);
        end = item.end?.date ? new Date(`${item.end.date}T23:59:59`) : new Date(start.getTime() + 86400000);
      } else {
        continue;
      }

      // Ignore events that already ended in the past
      if (end.getTime() <= now) continue;

      // Detect Video Call / Meeting Links
      const meetingLink = this.extractMeetingLink(item);

      processed.push({
        id: item.id,
        summary: item.summary || '(Untitled Event)',
        start,
        end,
        isAllDay,
        location: item.location || '',
        description: item.description || '',
        link: meetingLink,
        htmlLink: item.htmlLink
      });
    }

    // Sort by startTime
    processed.sort((a, b) => a.start.getTime() - b.start.getTime());
    return processed;
  }

  extractMeetingLink(item) {
    // 1. Google Meet hangoutLink
    if (item.hangoutLink) return item.hangoutLink;

    // 2. conferenceData entryPoints
    if (item.conferenceData?.entryPoints) {
      const videoEntry = item.conferenceData.entryPoints.find((ep) => ep.entryPointType === 'video');
      if (videoEntry?.uri) return videoEntry.uri;
    }

    // 3. Zoom, Teams, Webex regex search in location & description
    const text = `${item.location || ''} ${item.description || ''}`;
    const urlMatches = text.match(/(https?:\/\/[^\s<>"']+)/gi);
    if (urlMatches) {
      for (const url of urlMatches) {
        if (/(meet\.google\.com|zoom\.us\/j\/|teams\.microsoft\.com|webex\.com)/i.test(url)) {
          return url;
        }
      }
    }

    return null;
  }

  /* ---------------- State & Event Flow ---------------- */

  async refreshEvents(showSpinner = false) {
    if (this.isDemoMode) return;

    if (!this.isAuthenticated()) {
      this.updateAuthUI();
      return;
    }

    if (showSpinner) {
      this.setLoading(true);
      if (this.dom.refreshBtn) {
        this.dom.refreshBtn.classList.add('animate-spin');
      }
    }

    try {
      this.events = await this.fetchCalendarEvents();
      this.updateActiveEvent();
    } catch (err) {
      console.error('Error fetching events:', err);
      this.showToast(`Sync error: ${err.message}`);
    } finally {
      this.setLoading(false);
      if (this.dom.refreshBtn) {
        this.dom.refreshBtn.classList.remove('animate-spin');
      }
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      this.refreshEvents(false);
    }, this.refreshIntervalMs);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  updateActiveEvent() {
    if (this.events.length === 0) {
      this.currentEvent = null;
      this.countdown.setTarget(null);
      this.showState('empty');
      this.renderAgenda();
      return;
    }

    const now = Date.now();
    // Prioritize meeting currently in progress or next upcoming
    this.currentEvent = this.events[0];

    this.countdown.setTarget(this.currentEvent.start, this.currentEvent.end);
    this.showState('hero');
    this.renderHeroDetails();
    this.renderAgenda();
  }

  handleEventExpired() {
    // When an event ends, re-evalute or refresh
    setTimeout(() => {
      if (this.isDemoMode) {
        this.advanceDemoEvent();
      } else {
        this.refreshEvents(false);
      }
    }, 1500);
  }

  /* ---------------- UI Rendering ---------------- */

  showState(state) {
    this.dom.stateEmpty.classList.add('hidden');
    this.dom.stateAuth.classList.add('hidden');
    this.dom.stateLoading.classList.add('hidden');
    this.dom.heroContent.classList.add('hidden');

    if (state === 'auth') {
      this.dom.stateAuth.classList.remove('hidden');
      this.dom.agendaSection.classList.add('hidden');
    } else if (state === 'empty') {
      this.dom.stateEmpty.classList.remove('hidden');
      this.dom.agendaSection.classList.remove('hidden');
    } else if (state === 'loading') {
      this.dom.stateLoading.classList.remove('hidden');
    } else if (state === 'hero') {
      this.dom.heroContent.classList.remove('hidden');
      this.dom.agendaSection.classList.remove('hidden');
    }
  }

  setLoading(isLoading) {
    if (isLoading && !this.currentEvent) {
      this.showState('loading');
    }
  }

  updateAuthUI() {
    const authenticated = this.isAuthenticated();

    if (this.isDemoMode) {
      this.dom.demoToggleBtn.classList.add('active');
      this.dom.demoToggleBtn.textContent = 'Exit Demo';
      this.dom.userBadge.classList.remove('hidden');
      this.dom.userEmail.textContent = 'Demo Mode';
      this.dom.authBtn.classList.add('hidden');
      return;
    }

    this.dom.demoToggleBtn.classList.remove('active');
    this.dom.demoToggleBtn.textContent = 'Try Demo';

    if (authenticated) {
      this.dom.authBtn.classList.add('hidden');
      this.dom.userBadge.classList.remove('hidden');
      this.dom.userEmail.textContent = this.userProfile?.email || 'Connected';
    } else {
      this.dom.authBtn.classList.remove('hidden');
      this.dom.userBadge.classList.add('hidden');
      this.showState('auth');
    }
  }

  renderCountdown(state) {
    if (!this.dom.countdownValue) return;

    this.dom.countdownValue.textContent = state.primary;
    this.dom.countdownSub.textContent = state.secondary;

    // Badge styling
    this.dom.countdownBadge.textContent = state.badge;
    this.dom.countdownBadge.className = `badge badge-${state.urgency}`;

    // Apply urgency glow / pulse effect on card if urgent
    if (state.urgency === 'urgent') {
      this.dom.heroCard.classList.add('urgent-pulse');
    } else {
      this.dom.heroCard.classList.remove('urgent-pulse');
    }
  }

  renderHeroDetails() {
    if (!this.currentEvent) return;

    this.dom.meetingTitle.textContent = this.currentEvent.summary;

    const timeString = this.formatTimeRange(this.currentEvent.start, this.currentEvent.end, this.currentEvent.isAllDay);
    this.dom.meetingTime.textContent = timeString;

    // Meeting Location / Video Link
    if (this.currentEvent.link) {
      this.dom.joinBtn.classList.remove('hidden');
      this.dom.joinBtn.href = this.currentEvent.link;

      if (this.currentEvent.link.includes('meet.google.com')) {
        this.dom.joinBtnText.textContent = 'Join Google Meet';
      } else if (this.currentEvent.link.includes('zoom.us')) {
        this.dom.joinBtnText.textContent = 'Join Zoom';
      } else if (this.currentEvent.link.includes('teams.microsoft.com')) {
        this.dom.joinBtnText.textContent = 'Join Teams';
      } else {
        this.dom.joinBtnText.textContent = 'Join Video Call';
      }
    } else {
      this.dom.joinBtn.classList.add('hidden');
    }

    if (this.currentEvent.location && !this.currentEvent.link) {
      this.dom.meetingLocation.textContent = `📍 ${this.currentEvent.location}`;
      this.dom.meetingLocation.classList.remove('hidden');
    } else {
      this.dom.meetingLocation.classList.add('hidden');
    }
  }

  renderAgenda() {
    if (!this.dom.agendaList) return;
    this.dom.agendaList.innerHTML = '';

    // Show next 3 events excluding current
    const upcoming = this.events.slice(1, 4);

    if (upcoming.length === 0) {
      this.dom.agendaList.innerHTML = '<li class="agenda-empty">No further events scheduled</li>';
      return;
    }

    for (const evt of upcoming) {
      const li = document.createElement('li');
      li.className = 'agenda-item';

      const timeRange = this.formatTimeRange(evt.start, evt.end, evt.isAllDay);
      const isSoon = (evt.start.getTime() - Date.now()) < 3600000;

      li.innerHTML = `
        <div class="agenda-meta">
          <span class="agenda-time ${isSoon ? 'text-accent' : ''}">${this.formatShortTime(evt.start)}</span>
          <span class="agenda-title" title="${this.escapeHtml(evt.summary)}">${this.escapeHtml(evt.summary)}</span>
        </div>
        ${evt.link ? `<a href="${evt.link}" target="_blank" rel="noopener" class="agenda-join" title="Join Call">Join</a>` : ''}
      `;
      this.dom.agendaList.appendChild(li);
    }
  }

  formatTimeRange(startDate, endDate, isAllDay) {
    if (isAllDay) return 'All Day';

    const now = new Date();
    const isToday = startDate.toDateString() === now.toDateString();
    const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === startDate.toDateString();

    let dayPrefix = '';
    if (!isToday) {
      if (isTomorrow) dayPrefix = 'Tomorrow, ';
      else dayPrefix = `${startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, `;
    }

    const startStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const endStr = endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    return `${dayPrefix}${startStr} – ${endStr}`;
  }

  formatShortTime(date) {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (isToday) return timeStr;
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${timeStr}`;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ---------------- Demo Mode ---------------- */

  toggleDemoMode() {
    this.isDemoMode = !this.isDemoMode;
    if (this.isDemoMode) {
      this.loadDemoEvents();
      this.showToast('Demo Mode activated (Simulated data)');
    } else {
      if (this.isAuthenticated()) {
        this.refreshEvents(true);
      } else {
        this.events = [];
        this.currentEvent = null;
        this.countdown.setTarget(null);
        this.updateAuthUI();
      }
    }
    this.updateAuthUI();
  }

  loadDemoEvents() {
    const now = Date.now();
    this.events = [
      {
        id: 'demo-1',
        summary: 'Product Design & Roadmap Sync',
        start: new Date(now + 4 * 60 * 1000 + 30 * 1000), // 4m 30s away
        end: new Date(now + 35 * 60 * 1000),
        isAllDay: false,
        link: 'https://meet.google.com/abc-defg-hij',
        location: 'Google Meet'
      },
      {
        id: 'demo-2',
        summary: '1:1 Catchup with Engineering Lead',
        start: new Date(now + 48 * 60 * 1000), // 48m away
        end: new Date(now + 78 * 60 * 1000),
        isAllDay: false,
        link: 'https://meet.google.com/xyz-uvwx-rst',
        location: 'Google Meet'
      },
      {
        id: 'demo-3',
        summary: 'Q3 Architectural Review',
        start: new Date(now + 3 * 3600 * 1000 + 15 * 60 * 1000), // 3h 15m away
        end: new Date(now + 4 * 3600 * 1000),
        isAllDay: false,
        link: null,
        location: 'Building B, Room 402'
      },
      {
        id: 'demo-4',
        summary: 'Executive All-Hands & AMA',
        start: new Date(now + 26 * 3600 * 1000), // 1d 2h away
        end: new Date(now + 27 * 3600 * 1000),
        isAllDay: false,
        link: 'https://meet.google.com/all-hands-live',
        location: 'Main Auditorium'
      }
    ];

    this.updateActiveEvent();
  }

  advanceDemoEvent() {
    if (!this.isDemoMode || this.events.length === 0) return;
    this.events.shift();
    this.updateActiveEvent();
  }

  /* ---------------- Settings Modal & Toast ---------------- */

  openSettings() {
    this.dom.clientIdInput.value = this.clientId || '';
    if (this.dom.refreshIntervalSelect) {
      this.dom.refreshIntervalSelect.value = String(this.refreshIntervalMs);
    }
    if (this.isAuthenticated()) {
      this.dom.signoutBtn.classList.remove('hidden');
    } else {
      this.dom.signoutBtn.classList.add('hidden');
    }
    this.dom.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.dom.settingsModal.classList.add('hidden');
  }

  showToast(message) {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('show');
    }, 3200);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhatsNextApp();
});
