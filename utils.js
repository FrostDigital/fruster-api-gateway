const ESCAPE_DOTS_REGEPX = /\./g;
const conf = require("./conf");

module.exports = {
	/**
	 * Creates bus subject from a HTTP request.
	 *
	 * Example:
	 *
	 * GET /foo/bar => http.get.foo.bar
	 *
	 */
	createSubject: req => {
		const method = req.method.toLowerCase();
		const path = req.path.replace(ESCAPE_DOTS_REGEPX, "{dot}").split("/");

		let subject = ["http", method]
			.concat(path)
			.filter(function (val) {
				return val;
			})
			.join(".");

		if (conf.httpSubjectToLowerCase)
			subject = subject.toLowerCase();

		return subject;
	},

	/**
	 * Creates bus request message from a HTTP request.
	 */
	createRequest: (req, reqId, user) => {
		let o = {
			reqId: reqId,
			method: req.method,
			path: req.path,
			query: req.query,
			headers: req.headers,
			data: req.body
		};

		if (user) {
			o.user = user;
		}

		return o;
	},

	/**
	 * Strips data from response that should not be leaked to outside.
	 */
	sanitizeResponse: resp => {
		var clone = Object.assign(resp);
		delete clone.headers;
		delete clone.user;
		return clone;
	},

	/**
	 * Converts JSON object to a string that is appropriate to use
	 * in a HTTP header.
	 *
	 * Note that only ASCII chars are okay to use in HTTP headers. Emoji's and
	 * other unorthodox characters may break the request.
	 */
	convertJsonToHttpHeaderString: json => {
		const stringifiedJson = JSON.stringify(json);
		const stringWithOnlyAscii = stringifiedJson.replace(/[^\x00-\x7F]/g, ""); // ASCII filter magic taken from https://stackoverflow.com/a/20856346
		return stringWithOnlyAscii;
	}
};
