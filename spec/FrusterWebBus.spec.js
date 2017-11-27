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
const FrusterWebBus = require("../lib/FrusterWebBus");
const testUtils = require("fruster-test-utils");

fdescribe("FrusterWebBus", () => {
    let natsServer;
    let baseUri;
    let webSocketBaseUri;
    let httpPort;
    let server;

    testUtils.startBeforeEach({
        service: async (connection) => {
            httpPort = Math.floor(Math.random() * 6000 + 2000);
            baseUri = "http://127.0.0.1:" + httpPort;
            webSocketBaseUri = "ws://127.0.0.1:" + httpPort;

            server = await apiGw.start(httpPort, connection.natsUrl);
        },
        mockNats: true,
        bus: bus,
        afterStart: (connection) => {
            new FrusterWebBus(server, {
                test: true
            });
        }
    });


    it("should be possible to connect to web bus", done => {
        const messageToSend = {
            reqId: uuid.v4(),
            data: { some: "data" }
        };

        bus.subscribe({
            subject: "auth-service.decode-token",
            responseSchema: "",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: "hello-there-id",
                        scopes: conf.webSocketPermissionScope
                    }
                };
            }
        });

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

        bus.subscribe({
            subject: "auth-service.decode-token",
            responseSchema: "",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: "hello-there-id",
                        scopes: conf.webSocketPermissionScope
                    }
                };
            }
        });

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

        bus.subscribe({
            subject: "auth-service.decode-token",
            responseSchema: "",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: "hello-there-id",
                        scopes: conf.webSocketPermissionScope
                    }
                };
            }
        });

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

    fit("should be possible to send message to server via web bus", async done => {
        const subject = `ws.post.${uuid.v4()}.hello.:userId`;
        const reqId = uuid.v4();
        const responseText = "This is not the response you are looking for: ";

        bus.subscribe({
            subject: "auth-service.decode-token",
            responseSchema: "",
            handle: (req) => {
                return {
                    status: 200,
                    data: {
                        id: "hello-there-id",
                        firstName: "bob",
                        lastName: "fred",
                        scopes: conf.webSocketPermissionScope
                    }
                };
            }
        });

        const ws = new WebSocket(webSocketBaseUri, [], {
            headers: { cookie: "jwt=hello" }
        });

        bus.subscribe({
            subject: subject,
            responseSchema: "",
            handle: (req) => {
                console.log("\n");
                console.log("=======================================");
                console.log("req");
                console.log("=======================================");
                console.log(require("util").inspect(req, null, null, true));
                console.log("\n");
                return {
                    status: 400,
                    data: req.data
                };
            }
        });

        ws.on("close", () => {
            done.fail();
        });

        ws.on("message", (json) => {
            const message = JSON.parse(json.toString());

            console.log("\n");
            console.log("=======================================");
            console.log("Ws message");
            console.log("=======================================");
            console.log(require("util").inspect(message, null, null, true));
            console.log("\n");

            expect(message.data).toBeDefined("message.data");
            expect(message.data.text).toBe(responseText, "message.data.text");

            done();
        });

        setTimeout(() => {
            ws.send(new Buffer(JSON.stringify({
                subject: subject,
                message: {
                    reqId: reqId,
                    data: {
                        customMessage: "1337"
                    },
                    params: {
                        "userId": "BOB"
                    }
                }
            })));
        }, 100);

    });

});