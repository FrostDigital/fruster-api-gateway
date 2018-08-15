const InfluxRepo = require("../lib/repos/InfluxRepo");

describe("InfluxRepo", () => {
	xdescribe("with real influx", () => {
		// Note: This test suite requries that influx db runs locally
		// Start locally by running docker run -d --name influxdb -p 8086:8086 influxdb

		/** @type {InfluxRepo} */
		let repo;

		const writeInterval = 100;

		beforeEach(async done => {
			repo = new InfluxRepo({
				writeInterval
			});

			await repo.influx.dropDatabase(repo.database);

			await repo.init();

			done();
		});

		it("should create database while initializing", async done => {
			expect(await repo.influx.getDatabaseNames()).toContain(repo.database);
			done();
		});

		it("should write points to influxdb", async done => {
			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET",
				userAgent: "Chrome"
			});

			repo.addHttpMetric({
				duration: 200,
				path: "/another-path",
				statusCode: 400,
				reqId: "reqId",
				method: "GET",
				userAgent: "iOS"
			});

			expect(repo.cachedPoints.length).toBe(2);

			await wait(writeInterval);

			expect(repo.cachedPoints.length).toBe(0);

			done();
		});
	});

	describe("with mocked influx", () => {
		/** @type {InfluxRepo} */
		let repo;

		const writeInterval = 100;

		beforeEach(() => {
			repo = new InfluxRepo({
				writeInterval,
				maxFailedAttempts: 2
			});

			repo.influx = mockInflux(repo.influx);
		});

		it("should write points on a given interval", async done => {
			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET"
			});

			expect(repo.influx.writtenPoints.length).toBe(0, "points should not have been written yet");

			// Wait until interval kicks in
			await wait(writeInterval + 1);

			expect(repo.influx.writtenPoints.length).toBe(1, "should have been written in batch every X ms");
			expect(repo.cachedPoints.length).toBe(0, "should empty cached points after write");

			done();
		});
	});
});

function wait(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

/**
 * Override methods on influx client to avoid that is actually makes a
 * call to real database.
 *
 * @param {Object} influx
 */
function mockInflux(influx) {
	influx.writtenPoints = [];

	influx.writePoints = points => {
		if (influx.onWritePointsCallback) {
			influx.onWritePointsCallback();
		}

		influx.writtenPoints = influx.writtenPoints.concat(points);
	};

	influx.onWritePoints = fn => {
		influx.onWritePointsCallback = fn;
	};

	return influx;
}
