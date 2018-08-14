const log = require("fruster-log");
const bus = require("fruster-bus");
const conf = require("../../conf");
const AuthServiceClient = require("../clients/AuthServiceClient");

/**
 * Express middleware that decodes auth token that comes either as cookie or in Authorization
 * header (Bearer scheme) into a user object and appends it to HTTP request object for further
 * use.
 *
 * @return {Promise}
 */
async function decodeToken(req, httpRes, next) {
	if (isPublicRoute(req)) {
		log.debug(`[${req.reqId}] ${req.path} is a public route, skipping decode`);
		req.user = {};
		return next();
	}

	const reqId = req.reqId;
	const encodedToken = getToken(req);

	if (encodedToken) {
		log.debug(`[${req.reqId}] Will decode token`);

		try {
			req.user = await AuthServiceClient.decodeToken(reqId, encodedToken);
			log.debug(`[${req.reqId}] Successfully decoded token`);
		} catch (err) {
			if (err.status === 401 || err.status === 403) {
				log.debug("Failed to decode token (got error " + err.error.code + ") will expire cookie if present");

				err.headers = err.headers || {};
				err.headers["Set-Cookie"] = "jwt=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";

				// If jwt token failed to be decoded, we should unregister any clients connected using that jwt token
				unregisterWebSocketClients(reqId, encodedToken);
			}

			return httpRes
				.status(err.status)
				.set(err.headers)
				.json(err);
		}
	}
	next();
}

/**
 * Get token from HTTP request.
 *
 * Token is either set as cookie or in Authorization header.
 *
 * @param {Object} req
 */
function getToken(req) {
	let token;
	if (req.token) {
		token = req.token;
	} else if (req.cookies[conf.authCookieName] && req.cookies[conf.authCookieName].toLowerCase() !== "deleted") {
		token = req.cookies[conf.authCookieName];
	}

	return token;
}

/**
 * Checks if request is a public route and hence not needed to
 * decode cookie or token.
 *
 * @param {Object} req
 */
function isPublicRoute(req) {
	return conf.publicRoutes.includes(req.path);
}

/**
 * Unregisters web socket clients that used the provided token.
 * This should be invoked when token is not valid anymore.
 */
function unregisterWebSocketClients(reqId, token) {
	return bus.request({
		skipOptionsRequest: true,
		subject: "fruster-web-bus.unregister-client",
		message: {
			reqId: reqId,
			data: {
				jwt: token
			}
		}
	});
}

module.exports = () => {
	return decodeToken;
};
