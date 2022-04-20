const express = require("express");
const mongo = require("mongodb");
const http = require("http");
const ms = require("ms");
const request = require("request");
const { Promise: BPromise } = require("bluebird");
const log = require("fruster-log");
const bus = require("fruster-bus");
const utils = require("./utils");
const conf = require("./conf");
const constants = require("./lib/constants");
const ResponseTimeRepo = require("./lib/repos/ResponseTimeRepo");
const statzIndex = require("./web/statz/index");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const bearerToken = require("express-bearer-token");
const timeout = require("connect-timeout");
const bodyParser = require("body-parser");
const InfluxRepo = require("./lib/repos/InfluxRepo");
const favicon = require("express-favicon");
const reqIdMiddleware = require("./lib/middleware/reqid-middleware");
const httpMetricMiddleware = require("./lib/middleware/http-metric-middleware");
const noCacheMiddleware = require("./lib/middleware/no-cache-middleware");
const decodeTokenMiddleware = require("./lib/middleware/decode-token-middleware");

const dateStarted = new Date();

/**
 * @type ResponseTimeRepo
 */
let responseTimeRepo;

/**
 * @type InfluxRepo
 */
let influxRepo;

const interceptAction = {
	respond: "respond",
	next: "next"
};

/**
 * Creates an Express app and adds middlewares and handlers
 * so it can receive incoming requests and pass them thru to
 * internal services.
 */
function createExpressApp() {
	const app = express();

	app.use(favicon(__dirname + "/favicon.ico"));
	app.use(reqIdMiddleware());
	app.use(httpMetricMiddleware({ influxRepo, responseTimeRepo }));
	app.use(
		cors({
			origin: conf.allowOrigin,
			credentials: true,
			allowedHeaders: conf.allowedHeaders
		})
	);
	app.use(timeout(conf.httpTimeout));
	app.use(
		bodyParser.json({
			type: req => {
				const contentType = req.headers["content-type"] || "";
				return contentType.includes("json");
			},
			limit: conf.maxRequestSize
		})
	);
	app.use(
		bodyParser.text({
			type: constants.TEXT_CONTENT_TYPES,
			defaultCharset: "utf-8",
			limit: conf.maxRequestSize
		})
	);
	app.use(bodyParser.urlencoded({ extended: false }));
	app.use(cookieParser());
	app.use(bearerToken());
	app.use(noCacheMiddleware());

	app.get(["/", "/health"], (req, res) => {
		res.json({ status: "Alive since " + dateStarted });
	});

	app.get("/robots.txt", function (req, res) {
		res.type('text/plain');
		res.send("User-agent: *\nDisallow: /");
	});

	if (conf.enableStats) {
		// Add endpoints serving UI for response time statistics
		app.set("views", "./web/statz");
		app.set("view engine", "pug");

		app.get("/statz", statzIndex.index);
		app.get("/statz/search", statzIndex.search);
	}

	app.use(decodeTokenMiddleware());
	app.use(handleReq);

	app.use((err, req, res, next) => {
		res.status(err.status || 500);

		let json = { message: err.message };

		if (conf.printStacktrace)
			json.stacktrace = err.stack;

		res.json(json);

		if (res.status === 500)
			log.error(err.stack);
	});

	return app;
}

/**
 * Main handler for incoming http requests.
 *
 * @param {Object} httpReq
 * @param {Object} httpRes
 * @param {Function} next
 */
async function handleReq(httpReq, httpRes, next) {
	// Note: reqId was added by reqid-middleware
	const reqId = httpReq.reqId;

	try {
		// Translate http request to bus request and post it internally on bus
		const internalRes = await sendInternalRequest(httpReq);

		// Translate bus response to a HTTP response and send it
		sendHttpResponse(reqId, internalRes, httpRes);
	} catch (err) {
		handleBusErrorResponse(err, httpRes, reqId);
	}
}

function handleBusErrorResponse(err, httpRes, reqId) {
	/*
	 * Translates 408 timeout to 404 since timeout indicates that no one
	 * subscribed on subject
	 */
	if (err.status === 408) {
		err.status = 404;
		httpRes.status(404);
	} else {
		httpRes.status(err.status || 500);
	}

	if (httpRes.statusCode > 499)
		log.error(err);

	setRequestId(reqId, err);

	httpRes.set(err.headers).json(err);
}

function invokeRequestInterceptors(subject, message) {
	const matchedInterceptors = conf.interceptors.filter(interceptor => {
		return interceptor.type === "request" && interceptor.match(subject);
	});

	return BPromise.reduce(
		matchedInterceptors,
		(_message, interceptor) => {
			if (_message.interceptAction === interceptAction.respond) {
				return _message;
			}
			return bus.request({
				subject: interceptor.targetSubject,
				message: _message,
				skipOptionsRequest: true
			});
		},
		message
	);
}

function invokeResponseInterceptors(subject, message, messageIsException) {
	const matchedInterceptors = conf.interceptors.filter(interceptor => {
		const typeIsResponse = interceptor.type === "response";
		const subjectMatchesSubject = interceptor.match(subject);
		const isNotExceptionOrConfiguredToAllowExceptions = !messageIsException
			? true
			: !!interceptor.options.allowExceptions;

		return typeIsResponse && subjectMatchesSubject && isNotExceptionOrConfiguredToAllowExceptions;
	});

	/** If no interceptors allowing exceptions were found we throw the error for it to be taken care of normally */
	if (matchedInterceptors.length === 0 && messageIsException) throw cleanInterceptedResponse(message, message);

	return BPromise.reduce(
		matchedInterceptors,
		(_message, interceptor) => {
			if (_message.interceptAction === interceptAction.respond)
				return _message;

			return bus.request({
				subject: interceptor.targetSubject,
				message: _message,
				skipOptionsRequest: true
			});
		},
		message
	);
}

function sendInternalRequest(httpReq) {
	const reqId = httpReq.reqId;
	const user = httpReq.user;
	const subject = utils.createSubject(httpReq);
	const message = utils.createRequest(httpReq, reqId, user);

	return invokeRequestInterceptors(subject, message).then(interceptedReq => {
		if (interceptedReq.interceptAction === interceptAction.respond) {
			delete interceptedReq.interceptAction;
			return interceptedReq;
		}

		log.silly("Sending to subject", subject);

		// Multipart requests are dealt with manually so that
		// api gateway is able to stream the multipart body to
		// its internal receiving service.

		// Otherwise plain bus request is used, but note that
		// depending on what the recieving service wants for protocol
		// the resulting request may still be done via HTTP. However, this
		// happens under the hood in fruster-bus-js and hence is transparent for
		// the api gateway.

		if (isMultipart(httpReq)) {
			return sendInternalMultipartRequest(subject, interceptedReq, httpReq)
				.then(interceptResponse)
				.catch(err => interceptResponse(err, true));
		} else {
			return bus
				.request(subject, interceptedReq, ms(conf.busTimeout))
				.then(interceptResponse)
				.catch(err => interceptResponse(err, true));
		}

		function interceptResponse(response, messageIsException) {
			if (response.error) response.data = interceptedReq.data;

			return invokeResponseInterceptors(
				subject,
				prepareInterceptResponseMessage(response, message),
				messageIsException
			)
				.then(interceptedResponse => cleanInterceptedResponse(response, interceptedResponse))
				.catch(interceptedResponse => cleanInterceptedResponse(response, interceptedResponse));
		}
	});
}

function prepareInterceptResponseMessage(response, message) {
	const interceptMessage = Object.assign({}, response);

	interceptMessage.query = message.query;
	interceptMessage.params = message.params;
	interceptMessage.path = message.path;

	return interceptMessage;
}

function cleanInterceptedResponse(response, interceptedResponse) {
	delete interceptedResponse.query;
	delete interceptedResponse.params;
	delete interceptedResponse.path;

	/** If we get errors back we have the request data in the response as well */
	if (response.error && interceptedResponse.error) {
		delete interceptedResponse.data;
		delete interceptedResponse.query;
		delete interceptedResponse.path;
	}

	return interceptedResponse;
}

function sendInternalMultipartRequest(subject, message, httpReq) {
	return bus.request(subject, message, ms(conf.busTimeout), true).then(optionsRes => {
		const { url } = optionsRes.data.http;

		let requestOptions = { uri: url, qs: httpReq.query };

		httpReq.headers.data = utils.convertJsonToHttpHeaderString(message);

		return new Promise((resolve, reject) => {
			httpReq.pipe(
				request[httpReq.method.toLowerCase()](requestOptions, (error, response, returnBody) => {
					if (!error) {
						let body = typeof returnBody === "string" ? JSON.parse(returnBody) : returnBody;
						body.headers = response.headers;
						resolve(body);
					} else {
						log.error(
							`Got error response when streaming multipart request to ${requestOptions.uri}:`,
							error
						);
						reject({ status: 500, error });
					}
				})
			);
		});
	});
}

/**
 * Transfers status, headers and data from internal bus response to
 * http response and sends it.
 *
 * Can handle text based and binary data if such content type is provided.
 *
 * @param {String} reqId
 * @param {Object} busResponse
 * @param {Object} httpResponse
 */
function sendHttpResponse(reqId, busResponse, httpResponse) {
	setRequestId(reqId, busResponse);

	httpResponse
		.status(busResponse.status)
		.set(busResponse.headers);

	if (isTextResponse(busResponse)) {
		httpResponse.send(busResponse.data);
	} else if (isBinaryResponse(busResponse)) {
		const contentType = getContentType(busResponse);

		httpResponse
			.set("Content-Type", contentType + "; charset=binary")
			.send(Buffer.from(busResponse.data, "base64"));
	} else {
		httpResponse.json(conf.unwrapMessageData ? busResponse.data : utils.sanitizeResponse(busResponse));
	}
}

function setRequestId(reqId, resp) {
	if (resp.reqId != reqId) {
		log.warn(`Request id in bus response (${resp.reqId}) does not match the one set by API gateway (${reqId})`);
		resp.reqId = reqId;
	}
}

function isMultipart(httpReq) {
	return httpReq.headers["content-type"] && httpReq.headers["content-type"].includes("multipart");
}

/**
 * Checks if bus response contains text based content based on its content type.
 *
 * @param {Object} busResponse
 */
function isTextResponse(busResponse) {
	const contentType = getContentType(busResponse);
	return constants.TEXT_CONTENT_TYPES.includes(contentType);
}

/**
 * Checks if bus response data is base64 encoded binary string.
 *
 * @param {Object} busResponse
 */
function isBinaryResponse(busResponse) {
	const contentType = getContentType(busResponse);
	return constants.BINARY_CONTENT_TYPES.includes(contentType);
}

function getContentType(busResponse) {
	return busResponse.headers && (busResponse.headers["content-type"] || busResponse.headers["Content-Type"]) || "";
}

module.exports = {
	start: async (busAddress, mongoUrl, httpServerPort) => {
		if (conf.enableStats) {
			log.info("Enabling stats module, view by visiting /statz");
			const db = await mongo.connect(mongoUrl);
			responseTimeRepo = new ResponseTimeRepo(db);

			if (!process.env.CI)
				await createIndexes(db);
		}

		if (conf.influxDbUrl) {
			log.info("Enabling InfluxDB");
			influxRepo = await createInfluxRepo();
		}

		const startHttpServer = new Promise((resolve, reject) => {
			const server = http.createServer(createExpressApp()).listen(httpServerPort);

			server.on("error", reject);

			server.on("listening", () => {
				log.info("HTTP server listening for on port", httpServerPort);
				resolve();
			});

			return resolve(server);
		});

		const connectToBus = () => {
			return bus.connect(busAddress);
		};

		return startHttpServer.then(server => connectToBus().then(() => server));
	}
};

async function createIndexes(db) {
	try {
		await db.collection(constants.collections.RESPONSE_TIME).createIndex(
			{ createdAt: 1 },
			{ expireAfterSeconds: conf.statsTTL }
		);
	} catch (err) {
		log.warn(err);
	}
}

/**
 * Creates and initializes the influx client.
 */
async function createInfluxRepo() {
	let influx = null;

	try {
		influx = await new InfluxRepo({
			url: conf.influxDbUrl,
			writeInterval: conf.influxWriteInterval,
			ipLookup: conf.influxLookupIp,
			ipLookupDbUrl: conf.ipLookUpDbUrl
		}).init();
	} catch (err) {
		log.warn(
			"Failed to connect to InfluxDB, API Gateway will start anyways but metrics will not be written to InfluxDB"
		);
		log.error(err);
	}

	return influx;
}
