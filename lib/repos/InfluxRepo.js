const bus = require("fruster-bus");
const Influx = require("influx");
const log = require("fruster-log");
const ms = require("ms");

const MEASUREMENT_NAME = "http_response";
const DEFAULT_WRITE_INTERVAL = ms("30s");
const DEFAULT_MAX_CACHED_POINTS = 4000;
const MAX_FAILED_WRITES_UNTIL_ABORT = 4;

const INFLUX_URL_REGEXP = /influxdb\:\/\/(.*?):(.*?)\/(.*)/;
const INFLUX_URL_WITH_CREDENTIALS_REGEXP = /influxdb\:\/\/(.*?):(.*?)@(.*?):(.*?)\/(.*)/;

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
	 * @param {Number=} obj.maxCachedPoints max cached points until a write to influx happens
	 * @param {Number=} obj.writeInterval how often points are written to influx
	 * @param {Number=} obj.maxFailedAttempts how many consequtive times write can fail until all write stops
	 */
	constructor({
		url = "influxdb://localhost:8086/api-gateway",
		writeInterval = DEFAULT_WRITE_INTERVAL,
		maxCachedPoints = DEFAULT_MAX_CACHED_POINTS,
		maxFailedAttempts = MAX_FAILED_WRITES_UNTIL_ABORT
	}) {
		const connectionDetails = this._parseInfluxDbUrl(url);

		this.serviceInstanceId = bus.instanceId;
		this.cachedPoints = [];
		this.database = connectionDetails.database;
		this.writeInterval = writeInterval;
		this.failedWriteAttempts = 0;
		this.maxFailedAttempts = maxFailedAttempts;
		this.maxCachedPoints = maxCachedPoints;

		this.influx = new Influx.InfluxDB({
			host: connectionDetails.host,
			port: connectionDetails.port,
			database: this.database,
			schema: [
				{
					measurement: MEASUREMENT_NAME,
					fields: {
						path: Influx.FieldType.STRING,
						duration: Influx.FieldType.INTEGER,
						statusCode: Influx.FieldType.INTEGER,
						userId: Influx.FieldType.STRING,
						reqId: Influx.FieldType.STRING,
						method: Influx.FieldType.STRING
					},
					tags: ["serviceInstanceId", "statusCode"]
				}
			]
		});

		this.interval = setInterval(() => this._writeCachedPoints(), this.writeInterval);
	}

	/**
	 * Initializes the database, will create it if it does not already exist
	 */
	async init() {
		const dbs = await this.influx.getDatabaseNames();

		if (!dbs.includes(this.database)) {
			log.info(`Influx database named ${this.database} does not exist, creating it...`);
			try {
				await this.influx.createDatabase(this.database);
			} catch (err) {
				log.error("Failed to create influx database " + this.database, err);
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

	 */
	addHttpMetric({ statusCode, path, duration, userId, reqId, method }) {
		this.cachedPoints.push({
			measurement: MEASUREMENT_NAME,
			fields: {
				statusCode,
				path,
				duration,
				userId,
				reqId,
				method
			},
			timestamp: new Date(),
			tags: { serviceInstanceId: this.serviceInstanceId, statusCode }
		});

		if (this.cachedPoints.length >= this.maxCachedPoints) {
			// Force write to Influx if we have that many cached points
			// Most often this will not be invoked since the periodical write is enough
			log.debug(`Influx client reached maxCachedPoints ${this.cachedPoints.length} - will write to Influx`);
			this._writeCachedPoints();
		}
	}

	/**
	 * Write cached points to influx db.
	 */
	_writeCachedPoints() {
		const metricsToSend = this.cachedPoints;

		this.cachedPoints = [];

		if (metricsToSend.length) {
			log.debug(`Writing ${metricsToSend.length} points to influxdb`);

			try {
				this.influx.writePoints(metricsToSend);
				this.failedWriteAttempts = 0;
			} catch (err) {
				log.warn("Failed to write points to influx:", err);
				this.failedWriteAttempts++;

				if (this.failedWriteAttempts >= this.maxFailedAttempts) {
					log.warn(`Aborting writes to influx, has failed to write ${this.failedWriteAttempts} times`);
					this._stopWrites();
				}
			}
		}
	}

	/**
	 * Stop periodical writes to influx.
	 */
	_stopWrites() {
		clearInterval(this.interval);
		this.interval = null;
	}

	/**
	 * Parses string on format (both are valid):
	 *
	 * influxdb://{username}:{password}@{host}:{port}/{database}
	 * influxdb://{host}:{port}/{database}
	 */
	_parseInfluxDbUrl(url) {
		const hasCredentials = url.includes("@");
		const regExp = hasCredentials ? INFLUX_URL_WITH_CREDENTIALS_REGEXP : INFLUX_URL_REGEXP;
		const match = regExp.exec(url);

		const parsedConnectionObj = {};

		if (hasCredentials) {
			parsedConnectionObj["username"] = match[1];
			parsedConnectionObj["password"] = match[2];
			parsedConnectionObj["host"] = match[3];
			parsedConnectionObj["port"] = parseInt(match[4], 10);
			parsedConnectionObj["database"] = match[5];
		} else {
			parsedConnectionObj["host"] = match[1];
			parsedConnectionObj["port"] = parseInt(match[2], 10);
			parsedConnectionObj["database"] = match[3];
		}

		return parsedConnectionObj;
	}
}

module.exports = InfluxRepo;
