const router = require("express-promise-router")();

router.get("/version", (req, res) => res.json({ version: process.env["ROOMBELT_API_VERSION"] }));

router.use(require("./admin"));
router.use(require("./device"));
router.use(require("./paddle"));

router.use((err, req, res, next) => {
  console.error(err);
  res.sendStatus(500);
});

module.exports = router;
