import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as eks from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as aps from 'aws-cdk-lib/aws-aps'
import * as grafana from 'aws-cdk-lib/aws-grafana'
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice'
import * as osis from 'aws-cdk-lib/aws-osis'
import * as fs from 'fs'
import * as path from 'path'
import { Construct } from 'constructs'
import { StackConfig, ExportNames, CrossStackUtils } from './stack-config'

/**
 * ObservabilityStack manages monitoring, logging, and observability infrastructure
 */
export class ObservabilityStack extends cdk.Stack {
  public readonly prometheusWorkspace: aps.CfnWorkspace
  public readonly grafanaWorkspace: grafana.CfnWorkspace
  public readonly opensearchDomain: opensearch.Domain

  constructor (
    scope: Construct,
    id: string,
    config: StackConfig,
    props?: cdk.StackProps
  ) {
    super(scope, id, props)

    // Import VPC for OpenSearch domain
    const vpcId = CrossStackUtils.importValue(ExportNames.NETWORK_VPC_ID)
    const vpcCidr = CrossStackUtils.importValue(ExportNames.NETWORK_VPC_CIDR)
    const privateSubnetIds = CrossStackUtils.importListValue(
      ExportNames.NETWORK_PRIVATE_SUBNET_IDS
    )

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ImportedVpc', {
      vpcId,
      vpcCidrBlock: vpcCidr,
      availabilityZones: cdk.Fn.getAzs(),
      privateSubnetIds
    })

    // Create security group for OpenSearch
    const opensearchSecurityGroup = new ec2.SecurityGroup(
      this,
      'OpenSearchSecurityGroup',
      {
        vpc,
        description: 'Security group for OpenSearch domain',
        allowAllOutbound: false
      }
    )

    // Allow HTTPS access from VPC CIDR
    opensearchSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS access for OpenSearch and OSIS pipelines'
    )

    opensearchSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow outbound HTTPS traffic'
    )

    // Import EKS resources from InfrastructureStack for IRSA configuration
    const oidcProviderArn = CrossStackUtils.importValue(
      ExportNames.INFRA_OIDC_PROVIDER_ARN
    )
    const oidcProviderIssuer = CrossStackUtils.importValue(
      ExportNames.INFRA_OIDC_PROVIDER_ISSUER
    )

    // Import EKS cluster name for the collector
    const clusterName = CrossStackUtils.importValue(
      ExportNames.INFRA_CLUSTER_NAME
    )

    // Create Amazon Managed Prometheus workspace
    this.prometheusWorkspace = new aps.CfnWorkspace(
      this,
      'PrometheusWorkspace',
      {
        alias: `${config.environment}-eks-observability-workspace`,
        tags: [
          {
            key: 'Environment',
            value: config.environment
          },
          {
            key: 'Stack',
            value: 'Observability'
          },
          {
            key: 'Project',
            value: 'eks-observability'
          }
        ]
      }
    )

    // Load scrape configuration from file
    const scrapeConfigPath = path.resolve(
      __dirname,
      '../../k8s-res/prom/scraper.yaml'
    )
    const scrapeConfig = fs.readFileSync(scrapeConfigPath, 'utf8')

    // Create managed Prometheus collector for EKS cluster
    new aps.CfnScraper(this, 'EksPrometheusCollector', {
      alias: `${config.environment}-eks-collector`,
      scrapeConfiguration: {
        configurationBlob: scrapeConfig
      },
      source: {
        eksConfiguration: {
          clusterArn: `arn:aws:eks:${this.region}:${this.account}:cluster/${clusterName}`,
          subnetIds: CrossStackUtils.importListValue(
            ExportNames.NETWORK_PRIVATE_SUBNET_IDS
          )
        }
      },
      destination: {
        ampConfiguration: {
          workspaceArn: this.prometheusWorkspace.attrArn
        }
      }
    })

    // Create IAM role for Grafana to access Prometheus, CloudWatch, and OpenSearch
    const grafanaRole = new iam.Role(this, 'GrafanaServiceRole', {
      roleName: `${config.environment}-grafana-service-role`,
      assumedBy: new iam.ServicePrincipal('grafana.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonGrafanaCloudWatchAccess'
        )
      ],
      inlinePolicies: {
        PrometheusAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aps:ListWorkspaces',
                'aps:DescribeWorkspace',
                'aps:QueryMetrics',
                'aps:GetLabels',
                'aps:GetSeries',
                'aps:GetMetricMetadata'
              ],
              resources: ['*']
            })
          ]
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'es:ESHttpGet',
                'es:DescribeElasticsearchDomains',
                'es:ListDomainNames',
                'aoss:ListCollections'
              ],
              resources: ['*']
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['es:ESHttpPost'],
              resources: [
                'arn:aws:es:*:*:domain/*/_msearch*',
                'arn:aws:es:*:*:domain/*/_opendistro/_ppl',
                'arn:aws:es:*:*:domain/*/collection/*'
              ]
            })
          ]
        })
      }
    })

    // Create Amazon Managed Grafana workspace
    this.grafanaWorkspace = new grafana.CfnWorkspace(this, 'GrafanaWorkspace', {
      accountAccessType: 'CURRENT_ACCOUNT',
      authenticationProviders: ['AWS_SSO'],
      permissionType: 'SERVICE_MANAGED',
      name: `${config.environment}-eks-observability-grafana`,
      description: `Grafana workspace for EKS observability in ${config.environment}`,
      dataSources: ['PROMETHEUS', 'CLOUDWATCH', 'AMAZON_OPENSEARCH_SERVICE'],
      roleArn: grafanaRole.roleArn,
      grafanaVersion: '10.4',
      pluginAdminEnabled: true,
      vpcConfiguration: {
        securityGroupIds: [opensearchSecurityGroup.securityGroupId],
        subnetIds: privateSubnetIds
      }
    })

    // Create IAM role for EKS service account to write to Prometheus
    // Use CfnJson to handle cross-stack token resolution in trust policy
    const trustPolicyDocument = new cdk.CfnJson(this, 'TrustPolicyDocument', {
      value: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Federated: oidcProviderArn
            },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                [`${oidcProviderIssuer}:sub`]:
                  'system:serviceaccount:prometheus:amp-iamproxy-ingest-service-account',
                [`${oidcProviderIssuer}:aud`]: 'sts.amazonaws.com'
              }
            }
          }
        ]
      }
    })

    const prometheusServiceAccountRole = new iam.CfnRole(
      this,
      'PrometheusServiceAccountRole',
      {
        roleName: `${config.environment}-prometheus-service-account-role`,
        assumeRolePolicyDocument: trustPolicyDocument,
        policies: [
          {
            policyName: 'PrometheusRemoteWrite',
            policyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'aps:RemoteWrite',
                    'aps:GetSeries',
                    'aps:GetLabels',
                    'aps:GetMetricMetadata'
                  ],
                  Resource: this.prometheusWorkspace.attrArn
                }
              ]
            }
          }
        ]
      }
    )

    // Create OpenSearch domain for log aggregation (VPC internal access)
    this.opensearchDomain = new opensearch.Domain(this, 'OpenSearchCluster', {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      vpc: vpc,
      vpcSubnets: [
        {
          subnets: [
            ec2.Subnet.fromSubnetId(
              this,
              'OpenSearchSubnet',
              cdk.Fn.select(0, privateSubnetIds)
            )
          ]
        }
      ],
      securityGroups: [opensearchSecurityGroup],
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType:
          config.environment === 'prod' ? 'r5.large.search' : 't3.small.search',
        masterNodes: 0,
        multiAzWithStandbyEnabled: false
      },
      ebs: {
        volumeSize: config.environment === 'prod' ? 50 : 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3
      },
      zoneAwareness: {
        enabled: false
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      enforceHttps: true,
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AccountRootPrincipal()],
          actions: [
            'es:ESHttpGet',
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpDelete',
            'es:ESHttpHead'
          ],
          resources: ['*']
        })
      ]
    })

    // Create IAM role for OpenSearch Ingestion pipelines
    const ingestionRole = new iam.Role(this, 'IngestionRole', {
      assumedBy: new iam.ServicePrincipal('osis-pipelines.amazonaws.com'),
      inlinePolicies: {
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'es:ESHttpPost',
                'es:ESHttpPut',
                'es:ESHttpGet',
                'es:DescribeDomain',
                'es:DescribeDomains',
                'servicediscovery:*'
              ],
              resources: ['*']
            })
          ]
        })
      }
    })

    // Add ingestion role to OpenSearch access policy
    this.opensearchDomain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(ingestionRole.roleArn)],
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpHead'
        ],
        resources: [
          this.opensearchDomain.domainArn,
          `${this.opensearchDomain.domainArn}/*`
        ]
      })
    )

    // Logs ingestion pipeline
    // TODO: Add OSIS pipelines for log and trace processing
    const logsConfigPath = path.resolve(
      __dirname,
      '../config/logs-pipeline.yaml'
    )
    const logsConfig = fs
      .readFileSync(logsConfigPath, 'utf8')
      .replace(
        '${OPENSEARCH_ENDPOINT}',
        `https://${this.opensearchDomain.domainEndpoint}`
      )
      .replace('${INGESTION_ROLE_ARN}', ingestionRole.roleArn)
      .replace('${AWS_REGION}', this.region)

    const logLogGroup = new cdk.aws_logs.LogGroup(this, 'LogPipelineLogGroup', {
      logGroupName: `/aws/vendedlogs/OpenSearchIngestion/${config.environment}-logs-pipeline/logs`,
      retention: cdk.aws_logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })
    const logsPipeline = new osis.CfnPipeline(this, 'LogsPipeline', {
      pipelineName: `${config.environment}-logs-pipeline`,
      minUnits: 1,
      maxUnits: 4,
      pipelineConfigurationBody: logsConfig,
      logPublishingOptions: {
        cloudWatchLogDestination: {
          logGroup: logLogGroup.logGroupName
        },
        isLoggingEnabled: true
      },
      vpcOptions: {
        subnetIds: privateSubnetIds,
        securityGroupIds: [opensearchSecurityGroup.securityGroupId]
      }
    })

    // // Traces ingestion pipeline
    const tracesConfigPath = path.resolve(
      __dirname,
      '../config/traces-pipeline.yaml'
    )
    const tracesConfig = fs
      .readFileSync(tracesConfigPath, 'utf8')
      .replace(
        /\$\{OPENSEARCH_ENDPOINT\}/g,
        `https://${this.opensearchDomain.domainEndpoint}`
      )
      .replace(/\$\{INGESTION_ROLE_ARN\}/g, ingestionRole.roleArn)
      .replace(/\$\{AWS_REGION\}/g, cdk.Stack.of(this).region)
    // create log group for traces pipeline

    const tracesLogGroup = new cdk.aws_logs.LogGroup(this, 'TracesPipelineLogGroup', {
      logGroupName: `/aws/vendedlogs/OpenSearchIngestion/${config.environment}-traces-pipeline/logs`,
      retention: cdk.aws_logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })
    const tracesPipeline = new osis.CfnPipeline(this, 'TracesPipeline', {
      pipelineName: `${config.environment}-traces-pipeline`,
      minUnits: 1,
      maxUnits: 4,
      logPublishingOptions: {
        cloudWatchLogDestination: {
          logGroup: tracesLogGroup.logGroupName
        },
        isLoggingEnabled: true
      },
      pipelineConfigurationBody: tracesConfig,
      vpcOptions: {
        subnetIds: privateSubnetIds,
        securityGroupIds: [opensearchSecurityGroup.securityGroupId]
      }
    })

    tracesPipeline.addDependency(
      ingestionRole.node.defaultChild as cdk.CfnResource
    )

    // Create OpenSearch Application for observability dashboard
    const opensearchApplication = new opensearch.CfnApplication(
      this,
      'ObservabilityApplication',
      {
        name: `${config.environment}-observability-app`,
        dataSources: [
          {
            dataSourceArn: this.opensearchDomain.domainArn,
            dataSourceDescription: 'EKS observability logs and metrics'
          }
        ]
      }
    )

    // Add tags to all resources
    cdk.Tags.of(this.prometheusWorkspace).add('Environment', config.environment)
    cdk.Tags.of(this.grafanaWorkspace).add('Environment', config.environment)
    cdk.Tags.of(this.opensearchDomain).add('Environment', config.environment)
    cdk.Tags.of(opensearchApplication).add('Environment', config.environment)

    // Export observability service information
    CrossStackUtils.createExport(
      this,
      'PrometheusWorkspaceIdExport',
      this.prometheusWorkspace.attrWorkspaceId,
      ExportNames.OBS_PROMETHEUS_WORKSPACE_ID,
      'Amazon Managed Prometheus Workspace ID'
    )

    CrossStackUtils.createExport(
      this,
      'PrometheusEndpointExport',
      this.prometheusWorkspace.attrPrometheusEndpoint,
      ExportNames.OBS_PROMETHEUS_ENDPOINT,
      'Amazon Managed Prometheus Endpoint'
    )

    CrossStackUtils.createExport(
      this,
      'GrafanaWorkspaceIdExport',
      this.grafanaWorkspace.attrId,
      ExportNames.OBS_GRAFANA_WORKSPACE_ID,
      'Amazon Managed Grafana Workspace ID'
    )

    CrossStackUtils.createExport(
      this,
      'GrafanaEndpointExport',
      this.grafanaWorkspace.attrEndpoint,
      ExportNames.OBS_GRAFANA_ENDPOINT,
      'Amazon Managed Grafana Endpoint'
    )

    CrossStackUtils.createExport(
      this,
      'OpenSearchEndpointExport',
      this.opensearchDomain.domainEndpoint,
      ExportNames.OBS_OPENSEARCH_ENDPOINT,
      'OpenSearch Domain Endpoint'
    )

    // Create IAM role for OTEL collector (Pod Identity)
    const otelCollectorRole = new iam.CfnRole(this, 'OtelCollectorRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'pods.eks.amazonaws.com'
            },
            Action: ['sts:AssumeRole', 'sts:TagSession']
          }
        ]
      },
      description: 'IAM role for OTEL collector using Pod Identity',
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/AmazonEKSClusterPolicy'
      ],
      policies: [
        {
          policyName: 'PrometheusAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['aps:RemoteWrite'],
                Resource: this.prometheusWorkspace.attrArn
              }
            ]
          }
        },
        {
          policyName: 'OSISTraceAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'osis:Ingest',
                  'osis:BatchGetCollection',
                  'osis:GetPipeline'
                ],
                Resource: `arn:aws:osis:${this.region}:${this.account}:pipeline/${config.environment}-traces-pipeline`
              }
            ]
          }
        },
        {
          policyName: 'OpenSearchAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'es:ESHttpPost',
                  'es:ESHttpPut',
                  'es:ESHttpGet'
                ],
                Resource: [
                  this.opensearchDomain.domainArn,
                  `${this.opensearchDomain.domainArn}/*`
                ]
              }
            ]
          }
        },
        {
          policyName: 'EC2ResourceDetection',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'ec2:DescribeInstances',
                  'ec2:DescribeInstanceTypes',
                  'ec2:DescribeRegions',
                  'ec2:DescribeAvailabilityZones'
                ],
                Resource: '*'
              }
            ]
          }
        }
      ]
    })

    // Create Pod Identity Association for OTEL collector
    new eks.CfnPodIdentityAssociation(this, 'OtelCollectorPodIdentity', {
      clusterName: clusterName,
      namespace: 'default',
      serviceAccount: 'otel-collector',
      roleArn: otelCollectorRole.attrArn
    })

    new cdk.CfnOutput(this, 'PrometheusWorkspaceId', {
      value: this.prometheusWorkspace.attrWorkspaceId,
      description: 'Amazon Managed Prometheus Workspace ID'
    })

    new cdk.CfnOutput(this, 'PrometheusEndpoint', {
      value: this.prometheusWorkspace.attrPrometheusEndpoint,
      description: 'Amazon Managed Prometheus Endpoint'
    })

    new cdk.CfnOutput(this, 'GrafanaWorkspaceId', {
      value: this.grafanaWorkspace.attrId,
      description: 'Amazon Managed Grafana Workspace ID'
    })

    new cdk.CfnOutput(this, 'GrafanaEndpoint', {
      value: this.grafanaWorkspace.attrEndpoint,
      description: 'Amazon Managed Grafana Endpoint'
    })

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: this.opensearchDomain.domainEndpoint,
      description: 'OpenSearch Domain Endpoint'
    })

    new cdk.CfnOutput(this, 'PrometheusServiceAccountRoleArn', {
      value: prometheusServiceAccountRole.attrArn,
      description: 'IAM Role ARN for Prometheus service account'
    })

    new cdk.CfnOutput(this, 'GrafanaRoleArn', {
      value: grafanaRole.roleArn,
      description: 'IAM Role ARN for Grafana service'
    })

    new cdk.CfnOutput(this, 'OpenSearchApplicationId', {
      value: opensearchApplication.attrId,
      description: 'OpenSearch Application ID'
    })

    new cdk.CfnOutput(this, 'OpenSearchApplicationArn', {
      value: opensearchApplication.attrArn,
      description: 'OpenSearch Application ARN'
    })

    // Pipeline ingestion URLs
    new cdk.CfnOutput(this, 'LogsIngestionUrl', {
      value: cdk.Fn.select(0, logsPipeline.attrIngestEndpointUrls),
      description: 'Logs pipeline ingestion URL'
    })

    new cdk.CfnOutput(this, 'TracesIngestionUrl', {
      value: cdk.Fn.select(0, tracesPipeline.attrIngestEndpointUrls),
      description: 'Traces pipeline ingestion URL'
    })

    new cdk.CfnOutput(this, 'OtelCollectorRoleArn', {
      value: otelCollectorRole.attrArn,
      description: 'OTEL Collector IAM Role ARN'
    })
  }
}
