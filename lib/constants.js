module.exports = {
	websocketErrorCodes: {

		USER_DISCONNECTED: "USER_DISCONNECTED",
		PERMISSION_DENIED: "PERMISSION_DENIED",
		INVALID_TOKEN: "INVALID_TOKEN"

	},

	collections: {
		RESPONSE_TIME: "response-time"
	},

	TEXT_CONTENT_TYPES: [
		"text/plain",
		"text/xml",
		"text/html",
		"text/css",
		"text/csv",
		"text/calendar",
		"application/xml"
	],

	BINARY_CONTENT_TYPES: [
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-excel",
		"application/zip"
	]
};
