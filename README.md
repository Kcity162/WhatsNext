# WhatsNext ⏱️

A minimalist, mobile-responsive web app that connects to your Google Calendar and counts down to your next meeting in **intuitive, sensible increments** (e.g., *2d 4h* &rarr; *1h 15m* &rarr; *35m* &rarr; *4:12* &rarr; *45s*).

Designed with an ultra-compact footprint, perfect for mobile screens, pinned tabs, or a mini desktop corner widget.

---

## ✨ Features

- **Sensible, Adaptive Increments**:
  - **> 24 hours away**: Displays days & hours (e.g., `2d 4h`)
  - **1h to 24h away**: Displays hours & minutes (e.g., `1h 45m`)
  - **5m to 60m away**: Displays remaining minutes (e.g., `35m`)
  - **< 5 minutes away**: Live ticking countdown (e.g., `4:12`)
  - **< 1 minute away**: Imminent seconds countdown (e.g., `45s`)
  - **Happening Now**: Displays "In Progress · Ends in Xm"
- **One-Tap "Join Call"**: Automatically detects Google Meet, Zoom, Microsoft Teams, and Webex video links.
- **Mobile-Responsive & Compact**: Clean, modern dark aesthetic designed specifically for small viewports (smartphones, narrow sidebar tiles, floating windows).
- **Upcoming Agenda**: Collapsible preview of the next 2-3 meetings today/tomorrow.
- **Google OAuth 2.0 GIS**: Secure client-side authentication using Google Identity Services. Tokens stay strictly in your browser session.
- **Interactive Demo Mode**: Includes simulated meetings out-of-the-box so you can try the animations, countdown, and responsive layout immediately.

---

## 🚀 Quick Start

### 1. Start the local server
Run the included zero-dependency Python script:

```bash
python3 server.py
```

Then open your browser to:
👉 **[http://localhost:3000](http://localhost:3000)**

*(Click "Try Demo" in the top bar to test the UI immediately without signing in!)*

---

## 🔑 Google Cloud Setup (2 Minutes)

Since this app accesses your personal Google Calendar, Google requires an **OAuth 2.0 Client ID**:

1. Open the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Create a new project (e.g., `WhatsNext`).
3. Enable the **Google Calendar API**:
   - Go to **APIs & Services** &rarr; **Library**.
   - Search for **Google Calendar API** and click **Enable**.
4. Configure the **OAuth Consent Screen**:
   - Go to **APIs & Services** &rarr; **OAuth consent screen**.
   - Select User Type: **External** (or Internal if using Google Workspace).
   - Fill in App Name (e.g., `WhatsNext`) and your email address.
   - Under **Scopes**, click **Add or Remove Scopes** and add:
     - `.../auth/calendar.readonly` (See and download any calendar with the Google Calendar API)
   - Under **Test users**, add your personal Google email address.
   - *Important*: When signing in on the web app, Google will present a consent screen with checkboxes. **Make sure to check the box: "See and download events on your calendars"**!
5. Create Credentials:
   - Go to **APIs & Services** &rarr; **Credentials** &rarr; **Create Credentials** &rarr; **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `WhatsNext Web Client`.
   - Under **Authorized JavaScript origins**, add:
     ```
     http://localhost:3000
     https://YOUR_RENDER_URL.onrender.com
     ```
   - Under **Authorized redirect URIs**, add:
     ```
     http://localhost:3000/oauth2callback
     https://YOUR_RENDER_URL.onrender.com/oauth2callback
     ```
   - Click **Create** and copy both your **Client ID** and **Client Secret**.
6. Configure WhatsNext:
   - Open WhatsNext in your browser, click the **Settings (⚙️)** icon, and paste your **Client ID** and **Client Secret**.
   - Click **Save Settings**, then click **Sign in with Google**.
   - Google will issue an offline `refresh_token` so you **stay logged in permanently** (never logs out after 1 hour).

---

## 📱 Mobile Usage / Home Screen Widget

To use WhatsNext as an app on your phone:
1. When hosting on your local network (e.g., `http://<your-mac-ip>:3000`) or deploying to any static host (such as GitHub Pages, Vercel, or Netlify):
2. Open the page in **Safari** on iOS or **Chrome** on Android.
3. Tap **Share** &rarr; **Add to Home Screen**.
4. WhatsNext will open full-screen like a native mobile app without browser address bars!
