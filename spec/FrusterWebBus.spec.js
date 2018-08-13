const bus = require("fruster-bus");
const log = require("fruster-log");
const uuid = require("uuid");
const WebSocket = require("ws");
const testUtils = require("fruster-test-utils");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const FrusterWebBus = require("../lib/web-bus/FrusterWebBus");
const constants = require("../lib/constants");

describe("FrusterWebBus", () => {
	const wsEndpointSubject = `ws.post.hello.:userId`;
	const wsEndpointSubjectMustBeLoggedIn = `ws.post.hello.locked.:userId`;
	const mockUserId = "hello-there-id";
	const mockUserId2 = "hello-there-id-1337";
	let webSocketBaseUri;
	let httpPort;
	let server;
	let webBus;
	const mongoUrl = `mongodb://localhost:27017/fruster-api-gateway-test`;

	testUtils.startBeforeEach({
		service: async connection => {
			httpPort = Math.floor(Math.random() * 6000 + 2000);
			webSocketBaseUri = "ws://127.0.0.1:" + httpPort;

			server = await apiGw.start(connection.natsUrl, mongoUrl, httpPort);

			bus.subscribe({
				subject: wsEndpointSubject,
				handle: req => {
					if (req.data && req.data.shouldFail) {
						return {
							status: 500,
							error: {
								code: "INTERNAL_SERVER_ERROR",
								title: "internal server error",
								detail: "Fail because it had to fail"
							}
						};
					}
					return {
						status: 200,
						data: {
							hello: "hello " + req.params.userId
						}
					};
				}
			});

			bus.subscribe({
				subject: wsEndpointSubjectMustBeLoggedIn,
				mustBeLoggedIn: true,
				handle: req => {
					if (req.data && req.data.shouldFail) {
						return {
							status: 500,
							error: {
								code: "INTERNAL_SERVER_ERROR",
								title: "internal server error",
								detail: "Fail because it had to fail"
							}
						};
					}
					return {
						status: 200,
						data: {
							hello: "hello " + req.params.userId
						}
					};
				}
			});
		},
		mockNats: true,
		afterStart: connection => {
			webBus = new FrusterWebBus(server, {
				test: true
			});
		}
	});

	afterEach(done => {
		conf.allowPublicWebsocketConnections = true;
		done();
	});

	function registerMockAuthServiceResponse() {
		bus.subscribe({
			subject: "auth-service.decode-token",
			handle: req => {
				const usersByToken = {
					hello: {
						id: mockUserId,
						firstName: "bob",
						lastName: "fred",
						scopes: ["profile.get"]
					},
					hello2: {
						id: mockUserId2,
						firstName: "bob",
						lastName: "fred",
						scopes: ["profile.get"]
					}
				};

				return {
					status: 200,
					data: usersByToken[req.data]
				};
			}
		});
	}

	it("should be possible to connect to web bus", done => {
		const messageToSend = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.reqId).toBe(messageToSend.reqId);
			expect(message.data.some).toBe(messageToSend.data.some);
			expect(message.subject).toBeDefined("ws.out.hello-there-id.hello");

			done();
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		setTimeout(() => {
			bus.request("ws.out.hello-there-id.hello", messageToSend);
		}, 100);
	});

	it("should be possible to connect to web bus as public user", done => {
		const messageToSend = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());
			expect(message.data.hello).toBe("hello BOB", "json.data.hello");

			done();
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		setTimeout(() => {
			ws.send(
				new Buffer(
					JSON.stringify({
						subject: wsEndpointSubject.replace(":userId", "BOB"),
						message: {
							reqId: "hello",
							transactionId: "transactionId"
						}
					})
				)
			);
		}, 100);
	});

	it("should not be possible to make requests to endpoints that require user to be logged in as public user connected to websocket", done => {
		const messageToSend = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.status).toBe(403, "message.status");
			expect(message.error.code).toBe("PERMISSION_DENIED", "message.error.code");

			done();
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		setTimeout(() => {
			ws.send(
				new Buffer(
					JSON.stringify({
						subject: wsEndpointSubjectMustBeLoggedIn.replace(":userId", "BOB"),
						message: {
							reqId: "hello",
							transactionId: "transactionId"
						}
					})
				)
			);
		}, 100);
	});

	it("should be possible to connect to web bus using Authorization header", done => {
		const messageToSend = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				Authorization: "Bearer hello"
			}
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.reqId).toBe(messageToSend.reqId);
			expect(message.data.some).toBe(messageToSend.data.some);
			expect(message.subject).toBeDefined("ws.out.hello-there-id.hello");

			done();
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		setTimeout(() => {
			bus.request("ws.out.hello-there-id.hello", messageToSend);
		}, 100);
	});

	it("should only get messages addressed to user's id", done => {
		const messageToReceive = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};
		const messageNotToReceive = {
			reqId: uuid.v4(),
			data: {
				some: "data2"
			}
		};

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.reqId).not.toBe(messageNotToReceive.reqId);
			expect(message.reqId).toBe(messageToReceive.reqId);

			expect(message.data.some).not.toBe(messageNotToReceive.data.some);
			expect(message.data.some).toBe(messageToReceive.data.some);

			expect(message.subject).not.toBe("ws.out.hello2-there-id.hello");
			expect(message.subject).toBe("ws.out.hello-there-id.hello");

			done();
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		setTimeout(() => {
			bus.request("ws.out.hello2-there-id.hello", messageNotToReceive).then(() =>
				bus.request("ws.out.hello-there-id.hello", messageToReceive)
			);
		}, 100);
	});

	it("should be possible to send data to a list of users", done => {
		const req = {
			to: [mockUserId, "some-other-user", "some-other-user2", mockUserId2],
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		registerMockAuthServiceResponse();

		let wsGotMessage = false;
		let ws2GotMessage = false;

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});
		const ws2 = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello2"
			}
		});
		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});
		ws2.on("close", (code, reason) => {
			done.fail(`websocket2 closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			wsGotMessage = true;
		});
		ws2.on("message", json => {
			ws2GotMessage = true;

			if (wsGotMessage && ws2GotMessage) done();
			else done.fail();
		});

		setTimeout(() => {
			bus.request("ws.out.*.hello", req);
		}, 100);
	});

	it("should allow broadcasts", done => {
		const message = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		let wsGotMessage = false;
		let ws2GotMessage = false;

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});
		const ws2 = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		ws2.on("close", (code, reason) => {
			done.fail(`websocket2 closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.subject).toBe("ws.out.hello-there-id.new-message");
			expect(message.reqId).toBe(message.reqId);
			expect(message.data.some).toBe(message.data.some);
			expect(message.subject).toBe(message.subject);

			wsGotMessage = true;

			assertMessageReceived();
		});

		ws2.on("message", json => {
			ws2GotMessage = true;

			assertMessageReceived();
		});

		function assertMessageReceived() {
			if (wsGotMessage && ws2GotMessage) done();
		}

		setTimeout(() => {
			bus.request("ws.out.*.new-message", message);
		}, 100);
	});

	it("should allow broadcasts to public users", done => {
		const message = {
			reqId: uuid.v4(),
			data: {
				some: "data"
			}
		};

		let wsGotMessage = false;
		let ws2GotMessage = false;

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});
		const ws2 = new WebSocket(webSocketBaseUri, [], {});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});
		ws2.on("close", (code, reason) => {
			done.fail(`websocket2 closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.subject).toBe("ws.out.hello-there-id.new-message");
			expect(message.reqId).toBe(message.reqId);
			expect(message.data.some).toBe(message.data.some);
			expect(message.subject).toBe(message.subject);

			wsGotMessage = true;
		});

		ws2.on("message", json => {
			ws2GotMessage = true;

			if (wsGotMessage && ws2GotMessage) done();
			else done.fail();
		});

		setTimeout(() => {
			bus.request("ws.out.*.new-message", message);
		}, 100);
	});

	it("should be possible to send message to server via web bus", async done => {
		const reqId = uuid.v4();
		const transactionId = uuid.v4();
		const userId = "BOB";

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			const response = JSON.parse(json.toString());

			expect(response.status).toBe(200, "response.status");
			expect(response.data).toBeDefined("response.data");
			expect(response.data.hello).toBe("hello BOB", "response.data.hello");
			expect(response.reqId).toBe(reqId, "response.reqId");
			expect(response.subject).toBe(
				`res.${transactionId}.${wsEndpointSubjectMustBeLoggedIn.replace(":userId", userId)}`
			);

			done();
		});

		setTimeout(() => {
			ws.send(
				new Buffer(
					JSON.stringify({
						subject: wsEndpointSubjectMustBeLoggedIn.replace(":userId", userId),
						message: {
							reqId: reqId,
							transactionId: transactionId,
							data: {
								customMessage: "1337"
							},
							query: {
								pageSize: 12
							}
						}
					})
				)
			);
		}, 100);
	});

	it("should return errors from bus request(s)", async done => {
		const reqId = uuid.v4();
		const transactionId = uuid.v4();
		const userId = "BOB";

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			const response = JSON.parse(json.toString());

			expect(response.status).toBe(500, "response.status");
			expect(response.error).toBeDefined("response.error");
			expect(response.error.code).toBe("INTERNAL_SERVER_ERROR", "response.error.code");

			done();
		});

		setTimeout(() => {
			ws.send(
				new Buffer(
					JSON.stringify({
						subject: wsEndpointSubjectMustBeLoggedIn.replace(":userId", userId),
						message: {
							reqId: reqId,
							transactionId: transactionId,
							data: {
								shouldFail: true,
								customMessage: "1337"
							},
							query: {
								pageSize: 12
							}
						}
					})
				)
			);
		}, 100);
	});

	it("should return 404 if subject is invalid", async done => {
		const reqId = uuid.v4();

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			done.fail(`websocket closed: ${code} ${reason}`);
		});

		ws.on("message", json => {
			const message = JSON.parse(json.toString());

			expect(message.status).toBe(404, "message.status");

			done();
		});

		setTimeout(() => {
			ws.send(
				new Buffer(
					JSON.stringify({
						subject: "ws.out.hello",
						message: {
							reqId: reqId,
							data: {}
						}
					})
				)
			);
		}, 100);
	});

	it("should close connection when unregister endpoint with jwt token is called", async done => {
		const reqId = uuid.v4();

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			expect(reason).toBe(constants.websocketErrorCodes.USER_DISCONNECTED, "reason");
			done();
		});

		ws.on("open", async () => {
			await bus.request(FrusterWebBus.endpoints.UNREGISTER_CLIENT, {
				reqId: "hello",
				data: {
					jwt: "hello"
				}
			});
		});
	});

	it("should close connection when unregister endpoint with userId is called", async done => {
		const reqId = uuid.v4();

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {
				cookie: "jwt=hello"
			}
		});

		ws.on("close", (code, reason) => {
			expect(reason).toBe(constants.websocketErrorCodes.USER_DISCONNECTED, "reason");
			done();
		});

		ws.on("open", async () => {
			await bus.request(FrusterWebBus.endpoints.UNREGISTER_CLIENT, {
				reqId: "hello",
				data: {
					userId: mockUserId
				}
			});
		});
	});

	it("should not be possible to connect to websocket as public user if allowPublicWebsocketConnections is set to false", async done => {
		conf.allowPublicWebsocketConnections = false;
		const reqId = uuid.v4();

		registerMockAuthServiceResponse();

		const ws = new WebSocket(webSocketBaseUri, [], {
			headers: {}
		});

		ws.on("close", (code, reason) => {
			conf.allowPublicWebsocketConnections = true;
			expect(reason).toBe(constants.websocketErrorCodes.PERMISSION_DENIED, "reason");
			done();
		});
	});

	it("should return ok if client could not be found", async done => {
		try {
			await bus.request(FrusterWebBus.endpoints.UNREGISTER_CLIENT, {
				reqId: "hello",
				data: {
					userId: "ram-jam"
				}
			});

			done();
		} catch (err) {
			log.error(err);
			done.fail();
		}
	});

	it("should require userId or jwtToken when unregistering client", async done => {
		try {
			await bus.request(FrusterWebBus.endpoints.UNREGISTER_CLIENT, {
				reqId: "hello",
				data: {
					ram: mockUserId
				}
			});
		} catch (err) {
			expect(err.error.code).toBe("BAD_REQUEST", "err.error.code");
			expect(err.status).toBe(400, "err.status");
			expect(err.reqId).toBeDefined("err.reqId");

			done();
		}
	});
});
