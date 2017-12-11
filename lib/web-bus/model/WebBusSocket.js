const WebSocket = require("ws");

/**
 * Only used for JsDoc
 */
class WebBusSocket extends WebSocket {

    constructor(address, options, jwtToken, upgradeReq) {
        super(address, options);
        this.jwtToken = jwtToken;
        this.upgradeReq = {
            headers: {
                Authorization: "",
                cookie: { jwt: "" }
            }
        };
    }

}

module.exports = WebBusSocket;