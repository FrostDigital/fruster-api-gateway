module.exports = {

    /**
     * @param {String} subject subject to validate
     */
    isValidWebsocketRequest: (subject) => {
        const methods = ["post", "put", "delete", "get"];
        let isValid = true;

        isValid = isValid && !!methods.find(method => subject.includes(method));

        return isValid;
    },

    parseWebsocketRequest(json, socket) {
        const parsedFields = {};

        parsedFields.method = json.subject.split(".")[1].toUpperCase();
        parsedFields.path = json.subject.substring(json.subject.indexOf(json.subject.split(".")[2]));
        parsedFields.path = replaceAll(parsedFields.path, ".", "/");
        parsedFields.headers = {
            cookie: `jwt=${socket.jwtToken}`
        };
        parsedFields.headers["user-agent"] = "websocket";

        return parsedFields;
    }

};

function replaceAll(target, search, replacement) {
    return target.split(search).join(replacement);
};