'use strict';

const AWS = require('aws-sdk');
const ApiBuilder = require('claudia-api-builder');
const shortid = require('shortid');
const validUrl = require('valid-url');

const api = new ApiBuilder();
const docClient = new AWS.DynamoDB.DocumentClient();

api.get('/ping', function() {
  return 'pong!';
});

api.get('/links', function(req) {
  const params = {
    TableName: req.env.tableName
  };

  return docClient.scan(params).promise().then(results => {
    return results.Items;
  });
});

api.get('/links/{id}', function(req) {
  if(!req.pathParams.id) {
    throw new Error('Invalid ID');
  }

  const params = {
    TableName: req.env.tableName,
    Key: {
      hashId: req.pathParams.id
    }
  };

  return docClient.get(params).promise().then(results => {
    if(!results.Item) {
      throw new Error('Not Found');
    }
    return results.Item;
  });

}, { error: 400 });

api.post('/links', function(req) {
  if(!validUrl.isWebUri(req.body.url)) {
    throw new Error('Invalid URL');
  }

  const item = {
    hashId: shortid.generate(),
    createdAt: new Date().toISOString(),
    url: req.body.url
  };

  const params = {
    TableName: req.env.tableName,
    Item: item,
    ConditionExpression: 'attribute_not_exists(hashId)'
  };
  return docClient.put(params).promise().then(() => item);

}, { success: 201, error: 400 });

api.addPostDeployConfig('tableName', 'DynamoDB Table Name:', 'configure-db');

module.exports = api;
