import { createModel } from '../db/mongoose-compat';
import { promotionCampaignLogs } from '../db/schema';

export interface IPromotionCampaignLog {
  promotionId: string;
  channel: 'email' | 'push';
  triggeredBy: 'manual' | 'cron';
  recipientCount: number;
  successCount: number;
  failureCount: number;
  subject?: string;
  error?: string;
  createdAt: Date;
}

export const PromotionCampaignLog = createModel(promotionCampaignLogs);

export default PromotionCampaignLog;
