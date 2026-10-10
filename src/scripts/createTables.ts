import {
  CreateTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { dynamoClient, tables } from '../config/aws';

const S = 'S' as const;

/** GSI with a partition key and createdAt as sort key (so lists come back newest-first). */
function gsi(name: string, partitionKey: string) {
  return {
    IndexName: name,
    KeySchema: [
      { AttributeName: partitionKey, KeyType: 'HASH' as const },
      { AttributeName: 'createdAt', KeyType: 'RANGE' as const },
    ],
    Projection: { ProjectionType: 'ALL' as const },
  };
}

export function definitions(): CreateTableCommandInput[] {
  return [
    {
      TableName: tables.users,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'userId', AttributeType: S },
        { AttributeName: 'email', AttributeType: S },
      ],
      KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'email-index',
          KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      TableName: tables.pickups,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pickupId', AttributeType: S },
        { AttributeName: 'residentId', AttributeType: S },
        { AttributeName: 'collectorId', AttributeType: S },
        { AttributeName: 'status', AttributeType: S },
        { AttributeName: 'createdAt', AttributeType: S },
      ],
      KeySchema: [{ AttributeName: 'pickupId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        gsi('residentId-index', 'residentId'),
        gsi('collectorId-index', 'collectorId'),
        gsi('status-index', 'status'),
      ],
    },
    {
      TableName: tables.handoffs,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'handoffId', AttributeType: S },
        { AttributeName: 'pickupId', AttributeType: S },
      ],
      KeySchema: [{ AttributeName: 'handoffId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'pickupId-index',
          KeySchema: [{ AttributeName: 'pickupId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    },
    {
      // Small, admin-only table; listed with a Scan (see alertService). Add a GSI on createdAt
      // if it ever needs paging.
      TableName: tables.alerts,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'alertId', AttributeType: S }],
      KeySchema: [{ AttributeName: 'alertId', KeyType: 'HASH' }],
    },
  ];
}

/** Creates all 4 tables (skipping existing ones) and waits until each is ACTIVE. */
export async function createTables(): Promise<void> {
  for (const def of definitions()) {
    const name = def.TableName!;
    try {
      await dynamoClient.send(new CreateTableCommand(def));
      console.log(`Creating ${name}...`);
    } catch (err) {
      if (err instanceof ResourceInUseException) {
        console.log(`${name} already exists, skipping`);
        continue;
      }
      throw err;
    }
    await waitUntilTableExists({ client: dynamoClient, maxWaitTime: 300 }, { TableName: name });
    console.log(`${name} is ACTIVE`);
  }
  console.log('Done.');
}

if (require.main === module) {
  createTables().catch((err) => {
    console.error('createTables failed:', err);
    process.exit(1);
  });
}
