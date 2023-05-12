const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });

const org = process.env.GH_ORG;
const hook_id = process.env.GH_HOOKID;
const appId = process.env.GH_APPID;
const privateKey = fs.readFileSync('./certs/github-app-private-key.pem', 'utf8');
const tableName = process.env.DYNAMO_TABLENAME;

// Define the Lambda function handler
exports.handler = async (event, context) => {
  // Create a new Octokit instance
  let octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey
    }
  });

  // Get the installation ID for the app
  const installations = await octokit.rest.apps.listInstallations();

  const installationId = installations.data[0].id;

  // Create a new Octokit instance
  octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId
    }
  });

  // get webhook deliveries for the organization
  let webhookDeliveries = await getWebhookDeliveries(octokit, hook_id, org);

  console.log(webhookDeliveries);

  let webhookPayloadPromises = webhookDeliveries.map(async (delivery) => {
    return new Promise(async (resolve, reject) => {
      try {
        let delivery_id = delivery.id;
        let payload = await octokit.request('GET /orgs/{org}/hooks/{hook_id}/deliveries/{delivery_id}', {
          org,
          hook_id,
          delivery_id,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        })
  
        let pushData = payload.data.request.payload;
        let repository = pushData.repository.name;
        let user = pushData.pusher.name;

        let record = {
          "repo#user": `${repository}#${user}`,
          id: `${repository}#${user}`,
          ref: pushData.ref,
          before: pushData.before,
          after: pushData.after,
          repository: repository,
          user: user,
          timestamp: pushData.repository.pushed_at
        };

        resolve(record);
      }
      catch(e) {
        reject(e);
      }
    })
  });

  // when all promises are resolved, write to dynamodb
  let webhookPayloads = await Promise.all(webhookPayloadPromises);

  // for each webhook payload, write to dynamodb
  let dynamoPromises = webhookPayloads.map(async (payload) => {
    return new Promise(async (resolve, reject) => {

      let id = payload.id;

      try {
        const params = {
          TableName: tableName,
          Item: payload,
          ReturnValues: 'ALL_OLD'
        };
        const result = await dynamodb.put(params).promise();
        console.log(`Successfully upserted item with ID ${id}`);
      }
      catch (error) {
        console.error(`Error upserting item with ID ${id}: ${error}`);
        // reject(error);
      }
    });
  });

  let dynamoResponse = await Promise.all(dynamoPromises);
  
  // Return a success response
  return {
    statusCode: 200,
    body: `Successfully processed ${webhookDeliveries.length} webhook deliveries.`
  };
};

async function getWebhookDeliveries(octokit, hook_id, org) {
  // Get the organization events
  let events = await octokit.rest.orgs.listWebhookDeliveries({
    org,
    hook_id,
    per_page: 1
  });

  let totalEventCount = events.data.length;
  let pushEvents = [];

  // append push events to pushEvents array
  pushEvents = [].concat.apply(pushEvents, events.data.filter(event => event.event === 'push'));
  
  // if response header contains a link
  if (events.headers.link) {
    // parse cursor from link header
    let link = events.headers.link.split(',')[0];
    let linkRel = link.split(';')[1];
  
    let linkDirection = (linkRel.includes('next') ? 'next' : 'prev');
  
    while (linkDirection === 'next') {
      link = link.split(';')[0];
      link = link.replace('<', '');
      link = link.replace('>', '');
      link = link.replace(' ', '');
      link = link.replace('rel="next"', '');
  
      events = await octokit.request(link);
      totalEventCount = totalEventCount + events.data.length;

      // append push events to pushEvents array
      pushEvents = [].concat.apply(pushEvents, events.data.filter(event => event.event === 'push'));

      link = events.headers.link.split(',')[0];
      linkRel = link.split(';')[1];
      linkDirection = (linkRel.includes('next') ? 'next' : 'prev');
    }
  }

  // Log the organization events
  console.log(`Found ${totalEventCount} events.`);
  console.log(`Found ${pushEvents.length} push events.`);
  return pushEvents;
};