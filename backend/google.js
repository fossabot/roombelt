const router = require("express-promise-router")();
const GoogleCalendar = require("./services/google-calendar");
const logger = require("./logger");

router.post("/web_hook", async (req, res) => {
  const state = req.headers["x-goog-resource-state"];
  const channelId = req.headers["x-goog-channel-id"];
  const token = req.headers["x-goog-channel-token"];

  if (state !== "sync" && await GoogleCalendar.watchersCache.get(token) === channelId) {
    logger.debug(`clearing cache for ${channelId} ${token}`);
    await GoogleCalendar.valuesCache.delete(token);
  }

  logger.debug(`${state} ${token} ${channelId}`);

  res.sendStatus(204);
});

router.get("/oauth_callback", require("./context").adminContext, async (req, res) => {
  if (req.query.error === "access_denied") {
    return res.redirect("/");
  }

  if (!req.query || !req.query.code) {
    return res.sendStatus(400);
  }

  const tokens = await req.context.calendarProviders.google.getAuthTokens(req.query.code).then(undefined, e => console.error(e));

  if (!tokens) {
    return res.sendStatus(401);
  }

  await req.context.storage.oauth.saveTokens(tokens);

  const savedTokens = await req.context.storage.oauth.getByUserId(tokens.userId);

  if (!savedTokens.refreshToken) {
    return res.redirect(req.context.calendarProviders.google.getAuthUrl(true));
  }

  await req.context.storage.session.updateSession(req.context.session.token, { adminUserId: tokens.userId });

  res.redirect(`/admin`);
});

module.exports = router;
