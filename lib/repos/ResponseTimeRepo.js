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
	 * @param {String} subject
	 * @param {Number} status
	 * @param {Number} time
	 *
	 * @returns {Promise<Object>}
	 */
	async save(reqId, subject, status, time) {
		return await this._collection.insert({
			id: reqId,
			subject,
			status,
			time,
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
		return await this._collection
			.find(query)
			.limit(limit)
			.sort(sort)
			.toArray();
	}
}

module.exports = ResponseTimeRepo;
