'use strict';

const ApiBuilder = require('claudia-api-builder');
const validUrl = require('valid-url');
const Knex = require('knex');

class ApiError extends Error {}

const hashid = require('./hashid');

const api = new ApiBuilder();

const tx = function(req, work) {
  const knex = Knex({
    client: 'pg',
    connection: req.env.pgUrl,
    acquireConnectionTimeout: 1000
  });
  return work(knex)
    .catch(err => {
      if(!(err instanceof ApiError)) {
        err = new ApiError('Internal Error: ' + err.toString());
      }
      throw err;
    })
    .finally(() => knex.destroy());
};

api.get('/ping', function() {
  return 'pong!';
});

api.get('/links', function(req) {
  return tx(req, (knex => {
    return knex
      .select('hash as id', 'url', 'created_at')
      .from('urls')
      .orderBy('urls.id', 'desc')
      .offset(0)
      .limit(30);
  }));
}, { success: 200, error: 200, apiKeyRequired: true });

api.get('/links/{id}', function(req) {
  const hash = req.pathParams.id;
  if(!hash) {
    throw new ApiError('Bad Request: Invalid ID passed');
  }

  return tx(req, (knex => {
    return knex
      .select('hash as id', 'url', 'created_at')
      .from('urls')
      .where({ hash: hash })
      .then(results => {
        const item = results && results[0];
        if(!item) {
          throw new ApiError('Not Found: Link not found with short ID: ' + hash);
        }
        return item;
      });
  }));
}, { success: 200, error: 200, apiKeyRequired: true });

api.post('/links', function(req) {
  if(!validUrl.isWebUri(req.body.url)) {
    throw new ApiError('Bad Request: Validation error: not a valid URL: ' + req.body.url);
  }

  const hasCustomHash = 'id' in req.body;

  const item = {
    hash: req.body.id || hashid.generate(4),
    url: req.body.url
  };

  return tx(req, (knex => {
    return knex
      .insert(item)
      .into('urls')
      .returning(['hash as id', 'url', 'created_at'])
      .then(results => {
        const item = results && results[0];
        if(!item) {
          throw new Error('Service temporarily unavailable, please try again.');
        }
        return item;
      }, err => {
        if(err.message && err.message.indexOf('violates unique constraint "urls_hash_uniq"') > 0) {
          // Could not insert: hash already used.
          if(hasCustomHash) {
            // User-specified hash is already present in database.
            err = new ApiError('Bad Request: Validation error: ID already used: ' + req.body.id);

          } else {
            // Otherwise, throw a general error.
            err = new Error('Service temporarily unavailable, please try again.');
          }
        }

        throw err;
      });
  }));

}, { success: 201, error: 201, apiKeyRequired: true });

api.addPostDeployConfig('pgUrl', 'Postgres DB Connection String:', 'configure-db');

api.addPostDeployStep('apiErrorHandlers', function(commandLineOptions, lambdaProperties, utils) {
  const apiGateway = utils.apiGatewayPromise;
  const resources = {};

  const addErrorHandler = function(resourceId, methodName, statusCode, pattern) {
    const methodResponseParams = {
      'method.response.header.Access-Control-Allow-Origin': false,
      'method.response.header.Access-Control-Allow-Headers': false
    };
    const integrationResponseParams = {
      'method.response.header.Access-Control-Allow-Origin': '\'*\'',
      'method.response.header.Access-Control-Allow-Headers': '\'Content-Type,X-Amz-Date,Authorization,X-Api-Key\''
    };

    const responseTemplates = {
      'application/json': ''
    };

    const responseModels = {
      'application/json': 'Empty'
    };

    return apiGateway.putMethodResponsePromise({
      restApiId: lambdaProperties.apiId,
      resourceId: resourceId,
      httpMethod: methodName,
      statusCode: statusCode,
      responseParameters: methodResponseParams,
      responseModels: responseModels
    }).then(function () {
      return apiGateway.putIntegrationResponsePromise({
        restApiId: lambdaProperties.apiId,
        resourceId: resourceId,
        httpMethod: methodName,
        statusCode: statusCode,
        selectionPattern: pattern,
        responseParameters: integrationResponseParams,
        responseTemplates: responseTemplates
      });
    });
  };

  return apiGateway
    .getResourcesPromise({
      restApiId: lambdaProperties.apiId
    })
    .then(r => {
      r.items.forEach(function(item) {
        resources[item.path] = item;
      });
    })
    .then(() => addErrorHandler(resources['/links'].id, 'GET', '500', '^Internal Error: .*'))
    .then(() => addErrorHandler(resources['/links/{id}'].id, 'GET', '400', '^Bad Request: .*'))
    .then(() => addErrorHandler(resources['/links/{id}'].id, 'GET', '404', '^Not Found: .*'))
    .then(() => addErrorHandler(resources['/links/{id}'].id, 'GET', '500', '^Internal Error: .*'))
    .then(() => addErrorHandler(resources['/links'].id, 'POST', '400', '^Bad Request: .*'))
    .then(() => addErrorHandler(resources['/links'].id, 'POST', '500', '^Internal Error: .*'))
    .delay(20000)   // Try to limit AWS SDK rate-limiting
    .then(() => {
      // Needed to propagate changes from above
      return apiGateway.createDeploymentPromise({
        restApiId: lambdaProperties.apiId,
        stageName: lambdaProperties.alias,
        variables: {
          lambdaVersion: lambdaProperties.alias
        }
      });
    });
});

module.exports = api;
