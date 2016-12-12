serverless-offline-sns [![Build Status](https://travis-ci.org/rockabox/serverless-offline-sns.svg?branch=master)](https://travis-ci.org/rockabox/serverless-offline-sns)
==================
Simple implementation of a fake SNS server for serverless-offline

Currently only implements sending SNS messages to lamba functions configured
through Serverless (with no authentication).

When included as a plugin in the Serverless configuration along with
serverless-offline, an HTTP server will be started to listen for SNS message
publish messages. The SNS events in the Serverless configuration will be read and the associated handlers will be run whenever a SNS message of the given
topic is received.

The HTTP server should be configured as the SNS endpoint for messages that
should be sent to the Lambda functions.
