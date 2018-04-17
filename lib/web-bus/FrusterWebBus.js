const bus = require("fruster-bus");
const FrusterRequest = bus.FrusterRequest;
const log = require("fruster-log");
const conf = require("../../conf");
const WebSocket = require("ws");
const WebBusSocket = require("./model/WebBusSocket");
const _ = require("lodash");
const uuid = require("uuid");
const util = require("util");
const apiGateway = require("../../api-gateway");
const webBusUtils = require("./util/web-bus-utils");
const constants = require("../constants");


class FrusterWebBus {

    static get endpoints() {
        return {

            SEND_MESSAGE_TO_CLIENT: conf.webSocketSubject,

            UNREGISTER_CLIENT: "fruster-web-bus.unregister-client"

        };
    }

    constructor(server, options) {
        this._webSocketServer = new WebSocket.Server({ server });
        this._connectedClients = {};
        this._registerConnectionHandler();
        this._registerCookieHeaderParser();
        this._options = options || {};

        // Bus endpoints

        bus.subscribe({
            subject: FrusterWebBus.endpoints.SEND_MESSAGE_TO_CLIENT,
            createQueueGroup: false, // No websocket endpoint should register queue groups since clients may be spread over several instances of api gateway. 
            handle: (req, replyTo, actualSubject) => this._handleMessagesToWebsocket(req, actualSubject)
        });

        bus.subscribe({
            subject: FrusterWebBus.endpoints.UNREGISTER_CLIENT,
            requestSchema: "UnregisterWebsocketClientRequest",
            createQueueGroup: false, // No websocket endpoint should register queue groups since clients may be spread over several instances of api gateway. 
            handle: (req) => this._handleUnregister(req)
        });

    }

    /**
     * Handles messages being sent to a user via websocket.
     * 
     * @param {FrusterRequest|Object} req fruster request object
     * @param {String} actualSubject the actual subject request was sent to
     */
    _handleMessagesToWebsocket(req, actualSubject) {
        const userId = req.params.userId;
        const isPublish = userId === "*";

        if (isPublish) {
            if (!req.to || req.to.length === 0) {
                this._publishToAllClients(req, actualSubject);
            } else {
                this._sendToAllConnectionsForClients(req.to, req, actualSubject);
            }
        } else {
            this._sendToAllConnectionsForClient(userId, req, actualSubject);
        }

        return {
            status: 200,
            reqId: req.reqId
        };
    }

    /**
     * Endpoint for disconnecting a socket, e.g. on logout
     * 
     * @param {FrusterRequest} req 
     */
    _handleUnregister(req) {
        const that = this;
        const jwtToken = req.data.jwt;
        const userId = req.data.userId;

        let clientToClose;

        if (!!jwtToken) {
            _unregisterClientByJwtToken();
        } else {
            _unregisterClientByUserId();
        }

        return {
            status: 200
        };

        function _unregisterClientByJwtToken() {
            const connectedClientByUserIdValues = Object.values(that._connectedClients);

            let x = connectedClientByUserIdValues.length - 1;

            if (connectedClientByUserIdValues[x]) {
                do {
                    const connectedClientsConnectionIdValues = Object.values(connectedClientByUserIdValues[x]);
                    let y = connectedClientsConnectionIdValues.length - 1;

                    do {
                        if (connectedClientsConnectionIdValues[y].jwtToken === jwtToken) {
                            clientToClose = connectedClientsConnectionIdValues[y];
                        }
                    } while (y-- > 0);

                } while (x-- > 0);
            }

            that._close(clientToClose, constants.websocketErrorCodes.USER_DISCONNECTED);
        }

        function _unregisterClientByUserId() {
            if (that._connectedClients[userId])
                Object.values(that._connectedClients[userId]).forEach(client => that._close(client, constants.websocketErrorCodes.USER_DISCONNECTED));
        }
    }

    /**	
     * Registers the connection handler.
     */
    _registerConnectionHandler() {
        this._webSocketServer.on("connection", (/**@type {WebBusSocket} */ socket) => this._newConnection(socket));
    }

    /**
     * Registers handler for parsing cookie headers. 
     * In 99% of cases this should be necessary, but for tests it is.
     */
    _registerCookieHeaderParser() {
        this._webSocketServer.on("headers", (headers, req) => {
            req.headers.Authorization = req.headers.authorization;

            if (typeof req.headers.cookie === "string") {
                const cookies = {};
                const parts = req.headers.cookie.split("=");

                for (let i = 0; i < parts.length; i += 2) {
                    cookies[parts[i]] = parts[+1];
                }

                req.headers.cookie = cookies;
            }
        });
    }

    /**	
     * Handles new connections. 
     * Looks in the cookies for a jwt token and decodes it, then checks if the logged in user has the correct permissions.
     * If everything checks out, the connection is added to the list of connected users accessed by the user's id.
     * 
     * @param {WebBusSocket} socket websocket connection.
     * 
     * @return {Promise} promise.
     */
    async  _newConnection(socket) {
        const reqId = uuid.v4();

        let jwtToken;

        jwtToken = (socket.upgradeReq.headers.cookie && socket.upgradeReq.headers.cookie.jwt) || socket.upgradeReq.headers.Authorization;

        if (jwtToken)
            jwtToken = jwtToken.replace("Bearer ", "");

        const decodeTokenRequest = {
            cookies: {
                jwt: jwtToken
            }
        };

        socket.jwtToken = jwtToken;

        try {
            let connectedUser = await apiGateway.decodeToken(decodeTokenRequest, reqId);

            if ((!connectedUser || _.size(connectedUser) === 0) && conf.allowPublicWebsocketConnections) {
                connectedUser = { id: `public-${uuid.v4()}` };
            } else if (!conf.allowPublicWebsocketConnections) {
                return this._close(socket, constants.websocketErrorCodes.PERMISSION_DENIED);
            }

            if (!this._connectedClients[connectedUser.id])
                this._connectedClients[connectedUser.id] = {};

            let connectionId = uuid.v4();
            this._connectedClients[connectedUser.id][connectionId] = socket;

            log.debug("client", connectionId, "for user", connectedUser.id, "connected");

            socket.on("close", (reasonCode, description) => this._handleCloseEventForConnection(socket, connectedUser, connectionId, reasonCode, description));
            socket.on("message", (msg) => this._handleIncomingWebsocketRequest(msg, socket));

            socket.resume();
        } catch (err) {
            log.error(err);
            return this._close(socket, constants.websocketErrorCodes.INVALID_TOKEN);
        }
    }

    /**
     * Handles close-event for websocket connection. 
     * Removes connected client from registers of connect clients.
     * 
     * @param {WebBusSocket} socket socket connection
     * @param {Object} connectedUser user connected to websocket
     * @param {String} connectionId connection id for the user
     */
    _handleCloseEventForConnection(socket, connectedUser, connectionId, reasonCode, description) {
        delete this._connectedClients[connectedUser.id][connectionId];

        if (_.size(this._connectedClients[connectedUser.id]) === 0)
            delete this._connectedClients[connectedUser.id];

        log.debug("client", connectionId, "for user", connectedUser.id, "disconnected", reasonCode, description);
    }

    /**
     * Handles incoming websocket message.  
     * Sends request on bus to provided subject (only allowed subjects) and publishes the response back to the websocket connection.
     * Decodes token stored when connection is made so that the latest version of the user is provided with all requests. 
     * 
     * @param {Buffer|Object} msg message sent by the client   
     * @param {WebBusSocket} socket socket connection
     */
    async _handleIncomingWebsocketRequest(msg, socket) {
        const json = JSON.parse(msg.toString());
        const responseSubject = `res.${json.message.transactionId}.${json.subject}`;

        let connectedUserObject;

        if (socket.jwtToken) {
            const decodeTokenReq = { cookies: {} };
            decodeTokenReq.cookies[conf.authCookieName] = socket.jwtToken;
            connectedUserObject = await apiGateway.decodeToken(decodeTokenReq, json.message.reqId);
        }

        const req = json.message;
        const parsedFields = webBusUtils.parseWebsocketRequest(json, socket);

        req.user = connectedUserObject;
        req.method = parsedFields.method;
        req.path = parsedFields.path;
        req.headers = parsedFields.headers;

        if (json.message.query)
            req.query = json.message.query;

        if (json.message.params)
            req.params = json.message.params;

        if (!webBusUtils.isValidWebsocketRequest(json.subject)) {
            const errorResponse = {
                subject: responseSubject,
                status: 404,
                reqId: json.message.reqId
            }

            socket.send(JSON.stringify(errorResponse));
        }

        let responseForWebsocket;

        try {
            responseForWebsocket = await bus.request({
                subject: json.subject,
                message: req,
                skipOptionsRequest: json.skipOptionsRequest,
                timeout: json.timeout
            });
        } catch (err) {
            responseForWebsocket = err;
        }

        /** @type {Object} */
        const responseJson = Object.assign({}, responseForWebsocket);
        responseJson.subject = responseSubject;

        socket.send(JSON.stringify(responseJson));

    }

    /**	
     * Validates a user has the correct scopes configureds in conf.webSocketPermissionScope.
     * 
     * @param {Object} loggedInUser the logged in user.
     * 
     * @return {Boolean} whether or not the user has all the required scopes.
     */
    _validatePermissions(loggedInUser) {
        return conf.webSocketPermissionScope
            .filter(scope => loggedInUser.scopes.includes(scope)).length === conf.webSocketPermissionScope.length;
    }

    /** 
     * Sends a message to all connected users.
     * 
     * @param {Object} req request to send to all users.
     * @param {String} actualSubject the subject to send to. 
     */
    _publishToAllClients(req, actualSubject) {
        _.forIn(this._connectedClients, (clientObj, clientId) => {
            const subject = actualSubject.replace("*", clientId);
            this._sendToAllConnectionsForClient(clientId, req, subject);
        });
    }

    /**
     * Sends a message to all connections of a list of users.
     * 
     * @param {Array<String>} userIds 
     * @param {Object} req 
     * @param {String} actualSubject 
     */
    _sendToAllConnectionsForClients(userIds, req, actualSubject) {
        userIds.forEach(userId => {
            const subject = actualSubject.replace("*", userId);
            this._sendToAllConnectionsForClient(userId, req, subject);
        });
    }

    /** 
     * Sends a message to all connections of a user.
     * 
     * @param {String} userId id of the user to send to. 
     * @param {Object} req request to send to all clients.
     * @param {String} actualSubject the subject to send to. 
     */
    _sendToAllConnectionsForClient(userId, req, actualSubject) {
        if (this._connectedClients[userId]) {
            _.forIn(this._connectedClients[userId], (client, connectionId) => {
                this._sendToOneConnection(client, req, actualSubject);
            });
        }
    }

    /** 
     * Sends a message to one socket connection.
     * 
     * @param {WebBusSocket} socket the socket to send message to.
     * @param {Object} req request to send to all clients.
     * @param {String} actualSubject the subject to send to. 
     */
    _sendToOneConnection(socket, req, actualSubject) {
        if (socket.readyState === WebSocket.OPEN) {
            req.subject = actualSubject;
            socket.send(JSON.stringify(req));
        }
    }

    /**	
     * Closes a connection to a client with a 1011 status code.
     * 
     * @param {WebBusSocket} socket connection to a client.
     * @param {String=} reason reason why closing
     */
    _close(socket, reason) {
        if (socket)
            socket.close(1011, reason);
    }

}

module.exports = FrusterWebBus;