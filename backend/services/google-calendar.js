const { google } = require("googleapis");
const OAuth2 = google.auth.OAuth2;
const Cache = require("./cache");

const getTimestamp = time => time && time && new Date(time.dateTime || time.date).getTime();
const mapEvent = ({ id, summary, start, end, organizer, attendees, extendedProperties }) => ({
  id,
  summary,
  organizer,
  startTimestamp: getTimestamp(start),
  endTimestamp: getTimestamp(end),
  attendees: attendees || [],
  isCheckedIn: extendedProperties && extendedProperties.private && extendedProperties.private.roombeltIsCheckedIn === "true"
});

const cache = new Cache(30);

module.exports = class {
  constructor(keys, credentials) {
    this.oauthClient = new OAuth2(keys.clientId, keys.clientSecret, keys.redirectUrl);

    this.oauthClient.setCredentials({
      access_token: credentials && credentials.accessToken,
      refresh_token: credentials && credentials.refreshToken
    });

    this.calendarClient = google.calendar({ version: "v3", auth: this.oauthClient });
    this.plusClient = google.plus({ version: "v1", auth: this.oauthClient });

    this.cacheKey = credentials && credentials.refreshToken;
    this.clientId = keys.clientId;
  }

  getAuthUrl(forceConsent) {
    const scopes = ["https://www.googleapis.com/auth/calendar", "profile"];

    return this.oauthClient.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: forceConsent ? "consent" : undefined
    });
  }

  async getAuthTokens(authCode) {
    const { tokens } = await this.oauthClient.getToken(authCode);
    const verification = await this.oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      userId: verification.payload.sub
    };
  }

  async isAccessTokenValid() {
    try {
      await this.getCalendars();
      return true;
    } catch (err) {
      return false;
    }
  }

  async getUserDetails() {
    const { data } = await new Promise((res, rej) =>
      this.plusClient.people.get({ userId: "me" }, (err, data) => (err ? rej(err) : res(data)))
    );

    return data;
  }

  async getCalendars() {
    const cacheKey = `calendars-${this.cacheKey}`;
    const cachedValue = cache.get(cacheKey);

    if (cachedValue) {
      return cachedValue;
    }

    const { data } = await new Promise((res, rej) =>
      this.calendarClient.calendarList.list((err, data) => (err ? rej(err) : res(data)))
    );

    cache.set(cacheKey, data.items);

    return data.items;
  }

  async getCalendar(calendarId) {
    const cacheKey = `calendar-${this.cacheKey}-${calendarId}`;
    const cachedValue = cache.get(cacheKey);

    if (cachedValue) {
      return cachedValue;
    }

    const { data } = await new Promise((res, rej) =>
      this.calendarClient.calendarList.get(
        { calendarId: encodeURIComponent(calendarId) },
        (err, data) => (err ? rej(err) : res(data))
      )
    );

    cache.set(cacheKey, data);

    return data;
  }

  async getEvents(calendarId) {
    const cacheKey = `events-${this.cacheKey}-${calendarId}`;
    const cachedValue = cache.get(cacheKey);

    if (cachedValue) {
      return cachedValue;
    }

    const query = {
      calendarId: encodeURIComponent(calendarId),
      timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true
    };

    const { data } = await new Promise((res, rej) =>
      this.calendarClient.events.list(query, (err, data) => (err ? rej(err) : res(data)))
    );

    const result = data.items.map(mapEvent).sort((a, b) => a.startTimestamp - b.startTimestamp);

    cache.set(cacheKey, result);

    return result;
  }

  async createEvent(calendarId, { startTimestamp, endTimestamp, isCheckedIn, summary }) {
    cache.delete(`events-${this.cacheKey}-${calendarId}`);

    const query = {
      calendarId: encodeURIComponent(calendarId),
      resource: {
        summary,
        start: { dateTime: new Date(startTimestamp).toISOString() },
        end: { dateTime: new Date(endTimestamp).toISOString() },
        extendedProperties: { private: { roombeltIsCheckedIn: isCheckedIn ? "true" : "false" } }
      }
    };

    await new Promise((res, rej) =>
      this.calendarClient.events.insert(query, (err, data) => (err ? rej(err) : res(data)))
    );
  }

  async patchEvent(calendarId, eventId, { startTimestamp, endTimestamp, isCheckedIn }) {
    cache.delete(`events-${this.cacheKey}-${calendarId}`);

    const resource = {};
    if (startTimestamp) resource.start = { dateTime: new Date(startTimestamp).toISOString() };
    if (endTimestamp) resource.end = { dateTime: new Date(endTimestamp).toISOString() };
    if (isCheckedIn) resource.extendedProperties = { private: { roombeltIsCheckedIn: "true" } };

    const query = {
      calendarId: encodeURIComponent(calendarId),
      eventId: encodeURIComponent(eventId),
      resource
    };

    await new Promise((res, rej) =>
      this.calendarClient.events.patch(query, (err, data) => (err ? rej(err) : res(data)))
    );
  }

  async deleteEvent(calendarId, eventId) {
    cache.delete(`events-${this.cacheKey}-${calendarId}`);

    const query = {
      calendarId: encodeURIComponent(calendarId),
      eventId: encodeURIComponent(eventId)
    };

    await new Promise((res, rej) =>
      this.calendarClient.events.delete(query, (err, data) => (err ? rej(err) : res(data)))
    );
  }
};
