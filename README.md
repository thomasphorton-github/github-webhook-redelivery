# GitHub Webhook Redelivery

This repository contains an AWS Lambda function that will query an organization's webhook deliveries and store them in DynamoDB. This allows users with networks that restrict incoming webhooks to move to a poll-based approach.

## Example Architecture
![Architecture diagram showing EventBridge triggering the Lambda function, which gathers data from various GitHub APIs and pushes the data to DynamoDB](./assets/webhook-replay.drawio.png)