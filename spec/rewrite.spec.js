const request = require("request");
const bus = require("fruster-bus");
const testUtils = require("fruster-test-utils");
const conf = require("../conf");
const apiGw = require("../api-gateway");
const FrusterWebBus = require("../lib/web-bus/FrusterWebBus");

describe("Rewrite", () => {
	let baseUri;
	let httpPort;
	let server;
	const mongoUrl = `mongodb://localhost:27017/fruster-api-gateway-test`;

	const userId = "828e2a1c-4cbb-4e00-924d-79e7a4cd0a99";

	testUtils.startBeforeEach({
		service: (connection) => {
			conf.rewriteRules = `${userId}:http\.(get|post|put|delete)\.foo(\.?.*)>http.v2.$1.foo$2`;

			httpPort = Math.floor(Math.random() * 6000 + 2000);
			baseUri = "http://127.0.0.1:" + httpPort;
			return apiGw.start(connection.natsUrl, mongoUrl, httpPort).then((_server) => {
				server = _server;
			});
		},
		mockNats: true,
		afterStart: (connection) => {
			new FrusterWebBus(server, {
				test: true,
			});
		},
	});

	it("should rewrite path", async (done) => {
		bus.subscribe("auth-service.decode-token", (req) => {
			if (req.data === "user1") {
				return {
					status: 200,
					data: {
						id: userId,
					},
				};
			} else {
				return {
					status: 200,
					data: {
						id: "3d14fde1-b9ca-47f0-bd16-200967afb3b4", // some other user
					},
				};
			}
		});

		bus.subscribe("http.get.foo.:id", (req) => {
			return {
				status: 200,
				data: "not rewritten",
			};
		});

		bus.subscribe("http.v2.get.foo.:id", (req) => {
			return {
				status: 200,
				data: "rewritten",
			};
		});

		// Rewrite is only enabled for this user
		const rewrittenResponse = await get("/foo/123", { cookie: "jwt=user1" });

		// This user is not enabled for rewrite
		const notRewrittenResponse = await get("/foo/123", { cookie: "jwt=anotherUser" });

		expect(rewrittenResponse.statusCode).toBe(200);
		expect(rewrittenResponse.body.data).toBe("rewritten");

		expect(notRewrittenResponse.statusCode).toBe(200);
		expect(notRewrittenResponse.body.data).toBe("not rewritten");

		done();
	});

	function get(path, headers, reqOpts = {}) {
		return doRequest({ method: "GET", path, headers, reqOpts });
	}

	function doRequest({ method, path, headers = {}, json = null, rawBody = null, reqOpts = {} }) {
		return new Promise((resolve, reject) => {
			reqOpts = {
				...reqOpts,
				uri: baseUri + path,
				method: method,
				headers: headers,
			};

			if (rawBody) {
				reqOpts.body = rawBody;
			} else {
				reqOpts.json = json || true;
			}

			request(reqOpts, (err, response, body) => {
				if (err) {
					return reject(err);
				}
				response.body = body;
				resolve(response);
			});
		});
	}
});
