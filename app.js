/**
 * app.js
 * Main application logic for WhatsNext:
 * - Server-assisted Google OAuth 2.0 with permanent offline refresh_token (never logs out)
 * - Client-side Google Identity Services fallback
 * - Conference link detection (Meet, Zoom, Teams, Webex)
 * - State management and adaptive countdown UI coordination
 * - Demo mode support
 */

import { CountdownTimer } from './countdown.js';

// Auto-advance to next meeting 10 minutes after meeting starts
const EVENT_STARTED_GRACE_MS = 10 * 60 * 1000; // 10 minutes

class WhatsNextApp {
  constructor() {
    this.clientId = this.loadClientId();
    this.accessToken = localStorage.getItem('whatsnext_access_token') || null;
    this.tokenExpiresAt = parseInt(localStorage.getItem('whatsnext_token_expires_at') || '0', 10);
    this.userProfile = JSON.parse(localStorage.getItem('whatsnext_user_profile') || 'null');
    this.tokenRefreshTimeout = null;
    this.isRefreshingToken = false;

    // Backend-assisted permanent auth state
    this.isBackendSupported = false;
    this.backendConfigured = false;
    this.backendAuthenticated = false;
    this.userEmail = localStorage.getItem('whatsnext_user_email') || '';

    this.isDemoMode = false;
    this.events = [];
    this.currentEvent = null;
    this.refreshInterval = null;
    this.refreshIntervalMs = parseInt(localStorage.getItem('whatsnext_refresh_interval') || '60000', 10);
    this.tokenClient = null;

    this.countdown = new CountdownTimer({
      mode: localStorage.getItem('whatsnext_time_mode') || 'sensible',
      startedGraceMs: EVENT_STARTED_GRACE_MS,
      onTick: (state) => this.renderCountdown(state),
      onExpire: () => this.handleEventExpired()
    });

    this.dom = {};
    this.initDOMElements();
    this.initEventListeners();
    this.initApp();
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
    if (!this.isBackendSupported) {
      this.initGoogleClient();
    }
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
      clientSecretInput: document.getElementById('client-secret-input'),
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
    // Auth button clicks (header and card)
    this.dom.authBtn?.addEventListener('click', () => this.handleAuthClick());

    const cardAuthBtn = this.dom.stateAuth?.querySelector('button');
    if (cardAuthBtn) {
      cardAuthBtn.addEventListener('click', () => this.handleAuthClick());
    }

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

    this.dom.saveSettingsBtn?.addEventListener('click', async () => {
      const newClientId = this.dom.clientIdInput.value.trim();
      const newClientSecret = this.dom.clientSecretInput ? this.dom.clientSecretInput.value.trim() : '';

      this.saveClientId(newClientId);

      // Save to backend if supported
      if (this.isBackendSupported && (newClientId || newClientSecret)) {
        try {
          const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: newClientId, clientSecret: newClientSecret })
          });
          const data = await res.json();
          if (data.ok) {
            this.backendConfigured = true;
          }
        } catch (e) {
          console.error('[WhatsNext] Failed to save config to server:', e);
        }
      }

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
        this.refreshEvents(true);
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

    // Auto refresh on tab visibility / focus
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || this.isDemoMode) return;
      if (this.isAuthenticated()) {
        this.refreshEvents(false);
      } else if (!this.isBackendSupported && this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
    });

    window.addEventListener('focus', () => {
      if (this.isDemoMode) return;
      if (this.isAuthenticated()) {
        this.refreshEvents(false);
      } else if (!this.isBackendSupported && this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
    });
  }

  /* ---------------- Initialization & Server Detection ---------------- */

  async initApp() {
    // Check URL query parameters (e.g. from OAuth redirect)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
      this.showToast('Signed in! Stay-logged-in access is active.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
      this.showToast(`Authentication error: ${urlParams.get('error')}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Probe if backend API is available
    const hasBackend = await this.checkBackendStatus();

    if (hasBackend) {
      this.updateAuthUI();
      if (this.backendAuthenticated) {
        this.refreshEvents(true);
        this.startAutoRefresh();
      } else {
        this.showState('auth');
      }
    } else {
      // Static host fallback: initialize client-side Google Identity Services
      this.initGoogleClient();
    }
  }

  async checkBackendStatus() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        this.isBackendSupported = true;
        this.backendConfigured = !!data.configured;
        this.backendAuthenticated = !!data.authenticated;

        if (data.clientId && !this.clientId) {
          this.clientId = data.clientId;
          localStorage.setItem('whatsnext_client_id', data.clientId);
        }
        if (data.email) {
          this.userEmail = data.email;
          localStorage.setItem('whatsnext_user_email', data.email);
        }
        return true;
      }
    } catch (e) {
      console.log('[WhatsNext] Backend not detected, running in client-only mode.');
    }
    this.isBackendSupported = false;
    return false;
  }

  handleAuthClick() {
    if (this.isBackendSupported) {
      if (!this.backendConfigured) {
        this.openSettings();
        this.showToast('Please enter your Client ID & Secret in Settings.');
        return;
      }
      // Redirect to server-side Google OAuth (generates offline refresh_token)
      window.location.href = '/api/auth/login';
      return;
    }

    // Client-side fallback
    if (!this.clientId) {
      this.openSettings();
      this.showToast('Please configure your Google Client ID first');
      return;
    }
    this.requestGoogleAccessToken();
  }

  /* ---------------- Google Identity Services (GIS Client Fallback) ---------------- */

  initGoogleClient() {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
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

      if (this.isAuthenticated()) {
        this.fetchUserProfile();
        this.refreshEvents();
        this.startAutoRefresh();
        const remainingSec = Math.floor((this.tokenExpiresAt - Date.now()) / 1000);
        this.scheduleTokenRefresh(remainingSec);
      } else if (this.hasSignedInBefore()) {
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

    const refreshInSeconds = Math.max(expiresInSeconds - 300, 60);
    this.tokenRefreshTimeout = setTimeout(() => {
      this.refreshTokenSilently();
    }, refreshInSeconds * 1000);
  }

  refreshTokenSilently() {
    if (!this.tokenClient || !this.clientId || this.isRefreshingToken) return;
    this.isRefreshingToken = true;

    const email = this.userProfile?.email || localStorage.getItem('whatsnext_user_email') || '';
    const opts = { prompt: '' };
    if (email) opts.hint = email;

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
    if (this.isBackendSupported) {
      return this.backendAuthenticated;
    }
    return !!this.accessToken && Date.now() < this.tokenExpiresAt - 60000;
  }

  async signOut(revoke = true) {
    if (this.isBackendSupported) {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      this.backendAuthenticated = false;
    }

    if (revoke && this.accessToken && window.google?.accounts?.oauth2) {
      try {
        google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch (e) {}
    }

    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userProfile = null;
    this.userEmail = '';
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
          this.userEmail = this.userProfile.email;
          localStorage.setItem('whatsnext_user_email', this.userProfile.email);
        }
        this.updateAuthUI();
      }
    } catch (e) {}
  }

  /* ---------------- Google Calendar Events Fetching ---------------- */

  async fetchCalendarEvents() {
    // 1. Backend-assisted fetch (permanent refresh token)
    if (this.isBackendSupported) {
      const response = await fetch('/api/events', { cache: 'no-store' });
      if (response.status === 401) {
        this.backendAuthenticated = false;
        this.updateAuthUI();
        return [];
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch calendar (${response.status})`);
      }
      const data = await response.json();
      this.backendAuthenticated = true;
      this.updateAuthUI();
      return this.processGoogleEvents(data.items || []);
    }

    // 2. Client-side fallback fetch
    if (!this.isAuthenticated()) {
      if (this.hasSignedInBefore()) {
        this.refreshTokenSilently();
      }
      return [];
    }

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
      console.warn('[WhatsNext] Access token expired (401). Performing silent renewal...');
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
      const err = await response.json().catch(() => ({}));
      console.error('Google Calendar 403 Forbidden:', err);
      this.signOut(false);
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

      if (item.attendees) {
        const selfAttendee = item.attendees.find((a) => a.self);
        if (selfAttendee && selfAttendee.responseStatus === 'declined') {
          continue;
        }
      }

      let start = null;
      let end = null;
      let isAllDay = false;

      if (item.start?.dateTime) {
        start = new Date(item.start.dateTime);
        end = item.end?.dateTime ? new Date(item.end.dateTime) : new Date(start.getTime() + 30 * 60 * 1000);
      } else if (item.start?.date) {
        isAllDay = true;
        start = new Date(`${item.start.date}T00:00:00`);
        end = item.end?.date ? new Date(`${item.end.date}T23:59:59`) : new Date(start.getTime() + 86400000);
      } else {
        continue;
      }

      if (end.getTime() <= now) continue;

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

    processed.sort((a, b) => a.start.getTime() - b.start.getTime());
    return processed;
  }

  extractMeetingLink(item) {
    if (item.hangoutLink) return item.hangoutLink;

    if (item.conferenceData?.entryPoints) {
      const videoEntry = item.conferenceData.entryPoints.find((ep) => ep.entryPointType === 'video');
      if (videoEntry?.uri) return videoEntry.uri;
    }

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

  getEligibleEvents() {
    const now = Date.now();
    return this.events.filter((evt) => {
      const startMs = evt.start.getTime();
      const endMs = evt.end.getTime();
      // Filter out events that have fully ended
      if (endMs <= now) return false;
      // If event already started, only keep it for up to 10 minutes after start
      if (startMs <= now) {
        return (now - startMs) < EVENT_STARTED_GRACE_MS;
      }
      return true;
    });
  }

  updateActiveEvent() {
    const eligibleEvents = this.getEligibleEvents();

    if (eligibleEvents.length === 0) {
      this.currentEvent = null;
      this.countdown.setTarget(null);
      this.showState('empty');
      this.renderAgenda([]);
      return;
    }

    this.currentEvent = eligibleEvents[0];
    this.countdown.setTarget(this.currentEvent.start, this.currentEvent.end);
    this.showState('hero');
    this.renderHeroDetails();
    this.renderAgenda(eligibleEvents);
  }

  handleEventExpired() {
    if (this.isDemoMode) {
      this.advanceDemoEvent();
    } else {
      // Immediately advance to next eligible event
      this.updateActiveEvent();
      // Silently refresh calendar in background for any changes
      this.refreshEvents(false);
    }
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
      this.dom.userEmail.textContent = this.userEmail || this.userProfile?.email || 'Connected';
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

    this.dom.countdownBadge.textContent = state.badge;
    this.dom.countdownBadge.className = `badge badge-${state.urgency}`;

    if (state.urgency === 'urgent') {
      this.dom.heroCard.classList.add('urgent-pulse');
    } else {
      this.dom.heroCard.classList.remove('urgent-pulse');
    }
  }

  renderHeroDetails() {
    if (!this.currentEvent) return;

    this.dom.meetingTitle.textContent = this.currentEvent.summary;
    this.dom.meetingTime.textContent = this.formatTimeRange(this.currentEvent.start, this.currentEvent.end, this.currentEvent.isAllDay);

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

  renderAgenda(eligibleEvents = null) {
    if (!this.dom.agendaList) return;
    this.dom.agendaList.innerHTML = '';

    const list = eligibleEvents !== null ? eligibleEvents : this.getEligibleEvents();
    const upcoming = list.slice(1, 4);

    if (upcoming.length === 0) {
      this.dom.agendaList.innerHTML = '<li class="agenda-empty">No further events scheduled</li>';
      return;
    }

    for (const evt of upcoming) {
      const li = document.createElement('li');
      li.className = 'agenda-item';

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
        start: new Date(now + 4 * 60 * 1000 + 30 * 1000),
        end: new Date(now + 35 * 60 * 1000),
        isAllDay: false,
        link: 'https://meet.google.com/abc-defg-hij',
        location: 'Google Meet'
      },
      {
        id: 'demo-2',
        summary: '1:1 Catchup with Engineering Lead',
        start: new Date(now + 48 * 60 * 1000),
        end: new Date(now + 78 * 60 * 1000),
        isAllDay: false,
        link: 'https://meet.google.com/xyz-uvwx-rst',
        location: 'Google Meet'
      },
      {
        id: 'demo-3',
        summary: 'Q3 Architectural Review',
        start: new Date(now + 3 * 3600 * 1000 + 15 * 60 * 1000),
        end: new Date(now + 4 * 3600 * 1000),
        isAllDay: false,
        link: null,
        location: 'Building B, Room 402'
      },
      {
        id: 'demo-4',
        summary: 'Executive All-Hands & AMA',
        start: new Date(now + 26 * 3600 * 1000),
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
    if (this.dom.clientSecretInput) {
      if (this.backendConfigured) {
        this.dom.clientSecretInput.placeholder = '•••••••••••••••• (Configured on server)';
        this.dom.clientSecretInput.value = '';
      } else {
        this.dom.clientSecretInput.placeholder = 'Google OAuth Client Secret';
      }
    }
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
