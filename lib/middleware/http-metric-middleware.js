const log = require("fruster-log");
const InfluxClient = require("../clients/InfluxClient");
const ResponseTimeRepo = require("../repos/ResponseTimeRepo");
const utils = require("../../utils");

/**
 * @type {InfluxClient}
 */
let _influxClient;

/**
 * @type {ResponseTimeRepo}
 */
let _responseTimeRepo;

/**
 * Express middleware that measures duration of request/response and
 * takes care of logging and passing data to Influxdb if enabled.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function responseTimeMiddleware(req, res, next) {
	const startTime = Date.now();

	res.on("finish", () => {
		const duration = Date.now() - startTime;
		log.info(`[${req.reqId}] ${req.method} ${req.path} -- ${res.statusCode} ${duration}ms`);

		if (_influxClient) {
			// @ts-ignore
			_influxClient.addHttpMetric({
				reqId: req.reqId,
				duration,
				method: req.method,
				statusCode: res.startusCode,
				path: req.path,
				userId: req.user ? req.user.id : null
			});
		}

		if (_responseTimeRepo) {
			_responseTimeRepo.save(req.reqId, utils.createSubject(req), res.statusCode, duration);
		}
	});

	next();
}

/**
 *
 * @param {Object} config
 * @param {InfluxClient=} config.influxClient
 * @param {ResponseTimeRepo=} config.responseTimeRepo
 */
module.exports = ({ influxClient, responseTimeRepo }) => {
	_influxClient = influxClient;
	_responseTimeRepo = responseTimeRepo;
	return responseTimeMiddleware;
};
