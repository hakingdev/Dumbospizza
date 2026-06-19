import mongoose from 'mongoose';

export interface IWhatsAppQueue {
  phone: string;
  text: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  orderId?: string;
  createdAt: Date;
  sentAt?: Date;
}

const WhatsAppQueueSchema = new mongoose.Schema<IWhatsAppQueue>(
  {
    phone: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    error: { type: String },
    orderId: { type: String },
    sentAt: { type: Date }
  },
  { timestamps: true }
);

WhatsAppQueueSchema.index({ status: 1, createdAt: 1 });

export const WhatsAppQueue =
  mongoose.models.WhatsAppQueue ||
  mongoose.model<IWhatsAppQueue>('WhatsAppQueue', WhatsAppQueueSchema);

export default WhatsAppQueue;
