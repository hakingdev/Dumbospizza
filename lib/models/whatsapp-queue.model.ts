import { createModel } from '../db/mongoose-compat';
import { whatsappQueue } from '../db/schema';

export interface IWhatsAppQueue {
  phone: string;
  text: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  error?: string;
  orderId?: string;
  createdAt: Date;
  sentAt?: Date;
}

export const WhatsAppQueue = createModel(whatsappQueue);

export default WhatsAppQueue;
