const router = require("express-promise-router")();
const context = require("./context");

router.get("/oauth_callback", context.adminContext, async (req, res) => {
  if (req.query.error) {
    return res.redirect("/");
  }

  if (!req.query || !req.query.code) {
    return res.sendStatus(400);
  }

  const tokens = await req.context.calendarProviders.office365.getAuthTokens(req.query.code).then(undefined, err => console.log(err));

  if (!tokens) {
    return res.sendStatus(401);
  }

  await req.context.storage.oauth.saveTokens(tokens);

  await req.context.storage.session.updateSession(req.context.session.token, { adminUserId: tokens.userId });

  return res.redirect("/office365/check_access");
});

router.get("/oauth_callback_admin", context.adminContext, async (req, res) => {
  if (req.query && req.query["admin_consent"] === "True" && !req.query["error"]) {
    for (let i = 0; i < 10; i++) {
      if (await req.context.calendarProviders.office365.isAccessTokenValid()) {
        return res.redirect("/admin");
      }

      await new Promise(res => setTimeout(res, 1000));
      await req.context.calendarProviders.office365.refreshAccessToken();
    }
  }

  return res.redirect("/?error=office365_login_error");
});

router.get("/check_access", context.adminContext, async (req, res) => {
  if (!await req.context.calendarProviders.office365.isAccessTokenValid()) {
    return res.redirect(req.context.calendarProviders.office365.getAdminAuthUrl());
  }

  return res.redirect("/admin");
});

module.exports = router;
