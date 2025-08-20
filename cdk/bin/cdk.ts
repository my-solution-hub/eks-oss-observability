#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { NetworkStack } from '../lib/network-stack'
import { InfrastructureStack } from '../lib/infrastructure-stack'
import { ObservabilityStack } from '../lib/observability-stack'
import { ConfigLoader, CrossStackUtils } from '../lib/stack-config'

const app = new cdk.App()

// Get environment and region from context or environment variables
const environment =
  app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev'
const region =
  app.node.tryGetContext('region') ||
  process.env.CDK_DEFAULT_REGION ||
  'ap-southeast-1'
const account =
  app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT

// Load configuration for the environment
const config = ConfigLoader.loadConfig(environment, region)
ConfigLoader.validateConfig(config)

// Define common stack properties
const stackProps: cdk.StackProps = {
  env: {
    account,
    region
  },
  description: `EKS Observability Stack - ${environment} environment`,
  tags: {
    Environment: environment,
    Project: 'eks-observability',
    ManagedBy: 'CDK'
  }
}

// Create NetworkStack
const networkStack = new NetworkStack(
  app,
  CrossStackUtils.generateStackName(environment, 'network'),
  config,
  stackProps
)

// Create InfrastructureStack (depends on NetworkStack)
const infrastructureStack = new InfrastructureStack(
  app,
  CrossStackUtils.generateStackName(environment, 'infrastructure'),
  config,
  stackProps
)
infrastructureStack.addDependency(networkStack)

// Create ObservabilityStack (depends on both NetworkStack and InfrastructureStack)
const observabilityStack = new ObservabilityStack(
  app,
  CrossStackUtils.generateStackName(environment, 'observability'),
  config,
  stackProps
)
observabilityStack.addDependency(networkStack)
observabilityStack.addDependency(infrastructureStack)

// Add additional tags to identify stack relationships
cdk.Tags.of(networkStack).add('StackType', 'Network')
cdk.Tags.of(infrastructureStack).add('StackType', 'Infrastructure')
cdk.Tags.of(observabilityStack).add('StackType', 'Observability')

// Output deployment information
console.log(
  `Deploying EKS Observability stacks for environment: ${environment}`
)
console.log(`Region: ${region}`)
console.log(`Account: ${account || 'default'}`)
console.log(`Stack names:`)
console.log(`  - ${networkStack.stackName}`)
console.log(`  - ${infrastructureStack.stackName}`)
console.log(`  - ${observabilityStack.stackName}`)
