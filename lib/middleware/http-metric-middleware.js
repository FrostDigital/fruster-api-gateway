const log = require("fruster-log");
const InfluxRepo = require("../repos/InfluxRepo");
const ResponseTimeRepo = require("../repos/ResponseTimeRepo");
const utils = require("../../utils");

/**
 * @type {InfluxRepo}
 */
let _influxRepo;

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
function httpMetricsMiddleware(req, res, next) {
	const startTime = Date.now();

	res.on("finish", () => {
		const duration = Date.now() - startTime;
		log.info(`[${req.reqId}] ${req.method} ${req.path} -- ${res.statusCode} ${duration}ms`);

		if (_influxRepo) {
			// @ts-ignore
			_influxRepo.addHttpMetric({
				reqId: req.reqId,
				duration,
				method: req.method,
				statusCode: res.statusCode,
				path: req.path,
				userId: req.user ? req.user.id : null,
				userAgent: req.headers["user-agent"],
				roles: req.user && req.user.roles ? req.user.roles.join(",") : null,
				ip: req.headers["x-forwarded-for"]
			});
		}

		if (_responseTimeRepo && req.path.indexOf("/statz") !== 0) {
			_responseTimeRepo.save(req.reqId, utils.createSubject(req), res.statusCode, duration);
		}
	});

	next();
}

/**
 *
 * @param {Object} config
 * @param {InfluxRepo=} config.influxRepo
 * @param {ResponseTimeRepo=} config.responseTimeRepo
 */
module.exports = ({ influxRepo, responseTimeRepo }) => {
	_influxRepo = influxRepo;
	_responseTimeRepo = responseTimeRepo;
	return httpMetricsMiddleware;
};
