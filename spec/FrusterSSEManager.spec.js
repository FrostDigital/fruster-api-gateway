const bus = require("fruster-bus");
const request = require("supertest");
const testUtils = require("fruster-test-utils");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const FrusterSSEManager = require("../lib/sse/FrusterSSEManager");

describe("FrusterSSEManager", () => {
	const sseChannelName = "notifications";
	const sseEndpoint = `/sse/${sseChannelName}`;
	const mockUserId = "test-user-id";
	const mockUserId2 = "test-user-id-2";
	let httpPort;
	let server;
	let app;
	let sseManager;
	const mongoUrl = `mongodb://localhost:27017/fruster-api-gateway-test`;

	testUtils.startBeforeEach({
		service: async (connection) => {
			httpPort = Math.floor(Math.random() * 6000 + 2000);

			// Set enableSSE to true before starting the API gateway
			conf.enableSSE = true;

			server = await apiGw.start(connection.natsUrl, mongoUrl, httpPort);
			app = server._events.request;
		},
		mockNats: true,
		afterStart: () => {
			// Initialize the SSE manager directly, similar to how it's done in app.js
			sseManager = new FrusterSSEManager(app);

			// No need to register mock auth service response anymore
			// as we're using req.user directly
		},
	});

	const defaultMaxConnections = conf.maxSSEConnectionsPerUser;

	afterEach(() => {
		conf.enableSSE = false;
		conf.maxSSEConnectionsPerUser = defaultMaxConnections;
	});

	// No longer needed as we're using req.user directly

	it("should reject unauthenticated SSE connections", async () => {
		// Use supertest for this test since we're just checking the initial response
		const response = await request(app).get(sseEndpoint).set("Accept", "text/event-stream");

		// The connection should be established but then closed with an error message
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/event-stream");
		expect(response.text).toContain("Authentication required");
	});

	it("should accept authenticated SSE connections with valid user", (done) => {
		// Create a mock response object to simulate an SSE connection
		const mockResponse = {
			writeHead: jasmine.createSpy("writeHead").and.callFake(() => {
				// Verify headers were set correctly
				expect(mockResponse.writeHead).toHaveBeenCalledWith(
					200,
					jasmine.objectContaining({
						"Content-Type": "text/event-stream",
					})
				);
				return mockResponse;
			}),
			write: jasmine.createSpy("write").and.callFake((data) => {
				// Check if this is the connection established message
				if (data.includes("connection_established")) {
					expect(data).toContain("connection_established");
					done();
				}
				return mockResponse;
			}),
			end: jasmine.createSpy("end"),
		};

		// Simulate a request with authenticated user
		const mockReq = {
			params: { channelName: sseChannelName },
			reqId: "test-req-id",
			user: {
				id: mockUserId,
				firstName: "Test",
				lastName: "User",
				scopes: ["profile.get"],
			},
			on: (event, callback) => {
				// Store the close callback but don't call it
				mockReq.closeCallback = callback;
			},
		};

		// Call the handler directly
		sseManager._handleSSERequest(mockReq, mockResponse);
	});

	it("should handle SSE events sent to specific users", () => {
		// This test is more complex as it requires checking if events are properly
		// sent to the SSE connection. In a real environment, we would use a client
		// that can maintain the connection and receive events.
		//
		// For this test, we'll verify that the internal methods work correctly

		// Create a mock response object to simulate an SSE connection
		const mockResponse = {
			writeHead: jasmine.createSpy("writeHead"),
			write: jasmine.createSpy("write"),
			end: jasmine.createSpy("end"),
		};

		// Manually add a connection for testing
		sseManager._addConnection(mockUserId, sseChannelName, mockResponse);

		// Directly call the internal method to send an event
		const eventData = { type: "notification", message: "Test notification" };
		sseManager._sendEventToUser(mockUserId, sseChannelName, eventData);

		// Verify the event was sent to the connection
		expect(mockResponse.write).toHaveBeenCalled();
		const writtenData = mockResponse.write.calls.mostRecent().args[0];
		expect(writtenData).toContain(JSON.stringify(eventData));
	});

	it("should handle SSE events broadcast to all users on a channel", () => {
		// Create mock response objects to simulate SSE connections
		const mockResponse1 = {
			writeHead: jasmine.createSpy("writeHead1"),
			write: jasmine.createSpy("write1"),
			end: jasmine.createSpy("end1"),
		};

		const mockResponse2 = {
			writeHead: jasmine.createSpy("writeHead2"),
			write: jasmine.createSpy("write2"),
			end: jasmine.createSpy("end2"),
		};

		// Manually add connections for testing
		sseManager._addConnection(mockUserId, sseChannelName, mockResponse1);
		sseManager._addConnection(mockUserId2, sseChannelName, mockResponse2);

		// Directly call the internal method to broadcast an event
		const eventData = { type: "broadcast", message: "Broadcast message" };
		sseManager._broadcastToChannel(sseChannelName, eventData);

		// Verify the event was sent to both connections
		expect(mockResponse1.write).toHaveBeenCalled();
		expect(mockResponse2.write).toHaveBeenCalled();

		const writtenData1 = mockResponse1.write.calls.mostRecent().args[0];
		const writtenData2 = mockResponse2.write.calls.mostRecent().args[0];

		expect(writtenData1).toContain(JSON.stringify(eventData));
		expect(writtenData2).toContain(JSON.stringify(eventData));
	});

	it("should properly clean up connections when clients disconnect", () => {
		// Create mock response objects
		const mockResponse = {
			writeHead: jasmine.createSpy("writeHead"),
			write: jasmine.createSpy("write"),
			end: jasmine.createSpy("end"),
		};

		// Add a connection
		sseManager._addConnection(mockUserId, sseChannelName, mockResponse);

		// Verify connection was added
		expect(sseManager._connections[mockUserId]).toBeDefined();
		expect(sseManager._connections[mockUserId][sseChannelName]).toBeDefined();
		expect(sseManager._connections[mockUserId][sseChannelName].length).toBe(1);
		expect(sseManager._channelConnections[sseChannelName]).toBeDefined();
		expect(sseManager._channelConnections[sseChannelName].length).toBe(1);

		// Remove the connection
		sseManager._removeConnection(mockUserId, sseChannelName, mockResponse);

		// Verify connection was removed
		expect(sseManager._connections[mockUserId]).toBeUndefined();
		expect(sseManager._channelConnections[sseChannelName]).toBeUndefined();
	});

	it("should enforce connection limits per user", async () => {
		conf.maxSSEConnectionsPerUser = 2;

		// Create mock response objects
		const mockResponse1 = {
			writeHead: jasmine.createSpy("writeHead1"),
			write: jasmine.createSpy("write1"),
			end: jasmine.createSpy("end1"),
		};

		const mockResponse2 = {
			writeHead: jasmine.createSpy("writeHead2"),
			write: jasmine.createSpy("write2"),
			end: jasmine.createSpy("end2"),
		};

		const mockResponse3 = {
			writeHead: jasmine.createSpy("writeHead3"),
			write: jasmine.createSpy("write3"),
			end: jasmine.createSpy("end3"),
		};

		// Add connections up to the limit
		sseManager._addConnection(mockUserId, sseChannelName, mockResponse1);
		sseManager._addConnection(mockUserId, "another-channel", mockResponse2);

		// Verify connections were added
		expect(sseManager._connections[mockUserId][sseChannelName].length).toBe(1);
		expect(sseManager._connections[mockUserId]["another-channel"].length).toBe(1);

		// Try to add a connection beyond the limit
		// In a real request, this would be rejected by the _handleSSERequest method
		// Here we're just testing the connection count logic
		const totalConnections = Object.values(sseManager._connections[mockUserId]).flat().length;
		expect(totalConnections).toBe(2);
		expect(totalConnections >= conf.maxSSEConnectionsPerUser).toBe(true);
	});

	const mockRes = (name) => ({
		writeHead: jasmine.createSpy(`${name}.writeHead`),
		write: jasmine.createSpy(`${name}.write`),
		end: jasmine.createSpy(`${name}.end`),
		on: jasmine.createSpy(`${name}.on`),
	});

	const mockReqFor = (userId) => ({
		params: { channelName: sseChannelName },
		reqId: "test-req-id",
		user: { id: userId, scopes: [] },
		clearTimeout: jasmine.createSpy("clearTimeout"),
		on: jasmine.createSpy("req.on"),
	});

	it("should exempt a stream from the gateway request timeout", () => {
		const req = mockReqFor(mockUserId);

		sseManager._handleSSERequest(req, mockRes("res"));

		expect(req.clearTimeout).toHaveBeenCalled();
	});

	it("should release the stream when either the request or the response closes", () => {
		const req = mockReqFor(mockUserId);
		const res = mockRes("res");

		sseManager._handleSSERequest(req, res);
		expect(sseManager.getStats().connections).toBe(1);

		const resClose = res.on.calls.allArgs().find(([event]) => event === "close")[1];
		resClose();
		expect(sseManager.getStats().connections).toBe(0, "response close alone releases it");

		// The request's close arriving afterwards must be harmless
		const reqClose = req.on.calls.allArgs().find(([event]) => event === "close")[1];
		expect(() => reqClose()).not.toThrow();
		expect(sseManager.getStats().connections).toBe(0);
	});

	it("should prune dead streams on heartbeat instead of counting them forever", () => {
		const live = mockRes("live");
		const dead = { ...mockRes("dead"), destroyed: true };
		const endedByProxy = { ...mockRes("ended"), socket: { destroyed: true } };

		sseManager._addConnection(mockUserId, sseChannelName, live);
		sseManager._addConnection(mockUserId, sseChannelName, dead);
		sseManager._addConnection(mockUserId2, sseChannelName, endedByProxy);
		expect(sseManager.getStats().connections).toBe(3);

		sseManager._sendHeartbeat();

		expect(sseManager.getStats().connections).toBe(1);
		expect(live.write).toHaveBeenCalledWith(": heartbeat\n\n");
		expect(dead.write).not.toHaveBeenCalled();
		expect(sseManager._connections[mockUserId2]).toBeUndefined();
	});

	it("should not let dead streams lock a user out of the connection limit", () => {
		conf.maxSSEConnectionsPerUser = 2;

		sseManager._addConnection(mockUserId, sseChannelName, { ...mockRes("dead1"), destroyed: true });
		sseManager._addConnection(mockUserId, sseChannelName, { ...mockRes("dead2"), writableEnded: true });

		const res = mockRes("fresh");
		sseManager._handleSSERequest(mockReqFor(mockUserId), res);

		expect(res.end).not.toHaveBeenCalled();
		expect(res.write.calls.allArgs().some(([data]) => data.includes("Maximum connections exceeded"))).toBe(false);
		expect(sseManager.getStats().connections).toBe(1);
	});

	it("should still refuse an eleventh live stream", () => {
		conf.maxSSEConnectionsPerUser = 1;

		sseManager._addConnection(mockUserId, sseChannelName, mockRes("live"));

		const res = mockRes("refused");
		sseManager._handleSSERequest(mockReqFor(mockUserId), res);

		expect(res.write.calls.allArgs().some(([data]) => data.includes("Maximum connections exceeded"))).toBe(true);
		expect(res.end).toHaveBeenCalled();
		expect(sseManager.getStats().connections).toBe(1);
	});

	it("should provide connection statistics", () => {
		// Create mock response objects
		const mockResponse1 = {
			writeHead: jasmine.createSpy("writeHead1"),
			write: jasmine.createSpy("write1"),
			end: jasmine.createSpy("end1"),
		};

		const mockResponse2 = {
			writeHead: jasmine.createSpy("writeHead2"),
			write: jasmine.createSpy("write2"),
			end: jasmine.createSpy("end2"),
		};

		// Add connections
		sseManager._addConnection(mockUserId, sseChannelName, mockResponse1);
		sseManager._addConnection(mockUserId2, sseChannelName, mockResponse2);

		// Get stats
		const stats = sseManager.getStats();

		// Verify stats
		expect(stats.users).toBe(2);
		expect(stats.channels).toBe(1);
		expect(stats.connections).toBe(2);
	});
});
