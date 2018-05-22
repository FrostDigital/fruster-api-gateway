const express = require("express");
const mongo = require("mongodb");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const http = require("http");
const timeout = require("connect-timeout");
const ms = require("ms");
const uuid = require("uuid");
const bodyParser = require("body-parser");
const bearerToken = require("express-bearer-token");
const request = require("request");
const Promise = require("bluebird");
const log = require("fruster-log");
const bus = require("fruster-bus");
const utils = require("./utils");
const conf = require("./conf");
const constants = require("./lib/constants");
const ResponseTimeRepo = require("./lib/repos/ResponseTimeRepo");
const statzIndex = require("./web/statz/index");
const favicon = require("express-favicon");

const reqIdHeader = "X-Fruster-Req-Id";
const app = express();
const dateStarted = new Date();

/**
 * @type ResponseTimeRepo
 */
let responseTimeRepo;

const interceptAction = {
    respond: "respond",
    next: "next"
};
app.use(favicon(__dirname + "/favicon.png"));
app.use(cors({
    origin: conf.allowOrigin,
    credentials: true,
    allowedHeaders: conf.allowedHeaders
}));
app.use(timeout(conf.httpTimeout));
app.use(bodyParser.json({
    type: (req) => {
        let contentType = req.headers["content-type"] || "",
            includesJson = contentType.includes("json");

        return includesJson;
    },
    limit: conf.maxRequestSize
}));
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(cookieParser());
app.use(bearerToken());

app.get("/", function (req, res) {
    res.send("API Gateway is up and running");
});

app.get("/health", function (req, res) {
    setNoCacheHeaders(res);

    res.json({
        status: "Alive since " + dateStarted
    });
});

if (conf.enableStat) {
    app.set('views', "./web/statz");
    app.set('view engine', 'pug');

    app.get("/statz", statzIndex.index);
    app.get("/statz/search", statzIndex.search);
}

app.use(async (httpReq, httpRes, next) => {
    const reqId = uuid.v4();
    const reqStartTime = Date.now();
    var startTime = reqStartTime;
    let endTime;

    logRequest(reqId, httpReq);

    try {
        // Decode JWT token (provided as cookie or in header) if route is not public
        let decodedToken = isPublicRoute(httpReq) ? {} : await decodeToken(httpReq, reqId);

        startTime = Date.now();

        // Translate http request to bus request and post it internally on bus
        const internalRes = await sendInternalRequest(httpReq, reqId, decodedToken);

        endTime = Date.now();

        if (conf.enableStat) {
            responseTimeRepo.save(reqId, httpReq, internalRes, (endTime - startTime));
        }

        logResponse(reqId, internalRes, reqStartTime);

        // Translate bus response to a HTTP response and send back to user
        sendHttpResponse(reqId, internalRes, httpRes);
    } catch (err) {
        endTime = Date.now();

        if (conf.enableStat) {
            responseTimeRepo.save(reqId, httpReq, err, (endTime - startTime));
        }

        handleError(err, httpRes, reqId, reqStartTime);
    }
});

app.use((err, req, res, next) => {
    res.status(err.status || 500);

    let json = {
        message: err.message
    };

    if (conf.printStacktrace) {
        json.stacktrace = err.stack;
    }

    res.json(json);

    if (res.status === 500) {
        log.error(err.stack);
    }
});

function handleError(err, httpRes, reqId, reqStartTime) {
    logError(reqId, err, reqStartTime);

    /*
     * Translates 408 timeout to 404 since timeout indicates that no one 
     * subscribed on subject
     */
    if (err.status == 408) {
        err.status = 404;
        httpRes.status(404);
    } else {
        httpRes.status(err.status);
    }

    setRequestId(reqId, err);

    httpRes
        .set(err.headers)
        .header(reqIdHeader, reqId)
        .json(err);
}

/**
 * Token comes either in cookie or in header Authorization: Bearer <token>
 * 
 * @return {Promise}
 */
function decodeToken(httpReq, reqId) {
    const encodedToken = getToken(httpReq);

    if (encodedToken) {
        const decodeReq = {
            reqId: reqId,
            data: encodedToken
        };

        return bus
            .request({
                skipOptionsRequest: true,
                subject: "auth-service.decode-token",
                message: decodeReq
            })
            .then(resp => resp.data)
            .catch(async err => {
                if (err.status == 401 || err.status == 403) {
                    log.debug("Failed to decode token (got error " + err.code + ") will expire cookie if present");
                    err.headers = err.headers || {};
                    err.headers["Set-Cookie"] = "jwt=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                }

                // If jwt token failed to be decoded, we should unregister any clients connected to that jwt token
                bus.request({
                    skipOptionsRequest: true,
                    subject: "fruster-web-bus.unregister-client",
                    message: {
                        reqId: reqId,
                        data: {
                            jwt: encodedToken
                        }
                    }
                })

                throw err;
            });
    }
    //@ts-ignore
    return Promise.resolve({});
}

function invokeRequestInterceptors(subject, message) {
    const matchedInterceptors = conf.interceptors.filter(interceptor => {
        return interceptor.type === "request" && interceptor.match(subject);
    });

    return Promise.reduce(matchedInterceptors, (_message, interceptor) => {
        if (_message.interceptAction === interceptAction.respond) {
            return _message;
        }
        return bus.request({
            subject: interceptor.targetSubject,
            message: _message,
            skipOptionsRequest: true,
        });
    }, message);
}

function invokeResponseInterceptors(subject, message) {
    const matchedInterceptors = conf.interceptors.filter(interceptor => {
        return interceptor.type === "response" && interceptor.match(subject);
    });

    return Promise.reduce(matchedInterceptors, (_message, interceptor) => {
        if (_message.interceptAction === interceptAction.respond) {
            return _message;
        }
        return bus.request({
            subject: interceptor.targetSubject,
            message: _message,
            skipOptionsRequest: true,
        });
    }, message);
}

function getToken(httpReq) {
    let token;
    if (httpReq.token) {
        token = httpReq.token;
    } else if (httpReq.cookies[conf.authCookieName] && httpReq.cookies[conf.authCookieName].toLowerCase() !== "deleted") {
        token = httpReq.cookies[conf.authCookieName];
    }

    return token;
}

function sendInternalRequest(httpReq, reqId, decodedToken) {
    const subject = utils.createSubject(httpReq);
    const message = utils.createRequest(httpReq, reqId, decodedToken);

    return invokeRequestInterceptors(subject, message)
        .then(interceptedReq => {

            if (interceptedReq.interceptAction === interceptAction.respond) {
                delete interceptedReq.interceptAction;
                return interceptedReq;
            }

            log.debug("Sending to subject", subject);
            log.silly(interceptedReq);

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
                    .then(response => invokeResponseInterceptors(subject, prepareInterceptResponseMessage(response, message))
                        .then(interceptedResponse => cleanInterceptedResponse(response, interceptedResponse)));
            } else {
                return sendInternalBusRequest(subject, interceptedReq)
                    .then(response => invokeResponseInterceptors(subject, prepareInterceptResponseMessage(response, message))
                        .then(interceptedResponse => cleanInterceptedResponse(response, interceptedResponse)));
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
    return interceptedResponse;
}

function sendInternalMultipartRequest(subject, message, httpReq) {
    return bus.request(subject, message, ms(conf.busTimeout), true)
        .then((optionsRes) => {
            const httpOptions = optionsRes.data.http;

            let requestOptions = {
                uri: httpOptions.url
            };

            httpReq.headers.data = JSON.stringify(message);

            return new Promise((resolve, reject) => {
                httpReq
                    .pipe(request[httpReq.method.toLowerCase()](requestOptions, (error, response, returnBody) => {
                        if (!error) {
                            var body = typeof returnBody === "string" ? JSON.parse(returnBody) : returnBody;
                            body.headers = response.headers;
                            resolve(body);
                        } else {
                            let errorObj = {
                                status: 500,
                                error: error
                            };
                            reject(errorObj);
                        }
                    }));
            });
        });
}

function sendInternalBusRequest(subject, message) {
    return bus.request(subject, message, ms(conf.busTimeout));
}

function sendHttpResponse(reqId, internalRes, httpRes) {
    log.silly(internalRes.data);

    setRequestId(reqId, internalRes);

    if (conf.noCache) {
        setNoCacheHeaders(httpRes);
    }

    httpRes
        .status(internalRes.status)
        .set(internalRes.headers)
        .header(reqIdHeader, reqId)
        .json(conf.unwrapMessageData ? internalRes.data : utils.sanitizeResponse(internalRes));
}

function setRequestId(reqId, resp) {
    if (resp.reqId != reqId) {
        log.warn(`Request id in bus response (${resp.reqId}) does not match the one set by API gateway (${reqId})`);
        resp.reqId = reqId;
    }
}

function setNoCacheHeaders(res) {
    res.header("Cache-Control", "max-age=0, no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", 0);
}

function logResponse(reqId, resp, startTime) {
    const now = Date.now();
    log.info(`[${reqId}] ${resp.status} (${now - startTime}ms)`);

    if (isTrace()) {
        log.silly(resp);
    }
}

function logError(reqId, err, startTime) {
    const now = Date.now();

    let stringifiedError;

    try {
        stringifiedError = JSON.stringify(err.error);
    } catch (e) {
        stringifiedError = err.error;
    }

    if (err.status >= 500 || err.status == 408) {
        log.error(`[${reqId}] ${err.status} ${stringifiedError} (${now - startTime}ms)`);
    } else {
        log.info(`[${reqId}] ${err.status} ${stringifiedError} (${now - startTime}ms)`);
    }
}

function logRequest(reqId, req) {
    if (isTrace()) {
        log.silly(req);
    }
    log.info(`[${reqId}] ${req.method} ${req.path}`);
}

function isTrace() {
    return log.transports.console.level == "trace" || log.transports.console.level == "silly";
}

function isMultipart(httpReq) {
    return httpReq.headers["content-type"] && httpReq.headers["content-type"].includes("multipart");
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

module.exports = {
    start: async (busAddress, mongoUrl, httpServerPort) => {

        if (conf.enableStat) {
            const db = await mongo.connect(conf.mongoUrl);

            responseTimeRepo = new ResponseTimeRepo(db);

            createIndexes(db);
        }

        const startHttpServer = new Promise((resolve, reject) => {
            const server = http.createServer(app)
                .listen(httpServerPort);

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
    },

    decodeToken: decodeToken
};

function createIndexes(db) {
    db.collection(constants.collections.RESPONSE_TIME)
        .createIndex({
            "createdAt": 1
        }, {
                expireAfterSeconds: conf.statsTTL
            });
}