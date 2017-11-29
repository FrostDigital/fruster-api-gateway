module.exports = {

    isValidWebsocketRequest: (subject) => {
        const methods = ["post", "put", "delete", "get"];
        let isValid = true;

        isValid = isValid && !!methods.find(method => subject.includes(method));

        return isValid;
    }

};