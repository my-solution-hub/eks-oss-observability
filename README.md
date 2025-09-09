# EKS OSS Observability

A comprehensive observability solution for Amazon EKS using open-source tools and AWS managed services.

## Architecture

``` text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   EKS Cluster   │───▶│   Prometheus     │───▶│    Grafana      │
│                 │    │   (AMP)          │    │   (AMG)         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────────┐
│   Log Streams   │───▶│   OpenSearch     │
│                 │    │   + Application  │
└─────────────────┘    └──────────────────┘
```

**Components:**

- **Amazon EKS**: Kubernetes cluster for workloads
- **Amazon Managed Prometheus (AMP)**: Metrics collection and storage
- **Amazon Managed Grafana (AMG)**: Metrics visualization and dashboards
- **Amazon OpenSearch**: Log aggregation and search
- **OpenSearch Application**: Managed dashboard interface for logs

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK v2.199.0+
- kubectl configured for EKS access

**Required AWS Permissions:**

- EKS cluster management
- VPC and networking resources
- IAM roles and policies
- OpenSearch domain management
- Prometheus and Grafana workspace creation

## Deployment Process

### 1. Install Dependencies

```bash
cd cdk
npm install
```

### 2. Deploy Infrastructure

```bash
# Deploy all stacks in order
npm run deploy

# Or deploy individually:
npx cdk deploy NetworkStack
npx cdk deploy InfrastructureStack  
npx cdk deploy ObservabilityStack
```

```bash
# Check stack outputs
npx cdk list
aws cloudformation describe-stacks --stack-name dev-observability-stack --query 'Stacks[0].Outputs --no-cli-pager'
```

### 3. Configure kubectl for EKS

After infrastructure deployment, configure kubectl to access the EKS cluster:

```bash
# Get cluster name from CloudFormation output
CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name dev-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
  --output text)

# Update kubeconfig
aws eks update-kubeconfig --region <your-region> --alias $CLUSTER_NAME --name $CLUSTER_NAME  
```

### 4. Configure OpenSearch Application VPC Access

After CDK deployment completes, run the VPC endpoint authorization script:

```bash
cd .. # move to root folder of the project
./scripts/authorize-vpc-endpoint.sh
```

This script:

- Extracts the OpenSearch domain name from CloudFormation
- Authorizes VPC endpoint access for OpenSearch Application dashboard
- Enables secure access to the OpenSearch dashboard through VPC endpoints

### 5. Manual Configuration

1. Grafana
   - Configure Authentication to login
   - Verify login
2. OpenSearch Dashboard
   - After the deployment you can login to the AWS web console and check if OpenSearch UI works.
   - Make sure you have configured admin permission for dashboard UIIf everything works fine you can log into OpenSearch Dashboard and create a workspace (Observability) to validate result.

### 6. Deploy FluentBit, Otel Collector and Applications

```shell

# deploy fluentbit and otel collector
./scripts/deploy-log.sh

./scripts/deploy-otel.sh

# build image locally (requires docker) and push to ECR
./scripts/build-push.sh

# deploy apps - deploy script will build the app again
./scripts/deploy-apps.sh
```

### 7. Verify Deployment

```shell
kubectl get pods -A
```

Hopefully you can see the same - everything works

```text
default              hello-service-546ccc7b87-dpdbn        1/1     Running   1 (4m54s ago)   5m46s
default              hello-service-546ccc7b87-rb4nw        1/1     Running   0               4m2s
default              otel-collector-dc8694b7f-n4d6n        1/1     Running   0               15s
default              traffic-generator-7b88cc95bb-mcg6h    1/1     Running   0               4m58s
default              world-service-668bc8b54c-b4bfg        1/1     Running   0               6m24s
default              world-service-668bc8b54c-nl25l        1/1     Running   0               7m23s
kube-state-metrics   kube-state-metrics-7644897d6c-llgx8   1/1     Running   0               5h39m
kube-system          aws-node-b2lql                        2/2     Running   0               5h37m
kube-system          aws-node-csxnz                        2/2     Running   0               5h37m
kube-system          coredns-68bb4d6745-9f8z7              1/1     Running   0               5h43m
kube-system          coredns-68bb4d6745-hcjdg              1/1     Running   0               5h43m
kube-system          ebs-csi-controller-584ff59648-7tv4p   6/6     Running   0               5h38m
kube-system          ebs-csi-controller-584ff59648-bzcmc   6/6     Running   0               5h38m
kube-system          ebs-csi-node-mss6r                    3/3     Running   0               5h37m
kube-system          ebs-csi-node-tf2jd                    3/3     Running   0               5h37m
kube-system          eks-pod-identity-agent-d7g65          1/1     Running   0               5h37m
kube-system          eks-pod-identity-agent-fshb9          1/1     Running   0               5h37m
kube-system          fluent-bit-2fpjj                      1/1     Running   0               73s
kube-system          fluent-bit-kk498                      1/1     Running   0               74s
kube-system          kube-proxy-5tbh5                      1/1     Running   0               5h37m
kube-system          kube-proxy-p4w46                      1/1     Running   0               5h37m
```

Verify Metrics

- login to Grafana dashboard and add prometheus as new data source. As scraper is created, there should be metrics already.

Verify Logs and Traces

- Create index pattern for search - "logs-*", "otel-v1-apm-service-map" and "otel-v1-apm-span-*"
- Check if Logs and Traces presents in OpenSearch

Add OpenSearch Plugin and Add data source

## Configuration

The deployment creates:

- **Network Stack**: VPC, subnets, security groups
- **Infrastructure Stack**: EKS cluster with OIDC provider
- **Observability Stack**: Prometheus, Grafana, OpenSearch with Application

Environment-specific configurations are managed through the `StackConfig` in `/cdk/lib/stack-config.ts`.

## Access

- **Grafana Dashboard**: Available via AMG workspace endpoint (requires AWS SSO)
- **OpenSearch Dashboard**: Available via OpenSearch Application endpoint
- **Prometheus**: Accessible via AMP workspace for queries

## Security

- All services deployed within VPC with private subnets
- Security groups restrict access to necessary ports
- IAM roles follow least-privilege principle
- OpenSearch domain uses VPC endpoints for secure access
- HTTPS enforced for all endpoints
