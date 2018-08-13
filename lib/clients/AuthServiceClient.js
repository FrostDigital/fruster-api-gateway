const bus = require("fruster-bus");

class AuthServiceClient {
	constructor() {}

	/**
	 * Decodes provided token into a user object.
	 *
	 * @param {String} reqId
	 * @param {String} token encoded token
	 */
	async decodeToken(reqId, token) {
		const resp = await bus.request({
			skipOptionsRequest: true,
			subject: AuthServiceClient.DECODE_SUBJECT,
			message: {
				reqId,
				data: token
			}
		});

		return resp.data;
	}
}

AuthServiceClient.DECODE_SUBJECT = "auth-service.decode-token";

module.exports = AuthServiceClient;
