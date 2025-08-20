import * as cdk from 'aws-cdk-lib'

/**
 * Configuration interface for all stacks in the multi-stack architecture
 */
export interface StackConfig {
  /** Environment name (dev, staging, prod) */
  environment: string
  /** AWS region for deployment */
  region: string
  /** VPC CIDR block (optional, defaults to auto-assigned) */
  vpcCidr?: string
  /** EKS Kubernetes version (optional, defaults to v1.31) */
  eksVersion?: string
  /** EC2 instance type for EKS nodes (optional, defaults to t3.large) */
  nodeInstanceType?: string
  /** Number of EKS nodes (optional, defaults to 3) */
  nodeCount?: number
}

/**
 * Cross-stack export names for consistent referencing
 */
export class ExportNames {
  private static formatExportName(stackType: string, resourceType: string, resourceName: string): string {
    return `${stackType}-${resourceType}-${resourceName}`
  }

  // Network Stack Exports
  static readonly NETWORK_VPC_ID = ExportNames.formatExportName('network', 'vpc', 'id')
  static readonly NETWORK_PRIVATE_SUBNET_IDS = ExportNames.formatExportName('network', 'subnets', 'private-ids')
  static readonly NETWORK_PUBLIC_SUBNET_IDS = ExportNames.formatExportName('network', 'subnets', 'public-ids')
  static readonly NETWORK_VPC_CIDR = ExportNames.formatExportName('network', 'vpc', 'cidr')

  // Infrastructure Stack Exports
  static readonly INFRA_CLUSTER_NAME = ExportNames.formatExportName('infra', 'eks', 'cluster-name')
  static readonly INFRA_CLUSTER_ARN = ExportNames.formatExportName('infra', 'eks', 'cluster-arn')
  static readonly INFRA_OIDC_PROVIDER_ARN = ExportNames.formatExportName('infra', 'eks', 'oidc-provider-arn')
  static readonly INFRA_OIDC_PROVIDER_ISSUER = ExportNames.formatExportName('infra', 'eks', 'oidc-provider-issuer')

  // Observability Stack Exports
  static readonly OBS_PROMETHEUS_WORKSPACE_ID = ExportNames.formatExportName('obs', 'prometheus', 'workspace-id')
  static readonly OBS_PROMETHEUS_ENDPOINT = ExportNames.formatExportName('obs', 'prometheus', 'endpoint')
  static readonly OBS_GRAFANA_WORKSPACE_ID = ExportNames.formatExportName('obs', 'grafana', 'workspace-id')
  static readonly OBS_GRAFANA_ENDPOINT = ExportNames.formatExportName('obs', 'grafana', 'endpoint')
  static readonly OBS_OPENSEARCH_ENDPOINT = ExportNames.formatExportName('obs', 'opensearch', 'endpoint')
}

/**
 * Utility functions for cross-stack operations
 */
export class CrossStackUtils {
  /**
   * Create a CfnOutput with consistent export naming
   */
  static createExport(scope: cdk.Stack, id: string, value: string, exportName: string, description?: string): cdk.CfnOutput {
    return new cdk.CfnOutput(scope, id, {
      value,
      exportName,
      description: description || `Export for ${exportName}`
    })
  }

  /**
   * Import a value from another stack using consistent naming
   */
  static importValue(exportName: string): string {
    return cdk.Fn.importValue(exportName)
  }

  /**
   * Import a list of values (like subnet IDs) from another stack
   */
  static importListValue(exportName: string): string[] {
    return cdk.Fn.split(',', cdk.Fn.importValue(exportName))
  }

  /**
   * Generate stack name with consistent naming convention
   */
  static generateStackName(environment: string, stackType: string): string {
    return `${environment}-${stackType}-stack`
  }
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<StackConfig> = {
  vpcCidr: undefined, // Let CDK auto-assign
  eksVersion: '1.31',
  nodeInstanceType: 't3.large',
  nodeCount: 3
}

/**
 * Environment-specific configuration loader
 */
export class ConfigLoader {
  /**
   * Load configuration for the specified environment
   */
  static loadConfig(environment: string, region: string, overrides?: Partial<StackConfig>): StackConfig {
    const baseConfig: StackConfig = {
      environment,
      region,
      ...DEFAULT_CONFIG,
      ...overrides
    }

    // Environment-specific overrides
    switch (environment) {
      case 'prod':
        return {
          ...baseConfig,
          nodeInstanceType: 't3.xlarge',
          nodeCount: 5
        }
      case 'staging':
        return {
          ...baseConfig,
          nodeInstanceType: 't3.large',
          nodeCount: 3
        }
      case 'dev':
      default:
        return {
          ...baseConfig,
          nodeInstanceType: 't3.medium',
          nodeCount: 2
        }
    }
  }

  /**
   * Validate configuration before use
   */
  static validateConfig(config: StackConfig): void {
    if (!config.environment) {
      throw new Error('Environment must be specified')
    }
    if (!config.region) {
      throw new Error('Region must be specified')
    }
    if (config.nodeCount && config.nodeCount < 1) {
      throw new Error('Node count must be at least 1')
    }
  }
}