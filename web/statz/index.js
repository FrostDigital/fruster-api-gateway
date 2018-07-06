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

        if (req.query.subject) {
            query.subject = {
                $regex: ".*" + req.query.subject + ".*"
            };
        }

        if (req.query.status) {
            query["$where"] = "/^" + req.query.status + "/.test(this.status)"
        }

        let limit = 1000;

        if (req.query.limit) {
            limit = parseInt(req.query.limit);
        }

        let sort = {};

        if (req.query.sort) {
            switch (req.query.sort) {
                case "CREATED_AT_DESC":
                    sort = {
                        createdAt: -1
                    };
                    break;

                case "CREATED_AT_ASC":
                    sort = {
                        createdAt: 1
                    };
                    break;

                case "TIME_DESC":
                    sort = {
                        time: -1
                    };
                    break;

                case "TIME_ASC":
                    sort = {
                        time: 1
                    };
                    break;
            }
        }

        const result = await repo.findByQuery(query, limit, sort);

        res.json(result);
    }
}

async function getRepo() {
    if (!repo) {
        const db = await mongo.connect(conf.mongoUrl);
        repo = new ResponseTimeRepo(db);
    }

    return repo;
}