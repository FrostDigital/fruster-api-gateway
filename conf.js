const interceptorConfig = require("./lib/interceptor-config");
const ms = require("ms");

module.exports = {
	/**
	 * Port API gateway listens on
	 *
	 * Default: 3000
	 */
	port: process.env.PORT || 3000,

	/**
	 * Allow origin for CORS
	 * Examples: `*`, `http://www.example.com`, `http://www.example.com,http://localhost:9000`
	 *
	 * Default: *
	 */
	allowOrigin: parseArray(process.env.ALLOW_ORIGIN) || "*",

	/**
	 * Specify allowed headers for CORS, can be a comma separated string if multiple
	 *
	 * Default: {none}
	 */
	allowedHeaders: process.env.ALLOWED_HEADERS || "",

	/**
	 * If stack traces should be leaked in error responses.
	 *
	 * Default: true
	 */
	printStacktrace: parseBool(process.env.PRINT_STACKTRACE, true),

	/**
	 * NATS servers, set multiple if using cluster
	 * Example: `"nats://10.23.45.1:4222", "nats://10.23.41.8:4222"`
	 *
	 * Default: nats://localhost:4222
	 */
	bus: process.env.BUS || "nats://localhost:4222",

	/**
	 * Mongo database URL
	 *
	 * Default: "mongodb://localhost:27017/fruster-api-gateway
	 */
	mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/fruster-api-gateway",

	/**
	 * Enable stats module for response time monitoring. This will expose an web UI
	 * on path /statz.
	 *
	 * Note that MONGO_URL needs to be set in order for stats to work.
	 *
	 * Default: false
	 */
	enableStats: (process.env.ENABLE_STAT || process.env.ENABLE_STATS) === "true",

	/**
	 * URL to influxdb that, if set, will enable HTTP metrics to be sent to influx
	 * for further crunching and dashboarding i.e. using Grafana.
	 *
	 * If not set API gateway will not attempt to send any data to influxdb.
	 *
	 * Example values:
	 *
	 * influxdb://username:password@hostname:8086/some-database
	 * influxdb://hostname:8086/some-database
	 *
	 * Default: null
	 */
	influxDbUrl: process.env.INFLUXDB_URL || null,

	/**
	 * How often metrics are sent to influx.
	 *
	 * Default: 30s
	 */
	influxWriteInterval: ms(process.env.INFLUX_WRITE_INTERVAL || "30s"),

	/**
	 * For how long time HTTP response time stats should be saved.
	 *
	 * Default: 4w
	 */
	statsTTL: parseInt((ms(process.env.STATS_TTL || "4w") / 1000) + ""),

	/**
	 * Max size of requests that we can handle.
	 * Examples: `1mb`, `100kb`
	 *
	 * Default: 100mb
	 */
	maxRequestSize: process.env.MAX_REQUEST_SIZE || "100mb",

	/**
	 * Time in milliseconds until API Gateway responds with timeout failure response.
	 */
	httpTimeout: process.env.HTTP_TIMEOUT || "2s",

	/**
	 * Time in milliseconds API Gateway waits for reply from bus.
	 * If exceeded a 404 response will be sent.
	 *
	 * Default: 1s
	 */
	busTimeout: process.env.BUS_TIMEOUT || "1s",

	/**
	 * If to unwrap response JSON and only return `data` part.
	 *
	 * Default: false
	 *
	 * TODO: Is this used? If not this should be deprecated and eventually removed? /JS
	 */
	unwrapMessageData: process.env.UNWRAP_MESSAGE_DATA === "true",

	/**
	 * Name of cookie that holds auth token. This needs to match `JWT_COOKIE_NAME`
	 * in fruster-auth-service.
	 *
	 * Default: jwt
	 */
	authCookieName: process.env.AUTH_COOKIE_NAME || "jwt",

	/**
	 * Whether or not to allow public/non authenticated users to connect via websocket.
	 *
	 * Default: true
	 */
	allowPublicWebsocketConnections: parseBool(process.env.ALLOW_PUBLIC_WEBSOCKET_CONNECTIONS, true),

	/**
	 * Subject for web sockets.
	 *
	 * Default: ws.out.:userId.>
	 */
	webSocketSubject: process.env.WEBSOCKET_SUBJECT || "ws.out.:userId.>",

	/**
	 * Interceptor are named INTERCEPTOR_N where N is a number indicating in which
	 * order the interceptor will run. Is defined in syntax `<subject pattern to intercept>:<interceptor subject>`
	 *
	 * Example: `INTERCEPTOR_1=http.post.auth.*:foo-service.intercept-login`
	 */
	interceptors: interceptorConfig(),

	/**
	 * If true, no cache headers (Cache-control, Pragma and Expires) will be added to
	 * responsed to instruct clients not to cache any responses. Etags will be used by default.
	 *
	 * Default: false
	 */
	noCache: process.env.NO_CACHE === "true",

	/**
	 * Public routes that if hit, will not attempt to decode cookie/token even though a token
	 * was provided in request.
	 *
	 * Default: /auth/cookie,/auth/token
	 */
	publicRoutes: (process.env.PUBLIC_ROUTES || "/auth/cookie,/auth/token").split(","),


	/**
	 * Whether or not to do lowercase on http subjects
	 *
	 * Default: true
	 */
	httpSubjectToLowerCase: parseBool(process.env.HTTP_SUBJECT_TO_LOWERCASE, true),
};

function parseBool(str, defaultVal) {
	return !str ? defaultVal : str === "true";
}

function parseArray(str) {
	if (str) {
		return str.split(",");
	}
	return null;
}
