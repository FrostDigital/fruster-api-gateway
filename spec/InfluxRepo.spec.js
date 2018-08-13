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
				method: "GET"
			});

			repo.addHttpMetric({
				duration: 200,
				path: "/another-path",
				statusCode: 400,
				reqId: "reqId",
				method: "GET"
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

			// @ts-ignore
			repo.influx = new MockInflux();
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

		it("should abort writes if failed more than maxFailedAttempts", async done => {
			// Mock failed write
			repo.influx.addOnWritePointsCallback(() => {
				throw "A mock failure";
			});

			// Add first metric
			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET"
			});

			// ...and wait until interval kicks in
			await wait(writeInterval);

			// Add second metric
			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET"
			});

			// ...and wait until interval kicks in
			await wait(writeInterval);

			// After 2 consequtive failures, the interval should be stopped
			expect(repo.interval).toBeNull();

			done();
		});

		it("should write points if maxCachedPoints was reached", async done => {
			repo.maxCachedPoints = 2;

			// Add first metric
			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET"
			});

			repo.addHttpMetric({
				duration: 100,
				path: "/path",
				statusCode: 200,
				reqId: "reqId",
				method: "GET"
			});

			// Wait a bit for write to happen
			await wait(10);

			expect(repo.cachedPoints.length).toBe(0, "should have written cached points");

			done();
		});
	});
});

function wait(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

class MockInflux {
	constructor() {
		this.writtenPoints = [];
	}

	writePoints(points) {
		if (this.onWritePoints) {
			this.onWritePoints(points);
		} else {
			this.writtenPoints = this.writtenPoints.concat(points);
		}
	}

	addOnWritePointsCallback(cb) {
		this.onWritePoints = cb;
	}

	async getDatabaseNames() {
		return [];
	}

	async createDatabase(name) {
		return;
	}
}
