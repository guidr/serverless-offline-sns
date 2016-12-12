'use strict';

var server = require('./lib/server');

class OfflineSNS {
    constructor (serverless, options) {
        this.serverless = serverless;
        this.options = options;
        const start = this.start.bind(this);

        this.hooks = {
            'offline:start:init': start,
            'offline:start': start
        };
    }

    start () {
        server.create(this.serverless, this.options);
        server.parseSLSConfig(this.serverless);
        return server.listen();
    }
}

module.exports = OfflineSNS;
