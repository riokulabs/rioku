/**
 * Notification channels feature — barrel exports.
 */
export {
  useChannelList,
  useChannelDetail,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
} from './api';

export {
  emailChannelConfigSchema,
  slackChannelConfigSchema,
  webhookChannelConfigSchema,
  pagerdutyChannelConfigSchema,
  teamsChannelConfigSchema,
  smsChannelConfigSchema,
  channelConfigSchemas,
  CHANNEL_KINDS,
  channelKindSchema,
  createChannelSchema,
  updateChannelSchema,
  parseChannelConfig,
} from './schemas';

export type {
  CreateChannelFormValues,
  UpdateChannelFormValues,
} from './schemas';

export type {
  ChannelFilter,
  CreateChannelInput,
  NotificationChannel,
  TestChannelResult,
  UpdateChannelInput,
} from './types';
