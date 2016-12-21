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
var _log = () => {};
var _topics = {};
var _connectionOptions;

/**
 * Add a function a handle the incoming SNS messages
 *
 * @param {function} handler Handler function
 */
var addHandler = module.exports.addHandler = (handler) => {
    _server.route({
        method: '*',
        path: '/',
        handler: handler
    });
};

/**
 * Initialise the server for receiving the SNS messages
 *
 * @param {ServerlessInstance} [serverless] Serverless instance
 * @param {Object} [options] Options
 * @param {string} [options.location] Root path of lambda functions
 * @param {string} [options.host] Host address for the server to listen on
 */
module.exports.create = (serverless, options) => {
    _options = options || {};
    _options.location = _options.location || '.';
    _serverless = serverless;
    if (serverless) {
        _log = _serverless.cli.log.bind(_serverless.cli);
    }

    _server = new Hapi.Server({
        connections: {
            router: {
                stripTrailingSlash: true
            }
        }
    });

    _connectionOptions = {
        host: _options.host || process.env.SNS_HOST,
        port: _options.snsport || process.env.SNS_PORT || 9493
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

/**
 * Create a fake SNSEvent to send to a Lambda function
 *
 * @param {Object} params SNS Message parameters
 *   (@see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SNS.html#publish-property)
 *
 * @returns {SNSEvent}
 */
const createFakeEvent = module.exports.createFakeEvent = (params, messageId) => {
    const topicArn = params.TopicArn;
    const message = params.Message;
    if (!messageId) {
        messageId = uuid();
    }

    return {
        Records: [
            {
                EventSource: 'aws:sns',
                EventVersion: '1.0',
                Sns: {
                    Type: 'Notification',
                    MessageId: messageId,
                    TopicArn: topicArn,
                    Subject: params.Subject,
                    Message: params.Message
                }
            }
        ]
    };
};

const createFakeResponse = module.exports.createFakeResponse = (messageId) => {
    // Generate Message ID
    const requestId = uuid();
    if (!messageId) {
        messageId = uuid();
    }

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

    return jsontoxml(response);
};

/**
 * Run a given function as a lambda function receiving a SNS message
 *
 * @param {Object} params SNS Message parameters
 *   (@see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SNS.html#publish-property)
 * @param {function} lambda Function to run
 * @param {string} name Name of function for lambda context
 */
const runLambda = module.exports.runLambda = (params, lambda, name) => {
    const snsEvent = createFakeEvent(params);

    const lambdaContext = createLambdaContext({
        name: name
    });

    lambda(snsEvent, lambdaContext);
};

/**
 * Extracts and configures the lambda functions associated with SNS messages
 * in the Serverless configuration file
 *
 * @param {ServerlessInstance} serverless Serverless Instance
 */
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

    addHandler((request, reply) => {
        if (typeof request.payload === 'object') {
            if (request.payload.TopicArn) {
                const topicArn = request.payload.TopicArn;
                _log(`Received message for ${topicArn}`);

                // Generate Message ID
                const messageId = uuid();

                reply(createFakeResponse(messageId)).code(200).type('application/xml');

                const topic = _topics[topicArn];
                if (typeof topic !== 'undefined') {
                    // Build the fake SNSEvent object
                    let snsEvent = createFakeEvent(request.payload, messageId);

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
    });
};

/**
 * Starts the server to listen for the SNS messages
 */
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

/**
 * Stops the server listening for SNS messages
 */
module.exports.close = () => {
    return _server.stop().then(() => {
        _log('Offline SNS stopped');
    });;
};

