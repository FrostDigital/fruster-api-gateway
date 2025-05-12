# Server-Sent Events (SSE) Example

This directory contains example files demonstrating how to use the Server-Sent Events (SSE) implementation in the Fruster API Gateway.

## Files

-   `sse-demo.html`: A simple HTML page that demonstrates how to connect to SSE endpoints and receive events
-   `sse-routes.js`: Example routes for serving the demo page and providing an API endpoint to publish events

## How to Use

### 1. Integrate the SSE Routes

To use the example routes in your application, you can modify your `app.js` file to include them:

```javascript
const createSSERoutes = require("./examples/sse/sse-routes");

// After initializing your Express app
createSSERoutes(app);
```

### 2. Access the Demo Page

Once your server is running, you can access the demo page at:

```
http://localhost:3000/sse-demo
```

### 3. Connect to SSE Channels

The demo page allows you to:

-   Connect to specific SSE channels
-   Provide an optional JWT token for authentication
-   Send test events to specific users or broadcast to all users
-   View received events in real-time

## SSE Implementation Details

The SSE implementation in Fruster API Gateway provides:

1. **Authentication**: Uses the existing JWT token mechanism
2. **Channel-based Subscriptions**: Clients can connect to specific channels via URL patterns like `/sse/:channelName`
3. **Targeted Events**: Internal services can publish events to specific users
4. **Broadcast Support**: Events can be broadcast to all users on a channel
5. **Simple JSON Format**: Events are sent as JSON data

## Publishing Events

Internal services can publish events to SSE channels using the bus mechanism:

```javascript
// Send to specific user
bus.publish(`sse.out.user123.notifications`, {
	data: {
		type: "notification",
		message: "You have a new message",
	},
});

// Broadcast to all users on a channel
bus.publish(`sse.out.*.system-alerts`, {
	data: {
		type: "alert",
		message: "System maintenance in 10 minutes",
	},
});
```

## Client-Side Integration

To connect to an SSE channel from a client application:

```javascript
const eventSource = new EventSource("/sse/notifications");

eventSource.onmessage = function (event) {
	const data = JSON.parse(event.data);
	console.log("Received event:", data);
};

eventSource.onerror = function (error) {
	console.error("SSE connection error:", error);
};

// Close the connection when needed
function closeConnection() {
	eventSource.close();
}
```

## Configuration

The SSE implementation can be configured in `conf.js`:

```javascript
// Whether to allow unauthenticated SSE connections
allowPublicSSEConnections: false,

// Subject pattern for SSE events
sseSubject: "sse.out.:userId.>",

// Maximum number of SSE connections per user
maxSSEConnectionsPerUser: 10,

// SSE heartbeat interval
sseHeartbeatInterval: ms("30s"),
```
