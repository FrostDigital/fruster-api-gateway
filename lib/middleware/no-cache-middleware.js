const conf = require("../../conf");

/**
 * Express middleware that adds "no cache" headers if configured to do so.
 *
 * Primary use case for this is to deal with old IE browsers that
 * caches XHR requests if cache headers are not set.
 *
 * More about this here https://stackoverflow.com/questions/32261000/how-to-avoid-ajax-caching-in-internet-explorer-11-when-additional-query-string-p).
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function noCacheMiddleware(req, res, next) {
	if (conf.noCache) {
		res.header("Cache-Control", "max-age=0, no-cache, no-store, must-revalidate");
		res.header("Pragma", "no-cache");
		res.header("Expires", 0);
	}
	next();
}

module.exports = () => {
	return noCacheMiddleware;
};
