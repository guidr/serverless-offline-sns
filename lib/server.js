'use strict';

const Hapi = require('hapi'),
    path = require('path'),
    uuid = require('uuid/v1'),
    fs = require('fs'),
    jsontoxml = require('jsontoxml'),
    corsHeaders = require('hapi-cors-headers'),
    functionHelper = require('serverless-offline/src/functionHelper'),
    createLambdaContext = require('serverless-offline/src/createLambdaContext');

var _server;
var _options;
var _serverless;
var _log;
var _topics = {};
var _connectionOptions;

module.exports.create = (serverless, options) => {
    _options = options || {};
    _options.location = _options.location || '.';
    _serverless = serverless;
    _log = _serverless.cli.log.bind(_serverless.cli);

    _server = new Hapi.Server({
        connections: {
            router: {
                stripTrailingSlash: true
            }
        }
    });

    _connectionOptions = {
        host: process.env.SNS_HOST || _options.host,
        port: process.env.SNS_PORT || 9493
    };
    const httpsDir = _options.httpsProtocol;

    // HTTPS support
    if (typeof httpsDir === 'string' && httpsDir.length > 0) {
        _connectionOptions.tls = {
            key: fs.readFileSync(path.resolve(httpsDir, 'key.pem'), 'ascii'),
            cert: fs.readFileSync(path.resolve(httpsDir, 'cert.pem'), 'ascii')
        };
    }

    // Passes the configuration object to the server
    _server.connection(_connectionOptions);

    // Enable CORS preflight response
    _server.ext('onPreResponse', corsHeaders);
};

module.exports.parseSLSConfig = (serverless) => {
    const service = serverless.service;

    if (typeof service === 'object' && typeof service.functions === 'object') {
        Object.keys(service.functions).forEach(key => {
            const serviceFunction = service.getFunction(key);
            const servicePath = path.join(_serverless.config.servicePath, _options.location);

            serviceFunction.events.forEach(event => {
                if (!event.sns) {
                    return;
                }

                let topicName;
                if (typeof event.sns === 'string') {
                    topicName = event.sns;
                } else if (typeof event.sns === 'object') {
                    topicName = event.sns.topicName;
                }

                _log(`Found SNS listener for ${topicName}`);

                if (typeof _topics[topicName] === 'undefined') {
                    _topics[topicName] = {
                        handlers: []
                    };
                }

                // Add function to topic handlers
                _topics[topicName].handlers.push({
                    name: key,
                    subscriptionId: uuid(),
                    context: serviceFunction,
                    options: functionHelper.getFunctionOptions(serviceFunction, key, servicePath)
                });
            });
        });
    }

    _server.route({
        method: '*',
        path: '/',
        handler: (request, reply) => {
            if (typeof request.payload === 'object') {
                if (request.payload.TopicArn) {
                    const topicArn = request.payload.TopicArn;
                    const message = request.payload.Message;
                    _log(`Received message for ${topicArn}`);

                    // Generate Message ID
                    const messageId = uuid();
                    const requestId = uuid();

                    // Reply with XML if good
                    const response = {
                        PublishResponse: {
                            attr: {
                                xmlns: 'http://sns.amazonaws.com/doc/2010-03-31/'
                            },
                            PublishResult: {
                                MessageId: messageId
                            },
                            ResponseMetadata: {
                                RequestId: requestId
                            }
                        }
                    };

                    reply(jsontoxml(response)).code(200).type('application/xml');

                    const topic = _topics[topicArn];
                    if (typeof topic !== 'undefined') {
                        // Build the fake SNSEvent object
                        let snsEvent = {
                            Records: [
                                {
                                    EventSource: 'aws:sns',
                                    EventVersion: '1.0',
                                    Sns: {
                                        Type: 'Notification',
                                        MessageId: messageId,
                                        TopicArn: topicArn,
                                        Subject: request.payload.Subject,
                                        Message: message
                                    }
                                }
                            ]
                        };

                        topic.handlers.forEach(handlerItem => {
                            const lambdaContext = createLambdaContext(handlerItem.context);
                            const handler = functionHelper.createHandler(handlerItem.options, _options);

                            snsEvent.Records[0].EventSubscription = `${topicArn}:${handlerItem.subscriptionId}`;

                            // Try and call handler
                            try {
                                handler(snsEvent, lambdaContext);
                            } catch (error) {
                                _log(`Uncaught error in your '${handlerItem.name}' handler`, error);
                            }
                        });
                    }

                    return;
                }
            }

            // Send Error response
            reply().code(400);
        }
    });
};

module.exports.listen = () => {
    return new Promise((resolve, reject) => {
        _server.start(err => {
            if (err) {
                return reject(err);
            }

            _log('Offline SNS listening on http' + (_connectionOptions.tls ? 's' : '') +
                '://' + _connectionOptions.host + ':' + _connectionOptions.port);

            resolve(_server);
        });
    });
};

