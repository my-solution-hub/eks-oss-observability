#!/bin/bash

# Get OpenSearch domain name from CDK stack resources
DOMAIN_NAME=$(aws cloudformation describe-stack-resources \
  --stack-name dev-observability-stack \
  --logical-resource-id OpenSearchClusterFEB9E14E \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text \
  --no-cli-pager)

REGION=$(aws configure get region)

echo "Domain name: $DOMAIN_NAME"
echo "Region: $REGION"

# Authorize VPC endpoint access for OpenSearch Application
aws opensearch authorize-vpc-endpoint-access \
  --domain-name "$DOMAIN_NAME" \
  --service application.opensearchservice.amazonaws.com \
  --region "$REGION" \
  --no-cli-pager

echo "VPC endpoint access authorized for domain: $DOMAIN_NAME in region: $REGION"
