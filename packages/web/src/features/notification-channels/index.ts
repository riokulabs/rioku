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

export type { CreateChannelFormValues, UpdateChannelFormValues } from './schemas';

export type {
  ChannelFilter,
  CreateChannelInput,
  NotificationChannel,
  TestChannelResult,
  UpdateChannelInput,
} from './types';

export { ChannelList } from './components/list';
export { ChannelFilterBar } from './components/filter-bar';
export { ChannelDetail } from './components/detail';
export { ChannelForm } from './components/form';
export { ChannelKindConfigPanel } from './components/kind-config-panel';
export { TestPanel } from './components/test-panel';
