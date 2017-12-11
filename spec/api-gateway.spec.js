const request = require("request");
const fs = require("fs");
const conf = require("../conf");
const bus = require("fruster-bus");
const uuid = require("uuid");
const apiGw = require("../api-gateway");
const util = require("util");
const multiparty = require("multiparty");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const FrusterWebBus = require("../lib/web-bus/FrusterWebBus");
const testUtils = require("fruster-test-utils");

describe("API Gateway", () => {
    let natsServer;
    let baseUri;
    let webSocketBaseUri;
    let httpPort;
    let server;

    testUtils.startBeforeEach({
        service: (connection) => {
            httpPort = Math.floor(Math.random() * 6000 + 2000);
            baseUri = "http://127.0.0.1:" + httpPort;
            webSocketBaseUri = "ws://127.0.0.1:" + httpPort;

            return apiGw.start(httpPort, connection.natsUrl)
                .then(_server => {
                    server = _server
                });
        },
        mockNats: true,
        bus: bus,
        afterStart: (connection) => {
            new FrusterWebBus(server, {
                test: true
            });
        }
    });

    it("should returns status code 404 if gateway does not recieve a response", (done) => {
        get("/foo", (error, response, body) => {
            expect(response.statusCode).toBe(404);
            expect(body.status).toBe(404);
            done();
        });
    });

    it("should create and recieve bus message for HTTP GET", (done) => {
        bus.subscribe("http.get.foo", (req) => {
            expect(req.path).toBe("/foo");
            expect(req.method).toBe("GET");
            expect(req.reqId).toBeDefined();
            expect(req.query.foo).toBe("bar");

            return {
                status: 201,
                headers: {
                    "A-Header": "foo"
                },
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo?foo=bar", (error, response, body) => {
            expect(response.statusCode).toBe(201);
            expect(response.headers["a-header"]).toBe("foo");
            expect(response.headers["etag"]).toBeDefined();
            expect(response.headers["cache-control"]).toBeUndefined();
            expect(response.headers["x-fruster-req-id"]).toBeDefined();
            expect(body.data.foo).toBe("bar");
            expect(body.headers).toBeUndefined();

            done();
        });

    });

    it("should get no cache headers on HTTP response when NO_CACHE is true", (done) => {
        conf.noCache = true;

        bus.subscribe("http.get.foo", (req) => {
            return {
                status: 201,
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo?foo=bar", (error, response, body) => {
            expect(response.headers["etag"]).toBeDefined();
            expect(response.headers["cache-control"]).toBe("max-age=0, no-cache, no-store, must-revalidate");
            expect(response.headers["pragma"]).toBe("no-cache");
            expect(response.headers["expires"]).toBe("0");

            conf.noCache = false;
            done();
        });

    });

    it("should create and recieve bus message for HTTP GET in unwrapped mode", (done) => {
        conf.unwrapMessageData = true;

        bus.subscribe("http.get.foo", (req) => {
            return {
                status: 200,
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo", (error, response, body) => {
            expect(body.foo).toBe("bar");
            expect(response.statusCode).toBe(200);
            conf.unwrapMessageData = false;
            done();
        });
    });

    it("should return error status code from bus", (done) => {
        bus.subscribe("http.post.bar", (req) => {
            return {
                status: 420,
                headers: {
                    "x-foo": "bar"
                }
            };
        });

        post("/bar", (error, response, body) => {
            expect(response.statusCode).toBe(420);
            expect(response.headers["x-foo"]).toBe("bar");
            done();
        });
    });

    describe("Tokens", () => {

        it("should return 403 if validation of JWT cookie failed", (done) => {
            bus.subscribe("auth-service.decode-token", (req) => {
                return {
                    status: 403,
                    error: {
                        code: "auth-service.403.1"
                    }
                };
            });
    
            get("/foo", {
                cookie: "jwt=acookie"
            }, (error, response, body) => {
                expect(response.statusCode).toBe(403);
                expect(body.error.code).toBe("auth-service.403.1");
                done();
            });
        });
    
        it("should return 403 if validation of JWT in auth header failed", (done) => {
            bus.subscribe("auth-service.decode-token", (req) => {
                expect(req.data).toBe("a-token");
                return {
                    status: 403,
                    error: {
                        code: "auth-service.403.1"
                    }
                };
            });
    
            get("/foo", {
                authorization: "Bearer a-token"
            }, (error, response, body) => {
                expect(response.statusCode).toBe(403);
                expect(body.error.code).toBe("auth-service.403.1");
                done();
            });
        });
    
        it("should set user data with decoded jwt cookie", (done) => {
            bus.subscribe("auth-service.decode-token", (req) => {
                expect(req.data).toBe("acookie");
                return {
                    status: 200,
                    data: "decoded-cookie"
                };
            });
    
            bus.subscribe("http.get.foo", (req) => {
                expect(req.user).toBe("decoded-cookie");
                return {
                    status: 200,
                    data: {
                        foo: "bar"
                    }
                };
            });
    
            get("/foo", {
                cookie: "jwt=acookie"
            }, (error, response, body) => {
                expect(response.statusCode).toBe(200);
                expect(body.user).toBeUndefined();
                done();
            });
        });
    
        it("should not decode token if route is public", (done) => {
            let authServiceWasInvoked = false;

            bus.subscribe("auth-service.decode-token", (req) => {
                authServiceWasInvoked = true;
                done.fail("Auth service should not have been invoked");
                return {
                    status: 200,
                    data: "decoded-cookie"
                };
            });
    
            bus.subscribe("http.get.auth.cookie", (req) => {
                expect(req.user).toEqual({});
                return {
                    status: 200,
                    data: {
                        foo: "bar"
                    }
                };
            });
    
            get("/auth/cookie", {
                cookie: "jwt=acookie"
            }, (error, response, body) => {
                expect(response.statusCode).toBe(200);
                expect(body.user).toBeUndefined();
                done();
            });
        });
    
        it("should not try to decode token if none is present", (done) => {
            bus.subscribe("http.get.foo", (req) => {
                return {
                    status: 200,
                    data: {
                        foo: "bar"
                    }
                };
            });
    
            get("/foo", (error, response, body) => {
                expect(response.statusCode).toBe(200);
                expect(body.user).toBeUndefined();
                done();
            });
        });
    
        it("should set user data with decoded jwt cookie", (done) => {
            bus.subscribe("auth-service.decode-token", (req) => {
                expect(req.data).toBe("acookie");
                return {
                    status: 200,
                    data: "decoded-cookie"
                };
            });
    
            bus.subscribe("http.get.foo", (req) => {
                expect(req.user).toBe("decoded-cookie");
                return {
                    status: 200,
                    data: {
                        foo: "bar"
                    }
                };
            });
    
            get("/foo", {
                cookie: "jwt=acookie"
            }, (error, response, body) => {
                expect(response.statusCode).toBe(200);
                expect(body.user).toBeUndefined();
                done();
            });
        });

    });


    it("should set reqId in HTTP response even though none is returned from bus", (done) => {
        bus.subscribe("http.get.foo", (req) => {
            return {
                status: 200
            };
        });

        get("/foo", (error, response, body) => {
            expect(response.statusCode).toBe(200);
            expect(body.reqId).toBeDefined();
            done();
        });
    });

    it("should be possible to send content type containing json", (done) => {
        bus.subscribe("http.post.content-type-json", (req) => {
            expect(req.data.hello).toBe(1337);
            return {
                status: 200
            };
        });

        post("/content-type-json", {
            "content-type": "application/vnd.contentful.management.v1+json"
        }, {
                hello: 1337
            }, (error, response, body) => {
                expect(response.statusCode).toBe(200);
                expect(body.reqId).toBeDefined();
                done();
            });
    });

    it("should forward POST request with multipart via http to url specified by bus.subscribe", (done) => {
        let expressPort = Math.floor(Math.random() * 6000 + 3000);
        let app = express();
        let server = http.createServer(app);
        server.listen(expressPort);

        bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

        app.post("/foobar", (req, res) => {
            let form = new multiparty.Form();

            form.parse(req, function (err, fields, files) {
                expect(files.file[0].fieldName).toBe("file");
                expect(files.file[0].originalFilename).toBe("a-large-file.jpg");
                expect(files.file[0].size).toBe(86994);

                fs.unlink(files.file[0].path);

                console.log("sending");

                res.send({
                    reqId: JSON.parse(req.headers.data).reqId,
                    status: 200
                });
            });
        });

        doMultipartRequest("/foo", (error, response, respBody) => {
            let body = JSON.parse(respBody);

            expect(body.status).toBe(200);
            expect(body.reqId).toBeDefined();

            server.close();

            done();
        });
    });

    it("should send additional data in headers when forwarding POST request with multipart/form-data via http to url specified by bus.subscribe", (done) => {
        let expressPort = Math.floor(Math.random() * 6000 + 3000);
        let app = express();
        let server = http.createServer(app);
        server.listen(expressPort);

        bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

        let checkForReqId;
        app.post("/foobar", (req, res) => {
            let additionaldata = JSON.parse(req.headers.data);

            expect(additionaldata.reqId).toBeDefined();
            expect(additionaldata.path).toBe("/foo");
            expect(additionaldata.query.hej).toBe("1");

            checkForReqId = additionaldata.reqId;

            res.send({
                reqId: additionaldata.reqId,
                status: 200
            });
        });

        doFormDataRequest("/foo?hej=1", function (error, response, respBody) {
            let body = JSON.parse(respBody);
            expect(body.status).toBe(200);
            expect(body.reqId).toBe(checkForReqId);

            server.close();

            done();
        });
    });

    it("should get error when multipart upload failed", (done) => {
        let expressPort = Math.floor(Math.random() * 6000 + 3000);
        let app = express();
        let server = http.createServer(app);
        server.listen(expressPort);

        bus.subscribe("http.post.foo").forwardToHttp("http://127.0.0.1:" + expressPort + "/foobar");

        app.post("/foobar", (req, res) => {
            res.send({
                reqId: "reqId",
                status: 500,
                error: {
                    id: "8e97186c-4165-4d75-8293-92adead403db",
                    title: "Upload totally failed"
                }
            });
        });

        doFormDataRequest("/foo", function (error, response, respBody) {
            let body = JSON.parse(respBody);

            expect(response.statusCode).toBe(500);
            expect(body.status).toBe(500);
            expect(body.error.title).toBe("Upload totally failed");
            expect(body.error.id).toBeDefined();

            server.close();

            done();
        });
    });


    function get(path, headers, cb) {
        if (typeof (headers) === "function") {
            cb = headers;
        }
        doRequest("GET", path, headers, true, cb);
    }

    function post(path, headers, json, cb) {
        if (typeof (headers) === "function") {
            cb = headers;
        }
        doRequest("POST", path, headers, json, cb);
    }

    function put(path, headers, json, cb) {
        if (typeof (headers) === "function") {
            cb = headers;
        }
        doRequest("PUT", path, headers, json, cb);
    }

    function del(path, headers, cb) {
        if (typeof (headers) === "function") {
            cb = headers;
        }
        doRequest("DELETE", path, {}, true, cb);
    }

    function doRequest(method, path, headers, json, cb) {
        request({
            uri: baseUri + path,
            method: method,
            headers: headers,
            json: json || true
        }, cb);
    }

    function doFormDataRequest(path, cb) {
        request({
            method: "post",
            uri: baseUri + path,
            formData: {
                a: "a",
                b: "b",
                c: "c"
            },
            headers: {
                "content-type": "multipart/form-data"
            }
        }, cb);
    }

    function doMultipartRequest(path, cb) {
        request({
            method: "post",
            uri: baseUri + path,
            formData: {
                file: fs.createReadStream("./spec/a-large-file.jpg")
            },
            headers: {
                "content-type": "multipart/form-data"
            }
        }, cb);
    }

});