import { createModel } from '../db/mongoose-compat';
import { customerNotifications } from '../db/schema';

export type NotificationCategory = 'promo' | 'order' | 'loyalty' | 'system';

export interface ICustomerNotification {
  user: string;
  title: string;
  body: string;
  link?: string | null;
  linkLabel?: string | null;
  category: NotificationCategory;
  read: boolean;
  readAt?: Date | null;
  campaignId?: string | null;
  audience?: string | null;
  createdAt: Date;
}

export const CustomerNotification = createModel(customerNotifications);

export default CustomerNotification;
