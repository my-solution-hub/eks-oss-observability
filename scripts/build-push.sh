#!/bin/bash

APP_NAME=$1
PLATFORM=${2:-linux/amd64}
REGION=$(aws configure get region)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get cluster name from CloudFormation output
CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name dev-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
  --output text \
  --no-cli-pager)

echo "Using cluster name: $CLUSTER_NAME"

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

build_and_push() {
    local app=$1
    local repo_name="$CLUSTER_NAME-$app-service"
    if [ "$app" = "traffic-generator" ]; then
        repo_name="$CLUSTER_NAME-traffic-generator"
    fi
    
    echo "Building and pushing $app to $repo_name..."
    
    # Build and push (ECR repos created by CDK)
    docker build --platform $PLATFORM -t $app:latest ./app/$app
    docker tag $app:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$repo_name:latest
    docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$repo_name:latest
}

if [ -z "$APP_NAME" ]; then
    echo "Building and pushing all apps..."
    build_and_push "world"
    build_and_push "hello" 
    build_and_push "traffic-generator"
else
    build_and_push "$APP_NAME"
fi

echo "Build and push completed."
