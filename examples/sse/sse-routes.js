const bus = require("fruster-bus");
const log = require("fruster-log");
const express = require("express");
const path = require("path");

/**
 * Creates routes for SSE demo and API
 *
 * @param {Object} app Express app
 */
function createSSERoutes(app) {
	// Serve the SSE demo page
	app.get("/sse-demo", (req, res) => {
		res.sendFile(path.join(__dirname, "sse-demo.html"));
	});

	// API endpoint to publish events to SSE channels
	app.post("/api/sse/publish", async (req, res) => {
		try {
			const { userId, channel, data } = req.body;

			if (!userId || !channel || !data) {
				return res.status(400).json({
					error: true,
					message: "Missing required fields: userId, channel, and data are required",
				});
			}

			// Construct the subject based on userId (use * for broadcast)
			const subject = `sse.out.${userId}.${channel}`;

			log.info(`Publishing SSE event to ${subject}`, { userId, channel });

			// Publish the event to the bus
			await bus.publish(subject, { data });

			return res.status(200).json({
				success: true,
				message: "Event published successfully",
			});
		} catch (error) {
			log.error("Error publishing SSE event:", error);

			return res.status(500).json({
				error: true,
				message: "Failed to publish event",
				details: error.message,
			});
		}
	});
}

module.exports = createSSERoutes;
