const ms = require("ms");
const Sequelize = require("sequelize");
const Moment = require("moment");
const Storage = require("./storage");
const config = require("./config");
const premiumPlans = require("./services/premium-plans");

const GoogleCalendar = require("./services/google-calendar");
const Office365Calendar = require("./services/office365-calendar");

const storage = new Storage(
  new Sequelize(config.databaseUrl, {
    logging: process.env.NODE_ENV !== "production" && console.log
  })
);

async function getSubscriptionStatus(oauth) {
  if (!config.paddleApiKey || !oauth) {
    return null;
  }

  const isSubscriptionCancelled = oauth.isSubscriptionCancelled;

  const now = Moment();
  const endOfTrial = Moment(oauth.createdAt).add(30, "days");
  const firstOfApril = Moment([2019, 3, 1]);
  const isTrialExpired = !oauth.subscriptionPlanId && now.isAfter(endOfTrial) && now.isAfter(firstOfApril);
  const isTrialLongExpired = isTrialExpired && now.isAfter(endOfTrial.add(3, "days")) && now.isAfter(firstOfApril.add(3, "days"));

  const currentPlan = premiumPlans[oauth.subscriptionPlanId];
  const connectedDevicesCount = storage.devices.countDevicesForUser(oauth.userId);
  const isUpgradeRequired = currentPlan && currentPlan.maxDevices < connectedDevicesCount;

  return {
    isAdminPanelBlocked: isSubscriptionCancelled || isUpgradeRequired || isTrialExpired,
    areDevicesBlocked: isSubscriptionCancelled || isUpgradeRequired || isTrialLongExpired
  };
}

const createContext = (cookieName, cookieTTL, alternateCookieName) => async (req, res) => {
  if (!cookieName) {
    req.context = { storage };
    return "next";
  }

  const session = await storage.session.getSession(req.cookies[cookieName]) || await storage.session.createSession();

  const device = session.deviceId && await storage.devices.getDeviceById(session.deviceId);
  const userId = session.adminUserId || (device && device.userId);

  const oauth = await storage.oauth.getByUserId(userId);

  const googleCalendarProvider = new GoogleCalendar(config.google, (oauth && oauth.provider === "google") ? oauth : null);
  const office365CalendarProvider = new Office365Calendar(config.office365, (oauth && oauth.provider) === "office365" ? oauth : null);

  const subscriptionStatus = await getSubscriptionStatus(oauth);

  req.context = {
    storage,
    calendarProvider: oauth && (oauth.provider === "office365" ? office365CalendarProvider : googleCalendarProvider),
    calendarProviders: {
      google: googleCalendarProvider,
      office365: office365CalendarProvider
    },
    session,
    subscriptionStatus,
    removeSession: async () => {
      await storage.session.deleteSession(req.context.session.token);
      res.clearCookie(cookieName, { httpOnly: true });

      // TODO: Remove after 1st of September
      if (alternateCookieName) res.clearCookie(alternateCookieName, { httpOnly: true });
    }
  };

  res.cookie(cookieName, session.token, { httpOnly: true, maxAge: cookieTTL });

  // TODO: Remove after 1st of September
  if (alternateCookieName) res.cookie(alternateCookieName, session.token, { httpOnly: true, maxAge: cookieTTL });

  return "next";
};

exports.emptyContext = createContext();
exports.deviceContext = createContext("sessionToken", ms("1 year"), "deviceSessionToken");
exports.adminContext = createContext("adminSessionToken", ms("1 day"));

