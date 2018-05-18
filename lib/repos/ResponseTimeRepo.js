const mongo = require("mongodb");
const config = require("../../conf");
const constants = require("../constants");
const utils = require("../../utils");

class ResponseTimeRepo {

    /**
     * @returns {Promise<Object>}
     */
    async getCollection() {
        const db = await mongo.connect(config.mongoUrl);
        return db.collection(constants.collections.RESPONSE_TIME);
    }

    /**
     * Save response time 
     * 
     * @param {String} reqId 
     * @param {Object} httpReq 
     * @param {Number} time 
     */
    async save(reqId, httpReq, time) {
        const collection = await this.getCollection();

        return await collection.insert({
            id: reqId,
            subject: utils.createSubject(httpReq),
            time: time
        });
    }
}

module.exports = ResponseTimeRepo;