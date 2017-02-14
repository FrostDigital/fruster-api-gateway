const request = require("request"),
    fs = require("fs"),
    conf = require("../conf"),
    bus = require("fruster-bus"),
    nsc = require("nats-server-control"),
    uuid = require("uuid"),
    apiGw = require("../api-gateway"),
    util = require("util"),
    multiparty = require("multiparty"),
    http = require("http"),
    express = require("express"),
    WebSocket = require("ws"),
    FrusterWebBus = require("../lib/FrusterWebBus");


describe("API Gateway", function () {
    var natsServer;
    var baseUri;
    var webSocketBaseUri;

    beforeEach(done => {
        var httpPort = Math.floor(Math.random() * 6000 + 2000);
        var webSocketPort = Math.floor(Math.random() * 6000 + 2000);
        var busPort = Math.floor(Math.random() * 6000 + 2000);
        var busAddress = "nats://localhost:" + busPort;

        baseUri = "http://127.0.0.1:" + httpPort;
        webSocketBaseUri = "ws://127.0.0.1:" + httpPort;

        nsc.startServer(busPort)
            .then(server => {
                natsServer = server;
            })
            .then(() => apiGw.start(httpPort, [busAddress]))
            .then(server => new FrusterWebBus(server, {
                test: true
            }))
            .then(done)
            .catch(done.fail);
    });

    afterEach(() => {
        bus.closeAll();
        if (natsServer) {
            natsServer.kill();
        }
    });

    it("should returns status code 404 if gateway does not recieve a response", function (done) {
        get("/foo", function (error, response, body) {
            expect(response.statusCode).toBe(404);
            expect(body.status).toBe(404);
            done();
        });
    });

    it("should create and recieve bus message for HTTP GET", function (done) {
        bus.subscribe("http.get.foo", function (req) {
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

        get("/foo?foo=bar", function (error, response, body) {
            expect(response.statusCode).toBe(201);
            expect(response.headers["a-header"]).toBe("foo");
            expect(body.data.foo).toBe("bar");
            expect(body.headers).toBeUndefined();

            done();
        });

    });

    it("should create and recieve bus message for HTTP GET in unwrapped mode", function (done) {
        conf.unwrapMessageData = true;

        bus.subscribe("http.get.foo", function (req) {
            return {
                status: 200,
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo", function (error, response, body) {
            expect(body.foo).toBe("bar");
            expect(response.statusCode).toBe(200);
            conf.unwrapMessageData = false;
            done();
        });
    });

    it("should return error status code from bus", function (done) {
        bus.subscribe("http.post.bar", function (req) {
            return {
                status: 420,
                headers: {
                    "x-foo": "bar"
                }
            };
        });

        post("/bar", function (error, response, body) {
            expect(response.statusCode).toBe(420);
            expect(response.headers["x-foo"]).toBe("bar");
            done();
        });
    });

    it("should return 403 if validation of JWT cookie failed", function (done) {
        bus.subscribe("auth-service.decode-token", function (req) {
            return {
                status: 403,
                error: {
                    code: "auth-service.403.1"
                }
            };
        });

        get("/foo", {
            cookie: "jwt=acookie"
        }, function (error, response, body) {
            expect(response.statusCode).toBe(403);
            expect(body.error.code).toBe("auth-service.403.1");
            done();
        });
    });

    it("should return 403 if validation of JWT in auth header failed", function (done) {
        bus.subscribe("auth-service.decode-token", function (req) {
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
        }, function (error, response, body) {
            expect(response.statusCode).toBe(403);
            expect(body.error.code).toBe("auth-service.403.1");
            done();
        });
    });

    it("should set user data with decoded jwt cookie", function (done) {
        bus.subscribe("auth-service.decode-token", function (req) {
            expect(req.data).toBe("acookie");
            return {
                status: 200,
                data: "decoded-cookie"
            };
        });

        bus.subscribe("http.get.foo", function (req) {
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
        }, function (error, response, body) {
            expect(response.statusCode).toBe(200);
            expect(body.user).toBeUndefined();
            done();
        });
    });

    it("should set user data with decoded jwt in auth header", function (done) {
        bus.subscribe("auth-service.decode-token", function (req) {
            expect(req.data).toBe("a-token");
            return {
                status: 200,
                data: "decoded-cookie"
            };
        });

        bus.subscribe("http.get.foo", function (req) {
            expect(req.user).toBe("decoded-cookie");
            return {
                status: 200,
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo", {
            authorization: "Bearer a-token"
        }, function (error, response, body) {
            expect(response.statusCode).toBe(200);
            expect(body.user).toBeUndefined();
            done();
        });
    });

    it("should not try to decode token if none is present", function (done) {
        bus.subscribe("http.get.foo", function (req) {
            return {
                status: 200,
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo", function (error, response, body) {
            expect(response.statusCode).toBe(200);
            expect(body.user).toBeUndefined();
            done();
        });
    });

    it("should set reqId in HTTP response even though none is returned from bus", function (done) {
        bus.subscribe("http.get.foo", function (req) {
            return {
                status: 200
            };
        });

        get("/foo", function (error, response, body) {
            expect(response.statusCode).toBe(200);
            expect(body.reqId).toBeDefined();
            done();
        });
    });

    it("web bus - should be possible to connect to web bus", done => {
        let messageToSend = {
            reqId: uuid.v4(),
            data: {
                some: "data"
            }
        };

        bus.subscribe("auth-service.decode-token", function (req) {
            return {
                status: 200,
                data: {
                    id: "hello-there-id",
                    scopes: conf.webSocketPermissionScope
                }
            };
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: {
                cookie: "jwt=hello"
            }
        });

        ws.on("message", function (json) {
            let message = JSON.parse(json);

            expect(message.reqId).toBe(messageToSend.reqId);
            expect(message.data.some).toBe(messageToSend.data.some);
            expect(message.subject).toBeDefined("ws.hello-there-id.hello");

            done();
        });

        ws.on("close", () => {
            done.fail();
        });

        setTimeout(() => {
            bus.request("ws.hello-there-id.hello", messageToSend);
        }, 100);
    });

    it("web bus - should only get messages addressed to user's id", done => {
        let messageToReceive = {
                reqId: uuid.v4(),
                data: {
                    some: "data"
                }
            },
            messageNotToReceive = {
                reqId: uuid.v4(),
                data: {
                    some: "data2"
                }
            };

        bus.subscribe("auth-service.decode-token", function (req) {
            return {
                status: 200,
                data: {
                    id: "hello-there-id",
                    scopes: conf.webSocketPermissionScope
                }
            };
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: {
                cookie: "jwt=hello"
            }
        });

        ws.on("message", function (json) {
            let message = JSON.parse(json);

            expect(message.reqId).not.toBe(messageNotToReceive.reqId);
            expect(message.reqId).toBe(messageToReceive.reqId);

            expect(message.data.some).not.toBe(messageNotToReceive.data.some);
            expect(message.data.some).toBe(messageToReceive.data.some);

            expect(message.subject).not.toBe("ws.hello2-there-id");
            expect(message.subject).toBe("ws.hello-there-id");

            done();
        });

        ws.on("close", () => {
            done.fail();
        });

        setTimeout(() => {
            bus.request("ws.hello2-there-id", messageNotToReceive)
                .then(() => bus.request("ws.hello-there-id", messageToReceive));
        }, 100);
    });

    it("web bus - should not allow users without the correct scopes to connect", done => {
        bus.subscribe("auth-service.decode-token", function (req) {
            return {
                status: 200,
                data: {
                    id: "hello-there-id",
                    scopes: ["read.a.book"]
                }
            };
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: {
                cookie: "jwt=hello"
            }
        });

        ws.on("close", () => {
            done();
        });
    });

    it("web bus - should not allow non logged in users to connect", done => {
        const ws = new WebSocket(webSocketBaseUri);

        ws.on("close", () => {
            done();
        });
    });

    it("web bus - should allow broadcasts", done => {
        let message = {
            reqId: uuid.v4(),
            data: {
                some: "data"
            }
        };

        bus.subscribe("auth-service.decode-token", function (req) {
            return {
                status: 200,
                data: {
                    id: "hello-there-id",
                    scopes: conf.webSocketPermissionScope
                }
            };
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: {
                cookie: "jwt=hello"
            }
        });

        ws.on("message", function (json) {
            let message = JSON.parse(json);

            expect(message.subject).toBe("ws.hello-there-id.new-message");
            expect(message.reqId).toBe(message.reqId);
            expect(message.data.some).toBe(message.data.some);
            expect(message.subject).toBe(message.subject);

            done();
        });

        ws.on("close", () => {
            done.fail();
        });

        setTimeout(() => {
            bus.request("ws.*.new-message", message);
        }, 100);
    });

    function ws(path, headers, cb) {
        if (typeof (headers) === "function") {
            cb = headers;
        }
        doRequest("WS", path, headers, true, cb);
    }

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
            json: json ||  true
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