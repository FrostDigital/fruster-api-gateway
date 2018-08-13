const uuid = require("uuid");

const REQ_ID_HTTP_HEADER = "X-Fruster-Req-Id";

/**
 * A simple express middleware that generates and appends `reqId` to
 * request object and as a HTTP header to the response.
 *
 * The reqId will then be available in all subsequent express middlewares
 * and express handlers using `req.reqId`.
 *
 * This middleware should be invoked as early as possible in the chain
 * so that the reqId is made available.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function reqIdMiddleware(req, res, next) {
	const reqId = uuid.v4();

	req.reqId = reqId;
	res.header(REQ_ID_HTTP_HEADER, reqId);

	next();
}

module.exports = () => {
	return reqIdMiddleware;
};
