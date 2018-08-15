const bus = require("fruster-bus");
const batchingInflux = require("batching-influx");
const log = require("fruster-log");

const MEASUREMENT_NAME = "http_response";

/**
 * Repo used to write metrics to InfluxDB. Once in InfluxDB the data can be crunched
 * and visualized i.e. on dashboards using Grafana.
 *
 * The repo will cache data before sending so it is sent in batches for
 * better performance according to best Influx best practises.
 *
 * The batch is either sent ever X ms as configured by `writeInterval` or when
 * maximum number of cached points has been reached `maxCachedPoints`.
 *
 */
class InfluxRepo {
	/**
	 * Constructor.
	 *
	 * @param {Object} obj
	 * @param {String=} obj.url Influx DB url
	 * @param {Number=} obj.writeInterval how often points are written to influx
	 */
	constructor({ url = "influxdb://localhost:8086/api-gateway", writeInterval }) {
		this.serviceInstanceId = bus.instanceId;
		this.cachedPoints = [];
		this.failedWriteAttempts = 0;

		this.influx = new batchingInflux.BatchingInflux(
			{
				url,
				schema: [
					{
						measurement: MEASUREMENT_NAME,
						fields: {
							path: batchingInflux.Influx.FieldType.STRING,
							duration: batchingInflux.Influx.FieldType.INTEGER,
							statusCode: batchingInflux.Influx.FieldType.INTEGER,
							userId: batchingInflux.Influx.FieldType.STRING,
							reqId: batchingInflux.Influx.FieldType.STRING,
							method: batchingInflux.Influx.FieldType.STRING,
							userAgent: batchingInflux.Influx.FieldType.STRING
						},
						tags: ["serviceInstanceId", "statusCode"]
					}
				]
			},
			{
				writeInterval
			}
		).startPeriodicalWrites();
	}

	/**
	 * Initializes the database, will create it if it does not already exist
	 */
	async init() {
		const dbs = await this.influx.getDatabaseNames();

		if (!dbs.includes(this.influx.database)) {
			log.info(`Influx database named ${this.influx.database} does not exist, creating it...`);
			try {
				await this.influx.createDatabase(this.influx.database);
			} catch (err) {
				log.error("Failed to create influx database " + this.influx.database, err);
			}
		}

		return this;
	}

	/**
	 * Add HTTP metric.
	 *
	 * Will add to cache and later written to influx in a batch.
	 *
	 * @param {Object} obj metric object
	 * @param {Number} obj.statusCode http status code
	 * @param {String} obj.path path that was invoked
	 * @param {Number} obj.duration duration in ms until http response was sent
	 * @param {String=} obj.userId optional id of user
	 * @param {String} obj.reqId reqId of request
	 * @param {String} obj.method method (HTTP verb) of request
	 * @param {String=} obj.userAgent user agent

	 */
	addHttpMetric({ statusCode, path, duration, userId, reqId, method, userAgent }) {
		this.influx.addPoint({
			measurement: MEASUREMENT_NAME,
			fields: {
				statusCode,
				path,
				duration,
				userId,
				reqId,
				method,
				userAgent
			},
			timestamp: new Date(),
			tags: { serviceInstanceId: this.serviceInstanceId, statusCode }
		});
	}
}

module.exports = InfluxRepo;
