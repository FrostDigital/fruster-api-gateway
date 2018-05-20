const mongo = require("mongodb");
const conf = require("../../conf");
const ResponseTimeRepo = require("../../lib/repos/ResponseTimeRepo");

let repo;

module.exports = {
    index: async (req, res) => {
        res.render("index");
    },

    search: async (req, res) => {
        const repo = await getRepo();

        let query = {};

        if (req.query.q) {
            query = {
                subject: new RegExp(req.query.q)
            };
        }

        const result = await repo.findByQuery(query);

        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(result));
    }
}

async function getRepo() {
    if (!repo) {
        const db = await mongo.connect(conf.mongoUrl);
        repo = new ResponseTimeRepo(db);
    }

    return repo;
}