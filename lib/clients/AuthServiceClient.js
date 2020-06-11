const bus = require("fruster-bus");

class AuthServiceClient {
	static get endpoints() {
		return {
			DECODE_SUBJECT: "auth-service.decode-token"
		};
	}

	/**
	 * Decodes provided token into a user object.
	 *
	 * @param {String} reqId
	 * @param {String} token encoded token
	 * @param {String} headers
	 */
	static async decodeToken(reqId, token, headers) {
		const resp = await bus.request({
			skipOptionsRequest: true,
			subject: AuthServiceClient.endpoints.DECODE_SUBJECT,
			message: {
				reqId,
				data: token,
				headers
			}
		});

		return resp.data;
	}
}

module.exports = AuthServiceClient;
