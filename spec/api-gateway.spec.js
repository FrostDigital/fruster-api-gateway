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
            expect(response.headers["etag"]).toBeDefined();
            expect(response.headers["cache-control"]).toBeUndefined();
            expect(response.headers["x-fruster-req-id"]).toBeDefined();
            expect(body.data.foo).toBe("bar");
            expect(body.headers).toBeUndefined();

            done();
        });

    });

    it("should get no cache headers on HTTP response when NO_CACHE is true", function (done) {
        conf.noCache = true;

        bus.subscribe("http.get.foo", function (req) {           
            return {
                status: 201,                
                data: {
                    foo: "bar"
                }
            };
        });

        get("/foo?foo=bar", function (error, response, body) {  
            expect(response.headers["etag"]).toBeDefined();
            expect(response.headers["cache-control"]).toBe("max-age=0, no-cache, no-store, must-revalidate");
            expect(response.headers["pragma"]).toBe("no-cache");
            expect(response.headers["expires"]).toBe("0");

            conf.noCache = false;
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

    it("should be possible to send content type containing json", function (done) {
        bus.subscribe("http.post.content-type-json", function (req) {
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

            expect(message.subject).not.toBe("ws.hello2-there-id.hello");
            expect(message.subject).toBe("ws.hello-there-id.hello");

            done();
        });

        ws.on("close", () => {
            done.fail();
        });

        setTimeout(() => {
            bus.request("ws.hello2-there-id.hello", messageNotToReceive)
                .then(() => bus.request("ws.hello-there-id.hello", messageToReceive));
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

        doFormDataRequest('/foo?hej=1', function (error, response, respBody) {
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

        doFormDataRequest('/foo', function (error, response, respBody) {
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