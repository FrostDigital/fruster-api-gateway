module.exports = {

	http: {},

	service: {

		UNREGISTER_CLIENT: {
			description: "Request to (forcefully) unregister (a) websocket client. Can be done by either providing the jwt-token to unregister one connection or the id of the user to unregister all connections for user.",
			query: {},
			params: {},
			errors: {
				INTERNAL_SERVER_ERROR: "Something unexpected happened"
			}
		}

	},

	ws: {

		SEND_MESSAGE_TO_CLIENT: {
			description: "Sends a message to a client (user) via websocket, if such connection exists. The message is sent to a userId with a label (in place of the `>`). If sent to `ws.out.e3bcf884-8b49-46ae-8546-8dcc65b56932.new-notification` (The label being `new-notification`) the user will receive the message in the handler registered to `new-notification`. Can be used to send a global message to all connected users by providing a `*` as `userId`. To specify a list of users to send to `*` is used as `userId` and `req.to` is set to an array of userIds.",
			query: {},
			params: {},
			errors: {
				INTERNAL_SERVER_ERROR: "Something unexpected happened"
			}
		},

		SEND_MESSAGE_TO_CLIENT_PUBLIC: {
			description: "Sends a message to all connected users. Public and non public connections. The `>` is the label for the message being sent. E.g. `ws.out.public.psa` (Where the label is `psa`). This endpoint will make it possible for the public clients to subscribe to the endpoint without knowing their assigned uuid.",
			query: {},
			params: {},
			errors: {
				INTERNAL_SERVER_ERROR: "Something unexpected happened"
			}
		}


	}

};
