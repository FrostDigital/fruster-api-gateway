const express = require("express");
const fs = require("fs");
const _ = require("lodash");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const conf = require("./conf");
const bus = require("fruster-bus");
const cors = require("cors");
const http = require("http");
const timeout = require("connect-timeout");
const log = require("fruster-log");
const ms = require("ms");
const utils = require("./utils");
const uuid = require("uuid");
const bearerToken = require("express-bearer-token");
const request = require("request");
const Minimatch = require("minimatch").Minimatch;
const Promise = require("bluebird");
const util = require("util");

const reqIdHeader = "X-Fruster-Req-Id";
const app = express();
const dateStarted = new Date();

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


app.get("/health", function (req, res) {
    res.json({
        status: "Alive since " + dateStarted
    });
});

app.use(function (httpReq, httpRes, next) {
    const reqId = uuid.v4();
    const reqStartTime = Date.now();

    logRequest(reqId, httpReq);

    decodeToken(httpReq, reqId)            
        .then(decodedToken => sendInternalRequest(httpReq, reqId, decodedToken))
        .then(internalRes => sendHttpReponse(reqId, internalRes, httpRes))
        .catch(err => handleError(err, httpRes, reqId, reqStartTime));
});

app.use(function (err, req, res, next) {
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

/*
 * Token comes either in cookie or in header Authorization: Bearer <token>
 */
function decodeToken(httpReq, reqId) {
    const encodedToken = getToken(httpReq);

    if (encodedToken) {
        const decodeReq = {
            reqId: reqId,
            data: encodedToken
        };

        return bus
            .request("auth-service.decode-token", decodeReq)
            .then(resp => resp.data)
            .catch(err => {
                if (err.status == 401 || err.status == 403) {
                    log.debug("Failed to decode token (got error " + err.code + ") will expire cookie if present");
                    err.headers = err.headers ||  {};
                    err.headers["Set-Cookie"] = "jwt=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                }
                throw err;
            });
    }

    return Promise.resolve({});
}


function invokeInterceptors(subject, message) { 
    const matchedInterceptors = conf.interceptors.filter(interceptor => {
        return interceptor.match(subject);
    });    
        
    return Promise.reduce(matchedInterceptors, (_message, interceptor) => {
        return bus.request(interceptor.targetSubject, _message);
    }, message);
}

function getToken(httpReq) {
    let token;

    if (httpReq.token) {
        token = httpReq.token;
    } else if (httpReq.cookies[conf.authCookieName]) {
        token = httpReq.cookies[conf.authCookieName];
    }

    return token;
}

function sendInternalRequest(httpReq, reqId, decodedToken) {
    const subject = utils.createSubject(httpReq);
    const message = utils.createRequest(httpReq, reqId, decodedToken);
    
    return invokeInterceptors(subject, message)
        .then(interceptedReq => {
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
                return sendInternalMultipartRequest(subject, interceptedReq, httpReq);
            } else {
                return sendInternalBusRequest(subject, interceptedReq);
            }
        });
}

function sendInternalMultipartRequest(subject, message, httpReq) {
    return bus.request(subject, message, ms(conf.busTimeout), true)
        .then((optionsRes) => {
            const httpOptions = optionsRes.data.http;

            let requestOptions = {
                uri: httpOptions.url
            };

            httpReq.headers.data = JSON.stringify(message);

            return new Promise(resolve => {
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

function sendHttpReponse(reqId, internalRes, httpRes) {
    log.silly(internalRes.data);

    setRequestId(reqId, internalRes);

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

    if (err.status >= 500 ||  err.status == 408) {
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
    return log.transports.console.level == "trace" ||  log.transports.console.level == "silly";
}

function isMultipart(httpReq) {
    return httpReq.headers["content-type"] && httpReq.headers["content-type"].includes("multipart");
}

// function initInterceptors() {    
//     interceptors = conf.interceptors.map(interceptor => {
//         let split = interceptor.split(":"); 
//         const patternSplit = split[0].split(",");
//         const targetSubject = split[1];

//         return {
//             pattern: split[0],
//             targetSubject: targetSubject,
//             matchers: patternSplit.map(pattern => new Minimatch(pattern))
//         };
//     });

//     log.info(`Initialized ${interceptors.length} interceptor(s)`); 
// }

module.exports = {
    start: function (httpServerPort, busAddress) {

        let startHttpServer = new Promise(function (resolve, reject) {
            let server = http.createServer(app)
                .listen(httpServerPort);
            
            server.on("error", reject);
            
            server.on("listening", () => {
                log.info("HTTP server listening for on port", httpServerPort);     
                resolve();
            });

            return resolve(server);
        });

        let connectToBus = function () {
            return bus.connect(busAddress);
        };

        return startHttpServer.then(server => connectToBus().then(() => server));
    },

    decodeToken: decodeToken
};