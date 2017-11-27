const request = require("request");
const fs = require("fs");
const conf = require("../conf");
const bus = require("fruster-bus");
const log = require("fruster-log");
const uuid = require("uuid");
const apiGw = require("../api-gateway");
const util = require("util");
const multiparty = require("multiparty");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const FrusterWebBus = require("../lib/web-bus/FrusterWebBus");
const testUtils = require("fruster-test-utils");

describe("FrusterWebBus", () => {
    const wsEndpointSubject = `ws.post.hello.:userId`;
    const mockUserId = "hello-there-id";
    let natsServer;
    let baseUri;
    let webSocketBaseUri;
    let httpPort;
    let server;
    let webBus;

    testUtils.startBeforeEach({
        service: async (connection) => {
            httpPort = Math.floor(Math.random() * 6000 + 2000);
            baseUri = "http://127.0.0.1:" + httpPort;
            webSocketBaseUri = "ws://127.0.0.1:" + httpPort;

            server = await apiGw.start(httpPort, connection.natsUrl);

            bus.subscribe(wsEndpointSubject, (req) => {
                return {
                    status: 200,
                    data: {
                        hello: "hello " + req.params.userId
                    }
                };
            });
        },
        mockNats: true,
        bus: bus,
        afterStart: (connection) => {
            webBus = new FrusterWebBus(server, {
                test: true
            });
        }
    });

    function registerMockAuthServiceResponse() {
        bus.subscribe({
            subject: "auth-service.decode-token",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: mockUserId,
                        firstName: "bob",
                        lastName: "fred",
                        scopes: conf.webSocketPermissionScope
                    }
                };
            }
        });
    }

    it("should be possible to connect to web bus", done => {
        const messageToSend = {
            reqId: uuid.v4(),
            data: { some: "data" }
        };

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("message", function (json) {
            const message = JSON.parse(json.toString());

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

    it("should only get messages addressed to user's id", done => {
        const messageToReceive = {
            reqId: uuid.v4(),
            data: { some: "data" }
        };
        const messageNotToReceive = {
            reqId: uuid.v4(),
            data: { some: "data2" }
        };

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("message", function (json) {
            const message = JSON.parse(json.toString());

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

    it("should not allow users without the correct scopes to connect", done => {
        bus.subscribe({
            subject: "auth-service.decode-token",
            responseSchema: "",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: "hello-there-id",
                        scopes: ["read.a.book"]
                    }
                };
            }
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("close", () => {
            done();
        });
    });

    it("should not allow non-logged in users to connect", done => {
        const ws = new WebSocket(webSocketBaseUri);

        ws.on("close", () => {
            done();
        });
    });

    it("should allow broadcasts", done => {
        const message = {
            reqId: uuid.v4(),
            data: { some: "data" }
        };

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("message", (json) => {
            const message = JSON.parse(json.toString());

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

    it("should be possible to send message to server via web bus", async done => {
        const reqId = uuid.v4();
        const responseText = "This is not the response you are looking for: ";

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("close", () => {
            done.fail();
        });

        ws.on("message", (json) => {
            const response = JSON.parse(json.toString());

            expect(response.status).toBe(200, "response.status");
            expect(response.data).toBeDefined("response.data");
            expect(response.data.hello).toBe("hello BOB", "response.data.hello");
            expect(response.reqId).toBe(reqId, "response.reqId");

            done();
        });

        setTimeout(() => {
            ws.send(new Buffer(JSON.stringify({
                subject: wsEndpointSubject.replace(":userId", "BOB"),
                message: {
                    reqId: reqId,
                    data: {
                        customMessage: "1337"
                    }
                }
            })));
        }, 100);

    });

    it("should return 404 if subject is invalid", async done => {
        const reqId = uuid.v4();

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("close", () => {
            done.fail();
        });

        ws.on("message", (json) => {
            const message = JSON.parse(json.toString());

            expect(message.status).toBe(404, "message.status");

            done();
        });

        setTimeout(() => {
            ws.send(new Buffer(JSON.stringify({
                subject: "ws.hello",
                message: {
                    reqId: reqId,
                    data: {}
                }
            })));
        }, 100);

    });

    it("should close connection when unregister endpoint with jwt token is called", async done => {
        const reqId = uuid.v4();

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("close", () => {
            done();
        });

        ws.on("open", async () => {
            await bus.request(webBus.endpoints.UNREGISTER_CLIENT, {
                reqId: "hello",
                data: { jwt: "test-token" }
            });
        });

    });

    it("should close connection when unregister endpoint with userId is called", async done => {
        const reqId = uuid.v4();

        registerMockAuthServiceResponse();

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        ws.on("close", () => {
            done();
        });

        ws.on("open", async () => {
            await bus.request(webBus.endpoints.UNREGISTER_CLIENT, {
                reqId: "hello",
                data: { userId: mockUserId }
            });
        });

    });

    it("should return ok if client could not be found", async done => {
        try {
            await bus.request(webBus.endpoints.UNREGISTER_CLIENT, {
                reqId: "hello",
                data: { userId: "ram-jam" }
            });

            done();
        } catch (err) {
            log.error(err);
            done.fail();
        }
    });

    it("should require userId or jwtToken when unregistering client", async done => {
        try {
            await bus.request(webBus.endpoints.UNREGISTER_CLIENT, {
                reqId: "hello",
                data: { ram: mockUserId }
            });
        } catch (err) {
            expect(err.error.code).toBe("BAD_REQUEST", "err.error.code");
            expect(err.status).toBe(400, "err.status");

            done();
        }
    });

});