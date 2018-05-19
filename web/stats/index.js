const mongo = require("mongodb");
const conf = require("../../conf");
const ResponseTimeRepo = require("../../lib/repos/ResponseTimeRepo");

module.exports.get = async (req, res) => {

    const repo = await getRepo();

    const result = await repo.findByQuery();

    res.render("index", {
        result: result
    });
}

async function getRepo() {
    const db = await mongo.connect(conf.mongoUrl);
    return new ResponseTimeRepo(db);
}