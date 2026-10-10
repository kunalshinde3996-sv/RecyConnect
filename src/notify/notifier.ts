import { PublishCommand } from '@aws-sdk/client-sns';
import { sns } from '../config/aws';
import { env } from '../config/env';
import type { Alert } from '../types';
import { log } from '../utils/logger';

/**
 * Where alerts go once they are stored. alertService depends only on this interface, so moving
 * from SNS to e.g. EventBridge, Slack or SES means one new class and a change to getNotifier().
 */
export interface Notifier {
  readonly name: string;
  publish(alert: Alert): Promise<void>;
}

/**
 * Publishes to the SNS topic in SNS_TOPIC_ARN (the "SNS" box in the architecture diagram).
 * Subscribers (email/SMS for ops, a Lambda, an SQS queue) are configured on the topic, not here.
 * The `type` message attribute lets subscriptions filter, e.g. SMS only for missed_pickup.
 * Works unchanged against LocalStack (AWS_ENDPOINT) or real AWS (AWS_ENDPOINT unset).
 */
export class SnsNotifier implements Notifier {
  readonly name = 'sns';

  constructor(private readonly topicArn: string) {}

  async publish(alert: Alert): Promise<void> {
    await sns.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        // SNS subjects are limited to 100 printable ASCII characters (used as the email subject).
        Subject: `[RecyConnect] ${alert.type.replace(/_/g, ' ')}`.slice(0, 100),
        Message: JSON.stringify(alert),
        MessageAttributes: {
          type: { DataType: 'String', StringValue: alert.type },
          pickupId: { DataType: 'String', StringValue: alert.pickupId },
        },
      }),
    );
  }
}

/** Fallback when SNS_TOPIC_ARN is unset: the alert is still stored, and logged here. */
export class LogNotifier implements Notifier {
  readonly name = 'log';

  async publish(alert: Alert): Promise<void> {
    log().info({ event: 'alert_not_published', alertId: alert.alertId, type: alert.type }, 'SNS_TOPIC_ARN unset; alert stored only');
  }
}

let notifier: Notifier | undefined;

export function getNotifier(): Notifier {
  if (!notifier) {
    const topicArn = env.snsTopicArn;
    notifier = topicArn ? new SnsNotifier(topicArn) : new LogNotifier();
  }
  return notifier;
}

/** For tests. */
export function setNotifier(n: Notifier | undefined): void {
  notifier = n;
}
