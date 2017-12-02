'use strict';

var server = require('./lib/server');

class OfflineSNS {
    constructor (serverless, options) {
        this.serverless = serverless;
        this.options = options;
        const start = this.start.bind(this);

        this.commands = {
            'offline-sns': {
                usage: 'Simulates SNS service to call your lambda functions offline.',
                lifecycleEvents: ['start'],
                commands: {
                    start: {
                        usage: 'Starts SNS service offline using backward compatible initialization.'
                    }
                },
                options: {
                    host: {
                        usage: 'The host name to listen on. Default: localhost',
                        shortcut: 'o'
                    },
                    port: {
                        usage: 'Port to listen on. Default: 9493',
                        shortcut: 'P'
                    }
                }
            }
        };

        this.hooks = {
            'offline:start:init': start,
            'offline:start': start,
            'offline-sns:start': start
        };
    }

    start () {
        server.create(this.serverless, this.options);
        server.parseSLSConfig(this.serverless);
        return server.listen();
    }
}

module.exports = OfflineSNS;
