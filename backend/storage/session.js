const Sequelize = require("sequelize");

module.exports = class {
  constructor(sequelize) {
    this.Model = sequelize.define("login", {
      token: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4 },
      adminUserId: Sequelize.STRING,          // Used only for admin sessions
      deviceId: Sequelize.STRING              // Used only for device sessions
    });
  }

  async createSession() {
    const model = this.Model.build({});
    await model.save();

    return model;
  }

  async getSession(sessionToken) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(sessionToken)) {
      return null;
    }

    return await this.Model.findOne({ where: { token: sessionToken } });
  }

  async getSessionForDevice(deviceId) {
    return await this.Model.findOne({ where: { deviceId } });
  }

  async updateSession(token, update) {
    await this.Model.update(update, { where: { token } });
  }

  async deleteSession(token) {
    await this.Model.destroy({ where: { token } });
  }
};
