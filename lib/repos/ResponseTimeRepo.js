const config = require("../../conf");
const constants = require("../constants");
const utils = require("../../utils");

class ResponseTimeRepo {

    /**
     * @param {Object} db 
     */
    constructor(db) {
        this._collection = db.collection(constants.collections.RESPONSE_TIME);
    }

    /**
     * Save response time 
     * 
     * @param {String} reqId 
     * @param {Object} request
     * @param {Object} response 
     * @param {Number} time 
     * 
     * @returns {Promise<Object>}
     */
    async save(reqId, request, response, time) {
        return await this._collection.insert({
            id: reqId,
            subject: utils.createSubject(request),
            status: response.status,
            time: time,
            createdAt: new Date()
        });
    }

    /**
     * Get response time with pagination
     * 
     * @param {Object} query 
     * @param {Number} limit 
     * @param {Object} sort  
     * 
     * @returns {Promise<Array>}
     */
    async findByQuery(query = {}, limit, sort) {
        return await this._collection.find(query)
            .limit(limit)
            .sort(sort)
            .toArray();
    }
}

module.exports = ResponseTimeRepo;