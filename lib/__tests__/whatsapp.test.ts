import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueMock = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../models/whatsapp-queue.model', () => ({
  WhatsAppQueue: queueMock,
  default: queueMock,
}));

import { enqueueWhatsAppMessageOnce } from '../whatsapp';

describe('enqueueWhatsAppMessageOnce', () => {
  beforeEach(() => {
    queueMock.findOne.mockReset();
    queueMock.create.mockReset();
  });

  it('does not enqueue a duplicate pending/sent message for the same order', async () => {
    queueMock.findOne.mockResolvedValue({ id: 'existing' });

    const queued = await enqueueWhatsAppMessageOnce({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      orderId: '260623008',
    });

    expect(queued).toBe(false);
    expect(queueMock.create).not.toHaveBeenCalled();
  });

  it('enqueues the first message for an order', async () => {
    queueMock.findOne.mockResolvedValue(null);
    queueMock.create.mockResolvedValue({ id: 'new' });

    const queued = await enqueueWhatsAppMessageOnce({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      orderId: '260623008',
    });

    expect(queued).toBe(true);
    expect(queueMock.create).toHaveBeenCalledWith({
      phone: '+491234567',
      text: 'Ihre Bestellung 260623008 wurde zugestellt.',
      status: 'pending',
      orderId: '260623008',
    });
  });
});
