const router = require("express-promise-router")();
const Moment = require("moment");

const context = require("../context");
const logger = require("../logger");
const paddle = require("../services/paddle");

const deviceRepresentation = ({ deviceId, createdAt, lastActivityAt, deviceType, calendarId, location, language, clockType, minutesForCheckIn, minutesForStartEarly, showAvailableRooms }) => ({
  id: deviceId,
  createdAt: new Date(createdAt).getTime(),
  deviceType,
  calendarId,
  location,
  minutesForCheckIn,
  minutesForStartEarly,
  showAvailableRooms,
  language: language || "en",
  clockType: clockType,
  isOnline: lastActivityAt > Date.now() - 70 * 1000,
  msSinceLastActivity: Date.now() - lastActivityAt
});

const userRepresentation = ({ createdAt, provider, subscriptionPassthrough, subscriptionUpdateUrl, isSubscriptionCancelled }, { displayName, photoUrl }, properties, { subscriptionPlanId, subscriptionTrialEndTimestamp }) => ({
  displayName,
  avatarUrl: photoUrl,
  createdAt: new Date(createdAt).getTime(),
  provider,
  subscriptionPassthrough,
  subscriptionPlanId,
  subscriptionTrialEndTimestamp,
  subscriptionUpdateUrl,
  isSubscriptionCancelled,
  properties
});

router.use("/admin", context.adminContext);

router.get("/admin/auth_urls", (req, res) => res.json({
  google: req.context.calendarProviders.google.getAuthUrl(),
  office365: req.context.calendarProviders.office365.getAuthUrl()
}));

router.get("/admin/logout", async (req, res) => {
  await req.context.removeSession(req, res);
  res.redirect("/?info=logout");
});

router.use("/admin", async function(req, res) {
  if (!req.context.session.adminUserId) {
    return res.sendStatus(403);
  }

  return "next";
});

async function checkSubscription(req, res) {
  if (req.context.subscriptionStatus && req.context.subscriptionStatus.isAdminPanelBlocked) {
    return res.sendStatus(402);
  }

  return "next";
}

router.get("/admin/user", async function(req, res) {
  const userOAuth = await req.context.storage.oauth.getByUserId(req.context.session.adminUserId);
  const userDetails = await req.context.calendarProvider.getUserDetails();
  const userProperties = await req.context.storage.userProperties.getProperties(req.context.session.adminUserId);

  const getTrialEnd = () => {
    if (!req.context.subscriptionStatus || userOAuth.subscriptionPlanId) {
      return null;
    }

    if (Moment(userOAuth.createdAt).isBefore(Moment([2019, 2, 1]))) {
      return Moment([2019, 3, 1]).valueOf();
    }

    return Moment(userOAuth.createdAt).add(30, "days").valueOf();
  };

  const getSubscriptionPlanId = () => {
    if (!req.context.subscriptionStatus) return 1;
    if (userOAuth.isSubscriptionCancelled) return null;
    return userOAuth.subscriptionPlanId;
  };

  res.json(userRepresentation(userOAuth, userDetails, userProperties, {
    subscriptionTrialEndTimestamp: getTrialEnd(),
    subscriptionPlanId: getSubscriptionPlanId()
  }));
});

router.put("/admin/user/property/:propertyId", async function(req, res) {
  await req.context.storage.userProperties.setProperty(req.context.session.adminUserId, req.params.propertyId, req.body);
  res.sendStatus(204);
});

router.get("/admin/calendar", async function(req, res) {
  res.json(await req.context.calendarProvider.getCalendars({ invalidateCache: true }));
});

router.get("/admin/device", async function(req, res) {
  const devices = await req.context.storage.devices.getDevicesForUser(req.context.session.adminUserId);
  res.json(devices.map(deviceRepresentation));
});

router.post("/admin/device", checkSubscription, async function(req, res) {
  const device = await req.context.storage.devices.getDeviceByConnectionCode(req.body.connectionCode);

  if (!device) {
    return res.sendStatus(404);
  }

  console.log("connecting device: " + device.deviceId);

  await req.context.storage.devices.connectDevice(device.deviceId, req.context.session.adminUserId);

  res.json(deviceRepresentation(device));
});

router.put("/admin/device/:deviceId", checkSubscription, async function(req, res) {
  const device = await req.context.storage.devices.getDeviceById(req.params.deviceId);

  if (!device || device.userId !== req.context.session.adminUserId) {
    res.status(404).send(`No device with id ${req.params.deviceId}`);
  }

  if (req.body.calendarId) {
    const calendarsFromProvider = await req.context.calendarProvider.getCalendars();
    const calendar = calendarsFromProvider.find(calendar => calendar.id === req.body.calendarId);

    if (!calendar) {
      return res.status(404).send(`No calendar with id ${req.body.calendarId}`);
    }
  }

  await req.context.storage.devices.setTypeForDevice(req.params.deviceId, req.body.deviceType);
  await req.context.storage.devices.setCalendarForDevice(req.params.deviceId, req.body.calendarId);
  await req.context.storage.devices.setLocationForDevice(req.params.deviceId, String(req.body.location).trim());
  await req.context.storage.devices.setLanguageForDevice(req.params.deviceId, req.body.language);
  await req.context.storage.devices.setClockTypeForDevice(req.params.deviceId, req.body.clockType);
  await req.context.storage.devices.setMinutesForCheckIn(req.params.deviceId, req.body.minutesForCheckIn);
  await req.context.storage.devices.setMinutesForStartEarly(req.params.deviceId, req.body.minutesForStartEarly);
  await req.context.storage.devices.setShowAvailableRooms(req.params.deviceId, req.body.showAvailableRooms);

  res.sendStatus(204);
});

router.delete("/admin/device/:deviceId", checkSubscription, async function(req, res) {
  const device = await req.context.storage.devices.getDeviceById(req.params.deviceId);

  if (device && device.userId === req.context.session.adminUserId) {
    await req.context.storage.devices.removeDevice(req.params.deviceId, req.context.session.adminUserId);
  }

  res.sendStatus(204);
});

router.put("/admin/subscription", async function(req, res) {
  const oauth = await req.context.storage.oauth.getByUserId(req.context.session.adminUserId);
  const errorMessage = await paddle.changeSubscriptionPlan(oauth.subscriptionId, req.body.subscriptionPlanId);

  if (errorMessage) {
    logger.error(errorMessage);
  }

  res.sendStatus(errorMessage ? 400 : 200);
});

router.delete("/admin/subscription", async function(req, res) {
  const oauth = await req.context.storage.oauth.getByUserId(req.context.session.adminUserId);
  const errorMessage = await paddle.cancelSubscription(oauth.subscriptionId);

  if (errorMessage) {
    logger.error(errorMessage);
  }

  res.sendStatus(errorMessage ? 400 : 200);
});

module.exports = router;
