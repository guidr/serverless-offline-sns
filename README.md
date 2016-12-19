serverless-offline-sns [![Build Status](https://travis-ci.org/rockabox/serverless-offline-sns.svg?branch=master)](https://travis-ci.org/rockabox/serverless-offline-sns)
==================
Simple implementation of a fake SNS server / SNS HTTP API endpoint for
serverless-offline.

As the sending of messages between the AWS SNS and Lambda is all internal, the
functionality can't exactly be replicated in a development environment without
a little bit of fudging.

With this plugin for serverless-offline, you either set the HTTP server the
plugin starts to receive SNS messages as an HTTP API endpoint in another SNS
instance or use it as the SNS endpoint for your calls to the AWS SNS SDK.

It currently only implements sending SNS messages to lamba functions configured
through Serverless (with no authentication).

When included as a plugin in the Serverless configuration along with
serverless-offline, an HTTP server will be started to listen for SNS message
publish messages. The SNS events in the Serverless configuration will be read
and the associated lambda functions will be run whenever a SNS message of the
given topic is received.

